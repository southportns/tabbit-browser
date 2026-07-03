#!/usr/bin/env node
/**
 * Tabbit Browser CLI 工具 - 完整版
 *
 * 核心命令:
 *   tabbit chat "你好"              发送消息
 *   tabbit chat -i                  交互式对话
 *   tabbit new                      新对话
 *   tabbit list                     列出页面
 *   tabbit status                   连接状态
 *   tabbit launch                   启动 Tabbit
 *
 * 网络命令:
 *   tabbit net log                  查看请求日志
 *   tabbit net mock <url> <json>    Mock 响应
 *   tabbit net block <url>          屏蔽 URL
 *   tabbit net cookies              查看 Cookie
 *   tabbit net export-cookies       导出 Cookie
 *   tabbit net import-cookies <f>   导入 Cookie
 *   tabbit net throttle <mode>      网络限速
 *   tabbit net clear-cache          清除缓存
 *
 * 设备命令:
 *   tabbit device emulate <name>    仿真设备
 *   tabbit device viewport <w> <h>  自定义视口
 *   tabbit device reset             恢复默认
 *   tabbit device dark [on|off]     深色模式
 *   tabbit device geo <lat> <lng>   设置定位
 *
 * 存储命令:
 *   tabbit storage export <origin>  导出登录态
 *   tabbit storage import <file>    导入登录态
 *   tabbit storage clear <origin>   清除存储
 *
 * 截图命令:
 *   tabbit screenshot [file]        截图
 *   tabbit screenshot --full        全页截图
 *   tabbit screenshot --el <sel>    元素截图
 *   tabbit pdf [file]               导出 PDF
 *
 * 输入命令:
 *   tabbit input click <x> <y>      点击坐标
 *   tabbit input type <text>        输入文本
 *   tabbit input key <key>          按键
 *   tabbit input hotkey <keys>      快捷键
 *   tabbit input scroll <dir>       滚动
 *   tabbit input drag <x1> <y1> <x2> <y2>  拖拽
 *
 * 多标签命令:
 *   tabbit tabs                     列出标签
 *   tabbit tabs open <url>          新建标签
 *   tabbit tabs close <id>          关闭标签
 *   tabbit tabs chat <id> <msg>     在指定标签对话
 *   tabbit tabs parallel <msgs>     并行多标签对话
 *
 * 批量命令:
 *   tabbit batch chat <msgs.json>   批量对话
 *   tabbit batch run <tasks.json>   批量任务
 *
 * 设备列表:
 *   tabbit devices                  列出可用设备
 */

const { TabbitClient, TabbitBrowser, DeviceManager } = require('./lib/tabbit');
const readline = require('readline');
const fs = require('fs');

