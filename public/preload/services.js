const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

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

// 快速扫描所有项目：每个项目只读最新一个文件取 cwd，不加载完整会话列表
function getProjectsQuick() {
  const projectsPath = getProjectsPath()
  try {
    if (!fs.existsSync(projectsPath)) return []
    const projects = []
    const projectDirs = fs.readdirSync(projectsPath)
    for (const projectDir of projectDirs) {
      const projectPath = path.join(projectsPath, projectDir)
      const stat = fs.statSync(projectPath)
      if (!stat.isDirectory()) continue
      const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))
      const projectMemoryDir = path.join(projectPath, 'memory')
      const projectHasMemory = fs.existsSync(path.join(projectMemoryDir, 'MEMORY.md'))
      if (jsonlFiles.length === 0 && !projectHasMemory) continue
      // stat 所有文件找最新修改时间和最近修改的文件
      let latestMtime = new Date(0)
      let newestFile = null
      let newestMtime = new Date(0)
      for (const file of jsonlFiles) {
        const m = fs.statSync(path.join(projectPath, file)).mtime
        if (m > latestMtime) latestMtime = m
        if (m > newestMtime) { newestMtime = m; newestFile = file }
      }
      // 无会话时用 memory 目录的时间兜底
      if (latestMtime.getTime() === 0 && projectHasMemory) {
        try { latestMtime = fs.statSync(projectMemoryDir).mtime } catch (e) {}
      }
      // 只读最新文件的前几条取 cwd
      let cwd = ''
      if (newestFile) {
        try {
          const content = fs.readFileSync(path.join(projectPath, newestFile), 'utf-8')
          const items = parseJsonl(content)
          for (const data of items.slice(0, 20)) {
            if (data.cwd) { cwd = data.cwd; break }
          }
        } catch (e) {}
      }
      const memoryDir = projectMemoryDir
      const hasMemory = projectHasMemory
      let memorySize = 0
      let memoryFileCount = 0
      if (hasMemory) {
        try {
          const memFiles = fs.readdirSync(memoryDir)
          for (const mf of memFiles) {
            const s = fs.statSync(path.join(memoryDir, mf))
            if (s.isFile()) { memorySize += s.size; memoryFileCount++ }
          }
        } catch (e) {}
      }
      projects.push({
        name: projectDir,
        displayName: cwd || projectDir,
        cwd,
        path: projectPath,
        sessionCount: jsonlFiles.length,
        sessions: [],
        sessionsLoaded: false,
        sessionsLoading: false,
        latestMtime,
        hasMemory,
        memorySize,
        memoryFileCount
      })
    }
    return projects.sort((a, b) => b.latestMtime - a.latestMtime)
  } catch (error) {
    console.error('Error reading projects:', error)
    return []
  }
}

// 加载指定项目的完整会话列表（含 subagents）
function loadProjectSessions(projectPath) {
  try {
    const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))
    const sessions = files.map(file => {
      const filePath = path.join(projectPath, file)
      const fileStat = fs.statSync(filePath)
      let sessionInfo = { name: file.replace('.jsonl', ''), path: filePath }
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const items = parseJsonl(content)
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
      // 扫描同名目录下的 subagents
      const sessionUuid = file.replace('.jsonl', '')
      const subagentDir = path.join(projectPath, sessionUuid, 'subagents')
      const subagents = []
      if (fs.existsSync(subagentDir)) {
        try {
          const subFiles = fs.readdirSync(subagentDir).filter(f => /^agent-[a-f0-9]+\.jsonl$/.test(f))
          for (const subFile of subFiles) {
            const agentId = subFile.replace(/^agent-/, '').replace(/\.jsonl$/, '')
            const subPath = path.join(subagentDir, subFile)
            const subStat = fs.statSync(subPath)
            let subName = agentId
            const metaPath = path.join(subagentDir, `agent-${agentId}.meta.json`)
            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                if (meta.description) subName = meta.description
              } catch (e) {}
            }
            subagents.push({
              agentId,
              name: subName,
              path: subPath,
              size: subStat.size,
              modifiedTime: subStat.mtime,
              isSubagent: true,
              parentSessionPath: filePath
            })
          }
        } catch (e) {}
      }
      return { ...sessionInfo, size: fileStat.size, modifiedTime: fileStat.mtime, subagents }
    }).sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
    return { success: true, sessions }
  } catch (error) {
    return { success: false, error: error.message, sessions: [] }
  }
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
let currentMemoryWatcher = null

