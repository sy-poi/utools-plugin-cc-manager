<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { IconTerminal, IconCopy, IconFork, IconStop, IconChevronUp, IconChevronDown, IconChat, IconSearch, IconClose, IconExport, IconImage, IconFolder, IconMore, IconStar, IconStarOutline, IconEdit, IconDelete } from './icons'
import { formatTime } from '../composables/useFormat'
import { parseContentBlocks, mergeToolBlocks, getMessageRole, getRoleLabel, hasXmlTags, parseTextSegments } from '../composables/useMessageParser'
import { formatToolInput, getToolSummary, getDiff } from '../composables/useToolDisplay'
import { useCollapse } from '../composables/useToolDisplay'
import { useSnackbar } from '../composables/useSnackbar'
import { renderMarkdown } from '../composables/useMarkdown'
import { useSearch } from '../composables/useSearch'
import { exportAsMarkdown, serializeToHtml } from '../composables/useExport'
import { useTheme } from '../composables/useTheme'
import ExportOptionsDialog from './ExportOptionsDialog.vue'

const props = defineProps({
  session: Object,
  displayMessages: Array,
  loading: Boolean
})

const emit = defineEmits(['fork', 'resume', 'preview-image', 'rename', 'delete', 'toggle-favorite'])

const { showSnackbar } = useSnackbar()
const { toggleCollapse, isCollapsed, forceExpand } = useCollapse()
const { isDark } = useTheme()
const { searchVisible, searchText, matchIndex, matchCount, caseSensitive, wholeWord, useRegex, openSearch, closeSearch, doSearch, nextMatch, prevMatch } = useSearch()
const searchInputRef = ref(null)

// Auto-focus search input when opened
watch(searchVisible, (v) => {
  if (v) nextTick(() => searchInputRef.value?.focus())
})

// Global keyboard shortcuts
function onKeyDown(e) {
  if (!props.session) return
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault()
    openSearch()
  } else if (e.key === 'F3') {
    e.preventDefault()
    if (!searchVisible.value) openSearch()
    else if (e.shiftKey) prevMatch()
    else nextMatch()
  } else if (e.key === 'Escape' && searchVisible.value) {
    closeSearch()
  }
}
onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))

const contentBodyRef = ref(null)
const showMoreMenu = ref(false)
const showShareMenu = ref(false)
const exportDialog = ref({ show: false, format: '' })