const USAGE = `
Tabbit Browser 工具 v2.0 - 全功能浏览器自动化

用法: node cli.js <command> [args] [options]

核心:
  chat <msg>              发送消息    chat -i 交互式
  new                     新对话      list    列出页面
  status                  连接状态    launch  启动 Tabbit

网络:
  net log                 请求日志    net mock <url> <json>
  net block <url>         屏蔽 URL    net cookies
  net export-cookies      导出        net import-cookies <f>
  net throttle <mode>     限速        net clear-cache

设备:
  device emulate <name>   仿真设备    device viewport <w> <h>
  device reset            恢复默认    device dark [on|off]
  device geo <lat> <lng>  地理定位

存储:
  storage export <origin> 导出登录态  storage import <f>
  storage clear <origin>  清除存储

截图:
  screenshot [file]       截图        screenshot --full
  screenshot --el <sel>   元素截图    pdf [file]

输入:
  input click <x> <y>     点击        input type <text>
  input key <key>         按键        input hotkey <keys>
  input scroll <up|down>  滚动        input drag <x1> <y1> <x2> <y2>

多标签:
  tabs                    列出标签    tabs open <url>
  tabs close <id>         关闭        tabs chat <id> <msg>
  tabs parallel <msgs>    并行对话

批量:
  batch chat <msgs.json>  批量对话    batch run <tasks.json>

options: --port <n> --wait <ms> --format <fmt> --help
`.trim();

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];
  const sub = args[1];
  const port = getArg(args, '--port') || 9222;
  const waitMs = parseInt(getArg(args, '--wait') || '12000', 10);
  const format = getArg(args, '--format') || 'jpeg';

  const browser = new TabbitBrowser({ port });
  const client = browser.client();

  try {
    // ─── 核心命令 ──────────────────────────────────
    switch (command) {
      case 'status': return await cmdStatus(browser);
      case 'launch': return await cmdLaunch(browser);
      case 'list': return await cmdList(client);
      case 'chat': return await cmdChat(args, client, waitMs);
      case 'new': return await cmdNew(client);
      case 'devices': return cmdDevices();

      // ─── 网络命令 ────────────────────────────────
      case 'net': return await cmdNet(args, client, sub);

      // ─── 设备命令 ────────────────────────────────
      case 'device': return await cmdDevice(args, client, sub);

      // ─── 存储命令 ────────────────────────────────
      case 'storage': return await cmdStorage(args, client, sub);

      // ─── 截图命令 ────────────────────────────────
      case 'screenshot': return await cmdScreenshot(args, client);
      case 'pdf': return await cmdPdf(args, client);

      // ─── 输入命令 ────────────────────────────────
      case 'input': return await cmdInput(args, client, sub);

      // ─── 多标签命令 ──────────────────────────────
      case 'tabs': return await cmdTabs(args, client, sub);

      // ─── MCP Server ──────────────────────────────
      case 'mcp': {
        // mcp-server 接管 stdin/stdout，CLI 连接先关掉
        await client.close();
        require('./mcp-server');
        return;
      }

      // ─── 批量命令 ────────────────────────────────
      case 'batch': return await cmdBatch(args, client, sub);

      default:
        console.error(`未知命令: ${command}\n\n运行 node cli.js --help 查看帮助`);
        process.exit(1);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    if (e.message.includes('ECONNREFUSED')) {
      console.error('提示: 运行 `node cli.js launch` 启动 Tabbit');
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

// ─── 核心命令实现 ─────────────────────────────────────────

async function cmdStatus(browser) {
  const running = await browser.isRunning();
  if (!running) {
    console.log(JSON.stringify({ status: 'disconnected', port: browser.port }));
    return;
  }
  const client = browser.client();
  const version = await client.getVersion();
  const targets = await client.getTargets();
  console.log(JSON.stringify({
    status: 'connected',
    browser: version.Browser,
    port: browser.port,
    pages: targets.filter(t => t.type === 'page').map(p => ({ title: p.title, url: p.url })),
    webviews: targets.filter(t => t.type === 'webview').map(w => ({ title: w.title })),
  }, null, 2));
  await client.close();
}

async function cmdLaunch(browser) {
  if (await browser.isRunning()) { console.log('Tabbit 已在运行'); return; }
  console.log('启动 Tabbit...');
  await browser.launch();
  console.log('Tabbit 已启动，调试端口:', browser.port);
}

async function cmdList(client) {
  const targets = await client.getTargets();
  const icons = { page: '📄', webview: '🔍', service_worker: '⚙️', other: '🔗', browser_ui: '🌐' };
  targets.forEach(t => {
    console.log(`${icons[t.type] || '❓'} [${t.type}] ${t.title || '(无标题)'}`);
    console.log(`   ${t.url}`);
  });
}

async function cmdChat(args, client, waitMs) {
  const interactive = args.includes('-i') || args.includes('--interactive');
  if (interactive) return await interactiveChat(client, waitMs);

  const message = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
  if (!message) { console.error('请提供消息内容'); process.exit(1); }

  console.log(`发送: ${message}`);
  const result = await client.chat(message, { waitMs });
  console.log('\n' + '─'.repeat(50));
  console.log(result.text);
  console.log('─'.repeat(50));
  console.log(`模型: ${result.model} | 会话: ${result.url}`);
}

async function cmdNew(client) {
  await client.openInNewTab('https://web.tabbit.com/newtab');
  console.log('新对话已打开');
}

function cmdDevices() {
  const devices = Object.keys(DeviceManager.DEVICES);
  console.log('可用设备:');
  devices.forEach(d => {
    const info = DeviceManager.DEVICES[d];
    console.log(`  ${d}  ${info.viewport.width}x${info.viewport.height}  mobile=${info.viewport.mobile}`);
  });
}

// ─── 网络命令 ──────────────────────────────────────────────

async function cmdNet(args, client, sub) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { NetworkManager } = require('./lib/network');
  const net = new NetworkManager(session);
  await net.enable();

  switch (sub) {
    case 'log': {
      const log = net.getRequestLog({
        method: getArg(args, '--method'),
        type: getArg(args, '--type'),
        urlPattern: args.slice(2).find(a => !a.startsWith('--')),
      });
      log.slice(-20).forEach(r => console.log(`${r.method} ${r.url.substring(0, 80)}`));
      console.log(`共 ${log.length} 条请求`);
      break;
    }
    case 'cookies': {
      const pageUrl = target.url || '';
      const cookies = await net.getCookies([pageUrl]);
      cookies.forEach(c => console.log(`${c.name}=${c.value.substring(0, 30)}... (${c.domain})`));
      console.log(`共 ${cookies.length} 个 Cookie`);
      break;
    }
    case 'export-cookies': {
      const pageUrl = target.url || '';
      const json = await net.exportCookies([pageUrl]);
      const file = args[2] || 'cookies.json';
      fs.writeFileSync(file, json);
      console.log(`Cookie 已导出到 ${file}`);
      break;
    }
    case 'import-cookies': {
      const file = args[2];
      if (!file) { console.error('请指定 Cookie 文件'); process.exit(1); }
      const json = fs.readFileSync(file, 'utf-8');
      const count = await net.importCookies(json);
      console.log(`已导入 ${count} 个 Cookie`);
      break;
    }
    case 'throttle': {
      const mode = args[2] || null;
      await net.emulateNetwork(mode);
      console.log(mode ? `已限速: ${mode}` : '已恢复默认网络');
      break;
    }
    case 'clear-cache': {
      await net.clearCache();
      console.log('缓存已清除');
      break;
    }
    case 'mock': {
      const pattern = args[2];
      const jsonStr = args[3];
      if (!pattern || !jsonStr) { console.error('用法: net mock <url-pattern> <json-response>'); process.exit(1); }
      net.mock(pattern, JSON.parse(jsonStr));
      console.log(`已 Mock: ${pattern}`);
      break;
    }
    case 'block': {
      const pattern = args[2];
      if (!pattern) { console.error('用法: net block <url-pattern>'); process.exit(1); }
      net.block(pattern);
      console.log(`已屏蔽: ${pattern}`);
      break;
    }
    default:
      console.log('子命令: log, cookies, export-cookies, import-cookies, throttle, clear-cache, mock, block');
  }
  session.close();
}

// ─── 设备命令 ──────────────────────────────────────────────

async function cmdDevice(args, client, sub) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { DeviceManager } = require('./lib/device');
  const device = new DeviceManager(session);

  switch (sub) {
    case 'emulate': {
      const name = args[2];
      if (!name) { console.error('用法: device emulate <device-name>'); process.exit(1); }
      const info = await device.emulateDevice(name);
      console.log(`已仿真: ${name} (${info.viewport.width}x${info.viewport.height})`);
      break;
    }
    case 'viewport': {
      const w = parseInt(args[2]), h = parseInt(args[3]);
      if (!w || !h) { console.error('用法: device viewport <width> <height>'); process.exit(1); }
      await device.setViewport(w, h);
      console.log(`视口: ${w}x${h}`);
      break;
    }
    case 'reset': {
      await device.resetViewport();
      console.log('视口已恢复');
      break;
    }
    case 'dark': {
      const enabled = args[2] !== 'off';
      await device.setDarkMode(enabled);
      console.log(`深色模式: ${enabled ? '开启' : '关闭'}`);
      break;
    }
    case 'geo': {
      const lat = parseFloat(args[2]), lng = parseFloat(args[3]);
      if (isNaN(lat) || isNaN(lng)) { console.error('用法: device geo <lat> <lng>'); process.exit(1); }
      await device.setGeolocation(lat, lng);
      console.log(`定位: ${lat}, ${lng}`);
      break;
    }
    case 'touch': {
      await device.enableTouch(args[2] !== 'off');
      console.log('触摸仿真已切换');
      break;
    }
    case 'timezone': {
      await device.setTimezone(args[2] || 'Asia/Shanghai');
      console.log(`时区: ${args[2] || 'Asia/Shanghai'}`);
      break;
    }
    default:
      console.log('子命令: emulate, viewport, reset, dark, geo, touch, timezone');
  }
  session.close();
}

// ─── 存储命令 ──────────────────────────────────────────────

async function cmdStorage(args, client, sub) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { StorageManager } = require('./lib/storage');
  const storage = new StorageManager(session);

  const origin = args.find(a => a.startsWith('http')) || (await session.send('Runtime.evaluate', {
    expression: 'location.origin', returnByValue: true
  })).result?.value;

  switch (sub) {
    case 'export': {
      const state = await storage.exportLoginState(origin);
      const file = args[2] || 'login-state.json';
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      console.log(`登录态已导出到 ${file} (${state.cookies.length} cookies)`);
      break;
    }
    case 'import': {
      const file = args[2];
      if (!file) { console.error('用法: storage import <file>'); process.exit(1); }
      const state = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const result = await storage.importLoginState(state);
      console.log(`已导入: ${result.cookiesImported} cookies, ${result.localStorageImported} localStorage items`);
      break;
    }
    case 'clear': {
      await storage.clearAll(origin);
      console.log(`已清除 ${origin} 的所有存储`);
      break;
    }
    case 'local': {
      const items = await storage.getLocalStorage(origin);
      items.forEach(e => console.log(`${e.key} = ${e.value.substring(0, 50)}`));
      console.log(`共 ${items.length} 项`);
      break;
    }
    default:
      console.log('子命令: export, import, clear, local');
  }
  session.close();
}