function watchMemoryDir(projectPath, callback) {
  if (currentMemoryWatcher) { currentMemoryWatcher.close(); currentMemoryWatcher = null }
  const memoryDir = path.join(projectPath, 'memory')
  if (!fs.existsSync(memoryDir)) return
  let debounceTimer = null
  currentMemoryWatcher = fs.watch(memoryDir, () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { if (callback) callback() }, 300)
  })
}

function unwatchMemoryDir() {
  if (currentMemoryWatcher) { currentMemoryWatcher.close(); currentMemoryWatcher = null }
}

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
    let foundTitle = false
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'custom-title') {
        items[i].customTitle = newTitle
        foundTitle = true
        break
      }
    }
    if (!foundTitle) {
      items.push({ type: 'custom-title', customTitle: newTitle, sessionId })
    }
    // 同步更新 agent-name
    let foundAgent = false
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'agent-name') {
        items[i].agentName = newTitle
        foundAgent = true
        break
      }
    }
    if (!foundAgent) {
      items.push({ type: 'agent-name', agentName: newTitle, sessionId })
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

// 启动独立进程，立即 resolve；若进程在 400ms 内以非零码退出则 reject（命令找不到等）
function spawnDetached(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    // Windows 下显式传 /u 让 cmd.exe 以 UTF-16LE 输出错误信息，避免 GBK 乱码
    const isWin = process.platform === 'win32'
    const proc = isWin
      ? spawn('cmd', ['/u', '/d', '/s', '/c', `"${cmd}"`], { stdio: ['ignore', 'ignore', 'pipe'], windowsVerbatimArguments: true, windowsHide: true, ...opts })
      : spawn(cmd, [], { shell: true, stdio: ['ignore', 'ignore', 'pipe'], ...opts })
    proc.unref()

    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString(isWin ? 'utf16le' : 'utf8') })

    let settled = false
    const settle = (err) => {
      if (settled) return
      settled = true
      err ? reject(err) : resolve()
    }

    proc.on('error', (err) => settle(err))

    // 400ms 后仍在运行说明终端已成功打开
    const timer = setTimeout(() => settle(null), 400)

    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        settle(new Error(stderr.trim() || `进程退出码 ${code}`))
      } else {
        settle(null)
      }
    })
  })
}

