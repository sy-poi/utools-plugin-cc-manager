<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { IconSettings, IconSearch, IconClose, IconCollapseAll, IconExpandAll, IconRefresh, IconFolder, IconOpenExternal, IconFile, IconEdit, IconDelete, IconSun, IconMoon, IconStar, IconStarOutline, IconCheckbox, IconCheckboxChecked, IconSubagent, IconMore, IconTerminal } from './icons'
import { useTheme } from '../composables/useTheme'
import { useSnackbar } from '../composables/useSnackbar'
import { formatTime, formatSize, shortenPath } from '../composables/useFormat'

const props = defineProps({
  projects: Array,
  expandedProjects: Object,
  selectedSession: Object,
  searchQuery: String,
  collapsed: Boolean,
  projectsLoaded: Boolean
})

const emit = defineEmits([
  'update:searchQuery',
  'toggle-project',
  'toggle-all',
  'select-session',
  'rename-session',
  'delete-session',
  'open-project-dir',
  'refresh',
  'open-settings',
  'batch-delete',
  'open-session-window',
  'resume-session'
])

const { isDark, toggleTheme } = useTheme()
const { showSnackbar } = useSnackbar()

// Multi-select mode
const multiSelectMode = ref(false)
const selectedPaths = ref(new Set())

function toggleMultiSelect() {
  multiSelectMode.value = !multiSelectMode.value
  if (!multiSelectMode.value) selectedPaths.value = new Set()
}

function toggleSelect(session) {
  if (!multiSelectMode.value) multiSelectMode.value = true
  const s = new Set(selectedPaths.value)
  if (s.has(session.path)) {
    s.delete(session.path)
    if (s.size === 0) multiSelectMode.value = false
  } else {
    s.add(session.path)
  }
  selectedPaths.value = s
}

function batchDelete() {
  if (selectedPaths.value.size === 0) return
  emit('batch-delete', [...selectedPaths.value])
}

function clearMultiSelect() {
  selectedPaths.value = new Set()
  multiSelectMode.value = false
}

function expandSubagents(sessionPath) {
  if (!sessionPath) return
  const s = new Set(expandedSubagents.value)
  s.add(sessionPath)
  expandedSubagents.value = s
}

defineExpose({ clearMultiSelect, expandSubagents })

// Subagent expand/collapse
const expandedSubagents = ref(new Set())
function toggleSubagents(sessionPath) {
  const s = new Set(expandedSubagents.value)
  if (s.has(sessionPath)) s.delete(sessionPath)
  else s.add(sessionPath)
  expandedSubagents.value = s
}

// Favorite toggle
function toggleFavorite(session, event) {
  event.stopPropagation()
  const result = window.services.toggleFavorite(session.path)
  if (result.success) emit('refresh')
}

// Session item dropdown menu
const sidebarMenu = ref({ session: null, style: {} })

function openMenu(session, event) {
  event.stopPropagation()
  if (event.type === 'contextmenu') {
    // 右键：菜单左边缘对齐鼠标，向右展开
    sidebarMenu.value = { session, style: { left: event.clientX + 'px', top: event.clientY + 'px' } }
  } else {
    // 按钮点击：菜单右边缘对齐按钮右侧
    const rect = event.currentTarget.getBoundingClientRect()
    sidebarMenu.value = { session, style: { right: (window.innerWidth - rect.right) + 'px', top: (rect.bottom + 4) + 'px' } }
  }
}

function closeMenu() {
  sidebarMenu.value.session = null
}

function menuOpenWindow() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('open-session-window', s)
}

function menuResume() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('resume-session', s)
}

function menuToggleFavorite() {
  const s = sidebarMenu.value.session; closeMenu()
  const result = window.services.toggleFavorite(s.path)
  if (result.success) emit('refresh')
}

function menuRename() {
  const s = sidebarMenu.value.session; closeMenu()
  emit('rename-session', s)
}

