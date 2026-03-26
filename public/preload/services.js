const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { exec } = require('node:child_process')

/**
 * 判断文本是否为系统注入内容（非用户手动输入）
 * 系统注入消息以 [ 或 < 开头，如 [Request interrupted by user]、<tool_use_error>、<stdout> 等
 * 注意：src/composables/useMessageParser.js 中有同名函数，两处逻辑必须保持一致
 */
function isSystemText(text) {
  const t = (text || '').trimStart()
  return t.startsWith('[') || t.startsWith('<')
}

function getProjectsPath() {
  return path.join(os.homedir(), '.claude', 'projects')
}

// 从已解析的 items 中提取会话显示名称
function extractSessionName(items, fallbackName) {
  // 从底部往上找 custom-title
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'custom-title' && items[i].customTitle) {
      return items[i].customTitle
    }
  }
  // Check for custom-favorite metadata
  let isFavorite = false
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'custom-favorite') { isFavorite = true; break }
  }
  // 没有 custom-title，从底部往上找最后一条有效用户消息
  for (let i = items.length - 1; i >= 0; i--) {
    const data = items[i]
    if (data.type !== 'user') continue
    const msg = data.message
    if (!msg) continue
    const msgContent = msg.content
    // 跳过工具响应消息（含 tool_result 块、sourceToolUseID 或 sourceToolAssistantUUID）
    if (Array.isArray(msgContent) && msgContent.some(b => b.type === 'tool_result')) continue
    if (data.sourceToolUseID || data.sourceToolAssistantUUID) continue
    // 跳过 isMeta 命令注入消息（如 /init 注入的详细提示词）
    if (data.isMeta) continue
    let text = ''
    if (typeof msgContent === 'string') {
      text = isSystemText(msgContent) ? '' : msgContent
    } else if (Array.isArray(msgContent)) {
      // 遍历所有 text block，跳过系统注入的，找第一个用户文本
      for (const block of msgContent) {
        const t = typeof block === 'string' ? block : (block.type === 'text' && block.text ? block.text : '')
        if (!t) continue
        if (isSystemText(t)) {
          // 保留 <command-name>xxx</command-name> 中的命令名
          const cmdMatch = t.match(/<command-name>([^<]+)<\/command-name>/)
          if (cmdMatch) { text = cmdMatch[1].trim(); break }
          continue
        }
        text = t
        break
      }
    }
    // 去除可能残留的 XML 标签
    text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (text) return text.length > 50 ? text.slice(0, 50) + '...' : text
  }
  return fallbackName
}

function getAllProjects() {
  const projectsPath = getProjectsPath()
  try {
    if (!fs.existsSync(projectsPath)) return []
    const projects = []
    const projectDirs = fs.readdirSync(projectsPath)
    for (const projectDir of projectDirs) {
      const projectPath = path.join(projectsPath, projectDir)
      const stat = fs.statSync(projectPath)
      if (!stat.isDirectory()) continue
      const files = fs.readdirSync(projectPath)
      const sessions = files
        .filter(file => file.endsWith('.jsonl'))
        .map(file => {
          const filePath = path.join(projectPath, file)
          const fileStat = fs.statSync(filePath)
          let sessionInfo = { name: file.replace('.jsonl', ''), path: filePath }
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            const items = parseJsonl(content)
            // 遍历前面几条提取 sessionId、cwd；从最后几条取最新 timestamp
            let sessionId = '', cwd = ''
            for (const data of items.slice(0, 20)) {
              if (!sessionId && data.sessionId) sessionId = data.sessionId
              if (!cwd && data.cwd) cwd = data.cwd
              if (sessionId && cwd) break
            }
            let timestamp = ''
            for (let k = items.length - 1; k >= 0; k--) {
              if (items[k].timestamp) { timestamp = items[k].timestamp; break }
            }
            const isFavorite = items.some(item => item.type === 'custom-favorite')
            sessionInfo = {
              name: extractSessionName(items, file.replace('.jsonl', '')),
              path: filePath,
              sessionId,
              timestamp,
              cwd,
              isFavorite
            }
          } catch (e) {}
          return { ...sessionInfo, size: fileStat.size, modifiedTime: fileStat.mtime }
        })
        .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
      // 从第一个有 cwd 的 session 中提取项目实际路径
      if (sessions.length === 0) continue
      const firstCwd = sessions.find(s => s.cwd)?.cwd || ''
      projects.push({ name: projectDir, displayName: firstCwd || projectDir, path: projectPath, sessions })
    }
    return projects.sort((a, b) => {
      const aTime = a.sessions[0]?.modifiedTime ? new Date(a.sessions[0].modifiedTime) : 0
      const bTime = b.sessions[0]?.modifiedTime ? new Date(b.sessions[0].modifiedTime) : 0
      return bTime - aTime
    })
  } catch (error) {
    console.error('Error reading projects:', error)
    return []
  }
}

// 解析 JSONL 内容（兼容标准单行和美化多行两种格式）
function parseJsonl(content) {
  // 先尝试标准 JSONL（每行一个 JSON）
  const lines = content.split('\n')
  const results = []
  let hasParseError = false
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      results.push(JSON.parse(line))
    } catch (e) {
      hasParseError = true
      break
    }
  }
  if (!hasParseError) return results
  // 回退：多行美化 JSON 格式，通过大括号层级切分
  const objects = []
  let depth = 0
  let start = -1
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(content.slice(start, i + 1)))
        } catch (e) {}
        start = -1
      }
    }
  }
  return objects
}

function readSessionFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf-8')
    return parseJsonl(content)
  } catch (error) {
    console.error('Error reading session file:', error)
    return []
  }
}

let currentWatcher = null

