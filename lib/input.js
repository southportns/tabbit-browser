/**
 * Tabbit CDP - 高级输入模块
 * 鼠标精确操作、拖拽、键盘快捷键、文本选择
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class InputManager {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  // ─── 鼠标操作 ────────────────────────────────────────

  /** 移动鼠标到坐标 */
  async mouseMove(x, y) {
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x, y,
    });
  }

  /** 点击坐标 */
  async mouseClick(x, y, options = {}) {
    const { button = 'left', clickCount = 1, delay = 0 } = options;
    if (delay > 0) {
      await this.mouseMove(x, y);
      await sleep(delay);
    }
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y, button, clickCount,
    });
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y, button, clickCount,
    });
  }

  /** 双击 */
  async mouseDoubleClick(x, y) {
    return this.mouseClick(x, y, { clickCount: 2 });
  }

  /** 右键点击 */
  async mouseRightClick(x, y) {
    return this.mouseClick(x, y, { button: 'right' });
  }

  /** 鼠标悬停（移动 + 等待） */
  async hover(x, y, durationMs = 500) {
    await this.mouseMove(x, y);
    await sleep(durationMs);
  }

  /** 滚轮滚动 */
  async scroll(x, y, deltaX = 0, deltaY = 0) {
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x, y, deltaX, deltaY,
    });
  }

  /** 向下滚动 */
  async scrollDown(x, y, amount = 3) {
    return this.scroll(x, y, 0, amount * 100);
  }

  /** 向上滚动 */
  async scrollUp(x, y, amount = 3) {
    return this.scroll(x, y, 0, -amount * 100);
  }

  // ─── 拖拽 ───────────────────────────────────────────

  /**
   * 拖拽元素
   * @param {number} fromX - 起始 X
   * @param {number} fromY - 起始 Y
   * @param {number} toX - 目标 X
   * @param {number} toY - 目标 Y
   * @param {object} options
   * @param {number} options.steps - 拖拽步数（越大越平滑）
   * @param {number} options.delay - 每步延迟 ms
   */
  async drag(fromX, fromY, toX, toY, options = {}) {
    const { steps = 10, delay = 20 } = options;

    // 移动到起点并按下
    await this.mouseMove(fromX, fromY);
    await sleep(100);
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: fromX, y: fromY,
      button: 'left',
      clickCount: 1,
    });

    // 逐步移动
    for (let i = 1; i <= steps; i++) {
      const x = fromX + (toX - fromX) * (i / steps);
      const y = fromY + (toY - fromY) * (i / steps);
      await this.mouseMove(x, y);
      await sleep(delay);
    }

    // 释放
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: toX, y: toY,
      button: 'left',
      clickCount: 1,
    });
  }

  // ─── 键盘操作 ────────────────────────────────────────

  /** 按下单个键 */
  async pressKey(key, options = {}) {
    const { modifiers = 0 } = options;
    const keyMap = {
      'Enter': { code: 'Enter', windowsVirtualKeyCode: 13 },
      'Tab': { code: 'Tab', windowsVirtualKeyCode: 9 },
      'Escape': { code: 'Escape', windowsVirtualKeyCode: 27 },
      'Backspace': { code: 'Backspace', windowsVirtualKeyCode: 8 },
      'Delete': { code: 'Delete', windowsVirtualKeyCode: 46 },
      'ArrowUp': { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      'ArrowDown': { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      'ArrowLeft': { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      'ArrowRight': { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      'Home': { code: 'Home', windowsVirtualKeyCode: 36 },
      'End': { code: 'End', windowsVirtualKeyCode: 35 },
      'PageUp': { code: 'PageUp', windowsVirtualKeyCode: 33 },
      'PageDown': { code: 'PageDown', windowsVirtualKeyCode: 34 },
    };

    const info = keyMap[key] || { code: key, windowsVirtualKeyCode: 0 };

    await this.session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: info.code,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      nativeVirtualKeyCode: info.windowsVirtualKeyCode,
      modifiers,
    });
    await this.session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: info.code,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      nativeVirtualKeyCode: info.windowsVirtualKeyCode,
      modifiers,
    });
  }

  /** 执行键盘快捷键 */
  async pressShortcut(keys) {
    // keys: 'ctrl+c', 'ctrl+shift+t', etc.
    const parts = keys.toLowerCase().split('+');
    const modifiers = {
      ctrl: 2,
      alt: 4,
      shift: 8,
      meta: 16,
    };

    let modifierMask = 0;
    let mainKey = '';

    for (const part of parts) {
      if (modifiers[part]) {
        modifierMask |= modifiers[part];
      } else {
        mainKey = part;
      }
    }

    // 先按下所有修饰键
    for (const part of parts) {
      if (modifiers[part]) {
        const keyName = part.charAt(0).toUpperCase() + part.slice(1);
        await this.session.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: keyName,
          code: 'Key' + keyName,
          modifiers: modifierMask,
        });
      }
    }

    // 按主键
    await this.pressKey(mainKey, { modifiers: modifierMask });

    // 释放所有修饰键
    for (const part of parts) {
      if (modifiers[part]) {
        const keyName = part.charAt(0).toUpperCase() + part.slice(1);
        await this.session.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: keyName,
          code: 'Key' + keyName,
          modifiers: modifierMask,
        });
      }
    }
  }

  // ─── 文本选择 ────────────────────────────────────────

  /** 全选 (Ctrl+A) */
  async selectAll() {
    return this.pressShortcut('ctrl+a');
  }

  /** 复制 (Ctrl+C) */
  async copy() {
    return this.pressShortcut('ctrl+c');
  }

  /** 粘贴 (Ctrl+V) */
  async paste() {
    return this.pressShortcut('ctrl+v');
  }

  /** 剪切 (Ctrl+X) */
  async cut() {
    return this.pressShortcut('ctrl+x');
  }

  /** 撤销 (Ctrl+Z) */
  async undo() {
    return this.pressShortcut('ctrl+z');
  }

  /** 重做 (Ctrl+Y) */
  async redo() {
    return this.pressShortcut('ctrl+y');
  }

  /** 通过 JS 选中指定元素的文本 */
  async selectElementText(selector) {
    const result = await this.session.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('${selector}');
        if (!el) return false;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      })()`,
      returnByValue: true,
    });
    return result.result?.value;
  }

  /** 获取剪贴板内容 */
  async getClipboard() {
    const result = await this.session.send('Runtime.evaluate', {
      expression: `navigator.clipboard.readText()`,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.value;
  }

  /** 设置剪贴板内容 */
  async setClipboard(text) {
    await this.session.send('Runtime.evaluate', {
      expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
      awaitPromise: true,
    });
  }
}

module.exports = { InputManager };