// Close menus on click outside
function onDocClick(e) {
  if (showMoreMenu.value && !e.target.closest('.more-wrapper')) {
    showMoreMenu.value = false
    showShareMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

// Close search when session changes
watch(() => props.session, () => { if (searchVisible.value) closeSearch() })

function scrollToTop() {
  contentBodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToBottom() {
  const el = contentBodyRef.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

function isScrolledToBottom() {
  const el = contentBodyRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50
}

function scrollToEnd() {
  const el = contentBodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function copyMessageText(item) {
  const blocks = parseContentBlocks(item)
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => (b.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
  if (text) {
    window.utools.copyText(text)
    showSnackbar('已复制')
  } else {
    showSnackbar('无可复制的文本', 'error')
  }
}

function copyResumeCommand() {
  const session = props.session
  if (!session?.sessionId) return
  const command = window.utools.dbStorage.getItem('terminalCommand') || 'claude'
  const cmd = `${command} --resume ${session.sessionId}`
  window.utools.copyText(cmd)
  showSnackbar('已复制恢复命令')
}

function openSessionDir() {
  showMoreMenu.value = false
  const session = props.session
  if (!session?.path) return
  window.utools.shellShowItemInFolder(session.path)
}

function confirmDelete() {
  showMoreMenu.value = false
  emit('delete', props.session)
}

// Export functions
function doExport(format) {
  showMoreMenu.value = false
  showShareMenu.value = false
  const session = props.session
  const msgs = props.displayMessages
  if (!session || !msgs.length) return
  if (format === 'md') {
    const content = exportAsMarkdown(msgs, session)
    const filePath = window.services.saveText(content, `${session.name || 'session'}.md`)
    if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出 Markdown') }
  } else if (format === 'html' || format === 'image') {
    exportDialog.value = { show: true, format }
    return
  }
}

/**
 * Shared: clone preview DOM, apply export options, wrap in offscreen container.
 * Used by both HTML and image export.
 */
async function prepareExportClone(session, opts) {
  const source = contentBodyRef.value
  if (!source) return null

  // For HTML export, always expand all blocks (user can toggle in the HTML file)
  // For image export, only expand if explicitly requested
  const isHtml = exportDialog.value.format === 'html'
  const needExpand = isHtml || opts.showToolDetail || opts.showThinking
  if (needExpand) {
    forceExpand.value = true
    await nextTick()
  }

  const clone = source.cloneNode(true)
  if (needExpand) forceExpand.value = false

  // Strip interactive-only elements
  clone.querySelectorAll('.message-actions').forEach(el => el.remove())
  clone.querySelectorAll('.scroll-buttons').forEach(el => el.remove())
  clone.querySelectorAll('.search-highlight').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent))
  })

  // Apply export options
  if (!opts.showStats) clone.querySelectorAll('.message-stats').forEach(el => el.remove())

  if (isHtml) {
    // HTML: keep all blocks, but default them to collapsed (user can click to expand)
    clone.querySelectorAll('.tool-card-body, .block-body').forEach(el => {
      el.style.display = 'none'
    })
    clone.querySelectorAll('.collapse-icon').forEach(el => {
      el.textContent = '▸'
    })
  } else {
    // Image: remove blocks based on options
    if (!opts.showThinking) clone.querySelectorAll('.block-thinking').forEach(el => el.remove())
    if (!opts.showToolDetail) clone.querySelectorAll('.tool-card-body').forEach(el => el.remove())
  }

  // Handle file path mode
  if (opts.filePathMode === 'hidden') {
    clone.querySelectorAll('.tool-summary').forEach(el => { el.textContent = '' })
  } else if (opts.filePathMode === 'full') {
    clone.querySelectorAll('.tool-summary').forEach(el => {
      const fullPath = el.getAttribute('data-full-path')
      if (fullPath) el.textContent = fullPath
    })
  }

  // Build offscreen container
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:860px;z-index:-1;overflow:visible;'
  if (isDark.value) container.classList.add('dark')
  container.style.background = isDark.value ? '#1a1a1a' : '#f8f9fa'
  container.style.color = isDark.value ? '#e0e0e0' : '#1a1a1a'
  container.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif"
  container.style.padding = '16px'

  // Insert session title/meta at top
  const titleDiv = document.createElement('div')
  titleDiv.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:4px;'
  titleDiv.textContent = session.name || 'Session'
  container.appendChild(titleDiv)
  const metaParts = []
  if (opts.showSessionId && session.sessionId) metaParts.push(session.sessionId)
  if (opts.showCwd && session.cwd) metaParts.push(session.cwd)
  if (metaParts.length) {
    const metaDiv = document.createElement('div')
    metaDiv.style.cssText = 'font-size:12px;opacity:0.5;margin-bottom:16px;'
    metaDiv.textContent = metaParts.join(' · ')
    container.appendChild(metaDiv)
  }

  // Reset clone styles
  clone.style.overflow = 'visible'
  clone.style.height = 'auto'
  clone.style.maxHeight = 'none'
  clone.style.flex = 'none'
  container.appendChild(clone)

  return container
}

function doExportWithOptions(opts) {
  const format = exportDialog.value.format
  exportDialog.value.show = false
  const session = props.session
  const msgs = props.displayMessages
  if (!session || !msgs.length) return

  if (format === 'html') {
    showSnackbar('正在生成 HTML...')
    nextTick(async () => {
      try {
        const container = await prepareExportClone(session, opts)
        if (!container) return
        document.body.appendChild(container)
        await new Promise(r => setTimeout(r, 100))
        const htmlContent = serializeToHtml(container, session.name || 'Session', isDark.value)
        document.body.removeChild(container)
        const filePath = window.services.saveText(htmlContent, `${session.name || 'session'}.html`)
        if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出 HTML') }
      } catch (e) {
        console.error('Export HTML failed:', e)
        showSnackbar('导出 HTML 失败: ' + e.message, 'error')
      }
    })
  } else if (format === 'image') {
    showSnackbar('正在生成长图...')
    nextTick(async () => {
      try {
        const container = await prepareExportClone(session, opts)
        if (!container) return
        document.body.appendChild(container)

        await new Promise(r => setTimeout(r, 200))

        const totalHeight = container.scrollHeight
        const width = 860

        const html2canvas = (await import('html2canvas')).default
        const MAX_SLICE = 8000
        const sliceCount = Math.ceil(totalHeight / MAX_SLICE)

        if (sliceCount <= 1) {
          const canvas = await html2canvas(container, { useCORS: true, scale: 2, logging: false, width, height: totalHeight, windowWidth: width, windowHeight: totalHeight })
          document.body.removeChild(container)
          saveCanvasAsImage(canvas)
        } else {
          const finalCanvas = document.createElement('canvas')
          finalCanvas.width = width * 2
          finalCanvas.height = totalHeight * 2
          const ctx = finalCanvas.getContext('2d')
          for (let i = 0; i < sliceCount; i++) {
            const y = i * MAX_SLICE
            const h = Math.min(MAX_SLICE, totalHeight - y)
            const sliceCanvas = await html2canvas(container, { useCORS: true, scale: 2, logging: false, width, height: h, windowWidth: width, windowHeight: h, x: 0, y })
            ctx.drawImage(sliceCanvas, 0, y * 2)
          }
          document.body.removeChild(container)
          saveCanvasAsImage(finalCanvas)
        }
      } catch (e) {
        console.error('Export image failed:', e)
        showSnackbar('导出长图失败: ' + e.message, 'error')
      }
    })
  }
}

function saveCanvasAsImage(canvas) {
  canvas.toBlob(blob => {
    if (!blob) { showSnackbar('生成长图失败', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      const filePath = window.services.saveImage(base64, 'png')
      if (filePath) { window.utools.shellShowItemInFolder(filePath); showSnackbar('已导出长图') }
    }
    reader.readAsDataURL(blob)
  }, 'image/png')
}

defineExpose({ contentBodyRef, isScrolledToBottom, scrollToEnd })
</script>

<template>
  <template v-if="session">
    <div class="content-header">
      <div class="content-header-top">
        <button class="resume-btn" @click="emit('toggle-favorite', session)" :title="session.isFavorite ? '取消收藏' : '收藏'">
          <IconStar v-if="session.isFavorite" :size="14" style="color: #ff9800" />
          <IconStarOutline v-else :size="14" />
        </button>
        <h3>{{ session.name }}</h3>
        <button class="resume-btn" @click="emit('rename', session)" title="重命名">
          <IconEdit :size="13" />
        </button>
      </div>
      <div class="content-header-sub">
        <span class="content-cwd">{{ session.sessionId || session.cwd }}</span>
        <button v-if="session.sessionId" class="resume-btn" @click="emit('resume')" title="在终端中恢复会话">
          <IconTerminal />
        </button>
        <button v-if="session.sessionId" class="resume-btn" @click="copyResumeCommand" title="复制恢复命令">
          <IconCopy :size="13" />
        </button>
        <div style="flex:1"></div>
        <button class="header-action-btn" @click="openSearch" title="搜索 (Ctrl+F)">
          <IconSearch :size="14" />
        </button>
        <div class="more-wrapper">
          <button class="header-action-btn" @click="showMoreMenu = !showMoreMenu" title="更多">
            <IconMore :size="14" />
          </button>
          <div v-if="showMoreMenu" class="more-menu">
            <button @click="openSessionDir">
              <IconFolder :size="13" />
              <span>打开源文件目录</span>
            </button>
            <div class="menu-divider"></div>
            <div class="menu-sub-wrapper" @mouseenter="showShareMenu = true" @mouseleave="showShareMenu = false">
              <button class="menu-sub-trigger">
                <IconExport :size="13" />
                <span>分享</span>
                <span class="menu-arrow">▸</span>
              </button>
              <div v-if="showShareMenu" class="menu-sub">
                <button @click="doExport('md')">导出 Markdown</button>
                <button @click="doExport('html')">导出 HTML</button>
                <button @click="doExport('image')">导出长图</button>
              </div>
            </div>
            <div class="menu-divider"></div>
            <button class="menu-danger" @click="confirmDelete">
              <IconDelete :size="13" />
              <span>删除会话</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- 搜索栏 -->
    <div v-if="searchVisible" class="session-search-bar">
      <input
        class="session-search-input"
        v-model="searchText"
        placeholder="搜索内容..."
        @input="doSearch"
        @keyup.enter.exact="nextMatch"
        @keyup.enter.shift="prevMatch"
        @keyup.escape="closeSearch"
        ref="searchInputRef"
      />
      <button class="search-opt-btn" :class="{ active: caseSensitive }" @click="caseSensitive = !caseSensitive; doSearch()" title="区分大小写">Aa</button>
      <button class="search-opt-btn" :class="{ active: wholeWord }" @click="wholeWord = !wholeWord; doSearch()" title="全字匹配">Ab|</button>
      <button class="search-opt-btn" :class="{ active: useRegex }" @click="useRegex = !useRegex; doSearch()" title="正则表达式">.*</button>
      <span v-if="matchCount > 0" class="search-count">{{ matchIndex + 1 }}/{{ matchCount }}</span>
      <span v-else-if="searchText" class="search-count">0</span>
      <button class="search-nav-btn" @click="prevMatch" title="上一个 (Shift+F3)">▲</button>
      <button class="search-nav-btn" @click="nextMatch" title="下一个 (F3)">▼</button>
      <button class="search-nav-btn" @click="closeSearch" title="关闭 (Esc)"><IconClose :size="14" /></button>
    </div>
    <div class="content-body" ref="contentBodyRef">
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
      </div>
      <template v-else-if="displayMessages.length > 0">
        <template v-for="item in displayMessages" :key="item.uuid">
        <!-- 系统事件：中断 → 分隔线，通知 → 气泡 -->
        <div v-if="item.isSystemEvent && item.systemEventType === 'interrupt'" class="system-event">
          <div class="system-event-line"></div>
          <div class="system-event-content">
            <IconStop :size="12" />
            <span>用户中断了请求</span>
            <span class="system-event-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="system-event-line"></div>
        </div>
        <div v-else-if="item.isSystemEvent" class="message message-system-notify">
          <div class="message-header">
            <span class="role-badge role-system-notify">系统</span>
            <span class="message-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="message-blocks">
            <template v-for="(block, idx) in mergeToolBlocks(parseContentBlocks(item))" :key="idx">
              <template v-if="block.type === 'text'">
                <template v-if="hasXmlTags(block.text)">
                  <template v-for="(seg, si) in parseTextSegments(block.text)" :key="si">
                    <div v-if="seg.type === 'plain'" class="block-text">{{ seg.text }}</div>
                    <div v-else class="xml-tag-block" :class="'xml-' + seg.style">
                      <span class="xml-tag-label">{{ seg.label }}</span>
                      <span v-if="seg.text" class="xml-tag-content">{{ seg.text }}</span>
                    </div>
                  </template>
                </template>
                <div v-else class="block-text">{{ block.text }}</div>
              </template>
              <div v-else-if="block.type === 'tool_result'" class="tool-card">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-result-' + idx)">
                  <span class="block-tag tag-result">Result</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-result-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-result-' + idx)" class="tool-card-body">
                  <div class="tool-card-section"><div class="tool-card-code">{{ block.content }}</div></div>
                </div>
              </div>
            </template>
          </div>
        </div>
        <!-- 普通消息 -->
        <div v-else
          class="message"
          :class="[('message-' + getMessageRole(item)), { 'message-api-error': item.isApiErrorMessage }]"
        >
          <div class="message-header">
            <span class="role-badge" :class="item.isApiErrorMessage ? 'role-error' : ('role-' + getMessageRole(item))">
              {{ item.isApiErrorMessage ? '错误' : getRoleLabel(getMessageRole(item)) }}
            </span>
            <span class="message-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <div class="message-blocks">
            <template v-for="(block, idx) in mergeToolBlocks(parseContentBlocks(item))" :key="idx">
              <!-- 中断提示 -->
              <div v-if="block.type === 'text' && /^\[Request interrupted by user/.test(block.text)" class="block-interrupted">
                <IconStop />
                用户中断了请求
              </div>
              <!-- 文本（可能包含 XML 标签） -->
              <template v-else-if="block.type === 'text'">
                <template v-if="hasXmlTags(block.text)">
                  <template v-for="(seg, si) in parseTextSegments(block.text)" :key="si">
                    <div v-if="seg.type === 'plain' && getMessageRole(item) === 'assistant'" class="md-content" v-html="renderMarkdown(seg.text)"></div>
                    <div v-else-if="seg.type === 'plain'" class="block-text">{{ seg.text }}</div>
                    <div v-else class="xml-tag-block" :class="'xml-' + seg.style">
                      <span class="xml-tag-label">{{ seg.label }}</span>
                      <span v-if="seg.text" class="xml-tag-content">{{ seg.text }}</span>
                    </div>
                  </template>
                </template>
                <div v-else-if="getMessageRole(item) === 'assistant'" class="md-content" v-html="renderMarkdown(block.text)"></div>
                <div v-else class="block-text">{{ block.text }}</div>
              </template>

              <!-- 思考过程 -->
              <div v-else-if="block.type === 'thinking'" class="block-thinking">
                <div class="block-header clickable" @click="toggleCollapse(item.uuid + '-thinking-' + idx)">
                  <span class="block-tag tag-thinking">Thinking</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-thinking-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-thinking-' + idx)" class="block-body">{{ block.text }}</div>
              </div>

              <!-- 命令注入提示词（isMeta），默认折叠 -->
              <div v-else-if="block.type === 'meta'" class="block-thinking">
                <div class="block-header clickable" @click="toggleCollapse(item.uuid + '-meta-' + idx)">
                  <span class="block-tag tag-meta">Prompt</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-meta-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-meta-' + idx)" class="block-body">{{ block.text }}</div>
              </div>

              <!-- 工具调用（含结果） -->
              <div v-else-if="block.type === 'tool_call'" class="tool-card" :class="{ 'tool-error': block.isError }">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-tool-' + idx)">
                  <span class="block-tag" :class="block.isError ? 'tag-error' : 'tag-tool'">{{ block.name }}</span>
                  <span v-if="getToolSummary(block.name, block.input)" class="tool-summary" :data-full-path="block.input?.file_path || block.input?.path || ''">{{ getToolSummary(block.name, block.input) }}</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-tool-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-tool-' + idx)" class="tool-card-body">
                  <!-- Edit diff view -->
                  <template v-if="block.name === 'Edit' && block.input?.old_string">
                    <div class="diff-view">
                      <div class="diff-stats">
                        <span class="diff-stat-add">+{{ getDiff(block).added }} added</span>
                        <span class="diff-stat-del">-{{ getDiff(block).removed }} removed</span>
                        <span v-if="block.input.replace_all" class="diff-meta">replace_all</span>
                      </div>
                      <div v-for="(line, li) in getDiff(block).lines" :key="li" class="diff-line" :class="'diff-' + line.type">
                        <span class="diff-sign">{{ line.sign }}</span>
                        <span class="diff-text"><template v-for="(part, pi) in line.parts" :key="pi"><span v-if="part.hl" class="diff-hl">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="tool-card-section">
                      <div class="tool-card-code">{{ formatToolInput(block.input) }}</div>
                    </div>
                  </template>
                  <div v-if="block.result !== null" class="tool-card-section">
                    <div class="tool-card-code" :class="{ 'error-text': block.isError }">{{ block.result }}</div>
                  </div>
                </div>
              </div>

              <!-- 未匹配的独立工具结果 -->
              <div v-else-if="block.type === 'tool_result'" class="tool-card" :class="{ 'tool-error': block.isError }">
                <div class="tool-card-header clickable" @click="toggleCollapse(item.uuid + '-result-' + idx)">
                  <span class="block-tag" :class="block.isError ? 'tag-error' : 'tag-result'">{{ block.isError ? 'Error' : 'Result' }}</span>
                  <span class="collapse-icon">{{ isCollapsed(item.uuid + '-result-' + idx) ? '▸' : '▾' }}</span>
                </div>
                <div v-if="!isCollapsed(item.uuid + '-result-' + idx)" class="tool-card-body">
                  <div class="tool-card-section">
                    <div class="tool-card-code">{{ block.content }}</div>
                  </div>
                </div>
              </div>

              <!-- 图片 -->
              <div v-else-if="block.type === 'image'">
                <template v-if="block.source?.type === 'base64'">
                  <img
                    :src="'data:' + (block.source.media_type || 'image/png') + ';base64,' + block.source.data"
                    class="inline-image"
                    @click="$emit('preview-image', 'data:' + (block.source.media_type || 'image/png') + ';base64,' + block.source.data, block.source.media_type || 'image/png')"
                  />
                </template>
                <span v-else class="muted">[图片]</span>
              </div>

              <!-- 未知类型 -->
              <div v-else class="block-unknown">
                <span class="muted">[{{ block.type }}]</span>
              </div>
            </template>
          </div>
          <!-- AI 用量统计 -->
          <div v-if="getMessageRole(item) === 'assistant' && item._stats && item._stats.output_tokens" class="message-stats">
            <span v-if="item._stats.model" class="stat-item">{{ item._stats.model }}</span>
            <span class="stat-item" title="输入 / 输出 tokens">{{ item._stats.input_tokens + item._stats.cache_read }} + {{ item._stats.output_tokens }} tokens</span>
            <span v-if="item._stats.cache_read" class="stat-item" title="缓存读取">cache {{ item._stats.cache_read }}</span>
            <span v-if="item._stats.durationMs" class="stat-item">{{ (item._stats.durationMs / 1000).toFixed(1) }}s</span>
            <span v-if="item._stats.stop_reason" class="stat-item">{{ item._stats.stop_reason }}</span>
          </div>
          <!-- 悬浮操作按钮 -->
          <div class="message-actions">
            <button class="msg-action-btn" @click="copyMessageText(item)" title="复制文本">
              <IconCopy :size="12" />
            </button>
            <button v-if="getMessageRole(item) === 'assistant'" class="msg-action-btn" @click="emit('fork', item)" title="从此处分叉创建新会话">
              <IconFork :size="12" />
            </button>
          </div>
        </div>
        </template>
      </template>
      <div v-else class="empty-content">会话内容为空</div>
    </div>
    <!-- 滚动按钮 -->
    <div class="scroll-buttons">
      <button class="scroll-btn" @click="scrollToTop" title="滚动到顶部">
        <IconChevronUp />
      </button>
      <button class="scroll-btn" @click="scrollToBottom" title="滚动到底部">
        <IconChevronDown />
      </button>
    </div>
  </template>
  <!-- 未选择会话 -->
  <div v-else class="empty-main">
    <IconChat :size="64" style="opacity: 0.2" />
    <p>选择一个会话查看详情</p>
  </div>

  <!-- 导出选项对话框 -->
  <ExportOptionsDialog
    :show="exportDialog.show"
    :format="exportDialog.format"
    @confirm="doExportWithOptions"
    @cancel="exportDialog.show = false"
  />
</template>

<style scoped>
.content-header {
  padding: 4px 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fff;
}
:global(.dark .content-header) {
  background: #1e1e1e;
  border-color: #333;
}
.content-header-top {
  display: flex;
  align-items: center;
}
.content-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
.content-header-sub {
  display: flex;
  align-items: center;
}
.content-cwd {
  font-size: 11px;
  opacity: 0.5;
}
.resume-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  margin-left: 4px;
}
.resume-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .resume-btn:hover) {
  background: rgba(255,255,255,0.08);
}

/* Header action buttons */
.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
}
.header-action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .header-action-btn:hover) {
  background: rgba(255,255,255,0.08);
}
.more-wrapper {
  position: relative;
}
.more-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  overflow: visible;
  min-width: 160px;
  padding: 4px 0;
}
:global(.dark .more-menu) {
  background: #2a2a2a;
  border-color: #444;
}
.more-menu button, .menu-sub-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.more-menu button:hover, .menu-sub-trigger:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .more-menu button:hover), :global(.dark .menu-sub-trigger:hover) {
  background: rgba(255,255,255,0.06);
}
.menu-danger { color: #d32f2f !important; }
:global(.dark .menu-danger) { color: #ef9a9a !important; }
.menu-divider {
  height: 1px;
  background: rgba(0,0,0,0.08);
  margin: 4px 0;
}
:global(.dark .menu-divider) {
  background: rgba(255,255,255,0.08);
}
.menu-sub-wrapper {
  position: relative;
}
.menu-arrow {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.5;
}
.menu-sub {
  position: absolute;
  right: 100%;
  top: -4px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  min-width: 140px;
  padding: 4px 0;
}
:global(.dark .menu-sub) {
  background: #2a2a2a;
  border-color: #444;
}
.menu-sub button {
  display: block;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-sub button:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .menu-sub button:hover) {
  background: rgba(255,255,255,0.06);
}

/* Session search bar */
.session-search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
}
:global(.dark .session-search-bar) {
  background: #1e1e1e;
  border-color: #333;
}
.session-search-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  outline: none;
  background: inherit;
  color: inherit;
  font-family: inherit;
}
.session-search-input:focus {
  border-color: #1976d2;
}
:global(.dark .session-search-input) {
  border-color: #444;
}
:global(.dark .session-search-input:focus) {
  border-color: #90caf9;
}
.search-count {
  font-size: 12px;
  opacity: 0.5;
  white-space: nowrap;
}
.search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  font-size: 10px;
}
.search-nav-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
.search-opt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 5px;
  border: 1px solid transparent;
  background: none;
  border-radius: 3px;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.search-opt-btn:hover {
  opacity: 0.7;
  background: rgba(0,0,0,0.04);
}
.search-opt-btn.active {
  opacity: 1;
  color: #1976d2;
  border-color: #1976d2;
  background: rgba(25,118,210,0.08);
}
:global(.dark .search-opt-btn.active) {
  color: #90caf9;
  border-color: #90caf9;
  background: rgba(144,202,249,0.12);
}

