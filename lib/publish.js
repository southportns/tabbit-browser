/**
 * Tabbit CDP - 平台发布模块
 * 各平台发布流程配置。用 ElementManager 按文本/placeholder 定位，耐改版。
 *
 * 每个平台导出:
 *   - name:         平台名
 *   - creatorUrl:   创作者中心 URL
 *   - loginPattern: 未登录时跳转 URL 中包含的子串（用于登录态检测）
 *   - publish({element, content, dryRun, log}): 发布流程
 *
 * content 结构: { title?, text, images?:[], video?:string, topics?:[] }
 * publish 返回: { success, warning?, url?, steps:[] }
 */

const { ElementManager } = require('./element');

async function addTopics(element, topics, bodyLocator) {
  // 在正文末尾输入 #话题 触发话题选择，选第一个候选
  for (const topic of topics || []) {
    try {
      await element.typeAny(bodyLocator, ` #${topic}`);
      await new Promise(r => setTimeout(r, 800));
      // 选第一个话题候选
      await element.clickAny([
        { selector: '.topic-item, .mention-item, [class*="topic"] [class*="item"], [class*="mention"] li' },
        { text: topic },
      ], { timeout: 2000 });
    } catch (_) {}
  }
}

const PLATFORMS = {
  // ─── 小红书 ─────────────────────────────────────────
  xhs: {
    name: '小红书',
    creatorUrl: 'https://creator.xiaohongshu.com/publish/publish',
    loginPattern: 'login',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      // 1. 上传图片（图文笔记至少1张）
      if (content.images && content.images.length) {
        try {
          await element.upload(content.images);
          steps.push(`上传 ${content.images.length} 张图片`);
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) { steps.push(`图片上传失败: ${e.message}`); }
      } else if (content.video) {
        try { await element.upload([content.video]); steps.push('上传视频'); await new Promise(r => setTimeout(r, 4000)); }
        catch (e) { steps.push(`视频上传失败: ${e.message}`); }
      } else {
        steps.push('警告: 小红书图文笔记通常需要至少1张图');
      }

      // 2. 填标题
      if (content.title) {
        try {
          await element.typeAny([{ placeholder: '标题' }, { selector: '#title, [class*="title"] input, [class*="title"] textarea' }], content.title, { clear: true, timeout: 5000 });
          steps.push('填写标题');
        } catch (e) { steps.push(`标题填写失败: ${e.message}`); }
      }

      // 3. 填正文
      if (content.text) {
        try {
          await element.typeAny([{ placeholder: '正文' }, { placeholder: '描述' }, { selector: '#post-textarea, [class*="desc"] [contenteditable], [class*="content"] [contenteditable]' }], content.text, { clear: true, timeout: 5000 });
          steps.push('填写正文');
        } catch (e) { steps.push(`正文填写失败: ${e.message}`); }
      }

      // 4. 话题
      await addTopics(element, content.topics, [{ placeholder: '正文' }, { placeholder: '描述' }]);
      if (content.topics?.length) steps.push(`添加 ${content.topics.length} 个话题`);

      // 5. 发布
      if (dryRun) {
        steps.push('dryRun 模式：已填表，未点击发布');
        return { success: false, warning: 'dryRun', steps, log };
      }
      try {
        await element.clickAny([{ text: '发布' }, { text: '发布笔记' }], { timeout: 5000 });
        steps.push('点击发布');
        await new Promise(r => setTimeout(r, 3000));
        return { success: true, steps };
      } catch (e) {
        return { success: false, warning: `发布按钮未找到: ${e.message}`, steps };
      }
    },
  },

  // ─── 抖音 ───────────────────────────────────────────
  douyin: {
    name: '抖音',
    creatorUrl: 'https://creator.douyin.com/creator-micro/content/upload?default_tab_type=1',
    loginPattern: 'login',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      // 1. 上传视频（抖音以视频为主）
      if (content.video) {
        try { await element.upload([content.video]); steps.push('上传视频'); await new Promise(r => setTimeout(r, 5000)); }
        catch (e) { steps.push(`视频上传失败: ${e.message}`); }
      } else if (content.images && content.images.length) {
        try { await element.upload(content.images); steps.push(`上传 ${content.images.length} 张图片`); await new Promise(r => setTimeout(r, 3000)); }
        catch (e) { steps.push(`图片上传失败: ${e.message}`); }
      } else {
        steps.push('警告: 抖音发布需要视频或图片');
      }

      // 2. 填描述（抖音标题与描述合一）
      const desc = [content.title, content.text].filter(Boolean).join('\n');
      if (desc) {
        try {
          await element.typeAny([{ placeholder: '描述' }, { placeholder: '标题' }, { selector: '[class*="editor"] [contenteditable], .ql-editor, [class*="desc"] textarea' }], desc, { clear: true, timeout: 5000 });
          steps.push('填写描述');
        } catch (e) { steps.push(`描述填写失败: ${e.message}`); }
      }

      // 3. 话题
      await addTopics(element, content.topics, [{ placeholder: '描述' }, { placeholder: '标题' }]);
      if (content.topics?.length) steps.push(`添加 ${content.topics.length} 个话题`);

      if (dryRun) return { success: false, warning: 'dryRun', steps, log };

      // 4. 发布（抖音发布按钮文本"发布"，可能有风控验证）
      try {
        await element.clickAny([{ text: '发布' }], { timeout: 5000 });
        steps.push('点击发布');
        await new Promise(r => setTimeout(r, 5000));
        return { success: true, warning: '抖音可能有风控验证，请检查浏览器', steps };
      } catch (e) {
        return { success: false, warning: `发布失败: ${e.message}`, steps };
      }
    },
  },

  // ─── 微博 ───────────────────────────────────────────
  weibo: {
    name: '微博',
    creatorUrl: 'https://weibo.com',
    loginPattern: 'login',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      // 微博首页顶部发布框
      // 1. 填正文
      if (content.text) {
        try {
          await element.typeAny([{ placeholder: '有什么新鲜事' }, { selector: '[class*="PublishText"], textarea[class*="publish"]' }], content.text, { clear: true, timeout: 5000 });
          steps.push('填写正文');
        } catch (e) { steps.push(`正文填写失败: ${e.message}`); }
      }

      // 2. 上传图片
      if (content.images && content.images.length) {
        try { await element.upload(content.images, { selector: 'input[type=file]' }); steps.push(`上传 ${content.images.length} 张图片`); await new Promise(r => setTimeout(r, 3000)); }
        catch (e) { steps.push(`图片上传失败: ${e.message}`); }
      }

      if (dryRun) return { success: false, warning: 'dryRun', steps, log };

      // 3. 发布
      try {
        await element.clickAny([{ text: '发博' }, { text: '发布' }], { timeout: 5000 });
        steps.push('点击发布');
        await new Promise(r => setTimeout(r, 3000));
        return { success: true, steps };
      } catch (e) {
        return { success: false, warning: `发布失败: ${e.message}`, steps };
      }
    },
  },

  // ─── 知乎 ───────────────────────────────────────────
  zhihu: {
    name: '知乎',
    creatorUrl: 'https://zhuanlan.zhihu.com/write',
    loginPattern: 'login',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      // 1. 标题
      if (content.title) {
        try {
          await element.typeAny([{ placeholder: '输入标题' }, { selector: '.WriteIndex-titleInput input, [class*="title"] input' }], content.title, { clear: true, timeout: 5000 });
          steps.push('填写标题');
        } catch (e) { steps.push(`标题填写失败: ${e.message}`); }
      }

      // 2. 正文（知乎用 contenteditable 富文本编辑器）
      if (content.text) {
        try {
          await element.typeAny([{ selector: '.public-DraftEditor-content, [contenteditable="true"]' }], content.text, { clear: true, timeout: 5000 });
          steps.push('填写正文');
        } catch (e) { steps.push(`正文填写失败: ${e.message}`); }
      }

      if (dryRun) return { success: false, warning: 'dryRun', steps, log };

      // 3. 发布
      try {
        await element.clickAny([{ text: '发布' }], { timeout: 5000 });
        steps.push('点击发布');
        await new Promise(r => setTimeout(r, 3000));
        return { success: true, steps };
      } catch (e) {
        return { success: false, warning: `发布失败: ${e.message}`, steps };
      }
    },
  },

  // ─── B站 ────────────────────────────────────────────
  bilibili: {
    name: 'B站',
    creatorUrl: 'https://member.bilibili.com/platform/upload/text/edit',
    loginPattern: 'passport',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      // 1. 标题
      if (content.title) {
        try {
          await element.typeAny([{ placeholder: '标题' }, { placeholder: '做个好标题' }, { selector: '[class*="title"] input, input.title' }], content.title, { clear: true, timeout: 5000 });
          steps.push('填写标题');
        } catch (e) { steps.push(`标题填写失败: ${e.message}`); }
      }

      // 2. 正文（B站专栏用 ql-editor 富文本）
      if (content.text) {
        try {
          await element.typeAny([{ selector: '.ql-editor, [contenteditable="true"]' }], content.text, { clear: true, timeout: 5000 });
          steps.push('填写正文');
        } catch (e) { steps.push(`正文填写失败: ${e.message}`); }
      }

      // 3. 封面（可选）
      if (content.images && content.images.length) {
        try { await element.upload([content.images[0]], { selector: 'input[type=file]' }); steps.push('上传封面'); await new Promise(r => setTimeout(r, 2000)); }
        catch (e) { steps.push(`封面上传失败: ${e.message}`); }
      }

      if (dryRun) return { success: false, warning: 'dryRun', steps, log };

      // 4. 发布
      try {
        await element.clickAny([{ text: '发布' }], { timeout: 5000 });
        steps.push('点击发布');
        await new Promise(r => setTimeout(r, 3000));
        return { success: true, steps };
      } catch (e) {
        return { success: false, warning: `发布失败: ${e.message}`, steps };
      }
    },
  },

  // ─── 微信公众号（仅支持填表+存草稿，群发需扫码） ────
  wechat: {
    name: '微信公众号',
    creatorUrl: 'https://mp.weixin.qq.com/cgi-bin/homepage?t=home/index&lang=zh_CN',
    loginPattern: 'bizlogin',
    async publish({ element, content, dryRun, log }) {
      const steps = [];
      steps.push('注意: 微信公众号需扫码登录，群发也需扫码确认，无法完全自动化');
      // 进入"图文消息"新建
      try {
        await element.clickAny([{ text: '图文消息' }, { text: '新建图文' }, { text: '写新图文' }], { timeout: 5000 });
        await new Promise(r => setTimeout(r, 3000));
        steps.push('进入图文编辑');
      } catch (e) { steps.push(`进入图文编辑失败: ${e.message}`); }

      // 标题
      if (content.title) {
        try {
          await element.typeAny([{ placeholder: '请输入标题' }, { selector: '[class*="title"] input, input.weui-input' }], content.title, { clear: true, timeout: 5000 });
          steps.push('填写标题');
        } catch (e) { steps.push(`标题填写失败: ${e.message}`); }
      }

      // 正文（公众号编辑器在 iframe 内，contenteditable）
      if (content.text) {
        try {
          await element.typeAny([{ selector: '[contenteditable="true"], .edui-body-container' }], content.text, { clear: true, timeout: 5000 });
          steps.push('填写正文');
        } catch (e) { steps.push(`正文填写失败: ${e.message}`); }
      }

      // 保存草稿（不群发）
      try {
        await element.clickAny([{ text: '保存' }, { text: '保存为草稿' }], { timeout: 5000 });
        steps.push('保存草稿（群发需手动扫码）');
      } catch (e) { steps.push(`保存失败: ${e.message}`); }

      return { success: false, warning: 'wechat 仅支持填表+保存草稿，群发需手动扫码', steps };
    },
  },
};

module.exports = { PLATFORMS, ElementManager };
