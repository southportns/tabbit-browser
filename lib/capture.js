/**
 * Tabbit CDP - 截图与导出模块
 * 截图（元素/全页/视口）、PDF 导出、快照
 */

const fs = require('fs');
const path = require('path');

class CaptureManager {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  // ─── 截图 ────────────────────────────────────────────

  /**
   * 视口截图
   * @param {object} options
   * @param {string} options.format - jpeg|png|webp
   * @param {number} options.quality - 0-100 (仅 jpeg/webp)
   * @param {string} options.outputPath - 保存路径
   */
  async screenshot(options = {}) {
    const { format = 'jpeg', quality = 80, outputPath } = options;
    const result = await this.session.send('Page.captureScreenshot', { format, quality });
    const ext = format === 'jpeg' ? 'jpg' : format;
    const filePath = outputPath || path.join(process.cwd(), `screenshot-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return { path: filePath, format, data: result.data };
  }

  /**
   * 全页截图（滚动捕获完整页面）
   */
  async fullPageScreenshot(options = {}) {
    const { format = 'jpeg', quality = 80, outputPath } = options;

    // 获取页面完整尺寸
    const metrics = await this.session.send('Page.getLayoutMetrics');
    const contentSize = metrics.cssContentSize || metrics.contentSize;

    // 设置视口为完整页面大小
    await this.session.send('Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(contentSize.width),
      height: Math.ceil(contentSize.height),
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 等待两帧渲染完成，比固定 sleep(500) 更准确且更快
    await this.session.send('Runtime.evaluate', {
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true,
    });

    // 截图
    const result = await this.session.send('Page.captureScreenshot', {
      format,
      quality,
      clip: {
        x: 0,
        y: 0,
        width: contentSize.width,
        height: contentSize.height,
        scale: 1,
      },
    });

    // 恢复原始视口
    await this.session.send('Emulation.clearDeviceMetricsOverride');

    const ext = format === 'jpeg' ? 'jpg' : format;
    const filePath = outputPath || path.join(process.cwd(), `fullpage-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return { path: filePath, format };
  }

  /**
   * 元素截图（通过 CSS 选择器）
   * @param {string} selector - CSS 选择器
   */
  async elementScreenshot(selector, options = {}) {
    const { format = 'jpeg', quality = 80, outputPath } = options;

    // 获取元素位置
    const result = await this.session.send('Runtime.evaluate', {
      expression: `JSON.stringify((() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })())`,
      returnByValue: true,
    });

    const rect = JSON.parse(result.result.value);
    if (!rect) throw new Error(`找不到元素: ${selector}`);

    // 截图指定区域
    const screenshot = await this.session.send('Page.captureScreenshot', {
      format,
      quality,
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
    });

    const ext = format === 'jpeg' ? 'jpg' : format;
    const filePath = outputPath || path.join(process.cwd(), `element-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
    return { path: filePath, rect };
  }

  // ─── PDF 导出 ────────────────────────────────────────

  /**
   * 将当前页面导出为 PDF
   * @param {object} options
   * @param {string} options.outputPath
   * @param {string} options.paperWidth - 纸张宽度（英寸）
   * @param {string} options.paperHeight - 纸张高度（英寸）
   * @param {boolean} options.printBackground - 打印背景
   */
  async toPDF(options = {}) {
    const {
      outputPath,
      paperWidth = 8.27,   // A4
      paperHeight = 11.69,  // A4
      printBackground = true,
      marginTop = 0.4,
      marginBottom = 0.4,
      marginLeft = 0.4,
      marginRight = 0.4,
    } = options;

    const result = await this.session.send('Page.printToPDF', {
      paperWidth,
      paperHeight,
      printBackground,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
    });

    const filePath = outputPath || path.join(process.cwd(), `page-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return { path: filePath };
  }

  // ─── DOM 快照 ────────────────────────────────────────

  /** 获取页面 DOM 快照（用于分析） */
  async getDOMSnapshot() {
    const result = await this.session.send('DOMSnapshot.getSnapshot', {
      includeDOM: true,
      includeStyles: true,
      includePaintOrder: true,
      includeUserAgentShadowTree: false,
    });
    return result;
  }

  /** 获取页面可访问性树 */
  async getAccessibilityTree() {
    const result = await this.session.send('Accessibility.getFullAXTree');
    return result.nodes;
  }
}

module.exports = { CaptureManager };