function menuDelete(event) {
  const s = sidebarMenu.value.session; closeMenu()
  emit('delete-session', s, event)
}

const ctrlHeld = ref(false)
function onKeyDown(e) { if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.value = true }
function onKeyUp(e) { if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.value = false }

onMounted(() => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
})
onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
})

const allExpanded = computed(() => {
  return props.projects.length > 0 && props.projects.every(p => props.expandedProjects[p.name])
})

const filteredProjects = computed(() => {
  const q = (props.searchQuery || '').trim().toLowerCase()
  let result = props.projects
  if (q) {
    result = result.map(project => {
      const sessions = project.sessions.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.sessionId && s.sessionId.toLowerCase().includes(q)) ||
        (s.cwd && s.cwd.toLowerCase().includes(q))
      )
      if (project.displayName.toLowerCase().includes(q)) return project
      if (sessions.length === 0) return null
      return { ...project, sessions }
    }).filter(Boolean)
  }
  // Sort favorited sessions to top within each project
  return result.map(p => ({
    ...p,
    sessions: [...p.sessions].sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0)),
  }))
})
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-header">
      <h2>会话管理</h2>
      <div class="header-actions">
        <button class="icon-btn" @click="toggleTheme" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
          <IconSun v-if="isDark" />
          <IconMoon v-else />
        </button>
        <button class="icon-btn" @click="emit('open-settings')" title="设置">
          <IconSettings />
        </button>
      </div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="search-bar">
      <div class="search-box">
        <IconSearch class="search-icon" />
        <input
          class="search-input"
          :value="searchQuery"
          @input="emit('update:searchQuery', $event.target.value)"
          placeholder="搜索会话..."
        />
        <button v-if="searchQuery" class="search-clear" @click="emit('update:searchQuery', '')">
          <IconClose :size="14" />
        </button>
      </div>
      <button class="icon-btn-sm" @click="emit('toggle-all')" :title="allExpanded ? '全部收起' : '全部展开'">
        <IconCollapseAll v-if="allExpanded" />
        <IconExpandAll v-else />
      </button>
      <button class="icon-btn-sm" @click="emit('refresh')" title="刷新">
        <IconRefresh />
      </button>
    </div>
    <!-- 多选操作栏 -->
    <div v-if="multiSelectMode" class="multi-select-bar">
      <span>已选 {{ selectedPaths.size }} 项</span>
      <button class="batch-delete-btn" :disabled="selectedPaths.size === 0" @click="batchDelete">批量删除</button>
      <button class="batch-cancel-btn" @click="toggleMultiSelect">取消</button>
    </div>
    <div class="sidebar-list">
      <template v-if="filteredProjects.length > 0">
        <div v-for="project in filteredProjects" :key="project.name" class="project-group">
          <div class="project-item" @click="emit('toggle-project', project.name)">
            <span class="expand-icon">{{ expandedProjects[project.name] ? '▾' : '▸' }}</span>
            <IconFolder class="folder-icon" />
            <span class="project-name" :title="project.displayName">{{ shortenPath(project.displayName) }}</span>
            <span class="session-count">{{ project.sessionsLoaded ? project.sessions.length : project.sessionCount }}</span>
            <button v-if="project.cwd || project.sessions[0]?.cwd" class="project-open-btn" @click.stop="emit('open-project-dir', project)" title="打开目录">
              <IconOpenExternal />
            </button>
          </div>
          <div v-if="expandedProjects[project.name] || searchQuery?.trim()" class="session-list">
            <div v-if="project.sessionsLoading && project.sessions.length === 0" class="sessions-loading">
              <div class="sidebar-spinner"></div>
            </div>
            <template v-else-if="project.sessions.length > 0">
              <template v-for="session in project.sessions" :key="session.path">
              <div
                class="session-item"
                :class="{ selected: selectedSession?.path === session.path, 'has-subtoggle': session.subagents?.length }"
                @click="emit('select-session', session)"
                @contextmenu.prevent="openMenu(session, $event)"
              >
                <!-- 子对话展开箭头 / 对齐占位 -->
                <span
                  v-if="session.subagents?.length"
                  class="session-sub-toggle"
                  @click.stop="toggleSubagents(session.path)"
                  :title="expandedSubagents.has(session.path) ? '收起子对话' : '展开子对话'"
                >{{ expandedSubagents.has(session.path) ? '▾' : '▸' }}</span>
                <!-- 文件图标 / 复选框 -->
                <span v-if="multiSelectMode || selectedPaths.has(session.path)" class="multi-check" @click.stop="toggleSelect(session)">
                  <IconCheckboxChecked v-if="selectedPaths.has(session.path)" style="color: #1976d2" />
                  <IconCheckbox v-else />
                </span>
                <template v-else>
                  <IconFile class="session-icon session-icon-file" />
                  <span class="session-icon session-icon-check" @click.stop="toggleSelect(session)"><IconCheckbox /></span>
                </template>
                <div class="session-info">
                  <span class="session-name">
                    <IconStar v-if="session.isFavorite" class="fav-star" />
                    {{ session.name }}
                  </span>
                  <span class="session-meta">{{ formatSize(session.size) }} · {{ formatTime(session.timestamp) }}</span>
                </div>
                <div v-if="!multiSelectMode" class="session-actions">
                  <button class="action-btn" @click.stop="openMenu(session, $event)" title="更多操作">
                    <IconMore />
                  </button>
                </div>
              </div>
              <!-- 子对话列表 -->
              <template v-if="session.subagents?.length && expandedSubagents.has(session.path)">
                <div
                  v-for="sub in session.subagents"
                  :key="sub.path"
                  class="subagent-item"
                  :class="{ selected: selectedSession?.path === sub.path }"
                  @click="emit('select-session', sub)"
                >
                  <IconSubagent class="subagent-icon" />
                  <div class="session-info">
                    <span class="session-name">{{ sub.name }}</span>
                    <span class="session-meta">{{ formatSize(sub.size) }}</span>
                  </div>
                  <div class="session-actions">
                    <button class="action-btn" @click.stop="emit('open-session-window', sub)" title="新窗口打开">
                      <IconOpenExternal />
                    </button>
                  </div>
                </div>
              </template>
              </template>
            </template>
            <div v-else class="empty-sessions">暂无会话</div>
          </div>
        </div>
      </template>
      <div v-else-if="!projectsLoaded" class="empty-state">
        <div class="sidebar-spinner"></div>
        <p>加载中...</p>
      </div>
      <div v-else class="empty-state">
        <IconChat :size="48" style="opacity: 0.3" />
        <p>暂无项目</p>
        <small>请确保 .claude/projects 目录存在</small>
      </div>
    </div>
  </aside>

  <!-- 会话操作下拉菜单（fixed 定位，不受 overflow 裁剪） -->
  <Transition name="menu-fade">
    <div
      v-if="sidebarMenu.session"
      class="sidebar-item-menu"
      :style="sidebarMenu.style"
      @click.stop
    >
      <button @click="menuOpenWindow">
        <IconOpenExternal :size="13" />
        <span>新窗口打开</span>
      </button>
      <button v-if="sidebarMenu.session?.sessionId" @click="menuResume">
        <IconTerminal :size="13" />
        <span>在终端中恢复</span>
      </button>
      <button @click="menuToggleFavorite">
        <IconStar v-if="sidebarMenu.session.isFavorite" :size="13" style="color: #ff9800" />
        <IconStarOutline v-else :size="13" />
        <span>{{ sidebarMenu.session.isFavorite ? '取消收藏' : '收藏' }}</span>
      </button>
      <button @click="menuRename">
        <IconEdit :size="13" />
        <span>重命名</span>
      </button>
      <div class="sidebar-item-menu-divider"></div>
      <button class="menu-danger" :class="{ 'menu-danger-direct': ctrlHeld }" @click="menuDelete($event)">
        <IconDelete :size="13" />
        <span>{{ ctrlHeld ? '直接删除' : '删除' }}</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.sidebar {
  width: 320px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  flex-shrink: 0;
  transition: margin-left 0.2s;
  z-index: 20;
}
.sidebar.collapsed {
  margin-left: -320px;
}
:global(.dark .sidebar) {
  background: #1e1e1e;
  border-color: #333;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  min-height: 46px;
  box-sizing: border-box;
}
.sidebar-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.header-actions {
  display: flex;
  gap: 2px;
}
.sidebar-divider {
  height: 1px;
  background: #e0e0e0;
}
:global(.dark .sidebar-divider) {
  background: #333;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 4px 0;
}
.search-box {
  display: flex;
  align-items: center;
  flex: 1;
  margin: 0 0 0 8px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgba(0,0,0,0.04);
  gap: 6px;
}
:global(.dark .search-box) {
  background: rgba(255,255,255,0.06);
}
.search-icon {
  flex-shrink: 0;
  opacity: 0.4;
}
.search-input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  padding: 6px 0;
  color: inherit;
  font-family: inherit;
}
.search-input::placeholder {
  opacity: 0.4;
}
.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
  flex-shrink: 0;
}
.search-clear:hover {
  opacity: 0.8;
  background: rgba(0,0,0,0.08);
}
:global(.dark .search-clear:hover) {
  background: rgba(255,255,255,0.1);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}
