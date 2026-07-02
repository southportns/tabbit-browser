/**
 * Tabbit AI CDP 连接库
 * 通过 Chrome DevTools Protocol 操控 Tabbit 浏览器内置 AI
 */

const http = require('http');
const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = 'localhost';
const CDP_TIMEOUT = 15000;
const REPLY_WAIT_MS = 12000;

// ─── 基础工具 ────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── CDP 客户端 ──────────────────────────────────────────────

class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this._handlers = new Map();
    this._eventHandlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r, j) => {
      this.ws.on('open', r);
      this.ws.on('error', j);
    });
    this.ws.on('message', (raw) => this._onMessage(raw));
    return this;
  }

  _onMessage(raw) {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined && this._handlers.has(msg.id)) {
      const { resolve, reject, timer } = this._handlers.get(msg.id);
      clearTimeout(timer);
      this._handlers.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
    if (msg.method && this._eventHandlers.has(msg.method)) {
      for (const cb of this._eventHandlers.get(msg.method)) {
        try { cb(msg.params); } catch (_) {}
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this._handlers.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, CDP_TIMEOUT);
      this._handlers.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, cb) {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, []);
    this._eventHandlers.get(event).push(cb);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ─── Tabbit 客户端 ───────────────────────────────────────────

class TabbitClient {
  constructor(options = {}) {
    this.host = options.host || DEFAULT_HOST;
    this.port = options.port || DEFAULT_PORT;
    this._session = null;
    this._browserWs = null;
  }

  /** 获取浏览器版本信息 */
  async getVersion() {
    return httpGet(`http://${this.host}:${this.port}/json/version`);
  }

  /** 获取所有页面/目标列表 */
  async getTargets() {
    return httpGet(`http://${this.host}:${this.port}/json/list`);
  }

  /** 获取新标签页（Tabbit AI 对话入口） */
  async getNewTabPage() {
    const targets = await this.getTargets();
    return targets.find((t) => t.type === 'page' && t.url.includes('newtab'));
  }

  /** 获取当前活跃的会话页 */
  async getSessionPage() {
    const targets = await this.getTargets();
    return targets.find((t) => t.type === 'page' && t.url.includes('session'));
  }

  /** 获取 Tabbit AI webview */
  async getAIWebview() {
    const targets = await this.getTargets();
    return targets.find((t) => t.type === 'webview' && t.title.includes('Tabbit AI'));
  }

  /** 连接到指定目标的 WebSocket */
  async connectTo(target) {
    const session = new CDPSession(target.webSocketDebuggerUrl);
    await session.connect();
    await session.send('Runtime.enable');
    return session;
  }

  /** 连接到浏览器级别（用于创建新标签页等） */
  async connectBrowser() {
    const version = await this.getVersion();
    const session = new CDPSession(version.webSocketDebuggerUrl);
    await session.connect();
    this._browserWs = session;
    return session;
  }

  /** 在新标签页中打开 URL */
  async openInNewTab(url) {
    if (!this._browserWs) await this.connectBrowser();
    const result = await this._browserWs.send('Target.createTarget', { url });
    await sleep(1500);
    const targets = await this.getTargets();
    return targets.find((t) => t.targetId === result.targetId);
  }

  /** 截图并保存到文件 */
  async screenshot(target, outputPath, options = {}) {
    const session = await this.connectTo(target);
    const format = options.format || 'jpeg';
    const quality = options.quality || 70;
    const result = await session.send('Page.captureScreenshot', { format, quality });
    const ext = format === 'jpeg' ? 'jpg' : format;
    const filePath = outputPath || path.join(process.cwd(), `tabbit-screenshot.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    session.close();
    return filePath;
  }

  /** 在页面中执行 JavaScript */
  async evaluate(target, expression) {
    const session = await this.connectTo(target);
    const result = await session.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    session.close();
    return result.result?.value;
  }

  /**
   * 发送消息给 Tabbit AI 并获取回复
   * @param {string} message - 要发送的消息
   * @param {object} options - 选项
   * @param {number} options.waitMs - 等待回复的时间 (默认 12s)
   * @returns {Promise<{text: string, url: string, model: string}>}
   */
  async chat(message, options = {}) {
    const waitMs = options.waitMs || REPLY_WAIT_MS;

    // 找到新标签页或会话页
    let target = await this.getNewTabPage();
    if (!target) target = await this.getSessionPage();
    if (!target) throw new Error('找不到 Tabbit AI 对话页面');

    const session = await this.connectTo(target);

    // 聚焦输入框
    await session.send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('[contenteditable="plaintext-only"]') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea');
          if (el) { el.focus(); el.click(); return 'ok'; }
          return 'not found';
        })()
      `,
      returnByValue: true,
    });
    await sleep(300);

    // 输入消息
    await session.send('Input.insertText', { text: message });
    await sleep(300);

    // 按 Enter 发送
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });

    // 等待回复
    await sleep(waitMs);

    // 检查页面是否跳转到了会话页
    const currentUrl = await session.send('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    const currentUrlValue = currentUrl.result?.value || '';
    session.close();

    // 如果跳转了，从会话页读取
    if (currentUrlValue.includes('session')) {
      const newTarget = await this.getSessionPage();
      if (!newTarget) throw new Error('会话页未找到');
      return this._readSessionResponse(newTarget);
    }

    // 如果还在原页面，读取当前页面
    return this._readSessionResponse(target);
  }

  /** 读取会话页的 AI 回复 */
  async _readSessionResponse(target) {
    const session = await this.connectTo(target);

    // 多次尝试获取完整回复（等待流式输出完成）
    let lastText = '';
    for (let i = 0; i < 3; i++) {
      const result = await session.send('Runtime.evaluate', {
        expression: 'document.body?.innerText',
        returnByValue: true,
      });
      const currentText = result.result?.value || '';

      // 检查是否有"继续提问"标志（表示回复已完成）
      if (currentText.includes('继续提问')) {
        lastText = currentText;
        break;
      }
      lastText = currentText;
      await sleep(2000);
    }

    session.close();

    // 提取 AI 回复（跳过思考过程）
    const text = this._extractAIResponse(lastText);
    const modelMatch = lastText.match(/(Doubao-[\w.-]+)/i);
    const model = modelMatch ? modelMatch[0] : 'unknown';

    return {
      text,
      url: target.url,
      model,
    };
  }

  /** 从页面文本中提取 AI 回复 */
  _extractAIResponse(fullText) {
    // 移除尾部
    let cleaned = fullText
      .replace(/继续提问，或输入 @ 来引用内容[\s\S]*$/, '')
      .trim();

    // 移除头部（标题 + 用户消息 + 搜索标记）
    cleaned = cleaned
      .replace(/^.*?\n(用.*?\n|请.*?\n|帮我.*?\n|告诉.*?\n)?/, '')
      .replace(/^Microsoft Bing 搜索\n/m, '')
      .trim();

    // 移除思考过程块
    // 思考过程格式："思考过程\n[多段思考文本]\n\n" 然后是实际回复
    const thinkingMatch = cleaned.match(/思考过程\n([\s\S]*?)\n\n/);
    if (thinkingMatch) {
      // 找到思考过程块结束的位置
      const thinkingEnd = cleaned.indexOf(thinkingMatch[0]) + thinkingMatch[0].length;
      cleaned = cleaned.substring(thinkingEnd).trim();
    }

    // 移除可能残留的模型名
    cleaned = cleaned.replace(/Doubao-[\w.-]+/g, '').trim();

    return cleaned;
  }

  /** 在已有会话中继续对话 */
  async continueChat(message, sessionPage, waitMs = REPLY_WAIT_MS) {
    const session = await this.connectTo(sessionPage);

    // 聚焦输入框
    await session.send('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('[contenteditable="plaintext-only"]') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea');
          if (el) { el.focus(); el.click(); return 'ok'; }
          return 'not found';
        })()
      `,
      returnByValue: true,
    });
    await sleep(300);

    await session.send('Input.insertText', { text: message });
    await sleep(300);

    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });

    await sleep(waitMs);

    // 等待回复完成
    let lastText = '';
    for (let i = 0; i < 3; i++) {
      const result = await session.send('Runtime.evaluate', {
        expression: 'document.body?.innerText',
        returnByValue: true,
      });
      const currentText = result.result?.value || '';
      if (currentText.includes('继续提问')) {
        lastText = currentText;
        break;
      }
      lastText = currentText;
      await sleep(2000);
    }

    session.close();

    const text = this._extractAIResponse(lastText);
    return {
      text,
      url: sessionPage.url,
    };
  }

  /** 关闭所有连接 */
  async close() {
    if (this._browserWs) this._browserWs.close();
  }
}

// ─── Tabbit 浏览器管理 ───────────────────────────────────────

class TabbitBrowser {
  constructor(options = {}) {
    this.executablePath = options.executablePath || 'D:\\Tabbit Browser\\Application\\Tabbit Browser.exe';
    this.port = options.port || 9222;
  }

  /** 检查 Tabbit 是否已在运行且有调试端口 */
  async isRunning() {
    try {
      await httpGet(`http://localhost:${this.port}/json/version`);
      return true;
    } catch {
      return false;
    }
  }

  /** 启动 Tabbit（带调试端口） */
  async launch(options = {}) {
    const { killExisting = true } = options;

    if (killExisting) {
      try {
        const { execSync } = require('child_process');
        execSync('taskkill /f /im "Tabbit Browser.exe" 2>nul', { stdio: 'ignore' });
        await sleep(2000);
      } catch {}
    }

    const { spawn } = require('child_process');
    const args = [
      '--remote-debugging-port=' + this.port,
      '--remote-allow-origins=*',
      '--enable-remote-debugging',
    ];
    const proc = spawn(this.executablePath, args, { detached: true, stdio: 'ignore' });
    proc.unref();

    // 等待调试端口就绪
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (await this.isRunning()) return true;
    }
    throw new Error('Tabbit 启动超时，调试端口未就绪');
  }

  /** 获取 TabbitClient 实例 */
  client() {
    return new TabbitClient({ port: this.port });
  }
}

