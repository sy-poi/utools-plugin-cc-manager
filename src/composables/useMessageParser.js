import { computed } from 'vue'

// XML 标签解析
const XML_TAG_LABELS = {
  'local-command-caveat': { label: '本地命令提示', style: 'caveat' },
  'local-command-stdout': { label: 'stdout', style: 'stdout' },
  'bash-stdout': { label: 'stdout', style: 'stdout' },
  'bash-stderr': { label: 'stderr', style: 'stderr' },
  'bash-input': { label: '$ 命令', style: 'bash-input' },
  'command-name': { label: '命令', style: 'command' },
  'command-message': { label: '消息', style: 'command' },
  'command-args': { label: '参数', style: 'command' },
  'ide_opened_file': { label: 'IDE 打开文件', style: 'ide' },
  'ide_selection': { label: 'IDE 选中', style: 'ide' },
  'task-notification': { label: '任务通知', style: 'task' },
  'system-reminder': { label: '系统提示', style: 'caveat' }
}

const XML_TAG_REGEX = new RegExp(
  '<(' + Object.keys(XML_TAG_LABELS).join('|') + ')(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>',
  'g'
)

export function parseTextSegments(text) {
  if (!text) return []
  const segments = []
  let lastIndex = 0
  let match
  XML_TAG_REGEX.lastIndex = 0
  while ((match = XML_TAG_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: 'plain', text: before })
    }
    const tagName = match[1]
    const tagContent = match[2].trim()
    const meta = XML_TAG_LABELS[tagName]
    if (tagName === 'task-notification') {
      const sub = {}
      tagContent.replace(/<([a-z-]+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { sub[k] = v.trim() })
      segments.push({
        type: 'xml-tag', tag: tagName, label: meta.label, style: meta.style,
        text: sub.summary || sub.status || tagContent,
        detail: sub
      })
    } else if (tagContent || tagName === 'bash-stderr') {
      segments.push({ type: 'xml-tag', tag: tagName, label: meta.label, style: meta.style, text: tagContent })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim()
    if (rest) segments.push({ type: 'plain', text: rest })
  }
  if (segments.length === 0 && text.trim()) {
    return [{ type: 'plain', text: text }]
  }
  return segments
}

export function hasXmlTags(text) {
  if (!text) return false
  XML_TAG_REGEX.lastIndex = 0
  return XML_TAG_REGEX.test(text)
}

function parseToolResultContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') return item
      if (item.type === 'text') return item.text || ''
      if (item.type === 'tool_reference') return item.tool_name || item.tool_use_id || 'tool'
      return JSON.stringify(item)
    }).join('\n')
  }
  return JSON.stringify(content)
}

export function parseContentBlocks(item) {
  const content = item.message?.content
  if (!content) return []
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (Array.isArray(content)) {
    return content.map(block => {
      if (typeof block === 'string') return { type: 'text', text: block }
      switch (block.type) {
        case 'text':
          return { type: 'text', text: (block.text || '').replace(/^\n+/, '') }
        case 'thinking':
          return { type: 'thinking', text: block.thinking || '' }
        case 'tool_use':
          return {
            type: 'tool_use',
            name: block.name || 'Unknown',
            id: block.id || '',
            input: block.input || {}
          }
        case 'tool_result':
          return {
            type: 'tool_result',
            toolUseId: block.tool_use_id || '',
            content: parseToolResultContent(block.content),
            isError: block.is_error || false
          }
        case 'image':
          return { type: 'image', source: block.source }
        default:
          return { type: 'unknown', raw: block }
      }
    }).filter(b => {
      if (b.type === 'text' && (!b.text || !b.text.trim())) return false
      return true
    })
  }
  if (content.type === 'text') return [{ type: 'text', text: content.text || '' }]
  return [{ type: 'unknown', raw: content }]
}

export function mergeToolBlocks(blocks) {
  const result = []
  const resultMap = {}
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'tool_result' && blocks[i].toolUseId) {
      const id = blocks[i].toolUseId
      if (!resultMap[id]) resultMap[id] = []
      resultMap[id].push(blocks[i])
    }
  }
  const consumed = new Set()
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type === 'tool_use') {
      const results = resultMap[block.id] || []
      const combinedContent = results.map(r => r.content).filter(Boolean).join('\n')
      const hasError = results.some(r => r.isError)
      results.forEach(r => consumed.add(r))
      result.push({
        type: 'tool_call',
        name: block.name,
        id: block.id,
        input: block.input,
        result: combinedContent || null,
        isError: hasError
      })
    } else if (block.type === 'tool_result') {
      if (!consumed.has(block)) result.push(block)
    } else {
      result.push(block)
    }
  }
  return result
}

