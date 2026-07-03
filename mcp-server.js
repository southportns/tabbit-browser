#!/usr/bin/env node
/**
 * Tabbit Browser MCP Server v2.3
 *
 * 工具列表 (21 个):
 *   核心:    tabbit_chat, tabbit_screenshot, tabbit_pdf, tabbit_status, tabbit_launch, tabbit_new
 *   设备:    tabbit_device
 *   网络:    tabbit_network, tabbit_storage
 *   输入:    tabbit_input, tabbit_element
 *   标签:    tabbit_tabs
 *   增强:    tabbit_navigate, tabbit_extract, tabbit_antidetect, tabbit_cookies, tabbit_console
 *   特色:    tabbit_readability, tabbit_download, tabbit_monitor, tabbit_publish
 */

const { TabbitClient, TabbitBrowser, DeviceManager, httpGet } = require('./lib/tabbit');
const { NetworkManager } = require('./lib/network');
const { StorageManager } = require('./lib/storage');
const { CaptureManager } = require('./lib/capture');
const { InputManager } = require('./lib/input');
const { MultiTabManager } = require('./lib/multi-tab');
const { Scheduler } = require('./lib/scheduler');
const { ElementManager } = require('./lib/element');
const { ContentExtractor } = require('./lib/content');
const { DownloadManager } = require('./lib/download');
const { MonitorManager } = require('./lib/monitor');
const { PLATFORMS } = require('./lib/publish');
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
  process.stdout.write(msg + '\n');
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(msg + '\n');
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
    this._eventHandlers = new Map();
    this._closed = false;
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
      } else if (msg.method && this._eventHandlers.has(msg.method)) {
        for (const cb of this._eventHandlers.get(msg.method)) {
          try { cb(msg.params); } catch (_) {}
        }
      }
    });
    this.ws.on('close', () => {
      this._closed = true;
      // 拒绝所有未决请求，避免 hang
      for (const { reject, timer } of this.handlers.values()) {
        clearTimeout(timer);
        reject(new Error('CDP socket closed'));
      }
      this.handlers.clear();
    });
    this.ws.on('error', () => { /* close handler 会处理 */ });
    if (!this.isBrowser) await this.send('Runtime.enable');
    return this;
  }

  on(event, cb) {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, []);
    this._eventHandlers.get(event).push(cb);
  }

  get isOpen() { return this.ws && this.ws.readyState === 1 && !this._closed; }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) return reject(new Error(`CDP socket not open: ${method}`));
      const id = ++this.msgId;
      const timer = setTimeout(() => { this.handlers.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, CDP_TIMEOUT);
      this.handlers.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }), (err) => { if (err) reject(new Error(`WS send error: ${err.message}`)); });
    });
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }

  async injectAntiDetect() {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: ANTIDETECT_SCRIPT });
  }

  close() { this._closed = true; if (this.ws) try { this.ws.close(); } catch (_) {} }
}

// ─── 持久化网络拦截器 ──────────────────────────────────────
// 跨工具调用保持 CDP 会话，使 block/mock/throttle 真正生效，并累积请求日志。
// 活动页面变化或会话断开时自动重连，并保留已注册的拦截规则。

class NetworkInterceptor {
  constructor(port) {
    this.port = port;
    this.cdp = null;          // 持久 CDP 会话
    this.targetId = null;     // 当前附着的 target id
    this.rules = [];          // [{pattern, type:'block'|'mock', response, status}]
    this.requestLog = [];     // 累积请求日志（上限 500）
    this._throttle = null;    // 当前限速设置
  }

