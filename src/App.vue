<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useTheme } from './composables/useTheme'
import { useSnackbar } from './composables/useSnackbar'
import { useDisplayMessages } from './composables/useMessageParser'
import { IconChevronLeft, IconChevronRight } from './components/icons'
import Sidebar from './components/Sidebar.vue'
import SessionView from './components/SessionView.vue'
import RenameDialog from './components/RenameDialog.vue'
import DeleteConfirmDialog from './components/DeleteConfirmDialog.vue'
import ForkDialog from './components/ForkDialog.vue'
import ImagePreview from './components/ImagePreview.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import SnackBar from './components/SnackBar.vue'

const { isDark, initThemeListener } = useTheme()
const { showSnackbar } = useSnackbar()

// State
const projects = ref([])
const projectsLoaded = ref(false)
const expandedProjects = ref({})
const selectedSession = ref(null)
const sessionContent = ref([])
const loading = ref(false)
const searchQuery = ref('')
const sidebarCollapsed = ref(false)
const showSettings = ref(false)
const terminalCommand = ref(window.utools.dbStorage.getItem('terminalCommand') || 'claude')

// Computed
const displayMessages = useDisplayMessages(sessionContent)

// Refs
const sessionViewRef = ref(null)
const sidebarRef = ref(null)

// Dialog state
const renameDialog = ref({ show: false, session: null })
const deleteConfirm = ref({ show: false, session: null, showHint: true })
const batchDeleteConfirm = ref({ show: false, paths: [] })
const forkDialog = ref({ show: false, item: null })
const imagePreview = ref({ show: false, src: '', mediaType: '' })

// Project/session operations
function loadProjects() {
  try {
    projects.value = window.services.getAllProjects()
  } catch (error) {
    console.error('Failed to load projects:', error)
    showSnackbar('加载项目失败', 'error')
  }
  projectsLoaded.value = true
}

function openProjectDir(project) {
  const cwd = project.sessions[0]?.cwd
  if (cwd) window.utools.shellOpenPath(cwd)
}

function toggleProject(name) {
  expandedProjects.value[name] = !expandedProjects.value[name]
}

function toggleAllProjects() {
  const expand = !projects.value.every(p => expandedProjects.value[p.name])
  for (const p of projects.value) {
    expandedProjects.value[p.name] = expand
  }
}

function loadSessionContent(path, autoScroll = false) {
  const view = sessionViewRef.value
  const wasAtBottom = autoScroll && view?.isScrolledToBottom()
  try {
    sessionContent.value = window.services.readSessionFile(path)
  } catch (error) {
    console.error('Failed to load session:', error)
  }
  if (wasAtBottom) {
    nextTick(() => view?.scrollToEnd())
  }
}

function selectSession(session) {
  selectedSession.value = session
  loading.value = true
  loadSessionContent(session.path)
  loading.value = false
  nextTick(() => sessionViewRef.value?.scrollToEnd())
  window.services.watchSessionFile(session.path, () => {
    if (selectedSession.value?.path === session.path) {
      loadSessionContent(session.path, true)
    }
    loadProjects()
    if (selectedSession.value) {
      for (const p of projects.value) {
        const s = p.sessions.find(s => s.path === selectedSession.value.path)
        if (s) { selectedSession.value = { ...selectedSession.value, name: s.name }; break }
      }
    }
  })
}

function refresh() {
  loadProjects()
  showSnackbar('已刷新')
}

// Delete
function handleDelete(session, event) {
  if (event?.ctrlKey || event?.metaKey) {
    doDelete(session)
  } else {
    deleteConfirm.value = { show: true, session, showHint: !!event }
  }
}

function doDelete(session) {
  if (!session) session = deleteConfirm.value.session
  const result = window.services.deleteSession(session.path)
  if (result.success) {
    showSnackbar('会话已删除')
    if (selectedSession.value?.path === session.path) {
      window.services.unwatchSessionFile()
      selectedSession.value = null
      sessionContent.value = []
    }
    loadProjects()
  } else {
    showSnackbar(result.error || '删除失败', 'error')
  }
  deleteConfirm.value.show = false
}

// Batch delete
function handleBatchDelete(paths) {
  batchDeleteConfirm.value = { show: true, paths }
}

function doBatchDelete() {
  const paths = batchDeleteConfirm.value.paths
  const result = window.services.batchDeleteSessions(paths)
  if (result.deleted > 0) {
    showSnackbar(`已删除 ${result.deleted} 个会话`)
    if (selectedSession.value && paths.includes(selectedSession.value.path)) {
      window.services.unwatchSessionFile()
      selectedSession.value = null
      sessionContent.value = []
    }
    loadProjects()
    sidebarRef.value?.clearMultiSelect()
  }
  if (result.errors?.length) showSnackbar(`${result.errors.length} 个失败`, 'error')
  batchDeleteConfirm.value.show = false
}

// Rename
function startRename(session) {
  renameDialog.value = { show: true, session }
}

function confirmRename(newName) {
  const result = window.services.renameSession(renameDialog.value.session.path, newName)
  if (result.success) {
    showSnackbar('已重命名')
    loadProjects()
  } else {
    showSnackbar(result.error || '重命名失败', 'error')
  }
  renameDialog.value.show = false
}

