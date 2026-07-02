#!/usr/bin/env node
/**
 * Tabbit Browser MCP Server v2.1
 *
 * 工具列表 (15 个):
 *   核心:  tabbit_chat, tabbit_screenshot, tabbit_pdf, tabbit_status, tabbit_launch, tabbit_new
 *   设备:  tabbit_device
 *   网络:  tabbit_network, tabbit_storage
 *   输入:  tabbit_input
 *   标签:  tabbit_tabs
 *   增强:  tabbit_navigate, tabbit_extract, tabbit_antidetect, tabbit_cookies
 */

const { TabbitClient, TabbitBrowser, DeviceManager } = require('./lib/tabbit');
const { NetworkManager } = require('./lib/network');
const { StorageManager } = require('./lib/storage');
const { CaptureManager } = require('./lib/capture');
const { InputManager } = require('./lib/input');
const { MultiTabManager } = require('./lib/multi-tab');
const { Scheduler } = require('./lib/scheduler');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.TABBIT_PORT || '9222', 10);
const CDP_TIMEOUT = parseInt(process.env.TABBIT_CDP_TIMEOUT || '60000', 10);
const COOKIES_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.tabbit-browser');

// ─── 反检测脚本 ────────────────────────────────────────────

const ANTIDETECT_SCRIPT = `
  // 隐藏 webdriver 标记
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // 移除 CDP 检测变量
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  // 覆盖 chrome.runtime
  if (window.chrome) window.chrome.runtime = window.chrome.runtime || {};
  // 覆盖权限查询
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (p) =>
      p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(p);
  }
  // 覆盖 plugins 长度
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
  // 覆盖 languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en'],
  });
`;

// ─── MCP 协议 ──────────────────────────────────────────────

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

// ─── CDP 辅助 ──────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class CDP {
  constructor(wsUrl, isBrowser = false) {
    this.wsUrl = wsUrl;
    this.isBrowser = isBrowser;
    this.ws = null;
    this.msgId = 0;
    this.handlers = new Map();
  }

  async connect() {
    const { WebSocket } = require('ws');
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && this.handlers.has(msg.id)) {
        const { resolve, reject, timer } = this.handlers.get(msg.id);
        clearTimeout(timer);
        this.handlers.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    if (!this.isBrowser) await this.send('Runtime.enable');
    return this;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => { this.handlers.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, CDP_TIMEOUT);
      this.handlers.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }

  async injectAntiDetect() {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: ANTIDETECT_SCRIPT });
  }

  close() { if (this.ws) this.ws.close(); }
}

// ─── 工具定义 ──────────────────────────────────────────────

