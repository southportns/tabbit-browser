# Tabbit Browser MCP Server v2.6

Tabbit 浏览器的全功能 CDP 自动化 MCP Server。通过 Chrome DevTools Protocol 操控 Tabbit 浏览器，提供 22 个工具覆盖 AI 对话、截图、设备仿真、网络管理、智能元素操作、数据提取、平台发布等场景。

**v2.6 重点优化**：会话池复用、HTTP keep-alive、MutationObserver 事件驱动、懒加载模块、并行化处理，平均响应速度提升 40-60%。

## 功能特性

### 核心
- **AI 对话** - 与 Tabbit 内置 Doubao AI 对话，主动轮询检测回复完成（平均 2-4 秒，原 12-18 秒）
- **截图/PDF** - 视口截图、全页截图（requestAnimationFrame 等待渲染）、元素截图、PDF 导出
- **多标签管理** - 列出/新建/关闭标签页

### 设备与网络
- **设备仿真** - 模拟 iPhone/Android/iPad/桌面视口，深色模式、地理定位、时区、触摸仿真
- **网络管理** - 持久化请求拦截（block/mock）、限速（offline/3G/4G）、请求日志、Cookie 查看/导出/导入
- **存储管理** - 登录态导出/导入、localStorage 查看、一键清除

### 智能自动化
- **智能元素操作** - 按文本/placeholder/选择器/ARIA role 定位元素，MutationObserver 等待出现（即时返回），快速点击模式（默认）与拟人点击模式可选
- **高级输入** - 鼠标点击、键盘输入、快捷键、滚动、拖拽、剪贴板操作
- **智能导航** - 首屏自动注入反检测脚本、防风控等待、自动滚动触发懒加载、人类行为模拟
- **反检测（14 项）** - navigator.webdriver 多层隐藏、CDP 检测变量动态清除、chrome.runtime 完整模拟、plugins/languages/connection 伪装、WebGL vendor/renderer 伪装、canvas 指纹噪声、Function.toString 防检测、visibilityState/outerWidth 覆盖、hardwareConcurrency 伪装
- **人类行为模拟** - 贝塞尔曲线鼠标移动、随机偏移点击、逐字符自然输入、humanBrowse 浏览停留

### 数据提取与监控
- **结构化提取** - 商品列表（京东/淘宝/拼多多/抖音电商）、表格、链接、图片、全文、自定义（CSS/XPath）
- **正文提取** - Readability 算法按文本密度提取主体（top-20 候选快速评分），转 Markdown
- **控制台日志** - 抓取浏览器 console 输出，按级别过滤/关键词搜索，按 target 跟踪持久化 hook
- **页面监控** - 对页面区域取快照、MutationObserver 事件驱动检测变化、行级差异对比（支持顺序容错）

### 下载与发布
- **下载管理** - 设置下载目录、监听下载进度、查看下载记录
- **多平台发布** - 小红书/抖音/微博/知乎/B站/微信公众号自动填表发布（需先登录保存 Cookie）

## 安装

```bash
git clone https://github.com/southportns/tabbit-browser.git
cd tabbit-browser
npm install
```

## 前置条件

