/**
 * Tabbit CDP - 多标签并行管理模块
 * 并行操控多个 Tabbit 标签页、批量对话
 */

const http = require('http');
const { WebSocket } = require('ws');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class SimpleCDPSession {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.msgId = 0; this._handlers = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined && this._handlers.has(msg.id)) {
        const { resolve, reject, timer } = this._handlers.get(msg.id);
        clearTimeout(timer); this._handlers.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    });
    return this;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => { this._handlers.delete(id); reject(new Error(`timeout: ${method}`)); }, parseInt(process.env.TABBIT_CDP_TIMEOUT || '60000', 10));
      this._handlers.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { if (this.ws) this.ws.close(); }
}

class MultiTabManager {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 9222;
    this._sessions = new Map(); // targetId -> CDPSession
  }

  /** 获取所有页面 targets */
  async getTargets() {
    return new Promise((resolve, reject) => {
      http.get(`http://${this.host}:${this.port}/json/list`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  /** 获取浏览器版本 */
  async getVersion() {
    return new Promise((resolve, reject) => {
      http.get(`http://${this.host}:${this.port}/json/version`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  /** 连接到指定 target */
  async connectTo(targetId) {
    const targets = await this.getTargets();
    const target = targets.find(t => t.id === targetId);
    if (!target) throw new Error(`Target not found: ${targetId}`);

    const session = new SimpleCDPSession(target.webSocketDebuggerUrl);
    await session.connect();
    await session.send('Runtime.enable');
    this._sessions.set(targetId, session);
    return session;
  }

  /** 连接到浏览器级别 */
  async connectBrowser() {
    const version = await this.getVersion();
    const session = new SimpleCDPSession(version.webSocketDebuggerUrl);
    await session.connect();
    this._browserSession = session;
    return session;
  }

  /** 创建新标签页 */
  async createTab(url) {
    if (!this._browserSession) await this.connectBrowser();
    const result = await this._browserSession.send('Target.createTarget', { url });
    await sleep(1000);
    return result.targetId;
  }

  /** 关闭标签页 */
  async closeTab(targetId) {
    if (this._sessions.has(targetId)) {
      this._sessions.get(targetId).close();
      this._sessions.delete(targetId);
    }
    if (this._browserSession) {
      await this._browserSession.send('Target.closeTarget', { targetId });
    }
  }

  /** 在指定标签页执行 JavaScript */
  async evaluate(targetId, expression) {
    const session = this._sessions.get(targetId);
    if (!session) throw new Error(`Not connected to target: ${targetId}`);
    const result = await session.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    return result.result?.value;
  }

  // ─── 并行对话 ────────────────────────────────────────

  /**
   * 在多个标签页并行发送消息
   * @param {Array<{targetId: string, message: string}>} tasks - 任务列表
   * @param {object} options
   * @param {number} options.waitMs - 等待回复时间
   * @returns {Promise<Array<{targetId: string, text: string, error: string|null}>>}
   */
  async parallelChat(tasks, options = {}) {
    const { waitMs = 12000 } = options;

    const promises = tasks.map(async (task) => {
      try {
        const session = this._sessions.get(task.targetId);
        if (!session) throw new Error('Not connected');

        // 聚焦输入框
        await session.send('Runtime.evaluate', {
          expression: `(() => {
            const el = document.querySelector('[contenteditable="plaintext-only"]') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea');
            if (el) { el.focus(); el.click(); return 'ok'; }
            return 'not found';
          })()`,
          returnByValue: true,
        });
        await sleep(300);

        // 输入消息
        await session.send('Input.insertText', { text: task.message });
        await sleep(300);

        // 发送
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

        // 读取回复
        const result = await session.send('Runtime.evaluate', {
          expression: 'document.body?.innerText',
          returnByValue: true,
        });

        const text = result.result?.value || '';
        const cleaned = text
          .replace(/继续提问，或输入 @ 来引用内容[\s\S]*$/, '')
          .replace(/内容由 AI 生成仅供参考\n?/g, '')
          .replace(/Doubao-[\w.-]+/g, '')
          .trim();

        return { targetId: task.targetId, text: cleaned, error: null };
      } catch (e) {
        return { targetId: task.targetId, text: '', error: e.message };
      }
    });

    return Promise.all(promises);
  }

  // ─── 批量操作 ────────────────────────────────────────

  /**
   * 批量导航到指定 URL
   * @param {Array<{targetId: string, url: string}>} navigations
   */
  async parallelNavigate(navigations) {
    const promises = navigations.map(async (nav) => {
      const session = this._sessions.get(nav.targetId);
      if (!session) return { targetId: nav.targetId, error: 'Not connected' };
      await session.send('Page.navigate', { url: nav.url });
      await sleep(1000);
      return { targetId: nav.targetId, error: null };
    });
    return Promise.all(promises);
  }

  /**
   * 批量截图
   */
  async parallelScreenshot(targetIds, options = {}) {
    const promises = targetIds.map(async (targetId) => {
      const session = this._sessions.get(targetId);
      if (!session) return { targetId, error: 'Not connected' };
      const result = await session.send('Page.captureScreenshot', {
        format: options.format || 'jpeg',
        quality: options.quality || 70,
      });
      return { targetId, data: result.data, error: null };
    });
    return Promise.all(promises);
  }

  // ─── 清理 ────────────────────────────────────────────

  /** 关闭所有连接 */
  async closeAll() {
    for (const [id, session] of this._sessions) {
      session.close();
    }
    this._sessions.clear();
    if (this._browserSession) {
      this._browserSession.close();
      this._browserSession = null;
    }
  }
}

module.exports = { MultiTabManager };
