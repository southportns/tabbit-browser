#!/usr/bin/env node
/**
 * Tabbit Browser MCP Server
 * 通过 Chrome DevTools Protocol 操控 Tabbit 浏览器内置 AI
 *
 * 工具列表:
 *   tabbit_chat        - 发送消息给 Tabbit AI
 *   tabbit_screenshot  - 截图
 *   tabbit_pdf         - 导出 PDF
 *   tabbit_device      - 设备仿真
 *   tabbit_network     - 网络管理 (Cookie/拦截/限速)
 *   tabbit_storage     - 存储管理 (登录态导出/导入)
 *   tabbit_input       - 高级输入 (点击/键盘/拖拽)
 *   tabbit_tabs        - 多标签管理
 *   tabbit_status      - 连接状态
 *   tabbit_launch      - 启动 Tabbit
 */

const { TabbitClient, TabbitBrowser, DeviceManager } = require('./lib/tabbit');
const { NetworkManager } = require('./lib/network');
const { StorageManager } = require('./lib/storage');
const { CaptureManager } = require('./lib/capture');
const { InputManager } = require('./lib/input');
const { MultiTabManager } = require('./lib/multi-tab');
const { Scheduler } = require('./lib/scheduler');
const fs = require('fs');

const PORT = parseInt(process.env.TABBIT_PORT || '9222', 10);

// ─── MCP 协议 ──────────────────────────────────────────────

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