.icon-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .icon-btn:hover) {
  background: rgba(255,255,255,0.08);
}

.icon-btn-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
  flex-shrink: 0;
}
.icon-btn-sm:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .icon-btn-sm:hover) {
  background: rgba(255,255,255,0.08);
}

.sidebar-list {
  flex: 1;
  overflow: auto;
  padding: 4px 8px;
}

.project-item {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  min-height: 34px;
  border-radius: 8px;
  cursor: pointer;
  gap: 6px;
  user-select: none;
  box-sizing: border-box;
}
.project-item:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .project-item:hover) {
  background: rgba(255,255,255,0.06);
}
.expand-icon {
  width: 16px;
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
  flex-shrink: 0;
}
.folder-icon {
  color: #1976d2;
  flex-shrink: 0;
}
:global(.dark .folder-icon) {
  color: #90caf9;
}
.project-name {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-count {
  font-size: 12px;
  background: rgba(0,0,0,0.08);
  padding: 0 8px;
  border-radius: 10px;
  flex-shrink: 0;
  height: 22px;
  line-height: 22px;
  box-sizing: border-box;
}
:global(.dark .session-count) {
  background: rgba(255,255,255,0.12);
}
.project-open-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.4;
  flex-shrink: 0;
}
.project-item:hover .project-open-btn {
  display: flex;
}
.project-item:hover .session-count {
  display: none;
}
.project-open-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.06);
}
:global(.dark .project-open-btn:hover) {
  background: rgba(255,255,255,0.08);
}

