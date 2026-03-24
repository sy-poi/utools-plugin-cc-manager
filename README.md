# Claude Code 会话管理器

一款 [uTools](https://www.u-tools.cn/) 插件，用于浏览、管理和查看本地 Claude Code 的会话记录。

## 功能特性

### 会话浏览

- 自动扫描 `~/.claude/projects` 目录下的所有项目和会话文件
- 项目按实际工作目录路径显示，长路径自动缩短，hover 显示完整路径
- 会话按最后消息时间倒序排列，最新活跃的项目和会话排在最前
- 自动识别会话名称：优先读取自定义标题，否则取最后一条有效用户消息
- 智能跳过无效消息（XML 标签、中断消息、工具返回等）作为会话名
- **收藏/置顶**：星标重要会话，收藏的会话在项目内置顶显示

### 会话查看

- 双栏布局：左侧项目/会话列表，右侧会话内容查看
- **Markdown 渲染**：AI 回复使用 markdown-it 渲染，支持代码块、表格、列表、链接、标题等
- **代码块复制**：每个代码块右上角显示语言标签和复制按钮，一键复制代码
- 智能消息合并：连续的 AI 消息自动合并为一条，tool_result 和系统注入（如 Skill 返回）合并到对应的 AI 消息中
- **工具调用卡片**：Read/Write/Edit/Bash 等工具调用以卡片形式展示，折叠/展开
- **Edit Diff 视图**：Edit 工具以红绿 diff 形式展示代码变更，支持行内差异高亮
- **图片预览**：用户上传的图片可点击放大、复制到剪贴板、另存为文件
- **XML 标签解析**：stdout/stderr/命令/IDE 事件等 XML 标签结构化显示
- **中断提示**：`[Request interrupted by user]` 以橙色虚线框特殊样式展示
- **Token 统计**：每条 AI 消息底部显示模型、token 用量、缓存命中、耗时、停止原因
- **会话内搜索**：搜索栏支持关键词高亮定位，上下导航匹配项
- 兼容标准 JSONL 和美化多行 JSON 两种会话文件格式
- 实时监听：选中会话后自动监听文件变化，新消息实时刷新
- 自动滚动：文件更新时若滚动条在底部则自动跟随，否则保持当前位置

### 会话操作

- **搜索过滤**：按会话名、sessionId、工作目录模糊搜索，搜索时自动展开匹配项目
- **重命名会话**：弹窗修改会话显示名称
- **删除会话**：需要二次确认，按住 Ctrl 点击可跳过确认
- **批量删除**：多选模式下勾选多个会话，一键批量删除
- **Fork 分支**：从任意 AI 消息处截断，命名并创建新的会话分支
- **恢复会话**：点击终端图标，在新终端窗口中执行 `claude --resume {sessionId}`，支持 Windows / macOS / Linux
- **打开项目目录**：项目文件夹悬浮显示打开按钮，点击在文件管理器中打开
- **复制消息**：悬浮在消息上显示复制按钮，仅复制纯文本内容（排除工具调用等）
- **快速滚动**：右下角顶部/底部快速滚动按钮

### 导出

- **导出 Markdown**：会话导出为 `.md` 文件
- **导出 HTML**：导出为独立 HTML 文件（含完整样式）
- **导出长图**：导出为 HTML 文件，可在浏览器中打开截长图

### 界面交互

- 明暗主题切换（跟随系统 / 手动切换）
- 侧边栏可收起/展开，滑动动画
- 右侧抽屉式设置面板

### 设置

- **终端命令**：自定义恢复会话使用的命令，默认 `claude`
- **主题模式**：系统跟随 / 亮色 / 暗色

## 技术栈

- **Vue 3** + Composition API
- **Vite 6** 构建
- **markdown-it** Markdown 渲染
- **纯 CSS** 手写样式，无第三方 UI 库
- **Node.js** preload 层处理文件系统操作
- **uTools API** 插件平台集成与数据持久化

## 安装使用

1. 安装依赖：`pnpm install`
2. 开发模式：`pnpm run dev`
3. 构建：`pnpm run build`
4. 在 uTools 开发者工具中加载 `public/plugin.json` 或 `dist` 目录
5. 在 uTools 中输入「会话管理」启动插件

## 项目结构

```
├── public/
│   ├── plugin.json                 # uTools 插件配置
│   ├── logo.png                    # 插件图标
│   └── preload/
│       └── services.js             # Node.js 服务层（文件操作、会话管理）
├── src/
│   ├── main.js                     # Vue 入口
│   ├── main.css                    # 全局样式
│   ├── App.vue                     # 根组件（全局状态、业务逻辑协调）
│   ├── assets/
│   │   └── markdown.css            # Markdown 渲染样式
│   ├── components/
│   │   ├── Sidebar.vue             # 左侧项目/会话列表、搜索、多选
│   │   ├── SessionView.vue         # 右侧会话消息渲染、搜索、导出
│   │   ├── RenameDialog.vue        # 重命名弹窗
│   │   ├── DeleteConfirmDialog.vue # 删除确认弹窗
│   │   ├── ForkDialog.vue          # Fork 分支弹窗
│   │   ├── SettingsDrawer.vue      # 设置抽屉面板
│   │   ├── ImagePreview.vue        # 图片预览
│   │   ├── SnackBar.vue            # 全局提示条
│   │   └── icons/
│   │       └── index.js            # SVG 图标组件库
│   └── composables/
│       ├── useMessageParser.js     # 消息解析与合并
│       ├── useToolDisplay.js       # 工具调用展示与 diff 渲染
│       ├── useMarkdown.js          # Markdown 渲染
│       ├── useSearch.js            # 会话内搜索
│       ├── useExport.js            # 导出功能
│       ├── useSnackbar.js          # 全局提示状态
│       ├── useTheme.js             # 主题管理
│       └── useFormat.js            # 时间/大小/路径格式化
├── package.json
└── vite.config.js
```
