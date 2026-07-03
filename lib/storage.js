/**
 * Tabbit CDP - 存储管理模块
 * localStorage/sessionStorage/IndexedDB 管理、登录态导出/导入
 */

class StorageManager {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  // ─── LocalStorage ────────────────────────────────────

  /** 获取 localStorage 所有数据 */
  async getLocalStorage(origin) {
    await this.session.send('DOMStorage.enable');
    const result = await this.session.send('DOMStorage.getDOMStorageItems', {
      storageId: { securityOrigin: origin, isLocalStorage: true },
    });
    // CDP 返回 entries 为 [[key, value], ...] 二维数组，统一转为 {key, value}
    return (result.entries || []).map(e => Array.isArray(e) ? { key: e[0], value: e[1] } : e);
  }

  /** 设置 localStorage 项 */
  async setLocalStorageItem(origin, key, value) {
    await this.session.send('DOMStorage.enable');
    await this.session.send('DOMStorage.setDOMStorageItem', {
      storageId: { securityOrigin: origin, isLocalStorage: true },
      key,
      value,
    });
  }

  /** 删除 localStorage 项 */
  async removeLocalStorageItem(origin, key) {
    await this.session.send('DOMStorage.enable');
    await this.session.send('DOMStorage.removeDOMStorageItem', {
      storageId: { securityOrigin: origin, isLocalStorage: true },
      key,
    });
  }

  /** 清除 localStorage */
  async clearLocalStorage(origin) {
    await this.session.send('DOMStorage.enable');
    await this.session.send('DOMStorage.clearDOMStorageItems', {
      storageId: { securityOrigin: origin, isLocalStorage: true },
    });
  }

  // ─── SessionStorage ──────────────────────────────────

  /** 获取 sessionStorage 所有数据 */
  async getSessionStorage(origin) {
    await this.session.send('DOMStorage.enable');
    const result = await this.session.send('DOMStorage.getDOMStorageItems', {
      storageId: { securityOrigin: origin, isLocalStorage: false },
    });
    return (result.entries || []).map(e => Array.isArray(e) ? { key: e[0], value: e[1] } : e);
  }

  /** 清除 sessionStorage */
  async clearSessionStorage(origin) {
    await this.session.send('DOMStorage.enable');
    await this.session.send('DOMStorage.clearDOMStorageItems', {
      storageId: { securityOrigin: origin, isLocalStorage: false },
    });
  }

  // ─── IndexedDB ───────────────────────────────────────

  /** 列出所有 IndexedDB 数据库 */
  async listDatabases(origin) {
    await this.session.send('IndexedDB.enable');
    const result = await this.session.send('IndexedDB.requestDatabaseNames', { securityOrigin: origin });
    return result.databaseNames;
  }

  /** 获取 IndexedDB 数据库元数据 */
  async getDatabaseMetadata(origin, databaseName) {
    await this.session.send('IndexedDB.enable');
    const result = await this.session.send('IndexedDB.requestDatabase', {
      databaseName,
      securityOrigin: origin,
    });
    return result;
  }

  // ─── Cookies (通过 Network 域) ──────────────────────

  /** 导出指定 URL 的所有 Cookie */
  async exportCookies(urls) {
    const result = await this.session.send('Network.getCookies', { urls: urls || [] });
    return result.cookies;
  }

  /** 导入 Cookie */
  async importCookies(cookies) {
    for (const cookie of cookies) {
      await this.session.send('Network.setCookie', cookie);
    }
    return cookies.length;
  }

  // ─── 登录态导出/导入 ─────────────────────────────────

  /**
   * 导出完整登录态（Cookie + LocalStorage）
   * @param {string} origin - 网站 origin (如 https://web.tabbit.com)
   */
  async exportLoginState(origin) {
    const cookies = await this.exportCookies([origin]);
    const localStorage = await this.getLocalStorage(origin);

    return {
      origin,
      timestamp: new Date().toISOString(),
      cookies,
      localStorage: localStorage.reduce((acc, entry) => {
        acc[entry.key] = entry.value;
        return acc;
      }, {}),
    };
  }

  /**
   * 导入登录态
   * @param {object} state - exportLoginState 的返回值
   */
  async importLoginState(state) {
    // 导入 Cookie
    if (state.cookies && state.cookies.length) {
      await this.importCookies(state.cookies);
    }

    // 导入 LocalStorage
    if (state.localStorage) {
      for (const [key, value] of Object.entries(state.localStorage)) {
        await this.setLocalStorageItem(state.origin, key, value);
      }
    }

    return {
      cookiesImported: state.cookies?.length || 0,
      localStorageImported: Object.keys(state.localStorage || {}).length,
    };
  }

  // ─── 批量清理 ───────────────────────────────────────

  /** 清除指定 origin 的所有存储（Cookie + Storage + Cache），不影响其他站点 */
  async clearAll(origin) {
    // Storage.clearDataForOrigin 仅清除该 origin 的数据（含 cookies），
    // 不要用 Network.clearBrowserCookies —— 那会清空所有站点的 Cookie（数据丢失）。
    await this.session.send('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'appcache,cookies,indexeddb,local_storage,shader_cache,service_workers,cache_storage',
    });

    return { cleared: true, origin };
  }
}

module.exports = { StorageManager };
