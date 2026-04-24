<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useSnackbar } from '../composables/useSnackbar'
import { sideBySideDiff } from '../composables/useDiff'
import { IconMemory, IconDelete, IconCopy } from './icons'

const props = defineProps({
  project: Object,
  files: Array,
  loading: Boolean
})

const emit = defineEmits(['reload', 'cleared'])

const { showSnackbar } = useSnackbar()

const edits = reactive({})
const saving = reactive({})
const editing = reactive({})
const textareaRefs = {}
const deleteConfirm = ref(null)
const clearConfirm = ref(false)

watch(() => props.files, (files) => {
  if (!files) return
  const paths = new Set(files.map(f => f.path))
  for (const f of files) {
    if (!(f.path in edits)) edits[f.path] = f.content
  }
  for (const key of Object.keys(edits)) {
    if (!paths.has(key)) delete edits[key]
  }
}, { immediate: true })

function isDirty(file) {
  return edits[file.path] !== file.content
}

function startEdit(file) {
  editing[file.path] = true
  nextTick(() => { textareaRefs[file.path]?.focus() })
}

function cancelEdit(file) {
  edits[file.path] = file.content
  editing[file.path] = false
}

let savingInternally = false

function saveFile(file) {
  savingInternally = true
  saving[file.path] = true
  const result = window.services.saveMemoryFile(file.path, edits[file.path])
  saving[file.path] = false
  if (result.success) {
    file.content = edits[file.path]
    editing[file.path] = false
    showSnackbar('已保存')
  } else {
    showSnackbar('保存失败：' + result.error, 'error')
  }
  setTimeout(() => { savingInternally = false }, 500)
}

function confirmDelete() {
  const file = deleteConfirm.value
  deleteConfirm.value = null
  const result = window.services.deleteMemoryFile(file.path)
  if (result.success) {
    showSnackbar('已删除')
    emit('reload')
  } else {
    showSnackbar('删除失败：' + result.error, 'error')
  }
}

function doClearMemory() {
  clearConfirm.value = false
  const result = window.services.clearMemory(props.project.path)
  if (result.success) {
    showSnackbar('已清空所有记忆')
    emit('cleared')
  } else {
    showSnackbar('清空失败：' + result.error, 'error')
  }
}

// ── 冲突队列 ──────────────────────────────────────────────────
const conflictQueue = ref([])
const currentConflict = ref(null)

const sideDiff = computed(() =>
  currentConflict.value
    ? sideBySideDiff(currentConflict.value.userEdit, currentConflict.value.diskContent)
    : []
)

function resolveConflict(useMyEdit) {
  const c = currentConflict.value
  if (!c) return
  if (!useMyEdit) {
    edits[c.file.path] = c.diskContent
    c.file.content = c.diskContent
    editing[c.file.path] = false
  } else {
    c.file.content = c.diskContent
  }
  conflictQueue.value.shift()
  currentConflict.value = conflictQueue.value[0] || null
}

// ── 文件变更监听 ──────────────────────────────────────────────
function handleExternalChange() {
  if (savingInternally) return
  const result = window.services.getMemoryFiles(props.project.path)
  if (!result.success) return

  const newFiles = result.files
  const oldByPath = {}
  for (const f of (props.files || [])) oldByPath[f.path] = f

  for (const nf of newFiles) {
    const old = oldByPath[nf.path]
    if (!old) continue
    if (nf.content === old.content) continue

    const userEdit = edits[nf.path]
    const dirty = userEdit !== undefined && userEdit !== old.content

    if (dirty) {
      const alreadyQueued = conflictQueue.value.some(c => c.file.path === nf.path)
      if (!alreadyQueued) {
        conflictQueue.value.push({ file: old, diskContent: nf.content, userEdit })
        if (!currentConflict.value) currentConflict.value = conflictQueue.value[0]
      }
    } else {
      old.content = nf.content
      edits[nf.path] = nf.content
    }
  }

  const newPaths = new Set(newFiles.map(f => f.path))
  const oldPaths = new Set((props.files || []).map(f => f.path))
  const hasStructureChange = [...newPaths].some(p => !oldPaths.has(p)) || [...oldPaths].some(p => !newPaths.has(p))
  if (hasStructureChange) emit('reload')
}

function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    for (const file of (props.files || [])) {
      if (editing[file.path] && isDirty(file) && !saving[file.path]) saveFile(file)
    }
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text || '').then(() => showSnackbar('已复制'))
}

