/**
 * Tabbit CDP - 正文提取模块
 * 注入简化版 Readability 算法：按文本密度找出主体节点，去除导航/广告/评论，
 * 转 Markdown。比通用 extract 更智能，适合把网页文章转成干净文本。
 */

class ContentExtractor {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  /**
   * 提取页面正文
   * @param {object} options
   * @param {string} options.selector - 可选，限定根容器
   * @param {number} options.maxLength - markdown 最大长度
   */
  async extract(options = {}) {
    const selector = options.selector ? JSON.stringify(options.selector) : 'null';
    const expr = `(() => {
      const root = ${selector} ? document.querySelector(${selector}) : document.body;
      if (!root) return JSON.stringify({ error: '根容器未找到' });

      // 1. 移除明显的非内容节点
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,iframe,nav,footer,header,aside,form,button,svg,canvas,.ad,[role="navigation"],[role="banner"],[role="contentinfo"]').forEach(el => el.remove());

      // 2. 找标题
      const title = (document.querySelector('h1')?.textContent || document.title || '').trim();

      // 3. 按"文本密度"在候选块级元素中挑主体
      // 第一阶段：快速筛 top-20（只取 innerText.length，避免全量 querySelectorAll('a')）
      const candidates = [...clone.querySelectorAll('article,main,section,div')];
      const scored = candidates.map(el => {
        const text = el.textContent || '';
        const len = text.trim().length;
        return { el, len };
      }).filter(c => c.len >= 80);
      // 按文本长度降序，取 top-20
      scored.sort((a, b) => b.len - a.len);
      const topCandidates = scored.slice(0, 20);
      // 第二阶段：只对 top-20 详细评分
      let best = clone, bestScore = 0;
      for (const { el, len } of topCandidates) {
        const links = el.querySelectorAll('a').length;
        const linkText = [...el.querySelectorAll('a')].reduce((s,a)=>s+(a.textContent||'').length,0);
        const linkRatio = linkText / (len || 1);
        const score = len * Math.log(len + 1) / (1 + linkRatio * 5);
        if (score > bestScore) { bestScore = score; best = el; }
      }

      // 4. 主体转 Markdown
      const md = nodeToMd(best, 0);
      function nodeToMd(node, depth) {
        let out = '';
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { out += child.textContent; continue; }
          if (child.nodeType !== 1) continue;
          const tag = child.tagName.toLowerCase();
          // 超过最大深度（15），只取文本不再解析标签结构
          const inner = depth >= 15 ? (child.textContent || '') : nodeToMd(child, depth + 1);
          switch (tag) {
            case 'h1': out += '\\n# ' + inner.trim() + '\\n'; break;
            case 'h2': out += '\\n## ' + inner.trim() + '\\n'; break;
            case 'h3': out += '\\n### ' + inner.trim() + '\\n'; break;
            case 'h4': case 'h5': case 'h6': out += '\\n#### ' + inner.trim() + '\\n'; break;
            case 'p': out += '\\n' + inner.trim() + '\\n'; break;
            case 'br': out += '\\n'; break;
            case 'strong': case 'b': out += '**' + inner.trim() + '**'; break;
            case 'em': case 'i': out += '*' + inner.trim() + '*'; break;
            case 'a': { const href = child.getAttribute('href') || ''; out += '[' + inner.trim() + '](' + href + ')'; break; }
            case 'img': { const src = child.getAttribute('src') || ''; const alt = child.getAttribute('alt') || ''; out += '![' + alt + '](' + src + ')'; break; }
            case 'ul': case 'ol': { out += '\\n' + inner + '\\n'; break; }
            case 'li': out += '- ' + inner.trim() + '\\n'; break;
            case 'blockquote': out += '\\n> ' + inner.trim() + '\\n'; break;
            case 'pre': case 'code': out += '\\n\`\`\`\\n' + inner + '\\n\`\`\`\\n'; break;
            case 'hr': out += '\\n---\\n'; break;
            case 'table': out += '\\n' + inner + '\\n'; break;
            case 'tr': out += '| ' + inner.trim() + ' |\\n'; break;
            case 'th': case 'td': out += inner.trim() + ' | '; break;
            default: out += inner;
          }
        }
        return out;
      }

      // 5. 清理多余空行
      let markdown = md.replace(/\\n{3,}/g, '\\n\\n').trim();
      return JSON.stringify({ title, markdown, length: markdown.length, html: best.innerHTML.substring(0, 2000) });
    })()`;

    const r = await this.session.send('Runtime.evaluate', {
      expression: expr, returnByValue: true,
    });
    const data = JSON.parse(r.result?.value || '{}');
    if (data.error) throw new Error(data.error);
    if (options.maxLength && data.markdown) {
      data.markdown = data.markdown.substring(0, options.maxLength);
    }
    return data;
  }
}

module.exports = { ContentExtractor };