.content-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.message {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
  position: relative;
}
.message-user {
  background: rgba(25, 118, 210, 0.1);
}
.message-assistant {
  background: rgba(0, 0, 0, 0.03);
}
.message-system {
  background: rgba(0, 0, 0, 0.04);
  opacity: 0.6;
}
.message-system-notify {
  background: rgba(255, 152, 0, 0.08);
  border-left: 3px solid #ff9800;
}
:global(.dark .message-user) {
  background: rgba(144, 202, 249, 0.12);
}
:global(.dark .message-assistant) {
  background: rgba(255, 255, 255, 0.04);
}
:global(.dark .message-system) {
  background: rgba(255, 255, 255, 0.05);
}
:global(.dark .message-system-notify) {
  background: rgba(255, 152, 0, 0.1);
  border-left-color: rgba(255, 152, 0, 0.6);
}
.message-api-error {
  background: rgba(211, 47, 47, 0.06);
  border-left: 3px solid #d32f2f;
}
.message-api-error .block-text,
.message-api-error .md-content {
  color: #d32f2f;
}
:global(.dark .message-api-error) {
  background: rgba(239, 154, 154, 0.08);
  border-left-color: #ef9a9a;
}
:global(.dark .message-api-error .block-text),
:global(.dark .message-api-error .md-content) {
  color: #ef9a9a;
}
.role-error {
  background: #d32f2f;
  color: #fff;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.role-badge {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.role-user {
  background: #1976d2;
  color: #fff;
}
.role-assistant {
  background: #e0e0e0;
  color: #333;
}
:global(.dark .role-assistant) {
  background: #444;
  color: #e0e0e0;
}
.role-system-notify {
  background: #ff9800;
  color: #fff;
}
.role-badge:not(.role-user):not(.role-assistant):not(.role-system-notify) {
  background: rgba(0,0,0,0.1);
}
:global(.dark .role-badge:not(.role-user):not(.role-assistant):not(.role-system-notify)) {
  background: rgba(255,255,255,0.15);
}
.message-time {
  font-size: 12px;
  opacity: 0.5;
}