const TOOLS = [
  // === 核心工具 ===
  {
    name: 'tabbit_chat',
    description: '发送消息给 Tabbit AI 并获取回复。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '要发送的消息' },
        waitMs: { type: 'number', description: '等待回复时间(ms)，默认 12000' },
      },
      required: ['message'],
    },
  },
  {
    name: 'tabbit_screenshot',
    description: '对当前页面截图（视口/全页/元素）。',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string' },
        format: { type: 'string', enum: ['jpeg', 'png', 'webp'] },
        fullPage: { type: 'boolean' },
        selector: { type: 'string', description: 'CSS 选择器' },
      },
    },
  },
  {
    name: 'tabbit_pdf',
    description: '将当前页面导出为 PDF。',
    inputSchema: { type: 'object', properties: { outputPath: { type: 'string' } } },
  },
  {
    name: 'tabbit_status',
    description: '检查 Tabbit 连接状态。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tabbit_launch',
    description: '启动 Tabbit 浏览器（带调试端口）。',
    inputSchema: { type: 'object', properties: { killExisting: { type: 'boolean' } } },
  },
  {
    name: 'tabbit_new',
    description: '打开新对话页面。',
    inputSchema: { type: 'object', properties: {} },
  },
  // === 设备 ===
  {
    name: 'tabbit_device',
    description: '设备仿真（视口/UA/深色模式/定位）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['emulate', 'viewport', 'reset', 'dark', 'geo', 'touch', 'timezone'] },
        device: { type: 'string', description: 'iphone-14, iphone-14-pro-max, ipad-pro, pixel-7, galaxy-s23, desktop-1080, desktop-1440' },
        width: { type: 'number' }, height: { type: 'number' },
        enabled: { type: 'boolean' },
        latitude: { type: 'number' }, longitude: { type: 'number' },
        timezone: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // === 网络 ===
  {
    name: 'tabbit_network',
    description: '网络管理（Cookie/拦截/Mock/限速）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['cookies', 'export-cookies', 'import-cookies', 'block', 'mock', 'throttle', 'clear-cache', 'log'] },
        pattern: { type: 'string' },
        mockResponse: { type: 'object' },
        mode: { type: 'string', description: 'offline, slow-3g, fast-3g, 4g' },
        filePath: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // === 存储 ===
  {
    name: 'tabbit_storage',
    description: '存储管理（登录态导出/导入/清除）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['export', 'import', 'clear', 'local'] },
        origin: { type: 'string' },
        filePath: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // === 输入 ===
  {
    name: 'tabbit_input',
    description: '高级输入（点击/键盘/快捷键/滚动/拖拽）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'type', 'key', 'hotkey', 'scroll', 'drag', 'select-all', 'copy', 'paste'] },
        x: { type: 'number' }, y: { type: 'number' },
        x2: { type: 'number' }, y2: { type: 'number' },
        text: { type: 'string' },
        key: { type: 'string' },
        hotkey: { type: 'string' },
        direction: { type: 'string', enum: ['up', 'down'] },
      },
      required: ['action'],
    },
  },
  // === 标签 ===
  {
    name: 'tabbit_tabs',
    description: '多标签管理。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'open', 'close'] },
        url: { type: 'string' },
        targetId: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // === 增强工具 ===
  {
    name: 'tabbit_navigate',
    description: '智能导航：自动注入反检测脚本，支持防风控等待。用于访问淘宝/京东等有反爬的网站。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL' },
        waitForLoad: { type: 'number', description: '等待加载时间(ms)，默认 3000' },
        autoScroll: { type: 'boolean', description: '自动滚动触发懒加载' },
        scrollTimes: { type: 'number', description: '滚动次数，默认 10' },
      },
      required: ['url'],
    },
  },
  {
    name: 'tabbit_extract',
    description: '从当前页面提取结构化数据。支持：商品列表(goods)、表格(table)、链接(links)、图片(images)、全文(text)。',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['goods', 'table', 'links', 'images', 'text', 'custom'],
          description: '提取类型',
        },
        selector: { type: 'string', description: '自定义 CSS 选择器 (type=custom 时使用)' },
        platform: { type: 'string', description: '平台优化: taobao, jd, boqii, xhs' },
        limit: { type: 'number', description: '最大数量，默认 50' },
      },
      required: ['type'],
    },
  },
  {
    name: 'tabbit_antidetect',
    description: '注入反检测脚本到当前页面，隐藏自动化标记。访问反爬网站前调用。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tabbit_cookies',
    description: 'Cookie 持久化：保存/加载/列出站点的 Cookie。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'load', 'list', 'save-all', 'load-all'] },
        site: { type: 'string', description: '站点名（如 taobao, jd）' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabbit_console',
    description: '控制台日志抓取：查看/过滤/清空浏览器控制台输出。用于项目调试。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'clear', 'errors', 'warnings', 'logs'],
          description: '操作类型: list=全部, errors=仅错误, warnings=仅警告, logs=仅日志, clear=清空',
        },
        type: {
          type: 'string',
          enum: ['log', 'info', 'warning', 'error', 'debug'],
          description: '按类型过滤 (list 时使用)',
        },
        limit: { type: 'number', description: '最大返回条数，默认 50' },
        search: { type: 'string', description: '按关键词搜索日志内容' },
        includePreserved: { type: 'boolean', description: '是否包含历史导航的日志，默认 false' },
      },
      required: ['action'],
    },
  },
];