export function getMessageRole(item) {
  return item.message?.role || item.type || ''
}

export function getRoleLabel(role) {
  if (role === 'user') return '用户'
  if (role === 'assistant') return 'Claude'
  return role
}

export function useDisplayMessages(sessionContent) {
  return computed(() => {
    const raw = sessionContent.value.filter(item => {
      const type = item.type
      if (type !== 'user' && type !== 'assistant' && type !== 'system') return false
      if (type === 'system') {
        const content = item.message?.content
        if (!content || (typeof content === 'string' && !content.trim())) return false
        if (Array.isArray(content) && content.length === 0) return false
      }
      return true
    })

    const merged = []

    function extractStats(item) {
      const msg = item.message || {}
      const usage = msg.usage
      if (!usage) return null
      return {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation: usage.cache_creation_input_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0,
        model: msg.model || '',
        stop_reason: msg.stop_reason || '',
        durationMs: item.durationMs || 0
      }
    }

    function accumulateStats(prev, item) {
      const s = extractStats(item)
      if (!s) return
      const ps = prev._stats
      ps.input_tokens += s.input_tokens
      ps.output_tokens += s.output_tokens
      ps.cache_creation += s.cache_creation
      ps.cache_read += s.cache_read
      ps.durationMs += s.durationMs
      if (s.model) ps.model = s.model
      if (s.stop_reason) ps.stop_reason = s.stop_reason
    }

    for (const item of raw) {
      const msg = item.message || {}
      const role = msg.role || item.type
      const content = msg.content
      const blocks = Array.isArray(content) ? content : (typeof content === 'string' ? [{ type: 'text', text: content }] : [])
      const isToolResponse = role === 'user' && blocks.length > 0 && blocks.some(b => b.type === 'tool_result')
      const isSystemInjection = role === 'user' && blocks.length > 0 && blocks.every(b => b.type === 'text') && (() => {
        if (merged.length === 0) return false
        const prev = merged[merged.length - 1]
        const prevRole = prev.message?.role || prev.type
        if (prevRole !== 'assistant') return false
        const prevContent = prev.message?.content
        if (!Array.isArray(prevContent)) return false
        const lastBlock = prevContent[prevContent.length - 1]
        return lastBlock && (lastBlock.type === 'tool_use' || lastBlock.type === 'tool_result')
      })()

      if (merged.length > 0) {
        const prev = merged[merged.length - 1]
        const prevRole = prev.message?.role || prev.type
        if (role === 'assistant' && prevRole === 'assistant') {
          prev.message.content = [...(Array.isArray(prev.message.content) ? prev.message.content : []), ...blocks]
          if (msg.stop_reason) prev.message.stop_reason = msg.stop_reason
          accumulateStats(prev, item)
          continue
        }
        if (isToolResponse && prevRole === 'assistant') {
          prev.message.content = [...(Array.isArray(prev.message.content) ? prev.message.content : []), ...blocks]
          continue
        }
        if (isSystemInjection && prevRole === 'assistant') {
          const prevContent = prev.message.content
          const lastToolUse = [...prevContent].reverse().find(b => b.type === 'tool_use')
          const converted = blocks.map(b => ({
            type: 'tool_result',
            tool_use_id: lastToolUse?.id || '',
            content: b.text || ''
          }))
          prev.message.content = [...prevContent, ...converted]
          continue
        }
      }
      const initial = extractStats(item)
      merged.push({
        ...item,
        message: { ...msg, content: [...blocks] },
        _stats: initial || { input_tokens: 0, output_tokens: 0, cache_creation: 0, cache_read: 0, model: '', stop_reason: '', durationMs: 0 }
      })
    }
    // attach turn_duration
    let mergedAssistantIdx = 0
    const assistantMerged = merged.filter(m => (m.message?.role || m.type) === 'assistant')
    for (const item of sessionContent.value) {
      if (item.subtype === 'turn_duration' && item.durationMs && assistantMerged[mergedAssistantIdx]) {
        assistantMerged[mergedAssistantIdx]._stats.durationMs = item.durationMs
        mergedAssistantIdx++
      }
    }
    return merged
  })
}