function watchSessionFile(filePath, callback) {
  // 先关掉之前的 watcher
  if (currentWatcher) {
    currentWatcher.close()
    currentWatcher = null
  }
  if (!filePath || !fs.existsSync(filePath)) return
  let debounceTimer = null
  currentWatcher = fs.watch(filePath, (eventType) => {
    if (eventType !== 'change') return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (callback) callback()
    }, 300)
  })
}

function unwatchSessionFile() {
  if (currentWatcher) {
    currentWatcher.close()
    currentWatcher = null
  }
}

function deleteSession(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      // 删除同名目录（sessionID 目录，不含 .jsonl 后缀）
      const companionDir = filePath.replace(/\.jsonl$/, '')
      if (fs.existsSync(companionDir) && fs.statSync(companionDir).isDirectory()) {
        fs.rmSync(companionDir, { recursive: true, force: true })
      }
      return { success: true }
    }
    return { success: false, error: 'File not found' }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// 重命名会话（更新或新增 custom-title 行）
function renameSession(filePath, newTitle) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(filePath, 'utf-8')
    const items = parseJsonl(content)
    // 提取 sessionId
    let sessionId = ''
    for (const data of items) {
      if (data.sessionId) { sessionId = data.sessionId; break }
    }
    // 找已有的 custom-title 并更新
    let found = false
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'custom-title') {
        items[i].customTitle = newTitle
        found = true
        break
      }
    }
    if (!found) {
      items.push({ type: 'custom-title', customTitle: newTitle, sessionId })
    }
    // 写回为标准 JSONL 格式（每行一个 JSON）
    const output = items.map(item => JSON.stringify(item)).join('\n') + '\n'
    fs.writeFileSync(filePath, output, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function saveImage(base64, ext) {
  const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '.' + ext)
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return filePath
}

function saveText(content, filename) {
  const safe = (filename || 'export.txt').replace(/[<>:"/\\|?*]/g, '_')
  const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '-' + safe)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// 在新终端窗口中恢复会话
function resumeSession(sessionId, cwd, command) {
  const cmd = `${command || 'claude'} --resume ${sessionId}`
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const platform = process.platform
  if (platform === 'win32') {
    // Windows: 用 start 开新 cmd 窗口
    exec(`start cmd /k "${cmd}"`, { cwd: workDir })
  } else if (platform === 'darwin') {
    // macOS: 用 osascript 打开 Terminal
    const escaped = cmd.replace(/"/g, '\\"')
    exec(`osascript -e 'tell app "Terminal" to do script "cd ${workDir.replace(/"/g, '\\"')} && ${escaped}"'`)
  } else {
    // Linux: 尝试常见终端
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
    for (const term of terminals) {
      try {
        if (term === 'gnome-terminal') {
          exec(`${term} -- bash -c 'cd "${workDir}" && ${cmd}; exec bash'`)
        } else {
          exec(`${term} -e 'bash -c "cd \\"${workDir}\\" && ${cmd}; exec bash"'`)
        }
        return
      } catch (e) { continue }
    }
  }
}

const crypto = require('node:crypto')

// Fork 会话：截取到指定 uuid 为止的消息，创建新 session 文件
function forkSession(sourceFilePath, cutoffUuid, title) {
  try {
    if (!fs.existsSync(sourceFilePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(sourceFilePath, 'utf-8')
    const items = parseJsonl(content)
    // 找到 cutoff 位置
    let cutIdx = -1
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].uuid === cutoffUuid) { cutIdx = i; break }
    }
    if (cutIdx < 0) return { success: false, error: 'Message not found' }
    // 截取消息
    const forked = items.slice(0, cutIdx + 1)
    // 生成新 sessionId
    const newSessionId = crypto.randomUUID()
    // 替换所有 sessionId
    for (const item of forked) {
      if (item.sessionId) item.sessionId = newSessionId
    }
    // 添加 custom-title
    forked.push({ type: 'custom-title', customTitle: title, sessionId: newSessionId })
    // 写入同目录下
    const dir = path.dirname(sourceFilePath)
    const newFilePath = path.join(dir, newSessionId + '.jsonl')
    const output = forked.map(item => JSON.stringify(item)).join('\n') + '\n'
    fs.writeFileSync(newFilePath, output, 'utf-8')
    return { success: true, sessionId: newSessionId, path: newFilePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function toggleFavorite(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(filePath, 'utf-8')
    const items = parseJsonl(content)
    // Check if already favorited
    let favIdx = -1
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'custom-favorite') { favIdx = i; break }
    }
    if (favIdx >= 0) {
      // Toggle off - remove
      items.splice(favIdx, 1)
    } else {
      // Toggle on - add
      let sessionId = ''
      for (const data of items) { if (data.sessionId) { sessionId = data.sessionId; break } }
      items.push({ type: 'custom-favorite', favorite: true, sessionId })
    }
    const output = items.map(item => JSON.stringify(item)).join('\n') + '\n'
    fs.writeFileSync(filePath, output, 'utf-8')
    return { success: true, isFavorite: favIdx < 0 }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

function batchDeleteSessions(filePaths) {
  let deleted = 0, errors = []
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp)
        const companionDir = fp.replace(/\.jsonl$/, '')
        if (fs.existsSync(companionDir) && fs.statSync(companionDir).isDirectory()) {
          fs.rmSync(companionDir, { recursive: true, force: true })
        }
        deleted++
      }
      else errors.push(fp + ': not found')
    } catch (e) { errors.push(fp + ': ' + e.message) }
  }
  return { success: errors.length === 0, deleted, errors }
}

window.services = {
  getProjectsPath,
  getAllProjects,
  readSessionFile,
  deleteSession,
  renameSession,
  watchSessionFile,
  unwatchSessionFile,
  saveImage,
  saveText,
  resumeSession,
  forkSession,
  toggleFavorite,
  batchDeleteSessions
}
