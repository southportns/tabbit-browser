/**
 * Tabbit CDP - 下载管理模块
 * 设置下载目录、监听下载事件、累积记录已下载文件。
 * 跨工具调用保持状态（模块级单例在 mcp-server 中持有）。
 */

const fs = require('fs');
const path = require('path');

class DownloadManager {
  constructor(cdpSession) {
    this.session = cdpSession;
    this._started = false;
  }

  /** 启用下载监听（设置目录 + 注册事件） */
  async start(dir) {
    if (!dir) dir = path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads', 'tabbit');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await this.session.send('Page.enable');
    // setDownloadBehavior 设置下载目录
    await this.session.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: dir,
    });

    if (!this._started) {
      this._started = true;
      // 监听下载开始与进度（事件在 mcp-server 的 CDP 单例上注册）
    }
    return { dir };
  }

  /** 注册事件回调（由 mcp-server 的持久 session 调用） */
  attachEvents(cdp, records) {
    cdp.on('Browser.downloadWillBegin', (p) => {
      records.push({
        url: p.url, filename: p.suggestedFilename || p.filename,
        guid: p.guid, state: 'in_progress', time: new Date().toISOString(),
      });
    });
    cdp.on('Browser.downloadProgress', (p) => {
      const rec = records.find(r => r.guid === p.guid);
      if (rec) {
        rec.state = p.state || (p.totalBytes && p.receivedBytes >= p.totalBytes ? 'completed' : 'in_progress');
        rec.received = p.receivedBytes;
        rec.total = p.totalBytes;
        if (rec.state === 'completed') rec.completedTime = new Date().toISOString();
      }
    });
  }
}

module.exports = { DownloadManager };