// 在新终端窗口中新建会话，返回 Promise
function newSession(cwd, command, terminalApp) {
  const cmd = command || 'claude'
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const platform = process.platform
  const app = (terminalApp || 'auto').trim()
  const isAuto = app === '' || app.toLowerCase() === 'auto'

  if (!isAuto) {
    const finalCmd = app
      .replace(/\$\{cc_cmd\}/g, cmd)
      .replace(/\$\{cwd_raw\}/g, workDir)
      .replace(/\$\{cwd\}/g, workDir.replace(/\\/g, '/'))
    return spawnDetached(finalCmd, { cwd: workDir })
  }

  if (platform === 'win32') {
    return spawnDetached(`start cmd /c "${cmd}"`, { cwd: workDir })
  } else if (platform === 'darwin') {
    const escaped = cmd.replace(/"/g, '\\"')
    const escapedDir = workDir.replace(/"/g, '\\"')
    return spawnDetached(`osascript -e 'tell app "Terminal" to do script "cd ${escapedDir} && ${escaped}"'`)
  } else {
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
    const tryNext = (i) => {
      if (i >= terminals.length) return Promise.reject(new Error('未找到可用终端'))
      const term = terminals[i]
      const termCmd = term === 'gnome-terminal'
        ? `${term} -- bash -c 'cd "${workDir}" && ${cmd}; exec bash'`
        : `${term} -e 'bash -c "cd \\"${workDir}\\" && ${cmd}; exec bash"'`
      return spawnDetached(termCmd).catch(() => tryNext(i + 1))
    }
    return tryNext(0)
  }
}

// 在新终端窗口中恢复会话，返回 Promise
function resumeSession(sessionId, cwd, command, terminalApp) {
  const cmd = `${command || 'claude'} --resume ${sessionId}`
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const platform = process.platform
  const app = (terminalApp || 'auto').trim()
  const isAuto = app === '' || app.toLowerCase() === 'auto'

  if (!isAuto) {
    const finalCmd = app
      .replace(/\$\{cc_cmd\}/g, cmd)
      .replace(/\$\{cwd_raw\}/g, workDir)
      .replace(/\$\{cwd\}/g, workDir.replace(/\\/g, '/'))
    return spawnDetached(finalCmd, { cwd: workDir })
  }

  if (platform === 'win32') {
    return spawnDetached(`start cmd /c "${cmd}"`, { cwd: workDir })
  } else if (platform === 'darwin') {
    const escaped = cmd.replace(/"/g, '\\"')
    const escapedDir = workDir.replace(/"/g, '\\"')
    return spawnDetached(`osascript -e 'tell app "Terminal" to do script "cd ${escapedDir} && ${escaped}"'`)
  } else {
    // Linux auto: 依次尝试常见终端
    const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
    const tryNext = (i) => {
      if (i >= terminals.length) return Promise.reject(new Error('未找到可用终端'))
      const term = terminals[i]
      const termCmd = term === 'gnome-terminal'
        ? `${term} -- bash -c 'cd "${workDir}" && ${cmd}; exec bash'`
        : `${term} -e 'bash -c "cd \\"${workDir}\\" && ${cmd}; exec bash"'`
      return spawnDetached(termCmd).catch(() => tryNext(i + 1))
    }
    return tryNext(0)
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
    // 添加 custom-title 和 agent-name
    forked.push({ type: 'custom-title', customTitle: title, sessionId: newSessionId })
    forked.push({ type: 'agent-name', agentName: title, sessionId: newSessionId })
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

function forkSummarySession(sourceFilePath, summaryUuid, title) {
  try {
    if (!fs.existsSync(sourceFilePath)) return { success: false, error: 'File not found' }
    const content = fs.readFileSync(sourceFilePath, 'utf-8')
    const items = parseJsonl(content)
    const summaryItem = items.find(item => item.uuid === summaryUuid)
    if (!summaryItem) return { success: false, error: 'Summary message not found' }
    const newSessionId = crypto.randomUUID()
    const forked = [
      { ...summaryItem, sessionId: newSessionId },
      { type: 'custom-title', customTitle: title, sessionId: newSessionId },
      { type: 'agent-name', agentName: title, sessionId: newSessionId }
    ]
    const dir = path.dirname(sourceFilePath)
    const newFilePath = path.join(dir, newSessionId + '.jsonl')
    const output = forked.map(item => JSON.stringify(item)).join('\n') + '\n'
    fs.writeFileSync(newFilePath, output, 'utf-8')
    return { success: true, sessionId: newSessionId, path: newFilePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// 记忆管理：获取 memory 目录下所有文件内容
function getMemoryFiles(projectPath) {
  const memoryDir = path.join(projectPath, 'memory')
  if (!fs.existsSync(memoryDir)) return { success: false, files: [] }
  try {
    const entries = fs.readdirSync(memoryDir).filter(f => {
      return fs.statSync(path.join(memoryDir, f)).isFile()
    })
    const files = entries.map(f => ({
      name: f,
      path: path.join(memoryDir, f),
      content: fs.readFileSync(path.join(memoryDir, f), 'utf-8')
    }))
    files.sort((a, b) => {
      if (a.name === 'MEMORY.md') return -1
      if (b.name === 'MEMORY.md') return 1
      return a.name.localeCompare(b.name)
    })
    return { success: true, files }
  } catch (e) {
    return { success: false, error: e.message, files: [] }
  }
}

function saveMemoryFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function deleteMemoryFile(filePath) {
  try {
    fs.unlinkSync(filePath)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function clearMemory(projectPath) {
  const memoryDir = path.join(projectPath, 'memory')
  try {
    if (!fs.existsSync(memoryDir)) return { success: true }
    const entries = fs.readdirSync(memoryDir)
    const errors = []
    for (const entry of entries) {
      try {
        fs.rmSync(path.join(memoryDir, entry), { recursive: true, force: true })
      } catch (e) {
        errors.push(`${entry}: ${e.message}`)
      }
    }
    if (errors.length > 0) return { success: false, error: errors.join('\n') }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
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

// 读取快照中选定文件的备份内容与当前磁盘内容，供 diff 预览使用
function getSnapshotFileContents(sessionFilePath, selectedBackups) {
  try {
    const sessionUuid = path.basename(sessionFilePath, '.jsonl')
    const fileHistoryDir = path.join(os.homedir(), '.claude', 'file-history', sessionUuid)
    const content = fs.readFileSync(sessionFilePath, 'utf-8')
    const items = parseJsonl(content)
    let cwd = ''
    for (const item of items.slice(0, 20)) {
      if (item.cwd) { cwd = item.cwd; break }
    }
    if (!cwd) return { success: false, error: '无法确定项目目录' }
    const files = []
    for (const [relativePath, { backupFileName }] of Object.entries(selectedBackups)) {
      const backupFilePath = path.join(fileHistoryDir, backupFileName)
      const normalized = relativePath.split(/[/\\]/).join(path.sep)
      const absolutePath = path.join(cwd, normalized)
      let backupContent = null, currentContent = null
      try { backupContent = fs.readFileSync(backupFilePath, 'utf-8') } catch (e) {}
      try { currentContent = fs.readFileSync(absolutePath, 'utf-8') } catch (e) {}
      files.push({ filePath: relativePath, backupContent, currentContent })
    }
    return { success: true, files }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 恢复会话文件到指定快照时的状态
function restoreSnapshot(sessionFilePath, trackedFileBackups) {
  try {
    const sessionUuid = path.basename(sessionFilePath, '.jsonl')
    const fileHistoryDir = path.join(os.homedir(), '.claude', 'file-history', sessionUuid)

    // 从会话文件中读取 cwd（项目根目录）
    const content = fs.readFileSync(sessionFilePath, 'utf-8')
    const items = parseJsonl(content)
    let cwd = ''
    for (const item of items.slice(0, 20)) {
      if (item.cwd) { cwd = item.cwd; break }
    }
    if (!cwd) return { success: false, error: '无法确定项目目录（cwd 未找到）', restoredFiles: [], errors: [] }

    const restoredFiles = []
    const errors = []

    for (const [relativePath, { backupFileName }] of Object.entries(trackedFileBackups)) {
      try {
        const backupFilePath = path.join(fileHistoryDir, backupFileName)
        if (!fs.existsSync(backupFilePath)) {
          errors.push(`备份文件不存在: ${relativePath}`)
          continue
        }
        const backupContent = fs.readFileSync(backupFilePath, 'utf-8')
        const normalized = relativePath.split(/[/\\]/).join(path.sep)
        const absolutePath = path.join(cwd, normalized)
        fs.writeFileSync(absolutePath, backupContent, 'utf-8')
        restoredFiles.push(relativePath)
      } catch (e) {
        errors.push(`${relativePath}: ${e.message}`)
      }
    }

    return { success: errors.length === 0, restoredFiles, errors, cwd }
  } catch (error) {
    return { success: false, error: error.message, restoredFiles: [], errors: [] }
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
  getProjectsQuick,
  loadProjectSessions,
  getAllProjects,
  readSessionFile,
  deleteSession,
  renameSession,
  watchSessionFile,
  unwatchSessionFile,
  saveImage,
  saveText,
  newSession,
  resumeSession,
  forkSession,
  forkSummarySession,
  toggleFavorite,
  batchDeleteSessions,
  restoreSnapshot,
  getSnapshotFileContents,
  getMemoryFiles,
  saveMemoryFile,
  deleteMemoryFile,
  clearMemory,
  watchMemoryDir,
  unwatchMemoryDir
}