// ─── 截图命令 ──────────────────────────────────────────────

async function cmdScreenshot(args, client) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { CaptureManager } = require('./lib/capture');
  const cap = new CaptureManager(session);

  const format = getArg(args, '--format') || 'jpeg';
  const outputPath = args.filter(a => !a.startsWith('--') && a !== 'screenshot')[0];
  const isFull = args.includes('--full');
  const elSel = getArg(args, '--el');

  let result;
  if (elSel) {
    result = await cap.elementScreenshot(elSel, { format, outputPath });
  } else if (isFull) {
    result = await cap.fullPageScreenshot({ format, outputPath });
  } else {
    result = await cap.screenshot({ format, outputPath });
  }
  console.log(`截图已保存: ${result.path}`);
  session.close();
}

async function cmdPdf(args, client) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { CaptureManager } = require('./lib/capture');
  const cap = new CaptureManager(session);
  const outputPath = args.filter(a => !a.startsWith('--') && a !== 'pdf')[0];
  const result = await cap.toPDF({ outputPath });
  console.log(`PDF 已保存: ${result.path}`);
  session.close();
}

// ─── 输入命令 ──────────────────────────────────────────────

async function cmdInput(args, client, sub) {
  const target = await findActivePage(client);
  const session = await client.connectTo(target);
  const { InputManager } = require('./lib/input');
  const input = new InputManager(session);

  switch (sub) {
    case 'click': {
      const x = parseInt(args[2]), y = parseInt(args[3]);
      await input.mouseClick(x, y);
      console.log(`点击: ${x}, ${y}`);
      break;
    }
    case 'type': {
      const text = args.slice(2).join(' ');
      await session.send('Input.insertText', { text });
      console.log(`输入: ${text}`);
      break;
    }
    case 'key': {
      await input.pressKey(args[2]);
      console.log(`按键: ${args[2]}`);
      break;
    }
    case 'hotkey': {
      await input.pressShortcut(args[2]);
      console.log(`快捷键: ${args[2]}`);
      break;
    }
    case 'scroll': {
      const dir = args[2] || 'down';
      if (dir === 'down') await input.scrollDown(400, 400);
      else if (dir === 'up') await input.scrollUp(400, 400);
      console.log(`滚动: ${dir}`);
      break;
    }
    case 'drag': {
      const [x1, y1, x2, y2] = args.slice(2, 6).map(Number);
      await input.drag(x1, y1, x2, y2);
      console.log(`拖拽: (${x1},${y1}) -> (${x2},${y2})`);
      break;
    }
    case 'select-all': { await input.selectAll(); console.log('全选'); break; }
    case 'copy': { await input.copy(); console.log('复制'); break; }
    case 'paste': { await input.paste(); console.log('粘贴'); break; }
    case 'undo': { await input.undo(); console.log('撤销'); break; }
    default:
      console.log('子命令: click, type, key, hotkey, scroll, drag, select-all, copy, paste, undo');
  }
  session.close();
}

