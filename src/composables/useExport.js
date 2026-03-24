import { parseContentBlocks, mergeToolBlocks, getMessageRole, getRoleLabel } from './useMessageParser'
import { formatTime } from './useFormat'
import { renderMarkdown } from './useMarkdown'

// Default export options
export const defaultExportOptions = {
  showSessionId: true,
  showCwd: true,
  showToolDetail: false,
  showStats: true,
  showThinking: false
}

function messagesToMarkdown(displayMessages, session) {
  let md = `# ${session.name || 'Session'}\n\n`
  md += `> Session ID: ${session.sessionId || ''}\n`
  md += `> CWD: ${session.cwd || ''}\n\n---\n\n`

  for (const item of displayMessages) {
    const role = getMessageRole(item)
    const label = getRoleLabel(role)
    const time = formatTime(item.timestamp)
    md += `### ${label}  ${time}\n\n`

    const blocks = mergeToolBlocks(parseContentBlocks(item))
    for (const block of blocks) {
      if (block.type === 'text') {
        md += block.text + '\n\n'
      } else if (block.type === 'thinking') {
        md += `<details><summary>Thinking</summary>\n\n${block.text}\n\n</details>\n\n`
      } else if (block.type === 'tool_call') {
        md += `**${block.name}**`
        if (block.input?.file_path) md += ` \`${block.input.file_path}\``
        md += '\n\n'
        if (block.result) {
          md += `<details><summary>Result</summary>\n\n\`\`\`\n${block.result}\n\`\`\`\n\n</details>\n\n`
        }
      } else if (block.type === 'image') {
        md += `[Image]\n\n`
      }
    }
    md += '---\n\n'
  }
  return md
}

const HTML_STYLES = `
* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; padding-bottom: 4px; line-height: 1.6; }
body.light { background: #f8f9fa; color: #1a1a1a; }
body.dark { background: #1a1a1a; color: #e0e0e0; }
.session-title { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
.session-meta { font-size: 12px; opacity: 0.5; margin-bottom: 20px; }
.message { margin-bottom: 12px; padding: 14px 18px; border-radius: 10px; }
.message:last-child { margin-bottom: 0; }
.light .message-user { background: rgba(25,118,210,0.08); }
.light .message-assistant { background: rgba(0,0,0,0.03); }
.dark .message-user { background: rgba(144,202,249,0.1); }
.dark .message-assistant { background: rgba(255,255,255,0.04); }
.msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.role-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; font-weight: 500; color: #fff; }
.role-user { background: #1976d2; }
.role-assistant { background: #e0e0e0; color: #333; }
.dark .role-assistant { background: #444; color: #e0e0e0; }
.msg-time { font-size: 12px; opacity: 0.45; }
.msg-body p { margin: 0 0 8px; } .msg-body p:last-child { margin: 0; }
.msg-body h1,.msg-body h2,.msg-body h3,.msg-body h4 { margin: 14px 0 6px; }
.msg-body ul,.msg-body ol { margin: 4px 0; padding-left: 24px; }
.msg-body blockquote { border-left: 3px solid rgba(128,128,128,0.3); margin: 6px 0; padding: 2px 12px; opacity: 0.8; }
.msg-body table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 13px; }
.msg-body th,.msg-body td { border: 1px solid rgba(128,128,128,0.2); padding: 5px 10px; text-align: left; }
.light .msg-body th { background: rgba(0,0,0,0.03); }
.dark .msg-body th { background: rgba(255,255,255,0.05); }
.msg-body a { color: #1976d2; text-decoration: none; }
.dark .msg-body a { color: #90caf9; }
pre { border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 13px; line-height: 1.5; }
.light pre { background: #f0f0f0; }
.dark pre { background: #2d2d2d; }
code { font-family: 'Cascadia Code','Fira Code',Consolas,monospace; font-size: 0.9em; }
.light code { background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px; }
.dark code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; }
pre code { background: none !important; padding: 0 !important; }
.tool-card { border-left: 3px solid #0288d1; border-radius: 0 6px 6px 0; padding: 8px 12px; margin: 6px 0; font-size: 13px; }
.light .tool-card { background: rgba(2,136,209,0.05); }
.dark .tool-card { background: rgba(2,136,209,0.1); }
.tool-name { font-weight: 600; color: #0288d1; }
.tool-detail { margin-top: 6px; font-family: 'Cascadia Code',Consolas,monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; opacity: 0.7; max-height: 400px; overflow: hidden; }
.thinking { margin: 6px 0; padding: 8px 12px; border-radius: 6px; font-size: 13px; opacity: 0.6; white-space: pre-wrap; }
.light .thinking { background: rgba(0,0,0,0.03); }
.dark .thinking { background: rgba(255,255,255,0.04); }
.thinking-label { font-weight: 600; font-size: 11px; opacity: 0.5; margin-bottom: 4px; }
.stats { font-size: 11px; opacity: 0.4; margin-top: 8px; padding-top: 4px; border-top: 1px solid rgba(128,128,128,0.15); }
`

