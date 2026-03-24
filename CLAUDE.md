# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

uTools 插件，用于浏览和管理 Claude Code 的本地会话记录（`~/.claude/projects/` 下的 JSONL 文件）。支持搜索、删除、重命名、fork 分支、在终端中恢复会话等操作。

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
- 亮色/暗色主题跟随系统 `prefers-color-scheme`

## 架构

### Preload 层（Node.js）

`public/preload/services.js` — CommonJS 模块，通过 `window.services` 暴露 API 给渲染进程：

- `getAllProjects()` — 扫描 `~/.claude/projects/`，返回项目和会话列表
- `readSessionFile()` / `watchSessionFile()` — 读取和监听 JSONL 会话文件
- `deleteSession()` / `renameSession()` / `forkSession()` — 会话 CRUD 操作
- `resumeSession()` — 跨平台在新终端窗口中恢复会话
- `parseJsonl()` — 兼容标准单行和美化多行两种 JSONL 格式

### 渲染层（Vue）

`src/App.vue` 作为根组件协调全局状态和业务逻辑，UI 拆分为组件：

**组件** (`src/components/`)：
- `Sidebar.vue` — 左侧项目/会话列表、搜索
- `SessionView.vue` — 右侧会话消息渲染（消息合并、tool_use/tool_result 配对折叠）
- `RenameDialog.vue` / `DeleteConfirmDialog.vue` / `ForkDialog.vue` — 操作弹窗
- `SettingsDrawer.vue` — 右侧抽屉设置面板
- `ImagePreview.vue` — 图片预览
- `SnackBar.vue` — 全局提示条
- `icons/index.js` — SVG 图标组件，函数式渲染（`h()` 函数）

**Composables** (`src/composables/`)：
- `useMessageParser.js` — 消息解析核心：XML 标签解析、content blocks 解析、tool_use/tool_result 配对合并、连续 assistant 消息合并、token 统计累加
- `useToolDisplay.js` — 工具调用展示：摘要生成、Edit diff 渲染（LCS + 内联高亮）、折叠状态管理
- `useSnackbar.js` — 全局 snackbar 状态（模块级单例 ref）
- `useTheme.js` — 暗色模式检测（模块级单例 ref）
- `useFormat.js` — 时间/大小/路径格式化工具函数

### uTools 集成

- `public/plugin.json` — 插件配置，feature code `sessions`，关键词"CC会话管理"
- 开发模式 `main` 指向 `http://localhost:5173`
- `window.utools.dbStorage` 持久化用户设置（key: `terminalCommand`）
- `window.utools.shellOpenPath()` 打开项目目录

### 样式规范：亮色/暗色双主题

新增或修改任何 CSS 样式时，必须同时处理亮色和暗色两种模式。根组件 `App.vue` 通过 `:class="{ dark: isDark }"` 控制主题，暗色样式使用 `.dark` 选择器覆盖：
- 各组件内使用 `.dark .xxx` 或父组件传递的 `.dark` 类来定义暗色变体
- 颜色、背景、边框、阴影等视觉属性都需要提供暗色版本
- `main.css` 中滚动条样式通过 `@media (prefers-color-scheme: dark)` 适配

### 关键设计模式

- Composables 中 `useSnackbar` 和 `useTheme` 使用模块级 `ref()` 实现跨组件单例共享状态
- 消息合并逻辑：连续 assistant 消息、tool_result 响应、系统注入文本都会合并到前一个 assistant 消息中
- 工具调用渲染：tool_use 与 tool_result 按 ID 配对，默认折叠，点击展开
- Edit 工具的 diff 使用 LCS 算法 + 内联差异高亮，结果通过 WeakMap 缓存