  async _findActiveTarget() {
    const list = await httpGet(`http://localhost:${this.port}/json/list`);
    return list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url))
        || list.find(t => t.type === 'page')
        || null;
  }

  /** 附着到指定 target（连接新 CDP 会话），用于 navigate 时让拦截器跟随新页面 */
  async attachToTarget(target) {
    if (this.cdp && this.targetId === target.id && this.cdp.isOpen) return this.cdp;
    if (this.cdp) { try { this.cdp.close(); } catch (_) {} }
    this.cdp = new CDP(target.webSocketDebuggerUrl);
    await this.cdp.connect();
    this.targetId = target.id;
    await this.cdp.send('Network.enable');
    await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    this.cdp.on('Fetch.requestPaused', (p) => this._onPaused(p));
    this.cdp.on('Network.requestWillBeSent', (p) => this._onRequest(p));
    // 恢复限速设置
    if (this._throttle) await this._applyThrottle(this._throttle);
    return this.cdp;
  }

  /** 确保已附着到当前活跃页面；页面变化或断开时重连 */
  async ensureAttached() {
    const target = await this._findActiveTarget();
    if (!target) throw new Error('无活跃页面可供附着网络拦截，请先打开一个网页');
    return this.attachToTarget(target);
  }

  _onRequest(params) {
    if (this.requestLog.length >= 500) this.requestLog.shift();
    this.requestLog.push({
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      time: new Date().toISOString(),
    });
  }

  async _onPaused(params) {
    const { requestId, request } = params;
    const url = request.url;
    for (const r of this.rules) {
      if (url.includes(r.pattern)) {
        try {
          if (r.type === 'mock') {
            const body = Buffer.from(typeof r.response === 'string' ? r.response : JSON.stringify(r.response || {})).toString('base64');
            await this.cdp.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: r.status || 200,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
              body,
            });
            return;
          }
          if (r.type === 'block') {
            await this.cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
            return;
          }
        } catch (_) { /* 已失效的 requestId 等，忽略 */ }
      }
    }
    try { await this.cdp.send('Fetch.continueRequest', { requestId }); } catch (_) {}
  }

  async block(pattern) {
    await this.ensureAttached();
    this.rules = this.rules.filter(r => r.pattern !== pattern || r.type !== 'block');
    this.rules.push({ pattern, type: 'block' });
    return this.rules.length;
  }

  async mock(pattern, response, status = 200) {
    await this.ensureAttached();
    this.rules = this.rules.filter(r => r.pattern !== pattern || r.type !== 'mock');
    this.rules.push({ pattern, type: 'mock', response, status });
    return this.rules.length;
  }

  async unblock(pattern) {
    if (pattern) this.rules = this.rules.filter(r => r.pattern !== pattern);
    else this.rules = [];
    return this.rules.length;
  }

  listRules() { return this.rules.map(r => ({ ...r, response: r.response ? '[已设置]' : undefined })); }

  async _applyThrottle(mode) {
    if (!mode) {
      await this.cdp.send('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
      });
      return;
    }
    const presets = {
      offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
      'slow-3g': { offline: false, downloadThroughput: 50 * 1024 / 8, uploadThroughput: 50 * 1024 / 8, latency: 2000 },
      'fast-3g': { offline: false, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 562 },
      '4g': { offline: false, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, latency: 100 },
    };
    await this.cdp.send('Network.emulateNetworkConditions', presets[mode] || presets['4g']);
  }

  async setThrottle(mode) {
    await this.ensureAttached();
    await this._applyThrottle(mode);
    this._throttle = mode || null;
  }

  getLog(filter = {}) {
    let log = [...this.requestLog];
    if (filter.method) log = log.filter(r => r.method === filter.method);
    if (filter.type) log = log.filter(r => r.type === filter.type);
    if (filter.urlPattern) log = log.filter(r => r.url.includes(filter.urlPattern));
    return log;
  }

  clearLog() { this.requestLog = []; }
}

const interceptor = new NetworkInterceptor(PORT);

// ─── 持久化下载跟踪器 ──────────────────────────────────────
// 跨调用保持下载记录。set-dir 时附着到活跃页面并设置下载目录，监听下载事件。

class DownloadTracker {
  constructor(port) {
    this.port = port;
    this.cdp = null;
    this.targetId = null;
    this.dir = path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads', 'tabbit');
    this.records = [];
    this._mgr = new DownloadManager(null);
  }

  async _findActiveTarget() {
    const list = await httpGet(`http://localhost:${this.port}/json/list`);
    return list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url))
        || list.find(t => t.type === 'page')
        || null;
  }

  async setDir(dir) {
    this.dir = dir;
    const target = await this._findActiveTarget();
    if (!target) throw new Error('无活跃页面，请先打开一个网页');
    if (this.cdp && this.cdp.isOpen && this.targetId === target.id) {
      await this.cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      return { dir, attached: true };
    }
    if (this.cdp) { try { this.cdp.close(); } catch (_) {} }
    this.cdp = new CDP(target.webSocketDebuggerUrl);
    await this.cdp.connect();
    this.targetId = target.id;
    await this.cdp.send('Page.enable');
    await this.cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    this._mgr.attachEvents(this.cdp, this.records);
    return { dir, attached: true };
  }

  list(limit = 50) {
    return this.records.slice(-limit);
  }

  clear() {
    this.records = [];
    return { cleared: true };
  }
}