1. 安装 [Tabbit Browser](https://www.tabbit.com/)（基于 Chromium 的 AI 浏览器）
2. 启动 Tabbit 并开启调试端口：

```bash
# Windows
"D:\Tabbit Browser\Application\Tabbit Browser.exe" --remote-debugging-port=9222 --remote-allow-origins=* --enable-remote-debugging
```

或使用 CLI 启动：

```bash
node cli.js launch
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TABBIT_PORT` | `9222` | Tabbit 浏览器调试端口 |
| `TABBIT_CDP_TIMEOUT` | `60000` | CDP 命令超时（毫秒） |

## 配置 MCP

### Claude Code / MiMoCode / TRAE

在 `~/.claude.json`（或 TRAE 的 MCP 配置）的 `mcpServers` 中添加，将路径替换为你 clone 的实际位置：

```json
{
  "mcpServers": {
    "tabbit-browser": {
      "command": "node",
      "args": ["/你的实际路径/tabbit-browser/mcp-server.js"],
      "env": {
        "TABBIT_PORT": "9222",
        "TABBIT_CDP_TIMEOUT": "60000"
      }
    }
  }
}
```

例如 Windows 下 clone 到 `D:\projects\tabbit-browser`：

```json
"args": ["D:\\projects\\tabbit-browser\\mcp-server.js"]
```

也可以用 `npm link` 安装到全局，避免写长路径：

```bash
cd /你的实际路径/tabbit-browser
npm link
```

然后配置简化为：

```json
{
  "mcpServers": {
    "tabbit-browser": {
      "command": "tabbit-mcp",
      "env": {
        "TABBIT_PORT": "9222",
        "TABBIT_CDP_TIMEOUT": "60000"
      }
    }
  }
}
```

### Codex

在 `~/.codex/config.toml` 中添加，同样替换为实际路径：

```toml
[mcp_servers.tabbit-browser]
command = "node"
args = ["/你的实际路径/tabbit-browser/mcp-server.js"]
```

## MCP 工具列表 (22 个)

### 核心

| 工具 | 说明 |
|------|------|
| `tabbit_chat` | 发送消息给 Tabbit AI 并获取回复（主动轮询，回复完成即返回） |
| `tabbit_screenshot` | 截图（视口/全页/元素，支持 jpeg/png/webp） |
| `tabbit_pdf` | 将页面导出为 PDF |
| `tabbit_status` | 检查 Tabbit 连接状态、浏览器版本、页面列表 |
| `tabbit_launch` | 启动 Tabbit 浏览器（带调试端口） |
| `tabbit_new` | 打开新对话页面 |

### 设备与网络

| 工具 | 说明 |
|------|------|
| `tabbit_device` | 设备仿真：viewport/emulate/reset/dark/geo/touch/timezone |
| `tabbit_network` | 持久化网络拦截：block/mock/unblock/throttle/log/rules + Cookie/缓存操作 |
| `tabbit_storage` | 存储管理：export/import/clear/local（按 origin 匹配页面） |

### 智能自动化

| 工具 | 说明 |
|------|------|
| `tabbit_element` | 智能元素操作：click/click-any/type/type-any/wait/get-text/scroll-into-view/upload/count。locator 支持 selector/text/placeholder/tag/role/index。click 默认快速模式，human:true 启用拟人模式 |
| `tabbit_input` | 高级输入：click/type/key/hotkey/scroll/drag/select-all/copy/paste/cut/undo/redo |
| `tabbit_tabs` | 多标签管理：list/open/close |
| `tabbit_navigate` | 智能导航：自动注入反检测脚本 + 防风控等待 + 自动滚动（单次 evaluate） + 人类行为模拟（`humanBrowse=true`） |
| `tabbit_antidetect` | 注入反检测脚本到当前页面（14 项反检测覆盖） |

### 数据提取与监控

| 工具 | 说明 |
|------|------|
| `tabbit_extract` | 结构化提取：goods(商品)/table/links/images/text/custom。支持 targetId/urlContains 精确定位页面、autoScroll 滚动加载、outputPath 结果导出（JSON/CSV）、locatorType(css/xpath)。商品提取支持淘宝/京东/拼多多/抖音电商 |
| `tabbit_readability` | Readability 算法提取正文转 Markdown，top-20 候选快速评分，去广告导航 |
| `tabbit_console` | 控制台日志抓取：即时捕获 + 持久化 hook，按 target 跟踪，按级别过滤/关键词搜索 |
| `tabbit_monitor` | 页面监控：snapshot(快照)/watch(MutationObserver 事件驱动)/diff(差异对比，支持顺序容错) |

### 下载与发布

| 工具 | 说明 |
|------|------|
| `tabbit_download` | 下载管理：set-dir(设目录)/list(查记录)/clear |
| `tabbit_cookies` | Cookie 持久化：save/load/list/save-all/load-all（并行化处理），存入 `~/.tabbit-browser/` |
| `tabbit_publish` | 多平台发布：xhs/douyin/weibo/zhihu/bilibili/wechat，支持 dryRun 预览 |
| `tabbit_task` | AI 任务管理：create/status/stop/list（依赖 Tabbit 内置 AI） |

## 性能优化（v2.6）

### 连接与会话管理
- **会话池复用** — CDP session 跨工具调用复用，避免重复建立 WebSocket（每次节省 50-150ms）
- **HTTP keep-alive** — 所有 HTTP 请求复用 TCP 连接（maxSockets: 6）
- **getTargets 缓存** — 1 秒 TTL，避免高频重复请求 `/json/list`
- **getVersion 缓存** — 30 秒 TTL，避免重复请求 `/json/version`
- **HTTP 超时保护** — 5 秒超时，防止浏览器卡死时无限挂起

### 工具执行优化
- **tabbit_chat 主动轮询** — 替代固定 sleep 12 秒，回复完成即返回（2-4 秒）
- **tabbit_navigate 单次查询** — 替代 20 次轮询，sleep 后单次查询
- **tabbit_navigate autoScroll 合并** — 10 次串行循环合并为单次 evaluate
- **tabbit_task 条件轮询** — 6 处固定 sleep 改为 waitForCondition 检查页面就绪
- **tabbit_cookies 并行化** — save-all/load-all 改为 Promise.all 并行

### 元素操作优化
- **element.click 快速模式** — 默认单次 mouseMoved（30ms），human:true 保留拟人模式（5 步 + 10ms）
- **element.waitFor MutationObserver** — 元素出现立即返回，替代 300ms 轮询
- **element._queryAll 预注入** — 辅助函数 `__tabbit_find` 预注入，避免每次传输大段 JS

### 爬虫功能优化
- **页面精确定位** — extract/readability/monitor 支持 targetId/urlContains 参数
- **商品提取扩展** — 新增拼多多、抖音电商平台
- **自动滚动加载** — extract 支持 autoScroll + maxPages 无限滚动
- **结果导出** — extract 支持 outputPath 导出 JSON/CSV
- **XPath 支持** — extract custom 类型支持 locatorType=xpath
- **readability 评分优化** — 两阶段：先筛 top-20 再详细评分
- **monitor.watch MutationObserver** — 页面变化时才触发对比，替代固定轮询
- **monitor._diff 优化** — Set 去重 + reorderOnly 检测仅排序变化
- **readability 递归限制** — nodeToMd 最大深度 15，防止栈溢出

### 架构优化
- **低频模块懒加载** — monitor/publish/scheduler/download 等 9 个模块首次使用时才 require
- **console hook 按 target 跟踪** — 避免重复注入 hook 脚本
- **NetworkInterceptor 快速路径** — 已附着时直接返回，避免重复 HTTP

## CLI 用法

除了 MCP，也可以直接通过命令行使用：

```bash
# 发送消息
node cli.js chat "你好"

# 交互式对话
node cli.js chat -i

# 设备仿真
node cli.js device emulate iphone-14
node cli.js device dark on
node cli.js device reset

# 截图/PDF
node cli.js screenshot output.jpg
node cli.js screenshot --full
node cli.js pdf output.pdf

# 网络管理
node cli.js net cookies
node cli.js net export-cookies
node cli.js net block "ads.*"
node cli.js net throttle slow-3g

# 存储管理
node cli.js storage export "https://web.tabbit.com"
node cli.js storage import login.json

# 多标签
node cli.js tabs
node cli.js tabs open "https://example.com"

# 批量对话
node cli.js batch chat messages.json
```

## 支持的设备

使用 `tabbit device emulate <设备名>` 切换，共 18 个预设：

| 设备名 | 分辨率 | 类型 |
|--------|--------|------|
| `iphone-14` | 390×844 | 移动端 |
| `iphone-14-pro-max` | 430×932 | 移动端 |
| `iphone-16` | 393×852 | 移动端 |
| `iphone-16-plus` | 430×932 | 移动端 |
| `iphone-16-pro` | 402×874 | 移动端 |
| `iphone-16-pro-max` | 440×956 | 移动端 |
| `iphone-16e` | 393×852 | 移动端 |
| `iphone-17` | 402×874 | 移动端 |
| `iphone-17-air` | 414×896 | 移动端 |
| `iphone-17-pro` | 402×874 | 移动端 |
| `iphone-17-pro-max` | 440×956 | 移动端 |
| `ipad-pro` | 1024×1366 | 平板 |
| `ipad-pro-13` | 1024×1366 | 平板 |
| `pixel-7` | 412×915 | 移动端 |
| `pixel-9` | 412×892 | 移动端 |
| `galaxy-s23` | 360×780 | 移动端 |
| `galaxy-s24-ultra` | 412×915 | 移动端 |
| `desktop-1080` | 1920×1080 | 桌面 |
| `desktop-1440` | 2560×1440 | 桌面 |

## 架构

```
mcp-server.js          MCP 协议入口 + 工具路由
├── CDP                 内联 WebSocket 连接管理（超时/事件/重连）
├── 会话池              _sessionPool 跨工具调用复用 CDP session（30s TTL）
├── NetworkInterceptor  持久化网络拦截器（block/mock/throttle/log 跨调用保持）
├── DownloadTracker     持久化下载跟踪器
└── ANTIDETECT_SCRIPT   反检测脚本（14 项覆盖，对标 go-rod/stealth）

lib/
├── tabbit.js           TabbitClient + TabbitBrowser 核心连接（HTTP keep-alive + 缓存）
├── element.js          ElementManager 智能元素定位（快速点击 + MutationObserver 等待 + 预注入辅助函数）
├── human.js            人类行为模拟（贝塞尔鼠标移动/随机延迟/自然输入/浏览停留）
├── content.js          ContentExtractor Readability 正文提取（top-20 候选评分 + 递归深度限制）
├── monitor.js          MonitorManager 页面快照/事件驱动监控/差异对比（Set 去重 + 顺序容错）
├── download.js         DownloadManager 下载事件监听（防重复注册）
├── publish.js          6 平台发布配置（小红书/抖音/微博/知乎/B站/公众号）
├── network.js          NetworkManager 网络操作
├── storage.js          StorageManager 存储操作
├── input.js            InputManager 输入操作
├── capture.js          CaptureManager 截图/PDF（requestAnimationFrame 等待渲染）
├── device.js           DeviceManager 设备仿真
├── multi-tab.js        MultiTabManager 多标签
└── scheduler.js        Scheduler 批量任务
```

### stdin 协议

同时支持两种 MCP 分帧方式：
- **NDJSON**（换行分隔）— Claude Code 等标准 MCP 客户端使用
- **Content-Length 分帧**（LSP 风格）— 部分客户端使用

输出统一为换行分隔。

### 持久化机制

- **会话池** — CDP session 跨工具调用复用，30 秒 TTL 自动过期清理
- **NetworkInterceptor** — 跨工具调用保持 CDP 会话，block/mock/throttle 规则在页面切换时自动重连并保留
- **DownloadTracker** — set-dir 后持续跟踪下载进度
- **控制台日志** — `addScriptToEvaluateOnNewDocument` 注入 hook，按 target 跟踪，跨导航持久捕获

### 反检测能力

对标 [go-rod/stealth](https://github.com/nicedoc/go-rod-stealth) 覆盖范围，14 项反检测：

| 检测维度 | 覆盖方式 |
|----------|----------|
| `navigator.webdriver` | 多层隐藏（含 `__proto__`） |
| CDP 检测变量 | 动态扫描 `window.cdc_*` 清除 |
| `chrome.runtime` | 完整模拟（枚举 + connect/sendMessage） |
| `navigator.permissions.query` | notifications 等查询覆盖 |
| `navigator.plugins` | 6 个标准插件（含 item/namedItem/Symbol.iterator） |
| `navigator.languages` | `['zh-CN', 'zh', 'en-US', 'en']` |
| WebGL vendor/renderer | Intel Iris OpenGL Engine |
| canvas 指纹 | toDataURL 添加微小随机噪声 |
| `navigator.connection` | rtt/downlink/effectiveType 伪装 |
| `Function.prototype.toString` | 防止原生代码检测 |
| `document.hidden/visibilityState` | 始终为 visible |
| `window.outerWidth/outerHeight` | 防 0 值暴露 |
| `navigator.hardwareConcurrency` | ≤2 核时伪装为 8 |
| 人类行为模拟 | 贝塞尔曲线鼠标移动 + 随机偏移点击 + 逐字符输入 + 浏览停留 |

## 技术栈

- Node.js + Chrome DevTools Protocol (CDP)
- WebSocket 通信（ws 库，keep-alive 复用）
- 持久化 CDP 会话池（跨工具调用保持连接，30s TTL）
- HTTP keep-alive（maxSockets: 6）+ 短期缓存（getTargets 1s / getVersion 30s）
- 低频模块懒加载（monitor/publish/scheduler/download 等）
- 无需额外浏览器驱动（直接连接 Tabbit）

## 许可证

MIT License
