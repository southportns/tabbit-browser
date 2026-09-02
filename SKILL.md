# Tabbit Browser MCP — Agent 智能触发技能

> **触发条件**：当用户的请求涉及以下任何场景时，自动激活本技能并使用 Tabbit Browser MCP 工具执行任务。

## 触发关键词与场景

### 🌐 浏览器导航与页面访问
**触发关键词**：打开网页、访问网站、导航到、浏览、打开链接、去某个网站、查看网页、go to、navigate、browse、visit URL
**对应工具**：`tabbit_navigate`（智能导航，自带反检测+防风控）
**示例触发**：
- "帮我打开淘宝首页"
- "访问这个链接 https://example.com"
- "去京东看看商品"
- "浏览一下小红书"

### 📸 截图与页面捕获
**触发关键词**：截图、截屏、页面快照、屏幕截图、screenshot、capture screen、截取页面、网页截图、全页截图、保存页面图片
**对应工具**：`tabbit_screenshot`（视口/全页/元素截图）
**示例触发**：
- "给这个页面截个图"
- "截个全页截图"
- "把页面元素截图保存"
- "帮我对网页进行截图"

### 📄 PDF 导出
**触发关键词**：导出PDF、转成PDF、保存为PDF、打印页面、export PDF、页面转PDF、网页保存为PDF
**对应工具**：`tabbit_pdf`
**示例触发**：
- "把这个网页导出为PDF"
- "保存成PDF文件"
- "页面转PDF"

### 🔍 数据提取与网页爬取
**触发关键词**：提取数据、爬取、抓取、获取商品信息、提取表格、获取链接、提取图片、获取页面文本、爬虫、数据采集、extract data、scrape、crawl、数据提取、页面数据
**对应工具**：`tabbit_extract`（商品/表格/链接/图片/全文/自定义提取）
**示例触发**：
- "帮我提取这个页面的商品信息"
- "爬取淘宝搜索结果"
- "提取页面中的所有链接"
- "抓取表格数据"
- "获取京东商品列表"

### 📝 正文提取与文章阅读
**触发关键词**：提取正文、读取文章、获取主要内容、文章正文、网页正文、阅读模式、readability、提取文章、干净文本、markdown转换
**对应工具**：`tabbit_readability`（Readability 算法提取正文转 Markdown）
**示例触发**：
- "提取这篇文章的正文"
- "获取页面主要内容"
- "把网页文章转成干净的文本"

### 🤖 AI 对话
**触发关键词**：和AI对话、问AI、聊天、发送消息给AI、问问题、chat with AI、豆包对话、AI聊天
**对应工具**：`tabbit_chat`（发送消息给 Tabbit 内置 Doubao AI）
**示例触发**：
- "帮我问一下AI这个问题"
- "用AI聊天"
- "发送消息给豆包"

### 📱 设备仿真与移动端测试
**触发关键词**：模拟手机、设备仿真、移动端测试、切换视口、iPhone模式、Android模拟、暗色模式、深色模式、地理位置模拟、时区切换、设备测试、mobile view、emulate device
**对应工具**：`tabbit_device`（设备仿真/视口/深色模式/定位/时区/触摸）
**示例触发**：
- "用iPhone模式看看这个页面"
- "切换到深色模式"
- "模拟移动端访问"
- "设置时区为东京"
- "模拟定位到上海"

### 🖱️ 元素操作与页面交互
**触发关键词**：点击按钮、点击元素、输入文本、填写表单、等待元素出现、获取元素文本、滚动到元素、上传文件、点击链接、表单填写、click button、type text、fill form
**对应工具**：`tabbit_element`（智能元素操作：click/type/wait/get-text/upload）
**示例触发**：
- "点击页面上的登录按钮"
- "在搜索框输入关键词"
- "等待页面加载完成"
- "上传文件到页面"
- "获取元素文本内容"