// ─── 多标签命令 ────────────────────────────────────────────

async function cmdTabs(args, client, sub) {
  const { MultiTabManager } = require('./lib/multi-tab');
  const mt = new MultiTabManager({ port: client.port });

  switch (sub) {
    case 'open': {
      const url = args[2] || 'https://web.tabbit.com/newtab';
      const id = await mt.createTab(url);
      console.log(`新标签: ${id}`);
      break;
    }
    case 'close': {
      await mt.closeTab(args[2]);
      console.log(`已关闭: ${args[2]}`);
      break;
    }
    case 'chat': {
      const targetId = args[2];
      const message = args.slice(3).join(' ');
      if (!targetId || !message) { console.error('用法: tabs chat <targetId> <message>'); process.exit(1); }
      await mt.connectTo(targetId);
      const results = await mt.parallelChat([{ targetId, message }]);
      console.log(results[0].text || results[0].error);
      break;
    }
    case 'parallel': {
      const msgs = args.slice(2);
      const targets = await client.getTargets();
      const pages = targets.filter(t => t.type === 'page');
      const tasks = msgs.map((msg, i) => ({
        targetId: pages[i % pages.length].id,
        message: msg,
      }));
      for (const t of tasks) await mt.connectTo(t.targetId);
      const results = await mt.parallelChat(tasks);
      results.forEach(r => console.log(`[${r.targetId.substring(0, 8)}] ${r.text?.substring(0, 100) || r.error}`));
      break;
    }
    default: {
      const targets = await client.getTargets();
      const pages = targets.filter(t => t.type === 'page');
      pages.forEach(p => console.log(`${p.id.substring(0, 12)}  ${p.title}  ${p.url}`));
    }
  }
  await mt.closeAll();
}