// ─── 工具执行 ──────────────────────────────────────────────

async function executeTool(name, args) {
  const browser = new TabbitBrowser({ port: PORT });
  const client = browser.client();

  try {
    switch (name) {
      // === 核心 ===
      case 'tabbit_chat': {
        const result = await client.chat(args.message, { waitMs: args.waitMs || 12000 });
        return { content: [{ type: 'text', text: result.text }], model: result.model, url: result.url };
      }
      case 'tabbit_screenshot': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const cap = new CaptureManager(session);
        let result;
        if (args.selector) result = await cap.elementScreenshot(args.selector, { format: args.format || 'jpeg', outputPath: args.outputPath });
        else if (args.fullPage) result = await cap.fullPageScreenshot({ format: args.format || 'jpeg', outputPath: args.outputPath });
        else result = await cap.screenshot({ format: args.format || 'jpeg', outputPath: args.outputPath });
        session.close();
        return { content: [{ type: 'text', text: `截图: ${result.path}` }], path: result.path };
      }
      case 'tabbit_pdf': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const cap = new CaptureManager(session);
        const result = await cap.toPDF({ outputPath: args.outputPath });
        session.close();
        return { content: [{ type: 'text', text: `PDF: ${result.path}` }], path: result.path };
      }
      case 'tabbit_status': {
        const running = await browser.isRunning();
        if (!running) return { content: [{ type: 'text', text: 'Tabbit 未运行' }], status: 'disconnected' };
        const version = await client.getVersion();
        const targets = await client.getTargets();
        return {
          content: [{ type: 'text', text: `${version.Browser} | ${targets.filter(t => t.type === 'page').length} pages` }],
          status: 'connected', browser: version.Browser,
        };
      }
      case 'tabbit_launch': {
        if (await browser.isRunning()) return { content: [{ type: 'text', text: '已运行' }] };
        await browser.launch({ killExisting: args.killExisting !== false });
        return { content: [{ type: 'text', text: `已启动 (port ${PORT})` }] };
      }
      case 'tabbit_new': {
        await client.openInNewTab('https://web.tabbit.com/newtab');
        return { content: [{ type: 'text', text: '新对话已打开' }] };
      }

      // === 设备 ===
      case 'tabbit_device': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const device = new DeviceManager(session);
        switch (args.action) {
          case 'emulate': { const info = await device.emulateDevice(args.device); session.close(); return { content: [{ type: 'text', text: `${args.device} (${info.viewport.width}x${info.viewport.height})` }] }; }
          case 'viewport': await device.setViewport(args.width, args.height); session.close(); return { content: [{ type: 'text', text: `${args.width}x${args.height}` }] };
          case 'reset': await device.resetViewport(); session.close(); return { content: [{ type: 'text', text: '已恢复' }] };
          case 'dark': await device.setDarkMode(args.enabled !== false); session.close(); return { content: [{ type: 'text', text: `深色: ${args.enabled !== false}` }] };
          case 'geo': await device.setGeolocation(args.latitude, args.longitude); session.close(); return { content: [{ type: 'text', text: `${args.latitude}, ${args.longitude}` }] };
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 网络 ===
      case 'tabbit_network': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const net = new NetworkManager(session);
        await net.enable();
        switch (args.action) {
          case 'cookies': { const c = await net.getCookies([target.url]); session.close(); return { content: [{ type: 'text', text: c.map(x => `${x.name}=${x.value.substring(0, 20)}... (${x.domain})`).join('\n') }], cookies: c }; }
          case 'export-cookies': { const j = await net.exportCookies([target.url]); session.close(); return { content: [{ type: 'text', text: j }], cookies: JSON.parse(j) }; }
          case 'throttle': await net.emulateNetwork(args.mode || null); session.close(); return { content: [{ type: 'text', text: args.mode ? `限速: ${args.mode}` : '恢复' }] };
          case 'clear-cache': await net.clearCache(); session.close(); return { content: [{ type: 'text', text: '已清除' }] };
          case 'block': net.block(args.pattern); session.close(); return { content: [{ type: 'text', text: `屏蔽: ${args.pattern}` }] };
          case 'mock': net.mock(args.pattern, args.mockResponse); session.close(); return { content: [{ type: 'text', text: `Mock: ${args.pattern}` }] };
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 存储 ===
      case 'tabbit_storage': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const storage = new StorageManager(session);
        const origin = args.origin || target.url;
        switch (args.action) {
          case 'export': { const s = await storage.exportLoginState(origin); const fp = args.filePath || 'login-state.json'; fs.writeFileSync(fp, JSON.stringify(s, null, 2)); session.close(); return { content: [{ type: 'text', text: `导出 ${s.cookies.length} cookies → ${fp}` }], state: s }; }
          case 'import': { const s = JSON.parse(fs.readFileSync(args.filePath, 'utf-8')); const r = await storage.importLoginState(s); session.close(); return { content: [{ type: 'text', text: `导入 ${r.cookiesImported} cookies` }] }; }
          case 'clear': await storage.clearAll(origin); session.close(); return { content: [{ type: 'text', text: `已清除 ${origin}` }] };
          case 'local': { const items = await storage.getLocalStorage(origin); session.close(); return { content: [{ type: 'text', text: items.map(e => `${e.key}=${e.value.substring(0, 30)}`).join('\n') || '(空)' }], items }; }
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 输入 ===
      case 'tabbit_input': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const input = new InputManager(session);
        switch (args.action) {
          case 'click': await input.mouseClick(args.x, args.y); session.close(); return { content: [{ type: 'text', text: `点击 ${args.x},${args.y}` }] };
          case 'type': await session.send('Input.insertText', { text: args.text }); session.close(); return { content: [{ type: 'text', text: `输入: ${args.text}` }] };
          case 'key': await input.pressKey(args.key); session.close(); return { content: [{ type: 'text', text: `按键: ${args.key}` }] };
          case 'hotkey': await input.pressShortcut(args.hotkey); session.close(); return { content: [{ type: 'text', text: `快捷键: ${args.hotkey}` }] };
          case 'scroll': if (args.direction === 'up') await input.scrollUp(400, 400); else await input.scrollDown(400, 400); session.close(); return { content: [{ type: 'text', text: `滚动: ${args.direction || 'down'}` }] };
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 标签 ===
      case 'tabbit_tabs': {
        const mt = new MultiTabManager({ port: PORT });
        switch (args.action) {
          case 'list': { const t = await client.getTargets(); const p = t.filter(x => x.type === 'page'); await mt.closeAll(); return { content: [{ type: 'text', text: p.map(x => `${x.id.substring(0, 10)} ${x.title} ${x.url}`).join('\n') }], tabs: p }; }
          case 'open': { const id = await mt.createTab(args.url || 'https://web.tabbit.com/newtab'); await mt.closeAll(); return { content: [{ type: 'text', text: `新标签: ${id}` }], targetId: id }; }
          case 'close': await mt.closeTab(args.targetId); await mt.closeAll(); return { content: [{ type: 'text', text: `已关闭` }] };
          default: await mt.closeAll(); throw new Error(`未知操作`);
        }
      }

      // === 增强: 智能导航 ===
      case 'tabbit_navigate': {
        const version = await client.getVersion();
        const bws = new CDP(version.webSocketDebuggerUrl, true);
        await bws.connect();
        await bws.send('Target.createTarget', { url: args.url });
        await sleep(2000);
        bws.close();

        const targets = await client.getTargets();
        const hostname = new URL(args.url).hostname;
        const page = targets.find(t => t.type === 'page' && t.url.includes(hostname));
        if (!page) throw new Error('页面未找到');

        const cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.connect();
        await cdp.injectAntiDetect();

        const waitTime = args.waitForLoad || 3000;
        await sleep(waitTime);

        if (args.autoScroll !== false) {
          const times = args.scrollTimes || 10;
          for (let i = 0; i < times; i++) {
            const dist = 200 + Math.floor(Math.random() * 400);
            await cdp.eval(`window.scrollBy(0, ${dist})`);
            await sleep(500 + Math.random() * 500);
          }
        }

        const title = await cdp.eval('document.title');
        const finalUrl = await cdp.eval('location.href');
        cdp.close();

        return { content: [{ type: 'text', text: `已导航: ${title}\nURL: ${finalUrl}` }], title, url: finalUrl };
      }

      // === 增强: 结构化提取 ===
      case 'tabbit_extract': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const limit = args.limit || 50;

        let extractScript;
        switch (args.type) {
          case 'goods':
            extractScript = getGoodsExtractScript(args.platform, limit);
            break;
          case 'table':
            extractScript = `JSON.stringify([...document.querySelectorAll('table')].slice(0,${limit}).map(t => ({
              headers: [...t.querySelectorAll('th')].map(h => h.textContent.trim()),
              rows: [...t.querySelectorAll('tr')].slice(1).map(r => [...r.querySelectorAll('td')].map(c => c.textContent.trim()))
            })))`;
            break;
          case 'links':
            extractScript = `JSON.stringify([...document.querySelectorAll('a[href]')].slice(0,${limit}).map(a => ({text: a.textContent.trim().substring(0,60), href: a.href.substring(0,120)})).filter(l => l.text))`;
            break;
          case 'images':
            extractScript = `JSON.stringify([...document.querySelectorAll('img[src]')].slice(0,${limit}).map(i => ({src: i.src.substring(0,120), alt: i.alt?.substring(0,40) || ''})))`;
            break;
          case 'text':
            extractScript = `document.body?.innerText?.substring(0, 5000) || ''`;
            break;
          case 'custom':
            if (!args.selector) throw new Error('custom 类型需要 selector 参数');
            extractScript = `JSON.stringify([...document.querySelectorAll('${args.selector}')].slice(0,${limit}).map(e => ({tag: e.tagName, text: e.textContent?.trim().substring(0,100), cls: (e.className||'').substring(0,50)})))`;
            break;
          default:
            throw new Error(`未知提取类型: ${args.type}`);
        }

        const result = await session.send('Runtime.evaluate', {
          expression: extractScript, returnByValue: true, awaitPromise: true,
        });
        session.close();

        const data = result.result?.value;
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }

        return { content: [{ type: 'text', text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) }], data: parsed };
      }

      // === 增强: 反检测 ===
      case 'tabbit_antidetect': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        await session.send('Page.addScriptToEvaluateOnNewDocument', { source: ANTIDETECT_SCRIPT });
        // 同时立即执行一次
        await session.send('Runtime.evaluate', { expression: ANTIDETECT_SCRIPT, returnByValue: true });
        session.close();
        return { content: [{ type: 'text', text: '反检测脚本已注入' }] };
      }

      // === 增强: Cookie 持久化 ===
      case 'tabbit_cookies': {
        if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });

        switch (args.action) {
          case 'save': {
            const target = await findPage(client);
            const session = await client.connectTo(target);
            const net = new NetworkManager(session);
            await net.enable();
            const cookies = await net.getCookies([target.url]);
            const filePath = path.join(COOKIES_DIR, `${args.site || 'default'}.json`);
            fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
            session.close();
            return { content: [{ type: 'text', text: `保存 ${cookies.length} cookies → ${filePath}` }] };
          }
          case 'load': {
            const filePath = path.join(COOKIES_DIR, `${args.site || 'default'}.json`);
            if (!fs.existsSync(filePath)) throw new Error(`Cookie 文件不存在: ${filePath}`);
            const target = await findPage(client);
            const session = await client.connectTo(target);
            const net = new NetworkManager(session);
            await net.enable();
            const cookies = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            await net.importCookies(cookies);
            session.close();
            return { content: [{ type: 'text', text: `加载 ${cookies.length} cookies` }] };
          }
          case 'list': {
            if (!fs.existsSync(COOKIES_DIR)) return { content: [{ type: 'text', text: '(无保存的 Cookie)' }] };
            const files = fs.readdirSync(COOKIES_DIR).filter(f => f.endsWith('.json'));
            const list = files.map(f => {
              const data = JSON.parse(fs.readFileSync(path.join(COOKIES_DIR, f), 'utf-8'));
              return `${f.replace('.json', '')}: ${data.length} cookies`;
            });
            return { content: [{ type: 'text', text: list.join('\n') || '(无)' }] };
          }
          case 'save-all': {
            const targets = await client.getTargets();
            const pages = targets.filter(t => t.type === 'page');
            let total = 0;
            for (const p of pages) {
              try {
                const session = await client.connectTo(p);
                const net = new NetworkManager(session);
                await net.enable();
                const cookies = await net.getCookies([p.url]);
                if (cookies.length > 0) {
                  const site = new URL(p.url).hostname.replace(/\./g, '_');
                  fs.writeFileSync(path.join(COOKIES_DIR, `${site}.json`), JSON.stringify(cookies, null, 2));
                  total += cookies.length;
                }
                session.close();
              } catch {}
            }
            return { content: [{ type: 'text', text: `保存 ${pages.length} 个站点的 ${total} 个 cookies` }] };
          }
          case 'load-all': {
            if (!fs.existsSync(COOKIES_DIR)) return { content: [{ type: 'text', text: '(无)' }] };
            const files = fs.readdirSync(COOKIES_DIR).filter(f => f.endsWith('.json'));
            let total = 0;
            for (const f of files) {
              try {
                const cookies = JSON.parse(fs.readFileSync(path.join(COOKIES_DIR, f), 'utf-8'));
                // 注入到所有页面
                const targets = await client.getTargets();
                const pages = targets.filter(t => t.type === 'page');
                for (const p of pages) {
                  const session = await client.connectTo(p);
                  const net = new NetworkManager(session);
                  await net.enable();
                  await net.importCookies(cookies);
                  session.close();
                }
                total += cookies.length;
              } catch {}
            }
            return { content: [{ type: 'text', text: `加载 ${files.length} 个文件的 ${total} 个 cookies` }] };
          }
          default: throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 增强: 控制台日志 ===
      case 'tabbit_console': {
        const target = await findPage(client);
        const session = await client.connectTo(target);

        // 启用 Console 域
        await session.send('Console.enable');
        await session.send('Log.enable');

        switch (args.action) {
          case 'list':
          case 'errors':
          case 'warnings':
          case 'logs': {
            // 确定过滤类型
            let filterType = args.type;
            if (args.action === 'errors') filterType = 'error';
            else if (args.action === 'warnings') filterType = 'warning';
            else if (args.action === 'logs') filterType = 'log';

            const limit = args.limit || 50;
            const search = args.search || '';
            const includePreserved = args.includePreserved || false;

            // 通过 JS 获取控制台日志（需要先注入日志捕获器）
            const result = await session.send('Runtime.evaluate', {
              expression: `(() => {
                // 从 window.__tabbit_logs 获取已捕获的日志
                const logs = window.__tabbit_logs || [];
                let filtered = logs;

                // 按类型过滤
                if (${filterType ? `'${filterType}'` : 'null'}) {
                  filtered = filtered.filter(l => l.type === '${filterType || ''}');
                }

                // 按关键词搜索
                if (${search ? `'${search}'` : 'null'}) {
                  const keyword = '${search || ''}'.toLowerCase();
                  filtered = filtered.filter(l => l.text.toLowerCase().includes(keyword));
                }

                return JSON.stringify(filtered.slice(-${limit}));
              })()`,
              returnByValue: true,
            });

            let logs = [];
            try { logs = JSON.parse(result.result?.value || '[]'); } catch {}

            // 如果没有捕获到日志，尝试通过 LogDomain 获取
            if (logs.length === 0) {
              // 注入日志捕获器并重新获取
              await session.send('Runtime.evaluate', {
                expression: `
                  if (!window.__tabbit_logs) {
                    window.__tabbit_logs = [];
                    const origLog = console.log;
                    const origWarn = console.warn;
                    const origError = console.error;
                    const origInfo = console.info;
                    const origDebug = console.debug;

                    console.log = function() {
                      window.__tabbit_logs.push({type:'log', text:[...arguments].map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '), time:Date.now()});
                      origLog.apply(console, arguments);
                    };
                    console.warn = function() {
                      window.__tabbit_logs.push({type:'warning', text:[...arguments].map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '), time:Date.now()});
                      origWarn.apply(console, arguments);
                    };
                    console.error = function() {
                      window.__tabbit_logs.push({type:'error', text:[...arguments].map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '), time:Date.now()});
                      origError.apply(console, arguments);
                    };
                    console.info = function() {
                      window.__tabbit_logs.push({type:'info', text:[...arguments].map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '), time:Date.now()});
                      origInfo.apply(console, arguments);
                    };
                    console.debug = function() {
                      window.__tabbit_logs.push({type:'debug', text:[...arguments].map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' '), time:Date.now()});
                      origDebug.apply(console, arguments);
                    };

                    // 捕获未处理错误
                    window.addEventListener('error', (e) => {
                      window.__tabbit_logs.push({type:'error', text:'[Uncaught] ' + e.message + ' at ' + e.filename + ':' + e.lineno, time:Date.now()});
                    });
                    window.addEventListener('unhandledrejection', (e) => {
                      window.__tabbit_logs.push({type:'error', text:'[UnhandledRejection] ' + (e.reason?.message || e.reason || 'unknown'), time:Date.now()});
                    });
                  }
                `,
                returnByValue: true,
              });

              // 获取页面已有的错误（通过 Runtime.evaluate 获取）
              const existingErrors = await session.send('Runtime.evaluate', {
                expression: `JSON.stringify(window.__tabbit_logs || [])`,
                returnByValue: true,
              });
              try { logs = JSON.parse(existingErrors.result?.value || '[]'); } catch {}
            }

            // 格式化输出
            if (logs.length === 0) {
              session.close();
              return { content: [{ type: 'text', text: '(无控制台日志)\n注意: 日志捕获器已注入，后续的 console 输出将被记录。' }] };
            }

            // 过滤
            if (filterType) logs = logs.filter(l => l.type === filterType);
            if (search) {
              const keyword = search.toLowerCase();
              logs = logs.filter(l => l.text.toLowerCase().includes(keyword));
            }

            const output = logs.slice(-limit).map(l => {
              const time = new Date(l.time).toLocaleTimeString();
              const icon = { log: '📝', info: 'ℹ️', warning: '⚠️', error: '❌', debug: '🔍' }[l.type] || '📝';
              return `[${time}] ${icon} ${l.type}: ${l.text.substring(0, 200)}`;
            }).join('\n');

            session.close();
            return { content: [{ type: 'text', text: output }], logs };
          }

          case 'clear': {
            await session.send('Runtime.evaluate', {
              expression: 'window.__tabbit_logs = []',
              returnByValue: true,
            });
            session.close();
            return { content: [{ type: 'text', text: '控制台日志已清空' }] };
          }

          default:
            session.close();
            throw new Error(`未知操作: ${args.action}`);
        }
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } finally {
    await client.close();
  }
}