const downloadTracker = new DownloadTracker(PORT);

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
        device: { type: 'string', description: 'iphone-14/14-pro-max, iphone-16/16-plus/16-pro/16-pro-max/16e, iphone-17/17-air/17-pro/17-pro-max, ipad-pro/ipad-pro-13, pixel-7/9, galaxy-s23/s24-ultra, desktop-1080/1440' },
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
    description: '网络管理（Cookie/拦截/Mock/限速/请求日志）。block/mock/throttle/log 基于持久化拦截器，跨调用生效。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['cookies', 'export-cookies', 'import-cookies', 'block', 'mock', 'unblock', 'throttle', 'clear-cache', 'clear-rules', 'log', 'rules'],
          description: '操作类型',
        },
        pattern: { type: 'string', description: 'URL 子串匹配模式 (block/mock/unblock/log 过滤)' },
        mockResponse: { type: 'string', description: 'Mock 响应体 (mock 时使用，JSON 字符串或纯文本)' },
        status: { type: 'number', description: 'Mock 响应状态码，默认 200' },
        mode: { type: 'string', description: '限速模式: offline, slow-3g, fast-3g, 4g（传空字符串恢复）' },
        filePath: { type: 'string', description: 'import-cookies 的文件路径' },
        method: { type: 'string', description: 'log 按请求方法过滤 (GET/POST...)' },
        type: { type: 'string', description: 'log 按资源类型过滤 (Document/XHR/Fetch/...)' },
        limit: { type: 'number', description: 'log 最大返回条数，默认 50' },
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
    description: '高级输入（点击/键盘/快捷键/滚动/拖拽/剪贴板）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'type', 'key', 'hotkey', 'scroll', 'drag', 'select-all', 'copy', 'paste', 'cut', 'undo', 'redo'] },
        x: { type: 'number' }, y: { type: 'number' },
        x2: { type: 'number' }, y2: { type: 'number' },
        text: { type: 'string' },
        key: { type: 'string', description: '按键名 (Enter/Tab/Escape/Backspace/Delete/ArrowUp/...)' },
        hotkey: { type: 'string', description: '快捷键 (ctrl+c, ctrl+shift+t)' },
        direction: { type: 'string', enum: ['up', 'down'] },
      },
      required: ['action'],
    },
  },
  // === 标签 ===
  {
    name: 'tabbit_tabs',
    description: '多标签管理。list 返回的 id 即 close 所需的 targetId。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'open', 'close'] },
        url: { type: 'string' },
        targetId: { type: 'string', description: '目标 id (来自 list 输出的完整 id)' },
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
        includePreserved: { type: 'boolean', description: '是否包含历史持久化日志（window.__tabbit_logs），默认 true' },
      },
      required: ['action'],
    },
  },
  // === 智能元素操作 ===
  {
    name: 'tabbit_element',
    description: '智能元素操作：按文本/placeholder/选择器定位元素，自动滚动到可见、等待出现、健壮点击与输入。是发布、录制等自动化的底座，比坐标点击更耐改版。locator 用 {selector|text|placeholder|tag|role,index}。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'click-any', 'type', 'type-any', 'wait', 'get-text', 'scroll-into-view', 'upload', 'count'], description: '操作类型' },
        locator: {
          type: 'object',
          description: '定位条件，支持 selector/text/placeholder/tag/role/index',
          properties: {
            selector: { type: 'string' },
            text: { type: 'string' },
            placeholder: { type: 'string' },
            tag: { type: 'string' },
            role: { type: 'string' },
            index: { type: 'number' },
          },
        },
        locators: { type: 'array', description: 'click-any/type-any 的备选定位器数组', items: { type: 'object' } },
        text: { type: 'string', description: 'type/type-any 时输入的文本' },
        filePaths: { type: 'array', description: 'upload 时的文件绝对路径数组', items: { type: 'string' } },
        timeout: { type: 'number', description: '等待超时 ms，默认 10000' },
        clear: { type: 'boolean', description: 'type 时是否先清空，默认 false' },
      },
      required: ['action'],
    },
  },
  // === 正文提取 ===
  {
    name: 'tabbit_readability',
    description: '智能正文提取：注入 Readability 算法按文本密度提取主体、去广告导航，转为 Markdown。适合把网页文章转成干净文本。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '限定根容器 CSS 选择器（可选，默认全文）' },
        maxLength: { type: 'number', description: 'markdown 最大长度，默认不限' },
      },
    },
  },
  // === 下载管理 ===
  {
    name: 'tabbit_download',
    description: '下载管理：设置下载目录、查看下载记录。set-dir 后该页面的下载会自动记录。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set-dir', 'list', 'clear'], description: '操作类型' },
        dir: { type: 'string', description: 'set-dir 时的下载目录绝对路径' },
        limit: { type: 'number', description: 'list 最大返回条数，默认 50' },
      },
      required: ['action'],
    },
  },
  // === 页面监控 ===
  {
    name: 'tabbit_monitor',
    description: '页面监控：对页面区域取快照、轮询检测变化、对比差异。适合监控价格/库存/帖子数据。watch 会阻塞至变化或超时。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['snapshot', 'watch', 'diff'], description: '操作类型' },
        selector: { type: 'string', description: '监控区域的 CSS 选择器（默认全文）' },
        baseline: { type: 'string', description: 'watch 时的基线文本（为空则记录当前为基线）' },
        current: { type: 'string', description: 'diff 时的当前文本' },
        timeout: { type: 'number', description: 'watch 超时 ms，默认 60000，上限 300000' },
        interval: { type: 'number', description: 'watch 轮询间隔 ms，默认 2000' },
      },
      required: ['action'],
    },
  },
  // === 平台发布 ===
  {
    name: 'tabbit_publish',
    description: '多平台自动发布：小红书/抖音/微博/知乎/B站/微信公众号。用文本定位耐改版。需先在浏览器登录并用 tabbit_cookies 保存登录态。首次建议 dryRun=true。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['xhs', 'douyin', 'weibo', 'zhihu', 'bilibili', 'wechat'], description: '平台' },
        content: {
          type: 'object',
          description: '发布内容',
          properties: {
            title: { type: 'string' },
            text: { type: 'string' },
            images: { type: 'array', items: { type: 'string' }, description: '图片绝对路径数组' },
            video: { type: 'string', description: '视频绝对路径' },
            topics: { type: 'array', items: { type: 'string' }, description: '话题数组' },
          },
        },
        dryRun: { type: 'boolean', description: '只填表不点发布，默认 false' },
        waitForLoad: { type: 'number', description: '导航后等待 ms，默认 5000' },
      },
      required: ['platform', 'content'],
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
          case 'touch': await device.enableTouchEmulation(args.enabled !== false); session.close(); return { content: [{ type: 'text', text: `触摸仿真: ${args.enabled !== false}` }] };
          case 'timezone': await device.setTimezone(args.timezone); session.close(); return { content: [{ type: 'text', text: `时区: ${args.timezone}` }] };
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 网络 ===
      case 'tabbit_network': {
        switch (args.action) {
          // 持久化拦截器相关：block/mock/unblock/throttle/log/rules/clear-rules
          case 'block': {
            if (!args.pattern) throw new Error('block 需要 pattern 参数');
            const n = await interceptor.block(args.pattern);
            return { content: [{ type: 'text', text: `已屏蔽匹配 "${args.pattern}" 的请求（当前共 ${n} 条规则）` }] };
          }
          case 'mock': {
            if (!args.pattern) throw new Error('mock 需要 pattern 参数');
            const resp = args.mockResponse !== undefined ? args.mockResponse : '';
            const n = await interceptor.mock(args.pattern, resp, args.status || 200);
            return { content: [{ type: 'text', text: `已 Mock 匹配 "${args.pattern}" 的请求 → 状态 ${args.status || 200}（当前共 ${n} 条规则）` }] };
          }
          case 'unblock': {
            const n = await interceptor.unblock(args.pattern);
            return { content: [{ type: 'text', text: args.pattern ? `已移除 "${args.pattern}" 的规则` : `已清空所有拦截规则` }] };
          }
          case 'clear-rules': {
            await interceptor.unblock(null);
            return { content: [{ type: 'text', text: '已清空所有拦截规则' }] };
          }
          case 'rules': {
            const rules = interceptor.listRules();
            return { content: [{ type: 'text', text: rules.length ? rules.map(r => `[${r.type}] ${r.pattern}${r.response ? ' → mock' : ''}`).join('\n') : '(无规则)' }], rules };
          }
          case 'throttle': {
            await interceptor.setThrottle(args.mode || null);
            return { content: [{ type: 'text', text: args.mode ? `限速: ${args.mode}` : '已恢复默认网络' }] };
          }
          case 'log': {
            const log = interceptor.getLog({ method: args.method, type: args.type, urlPattern: args.pattern });
            const limit = args.limit || 50;
            const slice = log.slice(-limit);
            const text = slice.length
              ? slice.map(r => `[${r.time}] ${r.method} ${r.type || ''} ${r.url.substring(0, 120)}`).join('\n')
              : '(暂无请求日志；拦截器未附着或尚无请求。调用 block/mock/throttle 后会自动附着并开始记录。)';
            return { content: [{ type: 'text', text: `${text}\n共 ${log.length} 条` }], log: slice };
          }
          // 一次性会话操作：Cookie/缓存
          default: {
            const target = await findPage(client);
            const session = await client.connectTo(target);
            const net = new NetworkManager(session);
            await net.enableNetworkOnly();
            try {
              switch (args.action) {
                case 'cookies': { const c = await net.getCookies([target.url]); return { content: [{ type: 'text', text: c.map(x => `${x.name}=${x.value.substring(0, 20)}... (${x.domain})`).join('\n') || '(无)' }], cookies: c }; }
                case 'export-cookies': { const j = await net.exportCookies([target.url]); return { content: [{ type: 'text', text: j }], cookies: JSON.parse(j) }; }
                case 'clear-cache': await net.clearCache(); return { content: [{ type: 'text', text: '浏览器缓存已清除' }] };
                case 'import-cookies': {
                  if (!args.filePath) throw new Error('import-cookies 需要 filePath 参数');
                  const cookies = JSON.parse(fs.readFileSync(args.filePath, 'utf-8'));
                  const n = await net.importCookies(cookies);
                  return { content: [{ type: 'text', text: `导入 ${n} cookies` }] };
                }
                default: throw new Error(`未知操作: ${args.action}`);
              }
            } finally {
              session.close();
            }
          }
        }
      }

      // === 存储 ===
      case 'tabbit_storage': {
        // storage 操作需连接到与 origin 匹配的 http(s) 页面，否则 DOMStorage 报 Frame not found
        const targets = await client.getTargets();
        let origin = args.origin;
        // 未指定 origin 时，取第一个 http(s) 页面的 origin 作为默认
        if (!origin) {
          const httpPage = targets.find(t => (t.type === 'page' || t.type === 'webview') && /^https?:\/\//.test(t.url));
          if (!httpPage) throw new Error('未找到可操作的 http(s) 页面，请先打开目标网站或传入 origin');
          try { origin = new URL(httpPage.url).origin; } catch { origin = httpPage.url; }
        } else {
          // 传入的 origin 规范化（去掉路径）
          try { origin = new URL(origin).origin; } catch {}
        }
        // 找到该 origin 下的页面 target（优先 page，其次 webview）
        const target = targets.find(t => t.type === 'page' && t.url.startsWith(origin))
          || targets.find(t => t.type === 'webview' && t.url.startsWith(origin))
          || targets.find(t => /^https?:\/\//.test(t.url) && t.url.startsWith(origin));
        if (!target) throw new Error(`未找到 origin 为 ${origin} 的页面，请先在浏览器中打开该站点`);
        const session = await client.connectTo(target);
        const storage = new StorageManager(session);
        switch (args.action) {
          case 'export': { const s = await storage.exportLoginState(origin); const fp = args.filePath || 'login-state.json'; fs.writeFileSync(fp, JSON.stringify(s, null, 2)); session.close(); return { content: [{ type: 'text', text: `导出 ${s.cookies.length} cookies → ${fp}` }], state: s }; }
          case 'import': { const s = JSON.parse(fs.readFileSync(args.filePath, 'utf-8')); const r = await storage.importLoginState(s); session.close(); return { content: [{ type: 'text', text: `导入 ${r.cookiesImported} cookies` }] }; }
          case 'clear': await storage.clearAll(origin); session.close(); return { content: [{ type: 'text', text: `已清除 ${origin}` }] };
          case 'local': { const items = await storage.getLocalStorage(origin); session.close(); return { content: [{ type: 'text', text: items.map(e => `${e.key}=${String(e.value).substring(0, 30)}`).join('\n') || '(空)' }], items }; }
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
          case 'drag': await input.drag(args.x, args.y, args.x2, args.y2); session.close(); return { content: [{ type: 'text', text: `拖拽 ${args.x},${args.y} → ${args.x2},${args.y2}` }] };
          case 'select-all': await input.selectAll(); session.close(); return { content: [{ type: 'text', text: '全选' }] };
          case 'copy': await input.copy(); session.close(); return { content: [{ type: 'text', text: '复制' }] };
          case 'paste': await input.paste(); session.close(); return { content: [{ type: 'text', text: '粘贴' }] };
          case 'cut': await input.cut(); session.close(); return { content: [{ type: 'text', text: '剪切' }] };
          case 'undo': await input.undo(); session.close(); return { content: [{ type: 'text', text: '撤销' }] };
          case 'redo': await input.redo(); session.close(); return { content: [{ type: 'text', text: '重做' }] };
          default: session.close(); throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 标签 ===
      case 'tabbit_tabs': {
        const mt = new MultiTabManager({ port: PORT });
        switch (args.action) {
          case 'list': { const t = await client.getTargets(); const p = t.filter(x => x.type === 'page'); await mt.closeAll(); return { content: [{ type: 'text', text: p.map(x => `${x.id}  ${x.title}  ${x.url}`).join('\n') || '(无标签页)' }], tabs: p.map(x => ({ id: x.id, title: x.title, url: x.url })) }; }
          case 'open': { const id = await mt.createTab(args.url || 'https://web.tabbit.com/newtab'); await mt.closeAll(); return { content: [{ type: 'text', text: `新标签已打开: ${id}` }], targetId: id }; }
          case 'close': {
            if (!args.targetId) throw new Error('close 需要 targetId 参数（来自 list 输出的 id）');
            await mt.closeTab(args.targetId); await mt.closeAll();
            return { content: [{ type: 'text', text: `已关闭: ${args.targetId}` }] };
          }
          default: await mt.closeAll(); throw new Error(`未知操作`);
        }
      }

      // === 增强: 智能导航 ===
      case 'tabbit_navigate': {
        const version = await client.getVersion();
        const bws = new CDP(version.webSocketDebuggerUrl, true);
        await bws.connect();
        // 先以 about:blank 创建目标，便于在真实导航前注入反检测脚本
        const { targetId } = await bws.send('Target.createTarget', { url: 'about:blank' });
        bws.close();

        // 等待新 target 出现在 /json/list
        let page = null;
        const targetUrl = args.url;
        for (let i = 0; i < 20; i++) {
          const targets = await client.getTargets();
          page = targets.find(t => (t.id === targetId || t.targetId === targetId));
          if (page) break;
          await sleep(200);
        }
        if (!page) throw new Error('新标签页创建失败');

        const cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.connect();
        // 关键：在导航前注入反检测脚本，使其在首屏加载即生效
        await cdp.send('Page.enable');
        await cdp.injectAntiDetect();

        // 让持久化拦截器跟随新页面：使 block/mock 规则、限速、请求日志
        // 在首屏加载即生效。失败不阻断导航（如无规则也无需附着）。
        try { await interceptor.attachToTarget(page); } catch (_) {}

        // 导航到真实 URL
        await cdp.send('Page.navigate', { url: targetUrl });

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
            extractScript = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(args.selector)})].slice(0,${limit}).map(e => ({tag: e.tagName, text: e.textContent?.trim().substring(0,100), cls: (e.className||'').substring(0,50)})))`;
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
            await net.enableNetworkOnly();
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
            await net.enableNetworkOnly();
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
                await net.enableNetworkOnly();
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
                  await net.enableNetworkOnly();
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

        await session.send('Runtime.enable');
        await session.send('Log.enable');

        switch (args.action) {
          case 'list':
          case 'errors':
          case 'warnings':
          case 'logs': {
            let filterType = args.type;
            if (args.action === 'errors') filterType = 'error';
            else if (args.action === 'warnings') filterType = 'warning';
            else if (args.action === 'logs') filterType = 'log';

            const limit = args.limit || 50;
            const search = args.search || '';

            // ── 1. 即时事件捕获：本次 session 期间触发的 console 输出 ──
            // Runtime.consoleAPICalled 无需提前注入，任何 console 调用都能抓到
            const liveLogs = [];
            session.on('Runtime.consoleAPICalled', (params) => {
              const text = (params.args || [])
                .map(a => a.value !== undefined ? String(a.value) : (a.description || a.type || '[object]'))
                .join(' ');
              liveLogs.push({ type: params.type, text, time: params.timestamp || Date.now() });
            });
            // Log.entryAdded 捕获浏览器级日志（未捕获异常、网络错误等）
            session.on('Log.entryAdded', (entry) => {
              const e = entry.entry || entry;
              liveLogs.push({
                type: e.level === 'error' ? 'error' : (e.level === 'warning' ? 'warning' : 'log'),
                text: (e.text || '') + (e.url ? ` (${e.url}:${e.lineNumber || 0})` : ''),
                time: e.timestamp || Date.now(),
              });
            });

            // ── 2. 持久 hook：捕获历史/页面加载阶段日志，跨调用持久 ──
            // 用 addScriptToEvaluateOnNewDocument 在文档最早期注入，跨导航生效
            await session.send('Page.enable');
            const hookSrc = `
              if (!window.__tabbit_logs) {
                window.__tabbit_logs = [];
                const mk = (type) => function() {
                  window.__tabbit_logs.push({type, text:[...arguments].map(a=>{try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' '), time:Date.now()});
                };
                ['log','warn','error','info','debug'].forEach(m => {
                  const t = m === 'warn' ? 'warning' : m;
                  const orig = console[m];
                  console[m] = function(){ mk(t).apply(null, arguments); orig.apply(console, arguments); };
                });
                window.addEventListener('error', (e) => {
                  window.__tabbit_logs.push({type:'error', text:'[Uncaught] ' + e.message + ' at ' + (e.filename||'') + ':' + (e.lineno||0), time:Date.now()});
                });
                window.addEventListener('unhandledrejection', (e) => {
                  window.__tabbit_logs.push({type:'error', text:'[UnhandledRejection] ' + (e.reason && e.reason.message ? e.reason.message : e.reason), time:Date.now()});
                });
              }
            `;
            try { await session.send('Page.addScriptToEvaluateOnNewDocument', { source: hookSrc }); } catch {}
            // 对当前已加载文档立即注入一次（addScriptToEvaluateOnNewDocument 只对新文档生效）
            await session.send('Runtime.evaluate', { expression: hookSrc, returnByValue: true });

            // ── 3. 读取历史持久日志（includePreserved 默认 true）──
            let preservedLogs = [];
            if (args.includePreserved !== false) {
              try {
                const r = await session.send('Runtime.evaluate', {
                  expression: `JSON.stringify(window.__tabbit_logs || [])`,
                  returnByValue: true,
                });
                preservedLogs = JSON.parse(r.result?.value || '[]');
              } catch {}
            }

            // ── 4. 合并去重（持久 + 即时）──
            const seen = new Set(preservedLogs.map(l => l.time + '|' + l.type + '|' + l.text));
            for (const l of liveLogs) {
              const k = l.time + '|' + l.type + '|' + l.text;
              if (!seen.has(k)) { preservedLogs.push(l); seen.add(k); }
            }

            let logs = preservedLogs;
            if (filterType) logs = logs.filter(l => l.type === filterType);
            if (search) {
              const keyword = search.toLowerCase();
              logs = logs.filter(l => String(l.text).toLowerCase().includes(keyword));
            }

            if (logs.length === 0) {
              session.close();
              return { content: [{ type: 'text', text: '(无控制台日志)\n日志捕获器已就绪：历史日志记录到 window.__tabbit_logs，本次会话期间的 console 输出也会实时捕获。' }] };
            }

            const output = logs.slice(-limit).map(l => {
              const time = new Date(l.time).toLocaleTimeString();
              const icon = { log: '📝', info: 'ℹ️', warning: '⚠️', error: '❌', debug: '🔍' }[l.type] || '📝';
              return `[${time}] ${icon} ${l.type}: ${String(l.text).substring(0, 200)}`;
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

      // === 智能元素操作 ===
      case 'tabbit_element': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const element = new ElementManager(session);
        try {
          switch (args.action) {
            case 'click': {
              if (!args.locator) throw new Error('需要 locator 参数');
              const r = await element.click(args.locator, { timeout: args.timeout });
              return { content: [{ type: 'text', text: `已点击: ${JSON.stringify(args.locator)} @ ${Math.round(r.x)},${Math.round(r.y)}` }] };
            }
            case 'click-any': {
              if (!args.locators || !args.locators.length) throw new Error('需要 locators 数组');
              const r = await element.clickAny(args.locators, { timeout: args.timeout });
              return { content: [{ type: 'text', text: `已点击 @ ${Math.round(r.x)},${Math.round(r.y)}` }] };
            }
            case 'type': {
              if (!args.locator) throw new Error('需要 locator 参数');
              await element.type(args.locator, args.text || '', { clear: args.clear, timeout: args.timeout });
              return { content: [{ type: 'text', text: `已输入 ${args.text?.length || 0} 字符` }] };
            }
            case 'type-any': {
              if (!args.locators || !args.locators.length) throw new Error('需要 locators 数组');
              await element.typeAny(args.locators, args.text || '', { clear: args.clear, timeout: args.timeout });
              return { content: [{ type: 'text', text: `已输入 ${args.text?.length || 0} 字符` }] };
            }
            case 'wait': {
              if (!args.locator) throw new Error('需要 locator 参数');
              const el = await element.waitFor(args.locator, { timeout: args.timeout || 10000 });
              return { content: [{ type: 'text', text: `元素已出现: ${el.tag} "${el.text.substring(0, 40)}"` }] };
            }
            case 'get-text': {
              const t = await element.getText(args.locator || {});
              return { content: [{ type: 'text', text: t || '(空)' }] };
            }
            case 'scroll-into-view': {
              const el = await element.scrollIntoView(args.locator || {});
              return { content: [{ type: 'text', text: `已滚动到: ${el.tag} @ ${Math.round(el.cx)},${Math.round(el.cy)}` }] };
            }
            case 'upload': {
              if (!args.filePaths || !args.filePaths.length) throw new Error('需要 filePaths 数组');
              const r = await element.upload(args.filePaths, args.locator || {});
              return { content: [{ type: 'text', text: `已上传 ${r.uploaded} 个文件` }] };
            }
            case 'count': {
              const n = await element.count(args.locator || {});
              return { content: [{ type: 'text', text: `匹配 ${n} 个元素` }], count: n };
            }
            default: throw new Error(`未知操作: ${args.action}`);
          }
        } finally {
          session.close();
        }
      }

      // === 正文提取 ===
      case 'tabbit_readability': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const ext = new ContentExtractor(session);
        try {
          const data = await ext.extract({ selector: args.selector, maxLength: args.maxLength });
          return { content: [{ type: 'text', text: `# ${data.title}\n\n${data.markdown}\n\n---\n长度: ${data.length} 字符` }], ...data };
        } finally {
          session.close();
        }
      }

      // === 下载管理 ===
      case 'tabbit_download': {
        switch (args.action) {
          case 'set-dir': {
            const dir = args.dir || downloadTracker.dir;
            const r = await downloadTracker.setDir(dir);
            return { content: [{ type: 'text', text: `下载目录已设为 ${r.dir}，已附着到当前页面` }], dir: r.dir };
          }
          case 'list': {
            const records = downloadTracker.list(args.limit || 50);
            const text = records.length
              ? records.map(r => `[${r.time}] ${r.filename} ${r.state} ${r.received || 0}/${r.total || 0}`).join('\n')
              : '(暂无下载记录。先 set-dir 附着到页面后再触发下载。)';
            return { content: [{ type: 'text', text: `${text}\n共 ${records.length} 条` }], records };
          }
          case 'clear': {
            downloadTracker.clear();
            return { content: [{ type: 'text', text: '下载记录已清空' }] };
          }
          default: throw new Error(`未知操作: ${args.action}`);
        }
      }

      // === 页面监控 ===
      case 'tabbit_monitor': {
        const target = await findPage(client);
        const session = await client.connectTo(target);
        const mon = new MonitorManager(session);
        const locator = args.selector ? { selector: args.selector } : {};
        try {
          switch (args.action) {
            case 'snapshot': {
              const snap = await mon.snapshot(locator);
              return { content: [{ type: 'text', text: `[${new Date(snap.time).toLocaleTimeString()}] 快照 (${snap.text.length} 字符):\n${snap.text.substring(0, 1000)}` }], snapshot: snap };
            }
            case 'watch': {
              const r = await mon.watch(locator, { baseline: args.baseline, timeout: args.timeout, interval: args.interval });
              const text = r.changed
                ? `✅ 检测到变化（耗时 ${r.durationMs}ms）\n新增: ${r.diff.addedCount} 行\n移除: ${r.diff.removedCount} 行\n---\n${r.snapshot.text.substring(0, 1000)}`
                : `⏱ ${r.note || '未变化'}（耗时 ${r.durationMs}ms）\n基线已记录，可将其作为 baseline 参数再次 watch 检测后续变化`;
              return { content: [{ type: 'text', text }], ...r };
            }
            case 'diff': {
              if (!args.baseline || !args.current) throw new Error('diff 需要 baseline 和 current 参数');
              const d = mon.diff(args.baseline, args.current);
              return { content: [{ type: 'text', text: `新增 ${d.addedCount} 行，移除 ${d.removedCount} 行\n--- 新增 ---\n${d.added.join('\n')}\n--- 移除 ---\n${d.removed.join('\n')}` }], diff: d };
            }
            default: throw new Error(`未知操作: ${args.action}`);
          }
        } finally {
          session.close();
        }
      }

      // === 平台发布 ===
      case 'tabbit_publish': {
        const platform = PLATFORMS[args.platform];
        if (!platform) throw new Error(`未知平台: ${args.platform}`);
        const content = args.content || {};
        const dryRun = args.dryRun === true;

        // 1. 创建新标签 → 注入反检测 → 导航到创作者中心
        const version = await client.getVersion();
        const bws = new CDP(version.webSocketDebuggerUrl, true);
        await bws.connect();
        const { targetId } = await bws.send('Target.createTarget', { url: 'about:blank' });
        bws.close();

        let page = null;
        for (let i = 0; i < 20; i++) {
          const targets = await client.getTargets();
          page = targets.find(t => t.id === targetId || t.targetId === targetId);
          if (page) break;
          await sleep(200);
        }
        if (!page) throw new Error('发布标签页创建失败');

        const cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.connect();
        await cdp.send('Page.enable');
        await cdp.injectAntiDetect();
        try { await interceptor.attachToTarget(page); } catch (_) {}
        await cdp.send('Page.navigate', { url: platform.creatorUrl });
        await sleep(args.waitForLoad || 5000);

        const finalUrl = await cdp.eval('location.href');
        const title = await cdp.eval('document.title');

        // 2. 登录态检查
        const notLoggedIn = platform.loginPattern && finalUrl.includes(platform.loginPattern);
        if (notLoggedIn) {
          cdp.close();
          return {
            content: [{ type: 'text', text: `⚠️ 未登录${platform.name}。\n当前 URL: ${finalUrl}\n请先在浏览器登录${platform.name}，并用 tabbit_cookies save 保存登录态，然后重试。\n发布流程已终止。` }],
            success: false, warning: 'not_logged_in', url: finalUrl, platform: args.platform,
          };
        }

        // 3. 用 ElementManager 执行平台发布流程
        const element = new ElementManager(cdp);
        const log = [];
        const result = await platform.publish({ element, content, dryRun, log });
        cdp.close();

        const text = `【${platform.name}】${dryRun ? '(dryRun) ' : ''}${result.success ? '✅ 已发起发布' : '⚠️ ' + (result.warning || '未发布')}\nURL: ${finalUrl}\n标题: ${title}\n步骤:\n${(result.steps || []).map(s => '  - ' + s).join('\n')}`;
        return {
          content: [{ type: 'text', text }],
          platform: args.platform, success: !!result.success,
          warning: result.warning, steps: result.steps, url: finalUrl,
        };
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
        serverInfo: { name: 'tabbit-browser', version: '2.3.0' },
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
// 同时支持两种分帧：换行分隔(NDJSON，标准 MCP 客户端如 Claude Code 使用)
// 与 Content-Length 分帧(LSP 风格)。输出统一为换行分隔。

let buffer = '';
function tryHandle(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; } // 非 JSON 行直接忽略
  try { handleMessage(msg); } catch {}
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    // 优先尝试 Content-Length 分帧：仅在行首匹配时解析
    const clMatch = buffer.match(/^\s*Content-Length:\s*(\d+)\s*\r?\n\r?\n/);
    if (clMatch) {
      const contentLength = parseInt(clMatch[1], 10);
      const bodyStart = clMatch[0].length;
      if (buffer.length < bodyStart + contentLength) break; // 等待更多数据
      const body = buffer.substring(bodyStart, bodyStart + contentLength);
      buffer = buffer.substring(bodyStart + contentLength);
      tryHandle(body);
      continue;
    }
    // 否则按换行分隔处理
    const nl = buffer.indexOf('\n');
    if (nl === -1) break;
    const line = buffer.substring(0, nl);
    buffer = buffer.substring(nl + 1);
    tryHandle(line);
  }
});
process.stdin.on('end', () => process.exit(0));
process.stderr.write('Tabbit Browser MCP Server v2.3.0 started\n');