// ─── 批量命令 ──────────────────────────────────────────────

async function cmdBatch(args, client, sub) {
  const { Scheduler } = require('./lib/scheduler');
  const scheduler = new Scheduler(client);

  switch (sub) {
    case 'chat': {
      const file = args[2];
      if (!file) { console.error('用法: batch chat <messages.json>'); process.exit(1); }
      const msgs = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const interval = parseInt(getArg(args, '--interval') || '2000', 10);
      scheduler.addBatchChat(msgs, {
        interval,
        onResult: (r) => console.log(`[${r.model}] ${r.text?.substring(0, 80)}...`),
      });
      const results = await scheduler.run();
      console.log(`\n完成: ${results.filter(r => r.status === 'completed').length}/${results.length}`);
      break;
    }
    case 'run': {
      const file = args[2];
      if (!file) { console.error('用法: batch run <tasks.json>'); process.exit(1); }
      const tasks = JSON.parse(fs.readFileSync(file, 'utf-8'));
      tasks.forEach(t => scheduler.addTask({
        name: t.name,
        execute: async () => client.chat(t.message, { waitMs: waitMs }),
      }));
      const results = await scheduler.run();
      results.forEach(r => console.log(`[${r.status}] ${r.name}: ${r.result?.text?.substring(0, 60) || r.error}`));
      break;
    }
    default:
      console.log('子命令: chat, run');
  }
}

// ─── 工具函数 ──────────────────────────────────────────────

async function findActivePage(client) {
  let target = await client.getNewTabPage();
  if (!target) target = await client.getSessionPage();
  if (!target) {
    // 尝试找到任何可用的 page 类型
    const targets = await client.getTargets();
    target = targets.find(t => t.type === 'page');
  }
  if (!target) throw new Error('找不到活跃页面，先运行 `node cli.js new`');
  return target;
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function interactiveChat(client, defaultWaitMs) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('╔══════════════════════════════════════╗');
  console.log('║     Tabbit AI 交互式对话 v2.0        ║');
  console.log('║     输入 /quit 退出                  ║');
  console.log('╚══════════════════════════════════════╝\n');

  let sessionPage = null;
  const ask = () => {
    rl.question('你: ', async (input) => {
      const msg = input.trim();
      if (!msg || msg === '/quit' || msg === '/exit') { console.log('再见！'); rl.close(); return; }
      try {
        console.log('\n思考中...');
        if (!sessionPage) {
          const result = await client.chat(msg, { waitMs: defaultWaitMs });
          sessionPage = await client.getSessionPage();
          console.log('\nTabbit:', result.text);
        } else {
          const result = await client.continueChat(msg, sessionPage, defaultWaitMs);
          sessionPage = await client.getSessionPage();
          console.log('\nTabbit:', result.text);
        }
      } catch (e) { console.error('\n错误:', e.message); }
      console.log(); ask();
    });
  };
  ask();
}

main();
