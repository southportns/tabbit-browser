/**
 * Tabbit CDP - 智能元素操作模块
 * 按文本/placeholder/选择器定位元素，自动滚动到可见、等待出现、健壮点击。
 * 在元素中心用 Input.dispatchMouseEvent 点击（比 DOM click 更能触发框架事件）。
 *
 * locator 支持以下字段（任一组合，按优先级匹配）：
 *   - selector:  CSS 选择器（最精确）
 *   - text:       元素自身或子树文本包含此串（不区分大小写）
 *   - placeholder: input/textarea 的 placeholder 属性包含此串
 *   - role:       ARIA role
 *   - tag:        标签名（如 button/a/input）
 *   - index:      多个匹配时取第几个（默认 0）
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class ElementManager {
  constructor(cdpSession) {
    this.session = cdpSession;
    this._docNodeId = null;
  }

  // ─── 定位 ────────────────────────────────────────────

  /**
   * 在页面中查找匹配 locator 的元素，返回 rect 数组。
   * @param {object} options.scroll - 找到后是否在页面内 scrollIntoView
   * @param {object} options.focus - 找到后是否在页面内 el.focus()
   */
  async _queryAll(locator, options = {}) {
    const conds = [];
    if (locator.selector) conds.push(`m.selector(${JSON.stringify(locator.selector)})`);
    if (locator.text) {
      const t = JSON.stringify(locator.text).toLowerCase();
      conds.push(`m.text(${t})`);
    }
    if (locator.placeholder) {
      const p = JSON.stringify(locator.placeholder).toLowerCase();
      conds.push(`m.placeholder(${p})`);
    }
    if (locator.role) conds.push(`m.role(${JSON.stringify(locator.role)})`);
    if (locator.tag) conds.push(`m.tag(${JSON.stringify(locator.tag.toLowerCase())})`);

    const scroll = options.scroll ? 'true' : 'false';
    const focus = options.focus ? 'true' : 'false';

    const expr = `(() => {
      const m = {
        selector: s => { try { return [...document.querySelectorAll(s)] } catch(e) { return [] } },
        text: t => [...document.querySelectorAll('*')].filter(el => {
          const tx = (el.textContent || '').toLowerCase();
          if (!tx.includes(t)) return false;
          const direct = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) ||
                         ['BUTTON','A','INPUT','SPAN','LABEL','LI','TD','OPTION','DIV'].includes(el.tagName);
          return direct;
        }),
        placeholder: p => [...document.querySelectorAll('[placeholder]')].filter(el =>
          (el.getAttribute('placeholder') || '').toLowerCase().includes(p)),
        role: r => [...document.querySelectorAll('[role]')].filter(el =>
          (el.getAttribute('role') || '').toLowerCase() === r.toLowerCase()),
        tag: tg => [...document.getElementsByTagName(tg)],
      };
      const sets = [${conds.join(',')}];
      if (!sets.length) return [];
      let pool = sets[0];
      for (let i = 1; i < sets.length; i++) {
        const s = new Set(sets[i]);
        pool = pool.filter(el => s.has(el));
      }
      const visible = el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
        return true;
      };
      const matched = pool.filter(visible);
      if (${scroll} && matched[0]) {
        try { matched[0].scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(e) {}
      }
      if (${focus} && matched[0]) {
        try { matched[0].focus(); matched[0].click && matched[0].click(); } catch(e) {}
      }
      return matched.map(el => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x, y: r.y, width: r.width, height: r.height,
          cx: r.x + r.width / 2, cy: r.y + r.height / 2,
          tag: el.tagName, text: (el.textContent || '').substring(0, 80),
          placeholder: el.getAttribute('placeholder') || '',
        };
      });
    })()`;

    const result = await this.session.send('Runtime.evaluate', {
      expression: expr, returnByValue: true,
    });
    return result.result?.value || [];
  }

  /** 查找第 index 个匹配元素 */
  async find(locator = {}) {
    const arr = await this._queryAll(locator);
    const idx = locator.index || 0;
    return arr[idx] || null;
  }

  /** 等待元素出现（轮询） */
  async waitFor(locator, options = {}) {
    const timeout = options.timeout || 10000;
    const interval = options.interval || 300;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = await this.find(locator);
      if (el) return el;
      await sleep(interval);
    }
    throw new Error(`等待元素超时: ${JSON.stringify(locator)}`);
  }

  /** 元素总数 */
  async count(locator) {
    const arr = await this._queryAll(locator);
    return arr.length;
  }

  // ─── 滚动到可见 ──────────────────────────────────────

  /** 滚动元素到视口中央 */
  async scrollIntoView(locator, options = {}) {
    const arr = await this._queryAll(locator, { scroll: true });
    const idx = locator.index || 0;
    const el = arr[idx];
    if (!el) throw new Error(`找不到元素: ${JSON.stringify(locator)}`);
    await sleep(150);
    // 滚动后重新取 rect
    const fresh = await this._queryAll(locator);
    return fresh[idx] || el;
  }

  // ─── 点击 ────────────────────────────────────────────

  /** 点击元素（先滚动到可见，再在中心 dispatchMouseEvent） */
  async click(locator, options = {}) {
    let el = await this.waitFor(locator, { timeout: options.timeout || 10000 });
    el = await this.scrollIntoView(locator, { _el: el });
    if (!el) throw new Error(`点击失败，元素不可见: ${JSON.stringify(locator)}`);

    const { cx, cy } = el;
    // 拟人：移动 → 按下 → 释放
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
    await sleep(50);
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1,
    });
    await sleep(30);
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1,
    });
    return { clicked: true, x: cx, y: cy };
  }

  // ─── 输入 ────────────────────────────────────────────

  /** 在元素中输入文本（先聚焦+滚动，可选全选清空，再用 Input.insertText） */
  async type(locator, text, options = {}) {
    const el = await this.waitFor(locator, { timeout: options.timeout || 10000 });
    // 用统一查找器聚焦 + 滚动
    const arr = await this._queryAll(locator, { scroll: true, focus: true });
    const idx = locator.index || 0;
    if (!arr[idx]) throw new Error(`找不到元素: ${JSON.stringify(locator)}`);
    await sleep(150);

    // 点一下确保获得焦点，对 contenteditable/textarea 等有效
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: el.cx, y: el.cy });
    await sleep(30);
    await this.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: el.cx, y: el.cy, button: 'left', clickCount: 1 });
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: el.cx, y: el.cy, button: 'left', clickCount: 1 });
    await sleep(120);

    if (options.clear) {
      // Ctrl+A 全选 + Backspace
      await this.session.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
      });
      await this.session.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
      });
      await this.session.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
      });
      await this.session.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
      });
      await sleep(80);
    }

    // Input.insertText 对 contenteditable / textarea / input 都有效
    await this.session.send('Input.insertText', { text });
    await sleep(80);
    return { typed: text };
  }

  // ─── 读取 ────────────────────────────────────────────

  /** 获取元素文本 */
  async getText(locator) {
    const el = await this.find(locator);
    if (!el) return null;
    return el.text;
  }

  /** 获取元素属性 */
  async getAttribute(locator, attr) {
    const sel = locator.selector ? JSON.stringify(locator.selector) : null;
    if (!sel) throw new Error('getAttribute 需要 locator.selector');
    const r = await this.session.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${sel}); return el ? el.getAttribute(${JSON.stringify(attr)}) : null; })()`,
      returnByValue: true,
    });
    return r.result?.value;
  }

  // ─── 多备选定位器（耐改版）────────────────────────────

  /** 依次尝试多个 locator，第一个能找到元素的执行 click */
  async clickAny(locators, options = {}) {
    const errors = [];
    for (const loc of locators) {
      try {
        const el = await this.find(loc);
        if (el) return await this.click(loc, options);
      } catch (e) { errors.push(e.message); }
    }
    throw new Error(`所有定位器均失败: ${JSON.stringify(locators)} | ${errors.join('; ')}`);
  }

  /** 依次尝试多个 locator，第一个能找到元素的执行 type */
  async typeAny(locators, text, options = {}) {
    const errors = [];
    for (const loc of locators) {
      try {
        const el = await this.find(loc);
        if (el) return await this.type(loc, text, options);
      } catch (e) { errors.push(e.message); }
    }
    throw new Error(`所有定位器均失败: ${JSON.stringify(locators)} | ${errors.join('; ')}`);
  }

  /** 找到第一个匹配的 locator 元素 */
  async findAny(locators) {
    for (const loc of locators) {
      const el = await this.find(loc);
      if (el) return el;
    }
    return null;
  }

  // ─── 文件上传 ────────────────────────────────────────

  /**
   * 上传文件到 input[type=file]
   * @param {string[]} filePaths - 绝对路径数组
   * @param {object} locator - 可选，定位特定 file input；否则取第一个
   */
  async upload(filePaths, locator = {}) {
    if (!Array.isArray(filePaths)) filePaths = [filePaths];
    // 找到 input[type=file]
    const sel = locator.selector || 'input[type=file]';
    const doc = await this.session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId, selector: sel,
    });
    if (!nodeId) throw new Error(`找不到文件输入框: ${sel}`);
    await this.session.send('DOM.setFileInputFiles', { files: filePaths, nodeId });
    return { uploaded: filePaths.length, files: filePaths };
  }
}

module.exports = { ElementManager };