// ─── 工具定义 ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'tabbit_chat',
    description: '发送消息给 Tabbit AI 并获取回复。支持单次对话和交互式对话。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '要发送的消息内容' },
        waitMs: { type: 'number', description: '等待回复的时间(ms)，默认 12000' },
      },
      required: ['message'],
    },
  },
  {
    name: 'tabbit_screenshot',
    description: '对当前页面截图。支持全页截图和元素截图。',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: '保存路径（可选）' },
        format: { type: 'string', enum: ['jpeg', 'png', 'webp'], description: '图片格式，默认 jpeg' },
        fullPage: { type: 'boolean', description: '是否全页截图' },
        selector: { type: 'string', description: 'CSS 选择器，截取指定元素' },
      },
    },
  },
  {
    name: 'tabbit_pdf',
    description: '将当前页面导出为 PDF 文件。',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: '保存路径' },
      },
    },
  },
  {
    name: 'tabbit_device',
    description: '设备仿真。可切换手机/平板/桌面视口、深色模式、地理定位等。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['emulate', 'viewport', 'reset', 'dark', 'geo', 'touch', 'timezone'],
          description: '操作类型',
        },
        device: { type: 'string', description: '设备名 (emulate 时使用): iphone-14, iphone-14-pro-max, ipad-pro, pixel-7, galaxy-s23, desktop-1080, desktop-1440' },
        width: { type: 'number', description: '视口宽度 (viewport 时使用)' },
        height: { type: 'number', description: '视口高度 (viewport 时使用)' },
        enabled: { type: 'boolean', description: '开启/关闭 (dark/touch 时使用)' },
        latitude: { type: 'number', description: '纬度 (geo 时使用)' },
        longitude: { type: 'number', description: '经度 (geo 时使用)' },
        timezone: { type: 'string', description: '时区 (timezone 时使用)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_network',
    description: '网络管理：查看/导出 Cookie、请求拦截、Mock 响应、屏蔽 URL、网络限速。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['cookies', 'export-cookies', 'import-cookies', 'block', 'mock', 'throttle', 'clear-cache', 'log'],
          description: '操作类型',
        },
        pattern: { type: 'string', description: 'URL 匹配模式 (block/mock 时使用)' },
        mockResponse: { type: 'object', description: 'Mock 响应内容 (mock 时使用)' },
        mode: { type: 'string', description: '限速模式: offline, slow-3g, fast-3g, 4g (throttle 时使用)' },
        filePath: { type: 'string', description: 'Cookie 文件路径 (import-cookies 时使用)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_storage',
    description: '存储管理：导出/导入登录态、清除存储、查看 localStorage。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['export', 'import', 'clear', 'local'],
          description: '操作类型',
        },
        origin: { type: 'string', description: '网站 origin (如 https://web.tabbit.com)' },
        filePath: { type: 'string', description: '登录态文件路径 (export/import 时使用)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_input',
    description: '高级输入：鼠标点击、键盘输入、快捷键、滚动、拖拽。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'type', 'key', 'hotkey', 'scroll', 'drag', 'select-all', 'copy', 'paste'],
          description: '操作类型',
        },
        x: { type: 'number', description: 'X 坐标 (click/drag 时使用)' },
        y: { type: 'number', description: 'Y 坐标 (click/drag 时使用)' },
        x2: { type: 'number', description: '目标 X (drag 时使用)' },
        y2: { type: 'number', description: '目标 Y (drag 时使用)' },
        text: { type: 'string', description: '输入文本 (type 时使用)' },
        key: { type: 'string', description: '按键名 (key 时使用): Enter, Tab, Escape, Backspace, ArrowUp 等' },
        hotkey: { type: 'string', description: '快捷键 (hotkey 时使用): ctrl+c, ctrl+v, ctrl+z 等' },
        direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向 (scroll 时使用)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_tabs',
    description: '多标签管理：列出标签、新建标签、关闭标签。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'open', 'close'],
          description: '操作类型',
        },
        url: { type: 'string', description: '打开的 URL (open 时使用)' },
        targetId: { type: 'string', description: '标签 ID (close 时使用)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_status',
    description: '检查 Tabbit 连接状态、浏览器版本、当前页面列表。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tabbit_launch',
    description: '启动 Tabbit 浏览器（带调试端口）。',
    inputSchema: {
      type: 'object',
      properties: {
        killExisting: { type: 'boolean', description: '是否关闭现有实例', default: true },
      },
    },
  },
  {
    name: 'tabbit_new',
    description: '在 Tabbit 中打开新对话页面。',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── 工具执行 ──────────────────────────────────────────────

async function executeTool(name, args) {
  const browser = new TabbitBrowser({ port: PORT });
  const client = browser.client();

  try {
    switch (name) {
      case 'tabbit_chat': {
        const result = await client.chat(args.message, { waitMs: args.waitMs || 12000 });
        return { content: [{ type: 'text', text: result.text }], model: result.model, url: result.url };
      }

      case 'tabbit_screenshot': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const cap = new CaptureManager(session);

        let result;
        if (args.selector) {
          result = await cap.elementScreenshot(args.selector, { format: args.format || 'jpeg', outputPath: args.outputPath });
        } else if (args.fullPage) {
          result = await cap.fullPageScreenshot({ format: args.format || 'jpeg', outputPath: args.outputPath });
        } else {
          result = await cap.screenshot({ format: args.format || 'jpeg', outputPath: args.outputPath });
        }
        session.close();
        return { content: [{ type: 'text', text: `截图已保存: ${result.path}` }], path: result.path };
      }

      case 'tabbit_pdf': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const cap = new CaptureManager(session);
        const result = await cap.toPDF({ outputPath: args.outputPath });
        session.close();
        return { content: [{ type: 'text', text: `PDF 已保存: ${result.path}` }], path: result.path };
      }

      case 'tabbit_device': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const device = new DeviceManager(session);

        switch (args.action) {
          case 'emulate': {
            const info = await device.emulateDevice(args.device);
            session.close();
            return { content: [{ type: 'text', text: `已仿真: ${args.device} (${info.viewport.width}x${info.viewport.height})` }] };
          }
          case 'viewport':
            await device.setViewport(args.width, args.height);
            session.close();
            return { content: [{ type: 'text', text: `视口: ${args.width}x${args.height}` }] };
          case 'reset':
            await device.resetViewport();
            session.close();
            return { content: [{ type: 'text', text: '视口已恢复默认' }] };
          case 'dark':
            await device.setDarkMode(args.enabled !== false);
            session.close();
            return { content: [{ type: 'text', text: `深色模式: ${args.enabled !== false ? '开启' : '关闭'}` }] };
          case 'geo':
            await device.setGeolocation(args.latitude, args.longitude);
            session.close();
            return { content: [{ type: 'text', text: `定位: ${args.latitude}, ${args.longitude}` }] };
          case 'touch':
            await device.enableTouchEmulation(args.enabled !== false);
            session.close();
            return { content: [{ type: 'text', text: `触摸仿真: ${args.enabled !== false ? '开启' : '关闭'}` }] };
          case 'timezone':
            await device.setTimezone(args.timezone || 'Asia/Shanghai');
            session.close();
            return { content: [{ type: 'text', text: `时区: ${args.timezone || 'Asia/Shanghai'}` }] };
          default:
            session.close();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      case 'tabbit_network': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const net = new NetworkManager(session);
        await net.enable();

        switch (args.action) {
          case 'cookies': {
            const cookies = await net.getCookies([target.url]);
            session.close();
            return { content: [{ type: 'text', text: cookies.map(c => `${c.name}=${c.value.substring(0, 30)}... (${c.domain})`).join('\n') }], cookies };
          }
          case 'export-cookies': {
            const json = await net.exportCookies([target.url]);
            session.close();
            return { content: [{ type: 'text', text: json }], cookies: JSON.parse(json) };
          }
          case 'import-cookies': {
            const data = fs.readFileSync(args.filePath, 'utf-8');
            const count = await net.importCookies(JSON.parse(data));
            session.close();
            return { content: [{ type: 'text', text: `已导入 ${count} 个 Cookie` }] };
          }
          case 'block':
            net.block(args.pattern);
            session.close();
            return { content: [{ type: 'text', text: `已屏蔽: ${args.pattern}` }] };
          case 'mock':
            net.mock(args.pattern, args.mockResponse);
            session.close();
            return { content: [{ type: 'text', text: `已 Mock: ${args.pattern}` }] };
          case 'throttle':
            await net.emulateNetwork(args.mode || null);
            session.close();
            return { content: [{ type: 'text', text: args.mode ? `已限速: ${args.mode}` : '已恢复默认网络' }] };
          case 'clear-cache':
            await net.clearCache();
            session.close();
            return { content: [{ type: 'text', text: '缓存已清除' }] };
          case 'log': {
            const log = net.getRequestLog();
            session.close();
            return { content: [{ type: 'text', text: log.slice(-20).map(r => `${r.method} ${r.url.substring(0, 80)}`).join('\n') + `\n共 ${log.length} 条` }] };
          }
          default:
            session.close();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      case 'tabbit_storage': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const storage = new StorageManager(session);
        const origin = args.origin || target.url;

        switch (args.action) {
          case 'export': {
            const state = await storage.exportLoginState(origin);
            const filePath = args.filePath || 'login-state.json';
            fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
            session.close();
            return { content: [{ type: 'text', text: `登录态已导出到 ${filePath} (${state.cookies.length} cookies)` }], state };
          }
          case 'import': {
            const state = JSON.parse(fs.readFileSync(args.filePath, 'utf-8'));
            const result = await storage.importLoginState(state);
            session.close();
            return { content: [{ type: 'text', text: `已导入: ${result.cookiesImported} cookies, ${result.localStorageImported} localStorage` }] };
          }
          case 'clear':
            await storage.clearAll(origin);
            session.close();
            return { content: [{ type: 'text', text: `已清除 ${origin} 的所有存储` }] };
          case 'local': {
            const items = await storage.getLocalStorage(origin);
            session.close();
            return { content: [{ type: 'text', text: items.map(e => `${e.key} = ${e.value.substring(0, 50)}`).join('\n') || '(空)' }], items };
          }
          default:
            session.close();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      case 'tabbit_input': {
        let target = await client.getNewTabPage() || await client.getSessionPage();
        if (!target) {
          const targets = await client.getTargets();
          target = targets.find(t => t.type === 'page');
        }
        if (!target) throw new Error('No active page');
        const session = await client.connectTo(target);
        const input = new InputManager(session);

        switch (args.action) {
          case 'click':
            await input.mouseClick(args.x, args.y);
            session.close();
            return { content: [{ type: 'text', text: `点击: ${args.x}, ${args.y}` }] };
          case 'type':
            await session.send('Input.insertText', { text: args.text });
            session.close();
            return { content: [{ type: 'text', text: `输入: ${args.text}` }] };
          case 'key':
            await input.pressKey(args.key);
            session.close();
            return { content: [{ type: 'text', text: `按键: ${args.key}` }] };
          case 'hotkey':
            await input.pressShortcut(args.hotkey);
            session.close();
            return { content: [{ type: 'text', text: `快捷键: ${args.hotkey}` }] };
          case 'scroll':
            if (args.direction === 'up') await input.scrollUp(400, 400);
            else await input.scrollDown(400, 400);
            session.close();
            return { content: [{ type: 'text', text: `滚动: ${args.direction || 'down'}` }] };
          case 'drag':
            await input.drag(args.x, args.y, args.x2, args.y2);
            session.close();
            return { content: [{ type: 'text', text: `拖拽: (${args.x},${args.y}) -> (${args.x2},${args.y2})` }] };
          case 'select-all': await input.selectAll(); session.close();
            return { content: [{ type: 'text', text: '全选' }] };
          case 'copy': await input.copy(); session.close();
            return { content: [{ type: 'text', text: '复制' }] };
          case 'paste': await input.paste(); session.close();
            return { content: [{ type: 'text', text: '粘贴' }] };
          default:
            session.close();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      case 'tabbit_tabs': {
        const mt = new MultiTabManager({ port: PORT });
        switch (args.action) {
          case 'list': {
            const targets = await client.getTargets();
            const pages = targets.filter(t => t.type === 'page');
            await mt.closeAll();
            return { content: [{ type: 'text', text: pages.map(p => `${p.id.substring(0, 12)}  ${p.title}  ${p.url}`).join('\n') || '(无页面)' }], tabs: pages };
          }
          case 'open': {
            const id = await mt.createTab(args.url || 'https://web.tabbit.com/newtab');
            await mt.closeAll();
            return { content: [{ type: 'text', text: `新标签: ${id}` }], targetId: id };
          }
          case 'close': {
            await mt.closeTab(args.targetId);
            await mt.closeAll();
            return { content: [{ type: 'text', text: `已关闭: ${args.targetId}` }] };
          }
          default:
            await mt.closeAll();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      case 'tabbit_status': {
        const running = await browser.isRunning();
        if (!running) {
          return { content: [{ type: 'text', text: 'Tabbit 未运行或调试端口未开启' }], status: 'disconnected' };
        }
        const version = await client.getVersion();
        const targets = await client.getTargets();
        const pages = targets.filter(t => t.type === 'page');
        const webviews = targets.filter(t => t.type === 'webview');
        return {
          content: [{ type: 'text', text: `浏览器: ${version.Browser}\n页面: ${pages.length}\nWebview: ${webviews.length}` }],
          status: 'connected',
          browser: version.Browser,
          pages: pages.map(p => ({ title: p.title, url: p.url })),
        };
      }

      case 'tabbit_launch': {
        if (await browser.isRunning()) {
          return { content: [{ type: 'text', text: 'Tabbit 已在运行' }] };
        }
        await browser.launch({ killExisting: args.killExisting !== false });
        return { content: [{ type: 'text', text: `Tabbit 已启动，调试端口: ${PORT}` }] };
      }

      case 'tabbit_new': {
        await client.openInNewTab('https://web.tabbit.com/newtab');
        return { content: [{ type: 'text', text: '新对话已打开' }] };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } finally {
    await client.close();
  }
}

// ─── 消息处理 ──────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tabbit-browser', version: '2.0.0' },
      });
      break;

    case 'notifications/initialized':
      // client confirmed initialization
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(name, args || {});
        sendResponse(id, result);
      } catch (e) {
        sendResponse(id, {
          content: [{ type: 'text', text: `错误: ${e.message}` }],
          isError: true,
        });
      }
      break;
    }

    case 'ping':
      sendResponse(id, {});
      break;

    default:
      if (id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ─── stdin 读取 ─────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.substring(headerEnd + 4); continue; }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.substring(bodyStart, bodyStart + contentLength);
    buffer = buffer.substring(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg);
    } catch (e) {
      // ignore parse errors
    }
  }
});

process.stdin.on('end', () => process.exit(0));

// 通知 stderr 用于调试
process.stderr.write('Tabbit Browser MCP Server v2.0.0 started\n');