.session-list {
  padding-left: 10px;
}
.session-item {
  display: flex;
  align-items: center;
  padding: 6px 10px 6px 22px;
  border-radius: 8px;
  cursor: pointer;
  gap: 8px;
}
.session-item.has-subtoggle {
  padding-left: 0;
}
.session-item:hover {
  background: rgba(0,0,0,0.04);
}
:global(.dark .session-item:hover) {
  background: rgba(255,255,255,0.06);
}
.session-item.selected {
  background: rgba(25, 118, 210, 0.1);
}
:global(.dark .session-item.selected) {
  background: rgba(144, 202, 249, 0.15);
}
.session-icon {
  flex-shrink: 0;
  opacity: 0.5;
}
.session-icon-check {
  display: none;
  cursor: pointer;
}
.session-item:hover .session-icon-file {
  display: none;
}
.session-item:hover .session-icon-check {
  display: inline;
}
.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.session-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta {
  font-size: 11px;
  opacity: 0.6;
}
.session-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.session-item:hover .session-actions,
.subagent-item:hover .session-actions {
  display: flex;
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
  opacity: 0.5;
}
.action-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.08);
}
.action-btn.delete:hover {
  color: #d32f2f;
  background: rgba(211, 47, 47, 0.08);
}
:global(.dark .action-btn:hover) {
  background: rgba(255,255,255,0.1);
}
:global(.dark .action-btn.delete:hover) {
  color: #ef9a9a;
  background: rgba(239, 154, 154, 0.12);
}