### ⌨️ 键盘鼠标操作
**触发关键词**：按键、快捷键、键盘输入、鼠标点击、拖拽、滚动页面、复制粘贴、全选、undo、redo、keyboard input、mouse click、scroll page、drag and drop
**对应工具**：`tabbit_input`（高级输入：click/type/key/hotkey/scroll/drag/clipboard）
**示例触发**：
- "按回车键"
- "使用快捷键 Ctrl+C"
- "向下滚动页面"
- "拖拽元素"
- "复制粘贴"

### 📑 多标签管理
**触发关键词**：打开新标签、关闭标签、列出标签页、标签管理、new tab、close tab、tab management
**对应工具**：`tabbit_tabs`（多标签管理：list/open/close）
**示例触发**：
- "打开一个新标签页"
- "列出所有标签"
- "关闭这个标签"

### 🍪 Cookie 与登录态管理
**触发关键词**：保存Cookie、加载Cookie、管理登录态、保存登录、恢复登录、Cookie持久化、登录态导出、登录态导入、save cookies、load cookies、login state
**对应工具**：`tabbit_cookies`（Cookie 持久化：save/load/list）
**示例触发**：
- "保存淘宝的登录状态"
- "加载之前保存的Cookie"
- "导出登录态"
- "列出所有保存的站点Cookie"

### 🌐 网络管理
**触发关键词**：查看Cookie、导出Cookie、导入Cookie、屏蔽请求、Mock响应、网络限速、清除缓存、查看请求日志、请求拦截、网络模拟、network throttle、block request、mock API
**对应工具**：`tabbit_network`（网络管理：Cookie/拦截/Mock/限速/日志）
**示例触发**：
- "查看当前页面的Cookie"
- "屏蔽广告请求"
- "模拟3G网络"
- "Mock API响应"
- "查看网络请求日志"

### 💾 存储管理
**触发关键词**：导出登录态、导入登录态、清除存储、查看localStorage、storage export、storage import、clear storage
**对应工具**：`tabbit_storage`（存储管理：export/import/clear/local）
**示例触发**：
- "导出这个网站的登录态"
- "导入之前保存的登录状态"
- "清除网站存储"
- "查看localStorage"

### 🔧 反检测与反爬虫
**触发关键词**：反检测、隐藏自动化、反爬虫、绕过检测、stealth mode、antidetect、hide automation、反指纹
**对应工具**：`tabbit_antidetect`（注入14项反检测脚本）
**示例触发**：
- "注入反检测脚本"
- "隐藏自动化标记"
- "绕过网站的反爬检测"

### 📋 控制台日志调试
**触发关键词**：查看控制台、Console日志、调试错误、控制台输出、浏览器日志、console log、debug errors、console output
**对应工具**：`tabbit_console`（控制台日志抓取：list/errors/warnings/logs）
**示例触发**：
- "查看页面控制台日志"
- "获取控制台错误信息"
- "查看浏览器console输出"
- "调试页面错误"

### 📊 页面监控
**触发关键词**：监控页面、检测变化、页面快照、价格监控、库存监控、内容变化检测、monitor page、detect changes、price monitoring
**对应工具**：`tabbit_monitor`（页面监控：snapshot/watch/diff）
**示例触发**：
- "监控这个页面的价格变化"
- "检测页面内容是否有更新"
- "对页面区域取快照"

### ⬇️ 下载管理
**触发关键词**：设置下载目录、查看下载记录、下载管理、管理下载、download management、set download dir
**对应工具**：`tabbit_download`（下载管理：set-dir/list/clear）
**示例触发**：
- "设置下载目录"
- "查看下载记录"
- "管理文件下载"

### 📢 多平台发布
**触发关键词**：发布到小红书、发抖音、发微博、发知乎、发B站、发微信公众号、自动发布、社交媒体发布、publish to、post to、auto publish
**对应工具**：`tabbit_publish`（多平台发布：xhs/douyin/weibo/zhihu/bilibili/wechat）
**示例触发**：
- "帮我发布到小红书"
- "发一条抖音"
- "自动发布到微博"
- "在知乎上发文章"

