/**
 * Tabbit CDP - 页面监控模块
 * 对页面某区域取快照、轮询监控变化、对比差异。
 * 适合监控商品价格、库存、帖子数据等。
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class MonitorManager {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  /** 取 locator 区域的内容快照 */
  async snapshot(locator = {}) {
    const sel = locator.selector ? JSON.stringify(locator.selector) : null;
    const expr = `(() => {
      ${sel ? `const el = document.querySelector(${sel});` : `const el = document.body;`}
      if (!el) return JSON.stringify({ error: '元素未找到' });
      return JSON.stringify({
        text: (el.innerText || '').trim(),
        html: el.innerHTML.substring(0, 5000),
        time: Date.now(),
      });
    })()`;
    const r = await this.session.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const data = JSON.parse(r.result?.value || '{}');
    if (data.error) throw new Error(data.error);
    return data;
  }

  /**
   * 轮询监控，直到内容变化或超时
   * @param {object} locator - 监控区域
   * @param {string} baseline - 基线文本（为空则取当前快照作为基线，立即返回）
   * @param {number} timeout - 超时 ms（上限 300000）
   * @param {number} interval - 轮询间隔 ms
   * @returns {changed, snapshot, durationMs}
   */
  async watch(locator, options = {}) {
    const timeout = Math.min(options.timeout || 60000, 300000);
    const interval = Math.min(options.interval || 2000, 10000);
    const baseline = options.baseline || '';

    const start = Date.now();
    // 若无基线，取当前快照为基线
    let base = baseline;
    if (!base) {
      const snap = await this.snapshot(locator);
      base = snap.text;
      return { changed: false, snapshot: snap, baseline: base, durationMs: Date.now() - start, note: '已记录基线，再次调用 watch 传入此 baseline 以检测后续变化' };
    }

    // 注入 MutationObserver，页面变化时才触发对比（比固定轮询高效）
    const sel = locator.selector ? JSON.stringify(locator.selector) : null;
    const checkExpr = sel
      ? `document.querySelector(${sel})?.innerText || ''`
      : `document.body?.innerText || ''`;
    const result = await this.session.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const check = () => {
          const text = ${checkExpr};
          if (text !== ${JSON.stringify(base)}) {
            resolve(JSON.stringify({ changed: true, text }));
            return true;
          }
          return false;
        };
        if (check()) return;
        const obs = new MutationObserver(() => check());
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
        setTimeout(() => { obs.disconnect(); resolve(JSON.stringify({ changed: false })); }, ${timeout});
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    const watchResult = JSON.parse(result.result?.value || '{}');
    const snap = { text: watchResult.text || base, html: '', time: Date.now() };
    if (watchResult.changed) {
      return {
        changed: true,
        baseline: base,
        snapshot: snap,
        durationMs: Date.now() - start,
        diff: this._diff(base, snap.text),
      };
    }
    return {
      changed: false,
      baseline: base,
      snapshot: snap,
      durationMs: Date.now() - start,
      note: '超时未变化',
    };
  }

  /** 对比两个快照的差异（按行） */
  diff(baseline, current) {
    return this._diff(baseline, current);
  }

  _diff(a, b) {
    const aLines = (a || '').split('\n').filter(l => l.trim());
    const bLines = (b || '').split('\n').filter(l => l.trim());
    const aSet = new Set(aLines);
    const bSet = new Set(bLines);
    // 找出真正新增和移除的行（内容不同，而非顺序不同）
    const added = bLines.filter(l => !aSet.has(l)).slice(0, 50);
    const removed = aLines.filter(l => !bSet.has(l)).slice(0, 50);
    // 检测是否仅顺序变化（内容集合相同但顺序不同）
    const sameContent = added.length === 0 && removed.length === 0 
      && aLines.length === bLines.length
      && aLines.some((l, i) => l !== bLines[i]);
    return { 
      added, removed, 
      addedCount: added.length, 
      removedCount: removed.length,
      reorderOnly: sameContent,
    };
  }
}

module.exports = { MonitorManager };