onMounted(() => {
  if (props.project) window.services.watchMemoryDir(props.project.path, handleExternalChange)
  document.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  window.services.unwatchMemoryDir()
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="memory-view">
    <!-- 头部 -->
    <div class="memory-header">
      <div class="memory-header-left">
        <IconMemory :size="18" class="memory-header-icon" />
        <div>
          <div class="memory-title">记忆管理</div>
          <div class="memory-subtitle">{{ project?.displayName }}</div>
        </div>
      </div>
      <button class="clear-btn" @click="clearConfirm = true" title="删除 memory 目录">
        清空所有记忆
      </button>
    </div>
    <div class="memory-header-divider"></div>

    <!-- 加载中 -->
    <div v-if="loading" class="memory-loading">
      <div class="memory-spinner"></div>
    </div>

    <!-- 文件列表 -->
    <div v-else-if="files && files.length" class="memory-files">
      <div v-for="file in files" :key="file.path" class="memory-file-card">
        <div class="file-card-header">
          <span class="file-name">{{ file.name }}</span>
          <div class="file-actions">
            <template v-if="editing[file.path]">
              <button class="file-cancel-btn" @click="cancelEdit(file)">取消</button>
              <button
                class="file-save-btn"
                :class="{ dirty: isDirty(file) }"
                :disabled="!isDirty(file) || saving[file.path]"
                @click="saveFile(file)"
              >{{ saving[file.path] ? '保存中…' : '保存' }}</button>
            </template>
            <template v-else>
              <button class="file-edit-btn" @click="startEdit(file)">修改</button>
              <button
                v-if="file.name !== 'MEMORY.md'"
                class="file-delete-btn"
                @click="deleteConfirm = file"
                title="删除文件"
              >
                <IconDelete :size="13" />
              </button>
            </template>
          </div>
        </div>
        <textarea
          :ref="el => { if (el) textareaRefs[file.path] = el; else delete textareaRefs[file.path] }"
          class="file-editor"
          :class="{ readonly: !editing[file.path] }"
          v-model="edits[file.path]"
          :disabled="!editing[file.path]"
          spellcheck="false"
        ></textarea>
      </div>
    </div>

    <div v-else class="memory-empty">记忆目录为空</div>

    <!-- 删除文件确认 -->
    <div v-if="deleteConfirm" class="confirm-overlay" @click.self="deleteConfirm = null">
      <div class="confirm-dialog">
        <p>确认删除 <strong>{{ deleteConfirm.name }}</strong>？</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click="deleteConfirm = null">取消</button>
          <button class="confirm-ok danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 清空确认 -->
    <div v-if="clearConfirm" class="confirm-overlay" @click.self="clearConfirm = false">
      <div class="confirm-dialog">
        <p>确定要清空所有记忆吗？此操作不可恢复！</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click="clearConfirm = false">取消</button>
          <button class="confirm-ok danger" @click="doClearMemory">清空</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 冲突对话框（fixed，居中于整个视口）-->
  <div v-if="currentConflict" class="conflict-overlay">
    <div class="conflict-dialog">
      <div class="conflict-title">
        <span class="conflict-badge">冲突</span>
        <strong>{{ currentConflict.file.name }}</strong> 已在外部被修改
        <span v-if="conflictQueue.length > 1" class="conflict-count">（{{ conflictQueue.length }} 个文件冲突）</span>
      </div>
      <!-- 列标题行 -->
      <div class="sdiff-headers">
        <div class="sdiff-col-label mine">
          你的修改
          <button class="sdiff-copy-btn" @click="copyText(currentConflict.userEdit)" title="复制">
            <IconCopy :size="12" />
          </button>
        </div>
        <div class="sdiff-sep-hd"></div>
        <div class="sdiff-col-label disk">
          磁盘版本
          <button class="sdiff-copy-btn" @click="copyText(currentConflict.diskContent)" title="复制">
            <IconCopy :size="12" />
          </button>
        </div>
      </div>
      <!-- side-by-side diff 主体 -->
      <div class="sdiff-body">
        <template v-for="(row, i) in sideDiff" :key="i">
          <div class="sdiff-cell" :class="row.left.type">
            <span class="sdiff-marker">{{ row.left.type === 'del' ? '-' : row.left.type === 'same' ? ' ' : '' }}</span>
            <span class="sdiff-text">
              <template v-if="row.left.parts">
                <span v-for="(p, pi) in row.left.parts" :key="pi" :class="{ 'hl': p.hl }">{{ p.text }}</span>
              </template>
              <template v-else>{{ row.left.text }}</template>
            </span>
          </div>
          <div class="sdiff-sep"></div>
          <div class="sdiff-cell" :class="row.right.type">
            <span class="sdiff-marker">{{ row.right.type === 'add' ? '+' : row.right.type === 'same' ? ' ' : '' }}</span>
            <span class="sdiff-text">
              <template v-if="row.right.parts">
                <span v-for="(p, pi) in row.right.parts" :key="pi" :class="{ 'hl': p.hl }">{{ p.text }}</span>
              </template>
              <template v-else>{{ row.right.text }}</template>
            </span>
          </div>
        </template>
      </div>
      <div class="conflict-actions">
        <button class="conflict-btn keep" @click="resolveConflict(true)">保留我的修改</button>
        <button class="conflict-btn use-disk" @click="resolveConflict(false)">使用磁盘版本</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.memory-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.memory-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  min-height: 52px;
  box-sizing: border-box;
  flex-shrink: 0;
}
.memory-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.memory-header-icon { opacity: 0.7; flex-shrink: 0; }
.memory-title { font-size: 16px; font-weight: 600; }
.memory-subtitle { font-size: 12px; opacity: 0.5; margin-top: 1px; }
.memory-header-divider { height: 1px; background: #e0e0e0; flex-shrink: 0; }
:global(.dark .memory-header-divider) { background: #333; }

.clear-btn {
  padding: 5px 12px;
  border: 1px solid #d32f2f;
  background: transparent;
  color: #d32f2f;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.clear-btn:hover { background: rgba(211,47,47,0.06); }
:global(.dark .clear-btn) { border-color: #ef9a9a; color: #ef9a9a; }
:global(.dark .clear-btn:hover) { background: rgba(239,154,154,0.08); }

.memory-loading { display: flex; justify-content: center; padding: 40px; }
.memory-spinner {
  width: 28px; height: 28px;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
:global(.dark .memory-spinner) { border-color: rgba(255,255,255,0.1); border-top-color: #90caf9; }
@keyframes spin { to { transform: rotate(360deg); } }

.memory-files {
  flex: 1; overflow: auto; padding: 16px 20px;
  display: flex; flex-direction: column; gap: 16px;
}
.memory-empty { padding: 40px; text-align: center; opacity: 0.4; }

.memory-file-card { border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
:global(.dark .memory-file-card) { border-color: #333; }

.file-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  background: rgba(0,0,0,0.03);
  border-bottom: 1px solid #e0e0e0;
}
:global(.dark .file-card-header) { background: rgba(255,255,255,0.04); border-bottom-color: #333; }

.file-name { font-size: 13px; font-weight: 600; font-family: monospace; opacity: 0.8; }
.file-actions { display: flex; align-items: center; gap: 6px; }

.file-edit-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.6;
}
.file-edit-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); }
:global(.dark .file-edit-btn:hover) { background: rgba(255,255,255,0.07); }

.file-cancel-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.6;
}
.file-cancel-btn:hover { opacity: 1; background: rgba(0,0,0,0.04); }
:global(.dark .file-cancel-btn:hover) { background: rgba(255,255,255,0.07); }

.file-save-btn {
  padding: 3px 10px;
  border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; opacity: 0.5;
}
.file-save-btn.dirty { border-color: #1976d2; color: #1976d2; opacity: 1; }
.file-save-btn:disabled { cursor: default; }
.file-save-btn.dirty:hover { background: rgba(25,118,210,0.06); }
:global(.dark .file-save-btn.dirty) { border-color: #90caf9; color: #90caf9; }
:global(.dark .file-save-btn.dirty:hover) { background: rgba(144,202,249,0.08); }

.file-delete-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; background: transparent;
  color: inherit; border-radius: 4px; cursor: pointer; opacity: 0.4;
}
.file-delete-btn:hover { opacity: 1; color: #d32f2f; background: rgba(211,47,47,0.08); }
:global(.dark .file-delete-btn:hover) { color: #ef9a9a; background: rgba(239,154,154,0.1); }

.file-editor {
  width: 100%; min-height: 120px; padding: 12px;
  border: none; outline: none;
  font-size: 13px; font-family: 'Consolas', 'Monaco', monospace; line-height: 1.6;
  resize: vertical; background: transparent; color: inherit;
  box-sizing: border-box; display: block;
  transition: background 0.15s;
}
.file-editor.readonly {
  resize: none; cursor: default;
  background: rgba(0,0,0,0.015);
}
:global(.dark .file-editor) { color: #e0e0e0; }
:global(.dark .file-editor.readonly) { background: rgba(255,255,255,0.02); }

/* 通用确认弹窗（相对 memory-view 定位） */
.confirm-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
:global(.dark .confirm-overlay) { background: rgba(0,0,0,0.5); }
.confirm-dialog {
  background: #fff; border-radius: 10px; padding: 20px 24px;
  max-width: 320px; width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
:global(.dark .confirm-dialog) { background: #2a2a2a; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.confirm-dialog p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm-cancel {
  padding: 6px 14px; border: 1px solid #bbb;
  background: transparent; color: inherit;
  border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit;
}
.confirm-cancel:hover { background: rgba(0,0,0,0.05); }
:global(.dark .confirm-cancel:hover) { background: rgba(255,255,255,0.08); }
.confirm-ok {
  padding: 6px 14px; border: none; border-radius: 6px;
  font-size: 13px; cursor: pointer; font-family: inherit;
  background: #1976d2; color: #fff;
}
.confirm-ok.danger { background: #d32f2f; }
.confirm-ok:hover { filter: brightness(1.1); }

/* 冲突对话框（fixed，覆盖整个视口） */
.conflict-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
:global(.dark .conflict-overlay) { background: rgba(0,0,0,0.65); }

.conflict-dialog {
  background: #fff; border-radius: 12px;
  width: min(920px, 96vw);
  height: min(78vh, 680px);
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0,0,0,0.22);
  overflow: hidden;
}
:global(.dark .conflict-dialog) { background: #252525; box-shadow: 0 12px 48px rgba(0,0,0,0.65); }

.conflict-title {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  font-size: 14px;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .conflict-title) { border-bottom-color: #333; }
.conflict-badge {
  background: #ff9800; color: #fff;
  font-size: 11px; font-weight: 700;
  padding: 2px 7px; border-radius: 4px;
  flex-shrink: 0;
}
.conflict-count { font-size: 12px; opacity: 0.5; margin-left: 4px; }

/* side-by-side diff */
.sdiff-headers {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .sdiff-headers) { border-bottom-color: #333; }

.sdiff-sep-hd { background: #e0e0e0; }
:global(.dark .sdiff-sep-hd) { background: #333; }

.sdiff-col-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 5px 8px 5px 12px;
}
.sdiff-col-label.mine { color: #1565c0; background: rgba(25,118,210,0.07); }
.sdiff-col-label.disk { color: #6a1b9a; background: rgba(123,31,162,0.07); }
:global(.dark .sdiff-col-label.mine) { color: #90caf9; background: rgba(144,202,249,0.09); }
:global(.dark .sdiff-col-label.disk) { color: #ce93d8; background: rgba(206,147,216,0.09); }

.sdiff-copy-btn {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0;
  border: none; background: transparent; cursor: pointer;
  color: inherit; border-radius: 3px; opacity: 0.55; margin-left: auto;
}
.sdiff-copy-btn:hover { opacity: 1; background: rgba(0,0,0,0.08); }
:global(.dark .sdiff-copy-btn:hover) { background: rgba(255,255,255,0.1); }

.sdiff-body {
  flex: 1; overflow: auto; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  align-content: start;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px; line-height: 1.55;
}

.sdiff-sep { background: #e0e0e0; }
:global(.dark .sdiff-sep) { background: #333; }

.sdiff-cell {
  display: flex; white-space: pre-wrap; word-break: break-all;
}
.sdiff-cell.same { opacity: 0.7; }
.sdiff-cell.del { background: rgba(248,81,73,0.13); color: #b91c1c; }
.sdiff-cell.add { background: rgba(46,160,67,0.13); color: #1a6e2e; }
.sdiff-cell.empty {
  background: repeating-linear-gradient(
    135deg,
    rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 3px,
    transparent 3px, transparent 9px
  );
}
:global(.dark .sdiff-cell.del) { background: rgba(248,81,73,0.2); color: #ffa198; }
:global(.dark .sdiff-cell.add) { background: rgba(46,160,67,0.2); color: #7ee787; }
:global(.dark .sdiff-cell.empty) {
  background: repeating-linear-gradient(
    135deg,
    rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 3px,
    transparent 3px, transparent 9px
  );
}

.sdiff-marker { width: 16px; flex-shrink: 0; padding: 0 3px; opacity: 0.65; text-align: center; }
.sdiff-text { flex: 1; padding: 0 8px; }

/* 字符级高亮 */
.sdiff-cell.del .hl { background: rgba(248,81,73,0.35); border-radius: 2px; }
.sdiff-cell.add .hl { background: rgba(46,160,67,0.35); border-radius: 2px; }
:global(.dark .sdiff-cell.del .hl) { background: rgba(248,81,73,0.45); }
:global(.dark .sdiff-cell.add .hl) { background: rgba(46,160,67,0.45); }

.conflict-actions {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 11px 18px;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
}
:global(.dark .conflict-actions) { border-top-color: #333; }
.conflict-btn {
  padding: 7px 18px; border-radius: 6px;
  font-size: 13px; font-family: inherit;
  cursor: pointer; border: none;
}
.conflict-btn.keep { background: rgba(25,118,210,0.12); color: #1565c0; }
.conflict-btn.keep:hover { background: rgba(25,118,210,0.2); }
.conflict-btn.use-disk { background: #7b1fa2; color: #fff; }
.conflict-btn.use-disk:hover { filter: brightness(1.1); }
:global(.dark .conflict-btn.keep) { background: rgba(144,202,249,0.15); color: #90caf9; }
:global(.dark .conflict-btn.keep:hover) { background: rgba(144,202,249,0.25); }
:global(.dark .conflict-btn.use-disk) { background: #8e24aa; }
</style>
