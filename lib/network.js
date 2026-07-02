/**
 * Tabbit CDP - 网络模块
 * 请求拦截、Mock 响应、Cookie 管理、网络限速
 */

class NetworkManager {
  constructor(cdpSession) {
    this.session = cdpSession;
    this._interceptors = new Map();
    this._requestLog = [];
  }

  /** 启用网络监控 */
  async enable() {
    await this.session.send('Network.enable');
    await this.session.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }]
    });

    // 监听请求事件
    this.session.on('Fetch.requestPaused', (params) => {
      this._handleRequest(params);
    });

    this.session.on('Network.requestWillBeSent', (params) => {
      this._requestLog.push({
        id: params.requestId,
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        timestamp: params.timestamp,
      });
    });

    return this;
  }

  /** 拦截请求并执行自定义逻辑 */
  _handleRequest(params) {
    const { requestId, request } = params;
    const url = request.url;

    // 检查是否有匹配的拦截器
    for (const [pattern, handler] of this._interceptors) {
      if (url.includes(pattern)) {
        try {
          const result = handler({
            url,
            method: request.method,
            headers: request.headers,
            postData: request.postData,
            requestId,
          });

          if (result && result.action === 'mock') {
            this.session.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: result.status || 200,
              responseHeaders: result.headers || [{ name: 'Content-Type', value: 'application/json' }],
              body: Buffer.from(JSON.stringify(result.body)).toString('base64'),
            });
            return;
          }

          if (result && result.action === 'block') {
            this.session.send('Fetch.failRequest', {
              requestId,
              errorReason: 'BlockedByClient',
            });
            return;
          }
        } catch (e) {}
      }
    }

    // 默认：继续请求
    this.session.send('Fetch.continueRequest', { requestId });
  }

  /**
   * 注册 URL 拦截器
   * @param {string} pattern - URL 包含匹配
   * @param {Function} handler - 拦截处理函数
   */
  intercept(pattern, handler) {
    this._interceptors.set(pattern, handler);
    return this;
  }

  /** Mock 某个 URL 的响应 */
  mock(pattern, responseData, status = 200) {
    return this.intercept(pattern, () => ({
      action: 'mock',
      status,
      body: responseData,
    }));
  }

  /** 屏蔽某个 URL */
  block(pattern) {
    return this.intercept(pattern, () => ({ action: 'block' }));
  }

  /** 获取请求日志 */
  getRequestLog(filter = {}) {
    let log = [...this._requestLog];
    if (filter.method) log = log.filter(r => r.method === filter.method);
    if (filter.type) log = log.filter(r => r.type === filter.type);
    if (filter.urlPattern) log = log.filter(r => r.url.includes(filter.urlPattern));
    return log;
  }

  /** 清除请求日志 */
  clearRequestLog() {
    this._requestLog = [];
  }

  // ─── Cookie 管理 ──────────────────────────────────────

  /** 获取所有 Cookie */
  async getCookies(urls) {
    const result = await this.session.send('Network.getCookies', { urls: urls || [] });
    return result.cookies;
  }

  /** 设置 Cookie */
  async setCookie(cookie) {
    return await this.session.send('Network.setCookie', cookie);
  }

  /** 删除 Cookie */
  async deleteCookies(name, domain, path) {
    return await this.session.send('Network.deleteCookies', { name, domain, path });
  }

  /** 清除所有 Cookie */
  async clearCookies() {
    return await this.session.send('Network.clearBrowserCookies');
  }

  /** 导出 Cookie 为 JSON */
  async exportCookies(urls) {
    const cookies = await this.getCookies(urls);
    return JSON.stringify(cookies, null, 2);
  }

  /** 从 JSON 导入 Cookie */
  async importCookies(cookieJson) {
    const cookies = typeof cookieJson === 'string' ? JSON.parse(cookieJson) : cookieJson;
    for (const cookie of cookies) {
      await this.setCookie(cookie);
    }
    return cookies.length;
  }

  // ─── 网络限速 ────────────────────────────────────────

  /** 模拟网络条件 */
  async emulateNetwork(conditions) {
    // conditions: 'offline' | 'slow-3g' | 'fast-3g' | '4g' | null
    if (!conditions) {
      await this.session.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });
      return;
    }

    const presets = {
      offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
      'slow-3g': { offline: false, downloadThroughput: 50 * 1024 / 8, uploadThroughput: 50 * 1024 / 8, latency: 2000 },
      'fast-3g': { offline: false, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 562 },
      '4g': { offline: false, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8, latency: 100 },
    };

    const config = presets[conditions] || presets['4g'];
    await this.session.send('Network.emulateNetworkConditions', config);
  }

  /** 禁用缓存 */
  async disableCache(disabled = true) {
    await this.session.send('Network.setCacheDisabled', { cacheDisabled: disabled });
  }

  /** 获取页面加载性能指标 */
  async getPerformanceMetrics() {
    const result = await this.session.send('Performance.getMetrics');
    return result.metrics;
  }

  /** 清除浏览器缓存 */
  async clearCache() {
    return await this.session.send('Network.clearBrowserCache');
  }
}

module.exports = { NetworkManager };