// ─── 商品提取脚本 ──────────────────────────────────────────

function getGoodsExtractScript(platform, limit) {
  if (platform === 'jd') {
    return `JSON.stringify([...document.querySelectorAll("div[class*='_card_']")].slice(0,${limit}).map(card => {
      const title = card.querySelector("div[class*='_goods_title_container_'] span[class*='_newStyle_']")?.textContent?.trim() || ""
      const price = card.querySelector("span[class*='_price_']")?.textContent?.trim() || ""
      const volume = card.querySelector("span[class*='_goods_volume_']")?.textContent?.trim() || ""
      const img = card.querySelector("img[data-src]")?.getAttribute("data-src") || ""
      const tags = [...card.querySelectorAll("div[class*='_tag_'] img")].map(e => e.alt).filter(Boolean).join(", ")
      return { title: title.substring(0,100), price, sales: volume, image: img ? "https:" + img : "", tags }
    }).filter(g => g.title))`;
  }
  if (platform === 'taobao') {
    return `JSON.stringify((() => {
      const items = []; const seen = new Set()
      document.querySelectorAll("a").forEach(a => {
        const href = a.href || ""
        if (!href.includes("item.taobao.com") && !href.includes("detail.tmall.com")) return
        const title = a.textContent?.trim() || ""
        if (!title || title.length < 10 || seen.has(title)) return
        seen.add(title)
        let card = a.parentElement
        for (let i = 0; i < 5; i++) { if (card?.querySelector("img")) break; card = card?.parentElement }
        if (!card) return
        const imgs = [...card.querySelectorAll("img")].slice(0,3).map(i => {
          const s = i.getAttribute("data-src") || i.src || ""
          return s.startsWith("//") ? "https:" + s : s
        })
        const txt = card.textContent || ""
        const price = (txt.match(/[¥￥]\\s*(\\d+\\.?\\d*)/) || [])[1] || ""
        const sales = (txt.match(/(\\d+[\\+]?\\s*(?:人付款|人收货))/) || [])[1] || ""
        items.push({ title: title.substring(0,100), price, sales, images: imgs })
      })
      return JSON.stringify(items.slice(0,${limit}))
    })())`;
  }
  // 通用提取
  return `JSON.stringify((() => {
    const items = []
    document.querySelectorAll("[class*='product'], [class*='goods'], [class*='item'], [class*='card']").forEach(el => {
      const title = (el.querySelector("[class*='title'], h2, h3, h4") || {}).textContent?.trim() || ""
      const price = (el.querySelector("[class*='price']") || {}).textContent?.trim() || ""
      const img = (el.querySelector("img") || {}).src || ""
      if (title && title.length > 5) items.push({ title: title.substring(0,100), price, image: img })
    })
    return JSON.stringify(items.slice(0,${limit}))
  })())`;
}

// ─── 辅助函数 ──────────────────────────────────────────────

async function findPage(client) {
  let target = await client.getNewTabPage();
  if (!target) target = await client.getSessionPage();
  if (!target) {
    const targets = await client.getTargets();
    target = targets.find(t => t.type === 'page');
  }
  if (!target) throw new Error('无活跃页面');
  return target;
}

// ─── 消息处理 ──────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tabbit-browser', version: '2.1.0' },
      });
      break;
    case 'notifications/initialized': break;
    case 'tools/list': sendResponse(id, { tools: TOOLS }); break;
    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await executeTool(name, args || {});
        sendResponse(id, result);
      } catch (e) {
        sendResponse(id, { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true });
      }
      break;
    }
    case 'ping': sendResponse(id, {}); break;
    default: if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
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
    try { handleMessage(JSON.parse(body)); } catch {}
  }
});
process.stdin.on('end', () => process.exit(0));
process.stderr.write('Tabbit Browser MCP Server v2.1.0 started\n');
