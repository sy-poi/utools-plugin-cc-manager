<script setup>
import { ref, watch } from 'vue'
import { IconClose } from './icons'
import { useSnackbar } from '../composables/useSnackbar'
import { useTheme } from '../composables/useTheme'

const props = defineProps({
  show: Boolean,
  terminalCommand: String
})

const emit = defineEmits(['update:terminalCommand', 'close'])
const { showSnackbar } = useSnackbar()
const { themeMode, setThemeMode } = useTheme()
const draft = ref('')

watch(() => props.show, (v) => {
  if (v) draft.value = props.terminalCommand
})

function save() {
  emit('update:terminalCommand', draft.value)
  window.utools.dbStorage.setItem('terminalCommand', draft.value)
  emit('close')
  showSnackbar('设置已保存')
}
</script>

<template>
  <Transition name="drawer">
    <div v-if="show" class="drawer-overlay">
      <div class="drawer-panel">
        <div class="drawer-header">
          <h3>设置</h3>
          <button class="icon-btn" @click="emit('close')" title="关闭">
            <IconClose />
          </button>
        </div>
        <div class="drawer-body">
          <div class="setting-item">
            <label class="setting-label">主题模式</label>
            <div class="setting-desc">选择亮色、暗色或跟随系统</div>
            <div class="theme-options">
              <button
                class="theme-option"
                :class="{ active: themeMode === 'system' }"
                @click="setThemeMode('system')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18V4c4.41 0 8 3.59 8 8s-3.59 8-8 8z"/></svg>
                跟随系统
              </button>
              <button
                class="theme-option"
                :class="{ active: themeMode === 'light' }"
                @click="setThemeMode('light')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
                亮色
              </button>
              <button
                class="theme-option"
                :class="{ active: themeMode === 'dark' }"
                @click="setThemeMode('dark')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
                暗色
              </button>
            </div>
          </div>
          <div class="setting-item">
            <label class="setting-label">终端命令</label>
            <div class="setting-desc">用于「恢复会话」功能，默认 claude</div>
            <input class="setting-input" v-model="draft" placeholder="claude" @keyup.enter="save" />
          </div>
        </div>
        <div class="drawer-footer">
          <button class="setting-save-btn" @click="save">保存</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.3);
}
.drawer-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 16px rgba(0,0,0,0.1);
}
:global(.dark .drawer-panel) {
  background: #1e1e1e;
  box-shadow: -4px 0 16px rgba(0,0,0,0.4);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}
:global(.dark .drawer-header) {
  border-color: #333;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
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
.drawer-body {
  flex: 1;
  padding: 16px;
  overflow: auto;
}
.drawer-footer {
  padding: 12px 16px;
  border-top: 1px solid #e0e0e0;
  text-align: right;
}
:global(.dark .drawer-footer) {
  border-color: #333;
}
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }

.setting-item { margin-bottom: 12px; }
.setting-label {
  font-size: 13px;
  font-weight: 600;
  display: block;
  margin-bottom: 2px;
}
.setting-desc {
  font-size: 11px;
  opacity: 0.5;
  margin-bottom: 6px;
}
.setting-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: inherit;
  color: inherit;
  box-sizing: border-box;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
.setting-input:focus { border-color: #1976d2; }
:global(.dark .setting-input) { border-color: #444; }
:global(.dark .setting-input:focus) { border-color: #90caf9; }
.theme-options {
  display: flex;
  gap: 6px;
}
.theme-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.theme-option:hover {
  background: rgba(0,0,0,0.04);
}
.theme-option.active {
  border-color: #1976d2;
  background: rgba(25, 118, 210, 0.08);
  color: #1976d2;
  font-weight: 600;
}
:global(.dark .theme-option) {
  border-color: #444;
}
:global(.dark .theme-option:hover) {
  background: rgba(255,255,255,0.06);
}
:global(.dark .theme-option.active) {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.12);
  color: #90caf9;
}
.setting-save-btn {
  padding: 5px 16px;
  border: none;
  border-radius: 6px;
  background: #1976d2;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.setting-save-btn:hover { background: #1565c0; }
</style>