function messagesToHtml(displayMessages, session, isDark, opts = {}) {
  const options = { ...defaultExportOptions, ...opts }
  const theme = isDark ? 'dark' : 'light'

  const metaParts = []
  if (options.showSessionId && session.sessionId) metaParts.push(escHtml(session.sessionId))
  if (options.showCwd && session.cwd) metaParts.push(escHtml(session.cwd))

  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(session.name || 'Session')}</title>
<style>${HTML_STYLES}</style>
</head>
<body class="${theme}">
<div class="session-title">${escHtml(session.name || 'Session')}</div>
${metaParts.length ? `<div class="session-meta">${metaParts.join(' &middot; ')}</div>` : ''}
`

  for (const item of displayMessages) {
    const role = getMessageRole(item)
    const label = getRoleLabel(role)
    const time = formatTime(item.timestamp)

    html += `<div class="message message-${role}">\n`
    html += `<div class="msg-header"><span class="role-badge role-${role}">${escHtml(label)}</span><span class="msg-time">${escHtml(time)}</span></div>\n`
    html += `<div class="msg-body">\n`

    const blocks = mergeToolBlocks(parseContentBlocks(item))
    for (const block of blocks) {
      if (block.type === 'text') {
        if (role === 'assistant') {
          html += renderMarkdown(block.text)
        } else {
          html += `<p>${escHtml(block.text)}</p>\n`
        }
      } else if (block.type === 'thinking' && options.showThinking) {
        html += `<div class="thinking"><div class="thinking-label">Thinking</div>${escHtml(block.text)}</div>\n`
      } else if (block.type === 'tool_call') {
        html += `<div class="tool-card"><span class="tool-name">${escHtml(block.name)}</span>`
        if (block.input?.file_path) html += ` <code>${escHtml(block.input.file_path)}</code>`
        if (options.showToolDetail && block.result) {
          html += `<div class="tool-detail">${escHtml(block.result).substring(0, 2000)}</div>`
        }
        html += `</div>\n`
      } else if (block.type === 'image') {
        if (block.source?.type === 'base64') {
          html += `<img src="data:${block.source.media_type || 'image/png'};base64,${block.source.data}" style="max-width:100%;border-radius:6px;margin:6px 0" />\n`
        } else {
          html += `<p>[Image]</p>\n`
        }
      }
    }

    html += `</div>\n`

    if (options.showStats && role === 'assistant' && item._stats?.output_tokens) {
      const s = item._stats
      const parts = []
      if (s.model) parts.push(s.model)
      parts.push(`${s.input_tokens + s.cache_read} + ${s.output_tokens} tokens`)
      if (s.durationMs) parts.push(`${(s.durationMs / 1000).toFixed(1)}s`)
      if (s.stop_reason) parts.push(s.stop_reason)
      html += `<div class="stats">${escHtml(parts.join(' · '))}</div>\n`
    }

    html += `</div>\n`
  }

  html += `</body>\n</html>`
  return html
}

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportAsMarkdown(displayMessages, session) {
  return messagesToMarkdown(displayMessages, session)
}

export function exportAsHtml(displayMessages, session, isDark, opts) {
  return messagesToHtml(displayMessages, session, isDark, opts)
}