.message-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid rgba(0,0,0,0.05);
  font-size: 11px;
  opacity: 0.45;
}
:global(.dark .message-stats) {
  border-top-color: rgba(255,255,255,0.06);
}
.stat-item {
  white-space: nowrap;
}

.message-actions {
  display: none;
  position: sticky;
  bottom: 90px;
  float: right;
  gap: 2px;
  background: rgba(255,255,255,0.92);
  border-radius: 6px;
  padding: 2px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.12);
  z-index: 10;
  margin-top: -28px;
  margin-right: 4px;
}
:global(.dark .message-actions) {
  background: rgba(40,40,40,0.92);
  box-shadow: 0 1px 6px rgba(0,0,0,0.3);
}
.message:hover .message-actions {
  display: flex;
}
.msg-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.5;
  padding: 4px;
  border-radius: 3px;
  width: 24px;
  height: 24px;
}
.msg-action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.08);
}
:global(.dark .msg-action-btn:hover) {
  background: rgba(255,255,255,0.1);
}

.message-blocks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.block-text {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.block-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.block-header.clickable {
  cursor: pointer;
  user-select: none;
}
.block-header.clickable:hover .block-tag {
  filter: brightness(1.1);
}
.tool-summary {
  font-size: 12px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.collapse-icon {
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}
.block-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid;
}
.tag-thinking { color: #78909c; border-color: #b0bec5; background: rgba(120,144,156,0.08); }
.tag-tool { color: #546e7a; border-color: #90a4ae; background: rgba(84,110,122,0.06); }
.tag-result { color: #558b2f; border-color: #aed581; background: rgba(85,139,47,0.06); }
.tag-error { color: #d32f2f; border-color: #ef9a9a; background: rgba(211,47,47,0.06); }
.tag-meta { color: #7b1fa2; border-color: #ce93d8; background: rgba(156,39,176,0.08); }
:global(.dark .tag-thinking) { color: #90a4ae; border-color: #546e7a; background: rgba(144,164,174,0.1); }
:global(.dark .tag-tool) { color: #b0bec5; border-color: #546e7a; background: rgba(176,190,197,0.08); }
:global(.dark .tag-result) { color: #a5d6a7; border-color: #4a6e4b; background: rgba(165,214,167,0.08); }
:global(.dark .tag-error) { color: #ef9a9a; border-color: #7a3333; background: rgba(239,154,154,0.1); }
:global(.dark .tag-meta) { color: #ce93d8; border-color: #7b1fa2; background: rgba(206,147,216,0.1); }

.block-body {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow: auto;
  background: rgba(0,0,0,0.04);
}
:global(.dark .block-body) {
  background: rgba(255,255,255,0.05);
}

.tool-card {
  border-left: 2px solid rgba(0,0,0,0.12);
  border-radius: 0 6px 6px 0;
  background: rgba(0, 0, 0, 0.02);
  overflow: hidden;
}
.tool-card.tool-error {
  border-left-color: rgba(211, 47, 47, 0.4);
  background: rgba(211, 47, 47, 0.03);
}
:global(.dark .tool-card) {
  border-left-color: rgba(255,255,255,0.12);
  background: rgba(255, 255, 255, 0.03);
}
:global(.dark .tool-card.tool-error) {
  border-left-color: rgba(239, 154, 154, 0.3);
  background: rgba(239, 154, 154, 0.05);
}
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  user-select: none;
}
.tool-card-header:hover {
  background: rgba(0,0,0,0.03);
}
:global(.dark .tool-card-header:hover) {
  background: rgba(255,255,255,0.04);
}
.tool-card-body {
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-left: 22px;
}
:global(.dark .tool-card-body) {
  border-top-color: rgba(255,255,255,0.08);
}
.tool-card-section + .tool-card-section {
  border-top: 1px dashed rgba(0,0,0,0.08);
}
:global(.dark .tool-card-section + .tool-card-section) {
  border-top-color: rgba(255,255,255,0.08);
}
.tool-card-code {
  padding: 8px 10px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow: auto;
}

/* Diff */
.diff-view {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
  max-height: 500px;
}
.diff-stats {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  font-size: 11px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
:global(.dark .diff-stats) {
  border-bottom-color: rgba(255,255,255,0.08);
}
.diff-stat-add { color: #2e7d32; font-weight: 600; }
.diff-stat-del { color: #d32f2f; font-weight: 600; }
:global(.dark .diff-stat-add) { color: #81c784; }
:global(.dark .diff-stat-del) { color: #ef9a9a; }
.diff-meta { opacity: 0.5; }
.diff-ctx { opacity: 0.7; }
.diff-line {
  display: flex;
  white-space: pre;
}
.diff-sign {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
  font-weight: 600;
}
.diff-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  padding-right: 10px;
}
.diff-del {
  background: rgba(255, 0, 0, 0.08);
}
.diff-del .diff-sign { color: #d32f2f; }
:global(.dark .diff-del .diff-sign) { color: #ef9a9a; }
.diff-add {
  background: rgba(0, 160, 0, 0.08);
}
.diff-add .diff-sign { color: #2e7d32; }
:global(.dark .diff-add .diff-sign) { color: #81c784; }
.diff-hl { border-radius: 2px; }
.diff-del .diff-hl { background: rgba(255, 0, 0, 0.2); }
.diff-add .diff-hl { background: rgba(0, 160, 0, 0.2); }
:global(.dark .diff-del) { background: rgba(255, 80, 80, 0.1); }
:global(.dark .diff-add) { background: rgba(80, 200, 80, 0.1); }
:global(.dark .diff-del .diff-hl) { background: rgba(255, 80, 80, 0.25); }
:global(.dark .diff-add .diff-hl) { background: rgba(80, 200, 80, 0.25); }

.error-text { color: #d32f2f; }
:global(.dark .error-text) { color: #ef9a9a; }

.inline-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
  margin-top: 4px;
  display: block;
  cursor: zoom-in;
  transition: opacity 0.15s;
}
.inline-image:hover { opacity: 0.85; }

/* System events (interruptions, notifications) */
.system-event {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0;
  user-select: none;
}
.system-event-line {
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
}
:global(.dark .system-event-line) {
  background: rgba(255, 255, 255, 0.08);
}
.system-event-content {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #e65100;
  white-space: nowrap;
  flex-shrink: 0;
}
:global(.dark .system-event-content) {
  color: #ffb74d;
}
.system-event-text {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.system-event-time {
  opacity: 0.5;
  font-size: 11px;
}

.block-interrupted {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #e65100;
  background: rgba(255, 152, 0, 0.1);
  border: 1px dashed #ff9800;
  border-radius: 6px;
  padding: 4px 10px;
}
:global(.dark .block-interrupted) {
  color: #ffb74d;
  background: rgba(255, 152, 0, 0.12);
  border-color: rgba(255, 152, 0, 0.4);
}
.muted {
  font-size: 13px;
  opacity: 0.5;
}

/* XML tag blocks */
.xml-tag-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  border-left: 3px solid;
}
.xml-tag-label {
  font-size: 11px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.7;
}
.xml-tag-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px;
}
.xml-caveat { background: rgba(255, 152, 0, 0.08); border-color: #ff9800; }
.xml-caveat .xml-tag-label { background: rgba(255, 152, 0, 0.15); color: #e65100; }
:global(.dark .xml-caveat) { background: rgba(255, 152, 0, 0.1); }
:global(.dark .xml-caveat .xml-tag-label) { color: #ffb74d; background: rgba(255, 152, 0, 0.2); }
.xml-stdout { background: rgba(76, 175, 80, 0.06); border-color: #4caf50; }
.xml-stdout .xml-tag-label { background: rgba(76, 175, 80, 0.12); color: #2e7d32; }
:global(.dark .xml-stdout) { background: rgba(76, 175, 80, 0.08); }
:global(.dark .xml-stdout .xml-tag-label) { color: #81c784; background: rgba(76, 175, 80, 0.18); }
.xml-stderr { background: rgba(244, 67, 54, 0.06); border-color: #f44336; }
.xml-stderr .xml-tag-label { background: rgba(244, 67, 54, 0.12); color: #c62828; }
:global(.dark .xml-stderr) { background: rgba(244, 67, 54, 0.08); }
:global(.dark .xml-stderr .xml-tag-label) { color: #ef9a9a; background: rgba(244, 67, 54, 0.18); }
.xml-bash-input { background: rgba(33, 33, 33, 0.06); border-color: #616161; }
.xml-bash-input .xml-tag-label { background: rgba(33, 33, 33, 0.1); color: #424242; }
:global(.dark .xml-bash-input) { background: rgba(255, 255, 255, 0.06); border-color: #9e9e9e; }
:global(.dark .xml-bash-input .xml-tag-label) { color: #bdbdbd; background: rgba(255, 255, 255, 0.1); }
.xml-command { background: rgba(33, 150, 243, 0.06); border-color: #2196f3; }
.xml-command .xml-tag-label { background: rgba(33, 150, 243, 0.12); color: #1565c0; }
:global(.dark .xml-command) { background: rgba(33, 150, 243, 0.08); }
:global(.dark .xml-command .xml-tag-label) { color: #90caf9; background: rgba(33, 150, 243, 0.18); }
.xml-ide { background: rgba(156, 39, 176, 0.06); border-color: #9c27b0; }
.xml-ide .xml-tag-label { background: rgba(156, 39, 176, 0.12); color: #7b1fa2; }
:global(.dark .xml-ide) { background: rgba(156, 39, 176, 0.08); }
:global(.dark .xml-ide .xml-tag-label) { color: #ce93d8; background: rgba(156, 39, 176, 0.18); }
.xml-task { background: rgba(0, 150, 136, 0.06); border-color: #009688; }
.xml-task .xml-tag-label { background: rgba(0, 150, 136, 0.12); color: #00695c; }
:global(.dark .xml-task) { background: rgba(0, 150, 136, 0.08); }
:global(.dark .xml-task .xml-tag-label) { color: #80cbc4; background: rgba(0, 150, 136, 0.18); }

/* Loading & scroll */
.loading {
  display: flex;
  justify-content: center;
  padding: 40px;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
:global(.dark .spinner) {
  border-color: rgba(255,255,255,0.1);
  border-top-color: #90caf9;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.scroll-buttons {
  position: absolute;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scroll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.08);
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.scroll-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.14);
}
:global(.dark .scroll-btn) {
  background: rgba(255,255,255,0.1);
}
:global(.dark .scroll-btn:hover) {
  background: rgba(255,255,255,0.18);
}

.empty-content, .empty-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  opacity: 0.5;
}
.empty-main p {
  margin-top: 12px;
  font-size: 16px;
}
</style>
