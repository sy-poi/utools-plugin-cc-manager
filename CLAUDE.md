# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

uTools 插件，用于浏览和管理 Claude Code 的本地会话记录（`~/.claude/projects/` 下的 JSONL 文件）。支持搜索、删除、重命名、fork 分支、在终端中恢复会话、导出为 Markdown/HTML/长图等操作。

## 常用命令

```bash
pnpm dev      # 启动开发服务器 (localhost:5173)，配合 uTools 开发者模式使用
pnpm build    # 构建到 dist/ 目录
```

无测试、无 lint 配置。

## 技术栈

- Vue 3 (Composition API, `<script setup>`) + Vite 6
- 包管理器: pnpm
- 纯 CSS，无第三方 UI 库
- html2canvas 用于长图导出
- 亮色/暗色主题跟随系统 `prefers-color-scheme`

## 架构

### Preload 层（Node.js）

`public/preload/services.js` — CommonJS 模块，通过 `window.services` 暴露 API 给渲染进程：

- `getAllProjects()` — 扫描 `~/.claude/projects/`，返回项目和会话列表
- `readSessionFile()` / `watchSessionFile()` — 读取和监听 JSONL 会话文件
- `deleteSession()` / `renameSession()` / `forkSession()` — 会话 CRUD 操作
- `resumeSession()` — 跨平台在新终端窗口中恢复会话
- `toggleFavorite()` — 切换会话收藏状态
- `parseJsonl()` — 兼容标准单行和美化多行两种 JSONL 格式
- `saveText()` / `saveImage()` — 导出文件保存

### 渲染层（Vue）

`src/App.vue` 作为根组件协调全局状态和业务逻辑，UI 拆分为组件：

**组件** (`src/components/`)：
- `Sidebar.vue` — 左侧项目/会话列表、搜索、多选
- `SessionView.vue` — 右侧会话消息渲染（消息合并、tool_use/tool_result 配对折叠、导出）
- `ExportOptionsDialog.vue` — 导出选项对话框（图片/HTML 导出设置）
- `RenameDialog.vue` / `DeleteConfirmDialog.vue` / `ForkDialog.vue` — 操作弹窗
- `SettingsDrawer.vue` — 右侧抽屉设置面板
- `ImagePreview.vue` — 图片预览
- `SnackBar.vue` — 全局提示条
- `icons/index.js` — SVG 图标组件，函数式渲染（`h()` 函数）

**Composables** (`src/composables/`)：
- `useMessageParser.js` — 消息解析核心：content blocks 解析、tool_use/tool_result 配对合并、连续 assistant 消息合并、isMeta 命令注入合并、sourceToolUseID/sourceToolAssistantUUID 工具响应合并、isApiErrorMessage 错误识别、token 统计累加
- `useToolDisplay.js` — 工具调用展示：摘要生成、Edit diff 渲染（LCS + 内联高亮）、折叠状态管理（含 `forceExpand` 用于导出时临时展开）
- `useSearch.js` — 会话内搜索：关键词高亮定位、区分大小写/全字匹配/正则表达式选项
- `useExport.js` — 导出功能：Markdown 导出、`collectPageStyles()` 收集页面 CSS、`serializeToHtml()` 将 DOM 克隆序列化为独立 HTML
- `useSnackbar.js` — 全局 snackbar 状态（模块级单例 ref）
- `useTheme.js` — 暗色模式检测（模块级单例 ref）
- `useFormat.js` — 时间/大小/路径格式化工具函数
- `useMarkdown.js` — Markdown 渲染（markdown-it 配置）

### uTools 集成

- `public/plugin.json` — 插件配置，feature code `sessions`，关键词"CC会话管理"
- 开发模式 `main` 指向 `http://localhost:5173`
- `window.utools.dbStorage` 持久化用户设置（key: `terminalCommand`）
- `window.utools.shellOpenPath()` 打开项目目录
- `window.utools.shellShowItemInFolder()` 定位文件

### 样式规范：亮色/暗色双主题

新增或修改任何 CSS 样式时，必须同时处理亮色和暗色两种模式。根组件 `App.vue` 通过 `:class="{ dark: isDark }"` 控制主题，暗色样式使用 `.dark` 选择器覆盖：
- 各组件内使用 `.dark .xxx` 或父组件传递的 `.dark` 类来定义暗色变体
- 颜色、背景、边框、阴影等视觉属性都需要提供暗色版本
- `main.css` 中滚动条样式通过 `@media (prefers-color-scheme: dark)` 适配

### 关键设计模式

- Composables 中 `useSnackbar` 和 `useTheme` 使用模块级 `ref()` 实现跨组件单例共享状态
- 消息合并逻辑：连续 assistant 消息、tool_result 响应、sourceToolUseID/sourceToolAssistantUUID 工具响应、系统注入文本都会合并到前一个 assistant 消息中；isMeta 命令注入消息合并到前一个 user 消息中作为 `type: 'meta'` 块。合并时在 merged message 上记录 `lastUuid`（最后一条被合并的原始 item 的 uuid），供 fork 等功能定位截断点
- 系统注入判定：`isSystemText(text)` 函数判断文本是否为系统生成内容（以 `[` 或 `<` 开头）。该函数在 `preload/services.js` 和 `src/composables/useMessageParser.js` 中各有一份，修改时必须同步更新两处。注意：含 `<command-name>` 的消息是用户命令，不算系统事件
- 工具调用渲染：tool_use 与 tool_result 按 ID 配对，默认折叠，点击展开
- Edit 工具的 diff 使用 LCS 算法 + 内联差异高亮，结果通过 WeakMap 缓存
- 导出架构：图片和 HTML 导出共用 DOM 克隆方案（`prepareExportClone()` + `serializeToHtml()`），不维护独立的 HTML 模板和样式。`collectPageStyles()` 收集页面 CSS 时会过滤无关规则（sidebar/dialog 等）并剥除 `data-v-xxx` scoped 选择器，末尾追加覆盖规则确保独立 HTML 正常居中滚动
- `DeleteConfirmDialog` 的 `showHint` prop 控制是否显示 Ctrl 跳过提示：Sidebar 调用时传 event（showHint=true），SessionView 调用时不传 event（showHint=false）

### 更新日志规范

更新 `CHANGELOG.md` 时，按以下格式编写，保持简洁：

```
## vX.Y.Z

1. 修复了xxx
2. 新增了xxx
3. 优化了xxx
```

每条一句话说明，不用分类标题，不用加粗或详细解释。
需要同步修改 README.md 和 CLAUDE.md，更新新功能的使用说明和技术细节，如果有新增或删除的文件也要更新文件列表。
