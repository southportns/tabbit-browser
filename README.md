# Tabbit Browser MCP Server v2.3

Tabbit 浏览器的全功能 CDP 自动化 MCP Server。通过 Chrome DevTools Protocol 操控 Tabbit 浏览器，提供 21 个工具覆盖 AI 对话、截图、设备仿真、网络管理、智能元素操作、数据提取、平台发布等场景。

## 功能特性

### 核心
- **AI 对话** - 与 Tabbit 内置 Doubao AI 对话，支持流式输出
- **截图/PDF** - 视口截图、全页截图、元素截图、PDF 导出
- **多标签管理** - 列出/新建/关闭标签页

### 设备与网络
- **设备仿真** - 模拟 iPhone/Android/iPad/桌面视口，深色模式、地理定位、时区、触摸仿真
- **网络管理** - 持久化请求拦截（block/mock）、限速（offline/3G/4G）、请求日志、Cookie 查看/导出/导入
- **存储管理** - 登录态导出/导入、localStorage 查看、一键清除

### 智能自动化
- **智能元素操作** - 按文本/placeholder/选择器/ARIA role 定位元素，自动滚动到可见、等待出现、拟人点击与输入，多备选定位器耐改版
- **高级输入** - 鼠标点击、键盘输入、快捷键、滚动、拖拽、剪贴板操作
- **智能导航** - 首屏自动注入反检测脚本、防风控等待、自动滚动触发懒加载
- **反检测** - 隐藏 webdriver 标记、CDP 检测变量、权限查询覆盖

### 数据提取与监控
- **结构化提取** - 商品列表（京东/淘宝专用脚本）、表格、链接、图片、全文
- **正文提取** - Readability 算法按文本密度提取主体，转 Markdown
- **控制台日志** - 抓取浏览器 console 输出，按级别过滤/关键词搜索，持久化 hook 跨导航生效
- **页面监控** - 对页面区域取快照、轮询检测变化、行级差异对比

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

### Claude Code / MiMoCode

在 `~/.claude.json` 的 `mcpServers` 中添加，将路径替换为你 clone 的实际位置：

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

## MCP 工具列表 (21 个)

### 核心

| 工具 | 说明 |
|------|------|
| `tabbit_chat` | 发送消息给 Tabbit AI 并获取回复 |
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
| `tabbit_element` | 智能元素操作：click/click-any/type/type-any/wait/get-text/scroll-into-view/upload/count。locator 支持 selector/text/placeholder/tag/role/index |
| `tabbit_input` | 高级输入：click/type/key/hotkey/scroll/drag/select-all/copy/paste/cut/undo/redo |
| `tabbit_tabs` | 多标签管理：list/open/close |
| `tabbit_navigate` | 智能导航：自动注入反检测脚本 + 防风控等待 + 自动滚动触发懒加载 |
| `tabbit_antidetect` | 注入反检测脚本到当前页面（隐藏 webdriver/CDP 标记） |

### 数据提取与监控

| 工具 | 说明 |
|------|------|
| `tabbit_extract` | 结构化提取：goods(商品)/table/links/images/text/custom，支持淘宝/京东/波奇等平台优化 |
| `tabbit_readability` | Readability 算法提取正文转 Markdown，去广告导航 |
| `tabbit_console` | 控制台日志抓取：即时捕获 + 持久化 hook，按级别过滤/关键词搜索 |
| `tabbit_monitor` | 页面监控：snapshot(快照)/watch(轮询变化)/diff(差异对比) |

### 下载与发布

| 工具 | 说明 |
|------|------|
| `tabbit_download` | 下载管理：set-dir(设目录)/list(查记录)/clear |
| `tabbit_cookies` | Cookie 持久化：save/load/list/save-all/load-all，存入 `~/.tabbit-browser/` |
| `tabbit_publish` | 多平台发布：xhs/douyin/weibo/zhihu/bilibili/wechat，支持 dryRun 预览 |

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
├── NetworkInterceptor  持久化网络拦截器（block/mock/throttle/log 跨调用保持）
├── DownloadTracker     持久化下载跟踪器
└── ANTIDETECT_SCRIPT   反检测脚本（webdriver/CDP/权限/plugins/languages）

lib/
├── tabbit.js           TabbitClient + TabbitBrowser 核心连接
├── element.js          ElementManager 智能元素定位（多维度匹配 + 拟人点击）
├── content.js          ContentExtractor Readability 正文提取
├── monitor.js          MonitorManager 页面快照/轮询/差异对比
├── download.js         DownloadManager 下载事件监听
├── publish.js          6 平台发布配置（小红书/抖音/微博/知乎/B站/公众号）
├── network.js          NetworkManager 网络操作
├── storage.js          StorageManager 存储操作
├── input.js            InputManager 输入操作
├── capture.js          CaptureManager 截图/PDF
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

- **NetworkInterceptor** — 跨工具调用保持 CDP 会话，block/mock/throttle 规则在页面切换时自动重连并保留
- **DownloadTracker** — set-dir 后持续跟踪下载进度
- **控制台日志** — `addScriptToEvaluateOnNewDocument` 注入 hook，跨导航持久捕获

## 技术栈

- Node.js + Chrome DevTools Protocol (CDP)
- WebSocket 通信（ws 库）
- 持久化 CDP 会话（跨工具调用保持连接）
- 无需额外浏览器驱动（直接连接 Tabbit）

## 许可证

MIT License
