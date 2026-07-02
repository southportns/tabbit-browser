# Tabbit Browser MCP Server

Tabbit 浏览器的 MCP (Model Context Protocol) Server，让 AI Agent 直接操控 Tabbit 浏览器内置的 Doubao AI 进行对话、截图、设备仿真、网络管理等自动化操作。

## 功能特性

- **AI 对话** - 直接与 Tabbit 内置的 Doubao AI 对话，支持多轮接续
- **截图/PDF** - 视口截图、全页截图、元素截图、PDF 导出
- **设备仿真** - 模拟 iPhone/Android/iPad/桌面视口，支持深色模式、地理定位
- **网络管理** - Cookie 查看/导出/导入、请求拦截、Mock 响应、URL 屏蔽、网络限速
- **存储管理** - 登录态导出/导入、localStorage 管理、一键清除
- **高级输入** - 鼠标点击、键盘输入、快捷键、滚动、拖拽
- **多标签管理** - 并行操控多个标签页
- **智能导航** - 自动反检测注入、防风控等待、自动滚动
- **结构化提取** - 商品列表、表格、链接、图片等结构化数据提取
- **反检测** - 自动隐藏自动化标记（webdriver/CDP 检测）
- **Cookie 持久化** - 保存/加载/批量管理站点 Cookie

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

## 配置 MCP

### Claude Code / MiMoCode

在 `~/.claude.json` 的 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "tabbit-browser": {
      "command": "node",
      "args": ["C:\\path\\to\\tabbit-browser\\mcp-server.js"],
      "env": {
        "TABBIT_PORT": "9222"
      }
    }
  }
}
```

### Codex

在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.tabbit-browser]
command = "node"
args = ["/path/to/tabbit-browser/mcp-server.js"]
```

## MCP 工具列表 (15 个)

| 工具 | 说明 |
|------|------|
| `tabbit_chat` | 发送消息给 Tabbit AI 并获取回复 |
| `tabbit_screenshot` | 截图（视口/全页/元素） |
| `tabbit_pdf` | 将页面导出为 PDF |
| `tabbit_device` | 设备仿真（视口/UA/深色模式/定位） |
| `tabbit_network` | 网络管理（Cookie/拦截/Mock/限速） |
| `tabbit_storage` | 存储管理（登录态导出/导入） |
| `tabbit_input` | 高级输入（点击/键盘/拖拽） |
| `tabbit_tabs` | 多标签管理 |
| `tabbit_status` | 连接状态 |
| `tabbit_launch` | 启动 Tabbit 浏览器 |
| `tabbit_new` | 打开新对话 |
| `tabbit_navigate` | 智能导航（自动反检测+滚动） |
| `tabbit_extract` | 结构化数据提取（商品/表格/链接/图片） |
| `tabbit_antidetect` | 注入反检测脚本 |
| `tabbit_cookies` | Cookie 持久化（保存/加载/批量管理） |
| `tabbit_status` | 检查连接状态 |
| `tabbit_launch` | 启动 Tabbit 浏览器 |
| `tabbit_new` | 打开新对话 |

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

| 设备 | 分辨率 | 类型 |
|------|--------|------|
| iPhone 14 | 390x844 | 移动端 |
| iPhone 14 Pro Max | 430x932 | 移动端 |
| iPad Pro | 1024x1366 | 移动端 |
| Pixel 7 | 412x915 | 移动端 |
| Galaxy S23 | 360x780 | 移动端 |
| Desktop 1080p | 1920x1080 | 桌面 |
| Desktop 1440p | 2560x1440 | 桌面 |

## 技术栈

- Node.js + Chrome DevTools Protocol (CDP)
- WebSocket 通信
- 无需额外浏览器驱动（直接连接 Tabbit）

## 许可证

MIT License