.icon-btn-sm.active {
  opacity: 1;
  color: #1976d2;
}
.multi-select-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  background: rgba(25, 118, 210, 0.08);
  border-bottom: 1px solid rgba(25, 118, 210, 0.2);
}
.batch-delete-btn {
  border: none;
  background: #d32f2f;
  color: #fff;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.batch-delete-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.batch-cancel-btn {
  border: none;
  background: none;
  color: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
}
.batch-cancel-btn:hover {
  background: rgba(0,0,0,0.06);
}
.multi-check {
  flex-shrink: 0;
  cursor: pointer;
  opacity: 0.6;
}
.fav-star {
  color: #ff9800;
  vertical-align: -2px;
  margin-right: 2px;
}

.empty-sessions {
  padding: 6px 30px;
  font-size: 13px;
  opacity: 0.5;
}
.sessions-loading {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.session-sub-toggle {
  width: 14px;
  text-align: center;
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
  cursor: pointer;
  padding: 2px 0;
  line-height: 1;
}
.session-sub-toggle:hover {
  opacity: 1;
}
.subagent-item {
  display: flex;
  align-items: center;
  padding: 5px 10px 5px 36px;
  border-radius: 8px;
  cursor: pointer;
  gap: 8px;
}
.subagent-item:hover {
  background: rgba(0,0,0,0.04);
}
.subagent-item.selected {
  background: rgba(103, 58, 183, 0.1);
}
:global(.dark .subagent-item:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .subagent-item.selected) {
  background: rgba(179, 157, 219, 0.15);
}
.subagent-icon {
  flex-shrink: 0;
  color: #673ab7;
  opacity: 0.8;
}
:global(.dark .subagent-icon) {
  color: #b39ddb;
}
.sidebar-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: sidebar-spin 0.8s linear infinite;
}
:global(.dark .sidebar-spinner) {
  border-color: rgba(255,255,255,0.1);
  border-top-color: #90caf9;
}
@keyframes sidebar-spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}
.empty-state p {
  margin: 8px 0 4px;
  opacity: 0.5;
}
.empty-state small {
  opacity: 0.4;
  font-size: 12px;
}

.sidebar-item-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 148px;
  padding: 4px 0;
}
:global(.dark .sidebar-item-menu) {
  background: #2a2a2a;
  border-color: #444;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.sidebar-item-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.sidebar-item-menu button:hover {
  background: rgba(0,0,0,0.05);
}
:global(.dark .sidebar-item-menu button:hover) {
  background: rgba(255,255,255,0.07);
}
.sidebar-item-menu .menu-danger {
  color: #d32f2f;
}
:global(.dark .sidebar-item-menu .menu-danger) {
  color: #ef9a9a;
}
.sidebar-item-menu .menu-danger-direct {
  background: rgba(211, 47, 47, 0.08);
}
:global(.dark .sidebar-item-menu .menu-danger-direct) {
  background: rgba(239, 154, 154, 0.1);
}
.sidebar-item-menu-divider {
  height: 1px;
  background: rgba(0,0,0,0.08);
  margin: 4px 0;
}
:global(.dark .sidebar-item-menu-divider) {
  background: rgba(255,255,255,0.1);
}
.menu-fade-enter-active, .menu-fade-leave-active { transition: opacity 0.12s, transform 0.12s; }
.menu-fade-enter-from, .menu-fade-leave-to { opacity: 0; transform: scale(0.95); }
</style>