### 🤖 AI 任务管理
**触发关键词**：创建AI任务、后台任务、自动执行任务、任务状态查询、停止任务、列出任务、AI agent task、task management
**对应工具**：`tabbit_task`（AI 任务管理：create/status/stop/list）
**示例触发**：
- "创建一个AI任务来自动完成某事"
- "查询任务状态"
- "停止正在运行的任务"
- "列出所有任务"

### 🔗 连接检查与浏览器启动
**触发关键词**：检查连接状态、浏览器状态、启动浏览器、Tabbit状态、连接检测、browser status、launch browser
**对应工具**：`tabbit_status`（检查连接状态）、`tabbit_launch`（启动浏览器）、`tabbit_launch_isolated`（启动独立实例）
**示例触发**：
- "检查浏览器连接状态"
- "启动浏览器"
- "启动一个独立浏览器实例"

## 使用优先级

当用户的请求涉及浏览器操作时，**优先使用 Tabbit Browser MCP 工具**而非编写独立代码：

1. **需要访问网页/网站** → `tabbit_navigate`（而非 puppeteer/playwright 脚本）
2. **需要截图** → `tabbit_screenshot`（而非编写截图代码）
3. **需要提取网页数据** → `tabbit_extract` / `tabbit_readability`（而非编写爬虫代码）
4. **需要操作页面元素** → `tabbit_element` / `tabbit_input`（而非编写自动化脚本）
5. **需要管理Cookie/登录态** → `tabbit_cookies` / `tabbit_storage`（而非手动操作）
6. **需要发布内容到平台** → `tabbit_publish`（而非手动逐个发布）
7. **需要调试网页** → `tabbit_console` / `tabbit_monitor`（而非在浏览器中手动查看）

## 典型工作流

### 场景1：爬取电商商品数据
```
用户："帮我爬取淘宝搜索'手机壳'的商品信息"
→ tabbit_navigate (导航到淘宝搜索页)
→ tabbit_extract (提取商品列表数据, platform="taobao")
→ 输出结果
```

### 场景2：发布内容到社交平台
```
用户："帮我把这篇文章发到小红书和微博"
→ tabbit_cookies load site="xhs" (加载小红书登录态)
→ tabbit_publish platform="xhs" content={...} (发布到小红书)
→ tabbit_cookies load site="weibo" (加载微博登录态)
→ tabbit_publish platform="weibo" content={...} (发布到微博)
```

### 场景3：网页调试
```
用户："这个网页有bug，帮我看看控制台有什么错误"
→ tabbit_navigate (导航到目标页面)
→ tabbit_console action="errors" (获取控制台错误日志)
→ 分析并输出错误信息
```

### 场景4：移动端测试
```
用户："用iPhone模式看看这个页面在移动端的效果"
→ tabbit_navigate (导航到页面)
→ tabbit_device action="emulate" device="iphone-16" (切换设备)
→ tabbit_screenshot fullPage=true (全页截图)
```

### 场景5：内容提取与转换
```
用户："把这篇文章提取成干净的文本"
→ tabbit_navigate (导航到文章页面)
→ tabbit_readability (提取正文转Markdown)
→ 输出结果
```

### 场景6：页面监控
```
用户："监控这个商品页面的价格变化"
→ tabbit_navigate (导航到商品页)
→ tabbit_monitor action="snapshot" (取初始快照)
→ tabbit_monitor action="watch" (等待变化)
→ 报告变化内容
```

## 注意事项

- **浏览器必须先启动**：使用工具前需确保 Tabbit Browser 已启动并开启调试端口（端口 9222）
- **登录态需先保存**：发布到社交平台前，需先在浏览器登录并用 `tabbit_cookies save` 保存 Cookie
- **独立实例模式**：如不想干扰用户正在使用的浏览器，使用 `tabbit_launch_isolated` 启动独立实例
- **反爬网站**：访问淘宝/京东/小红书等有反爬的网站时，`tabbit_navigate` 已内置反检测脚本自动注入