// Fork
function startFork(item) {
  forkDialog.value = { show: true, item }
}

function confirmFork(name) {
  const item = forkDialog.value.item
  const itemUuid = item.uuid
  const cutoffUuid = item.lastUuid || itemUuid
  const result = window.services.forkSession(selectedSession.value.path, cutoffUuid, name)
  if (result.success) {
    showSnackbar('Fork 成功')
    loadProjects()
  } else {
    showSnackbar(result.error || 'Fork 失败', 'error')
  }
  forkDialog.value.show = false
}

// Resume
function resumeSession() {
  const session = selectedSession.value
  if (!session?.sessionId) return
  try {
    window.services.resumeSession(session.sessionId, session.cwd || '', terminalCommand.value)
    showSnackbar('已在终端中打开')
  } catch (e) {
    showSnackbar('打开终端失败', 'error')
  }
}

// Toggle favorite from SessionView
function toggleFavoriteFromView(session) {
  if (!session?.path) return
  const result = window.services.toggleFavorite(session.path)
  if (result.success) {
    session.isFavorite = result.isFavorite
    loadProjects()
  }
}

// Image preview
function openImagePreview(src, mediaType) {
  imagePreview.value = { show: true, src, mediaType }
}

// Lifecycle
onMounted(() => {
  window.utools.onPluginEnter(({ code }) => {
    if (code === 'sessions') loadProjects()
  })
  window.utools.onPluginOut(() => {
    window.services.unwatchSessionFile()
  })
  initThemeListener()
})
</script>

<template>
  <div class="app" :class="{ dark: isDark }">
    <Sidebar
      ref="sidebarRef"
      :projects="projects"
      :expanded-projects="expandedProjects"
      :selected-session="selectedSession"
      :search-query="searchQuery"
      :collapsed="sidebarCollapsed"
      :projects-loaded="projectsLoaded"
      @update:search-query="searchQuery = $event"
      @toggle-project="toggleProject"
      @toggle-all="toggleAllProjects"
      @select-session="selectSession"
      @rename-session="startRename"
      @delete-session="handleDelete"
      @batch-delete="handleBatchDelete"
      @open-project-dir="openProjectDir"
      @refresh="refresh"
      @open-settings="showSettings = true"
    />

    <!-- 侧边栏收起/展开按钮 -->
    <button class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">
      <IconChevronLeft v-if="!sidebarCollapsed" />
      <IconChevronRight v-else />
    </button>

    <!-- 右侧内容区 -->
    <main class="content">
      <SessionView
        ref="sessionViewRef"
        :session="selectedSession"
        :display-messages="displayMessages"
        :loading="loading"
        @fork="startFork"
        @resume="resumeSession"
        @preview-image="openImagePreview"
        @rename="startRename"
        @delete="handleDelete"
        @toggle-favorite="toggleFavoriteFromView"
      />
    </main>

    <!-- Dialogs -->
    <RenameDialog
      :show="renameDialog.show"
      :session="renameDialog.session"
      @confirm="confirmRename"
      @cancel="renameDialog.show = false"
    />

    <DeleteConfirmDialog
      :show="deleteConfirm.show"
      :session="deleteConfirm.session"
      :show-hint="deleteConfirm.showHint"
      @confirm="doDelete(deleteConfirm.session)"
      @cancel="deleteConfirm.show = false"
    />

    <DeleteConfirmDialog
      :show="batchDeleteConfirm.show"
      :session="{ name: batchDeleteConfirm.paths.length + ' 个会话' }"
      :show-hint="false"
      @confirm="doBatchDelete"
      @cancel="batchDeleteConfirm.show = false"
    />

    <ForkDialog
      :show="forkDialog.show"
      @confirm="confirmFork"
      @cancel="forkDialog.show = false"
    />

    <ImagePreview
      :show="imagePreview.show"
      :src="imagePreview.src"
      :media-type="imagePreview.mediaType"
      @close="imagePreview.show = false"
    />

    <SettingsDrawer
      :show="showSettings"
      :terminal-command="terminalCommand"
      @update:terminal-command="terminalCommand = $event"
      @close="showSettings = false"
    />

    <SnackBar />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f5f5f5;
  color: #333;
  position: relative;
  overflow: hidden;
}
.app.dark {
  background: #121212;
  color: #e0e0e0;
}

.sidebar-toggle {
  position: absolute;
  left: v-bind("sidebarCollapsed ? '0px' : '320px'");
  top: 50%;
  transform: translateY(-50%);
  z-index: 21;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 48px;
  border: none;
  border-radius: 0 6px 6px 0;
  background: rgba(0,0,0,0.04);
  cursor: pointer;
  color: inherit;
  opacity: 0.3;
  padding: 0;
  transition: left 0.2s, opacity 0.15s;
}
.sidebar-toggle:hover {
  opacity: 0.8;
  background: rgba(0,0,0,0.08);
}
.dark .sidebar-toggle {
  background: rgba(255,255,255,0.06);
}
.dark .sidebar-toggle:hover {
  background: rgba(255,255,255,0.12);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: relative;
}
</style>