// ─── 增强 TabbitClient：子模块工厂方法 ──────────────────────

TabbitClient.prototype.getNetwork = async function() {
  const target = await this.getNewTabPage() || await this.getSessionPage();
  if (!target) throw new Error('No active page');
  const session = await this.connectTo(target);
  const { NetworkManager } = require('./network');
  const mgr = new NetworkManager(session);
  await mgr.enable();
  return mgr;
};

TabbitClient.prototype.getDevice = async function() {
  const target = await this.getNewTabPage() || await this.getSessionPage();
  if (!target) throw new Error('No active page');
  const session = await this.connectTo(target);
  const { DeviceManager } = require('./device');
  return new DeviceManager(session);
};

TabbitClient.prototype.getStorage = async function() {
  const target = await this.getNewTabPage() || await this.getSessionPage();
  if (!target) throw new Error('No active page');
  const session = await this.connectTo(target);
  const { StorageManager } = require('./storage');
  return new StorageManager(session);
};

TabbitClient.prototype.getCapture = async function() {
  const target = await this.getNewTabPage() || await this.getSessionPage();
  if (!target) throw new Error('No active page');
  const session = await this.connectTo(target);
  const { CaptureManager } = require('./capture');
  return new CaptureManager(session);
};

TabbitClient.prototype.getInput = async function() {
  const target = await this.getNewTabPage() || await this.getSessionPage();
  if (!target) throw new Error('No active page');
  const session = await this.connectTo(target);
  const { InputManager } = require('./input');
  return new InputManager(session);
};

TabbitClient.prototype.getScheduler = function() {
  const { Scheduler } = require('./scheduler');
  return new Scheduler(this);
};

TabbitClient.prototype.getMultiTab = function() {
  const { MultiTabManager } = require('./multi-tab');
  return new MultiTabManager({ port: this.port });
};

// ─── 导出 ─────────────────────────────────────────────────────

module.exports = {
  TabbitClient,
  TabbitBrowser,
  CDPSession,
  httpGet,
  sleep,
  // 子模块也直接导出
  NetworkManager: require('./network').NetworkManager,
  DeviceManager: require('./device').DeviceManager,
  StorageManager: require('./storage').StorageManager,
  CaptureManager: require('./capture').CaptureManager,
  InputManager: require('./input').InputManager,
  MultiTabManager: require('./multi-tab').MultiTabManager,
  Scheduler: require('./scheduler').Scheduler,
};
