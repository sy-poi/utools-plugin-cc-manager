import { ref } from 'vue'
import { shortenFilePath } from './useFormat'

export function formatToolInput(input) {
  if (!input || typeof input !== 'object') return ''
  const entries = Object.entries(input)
  if (entries.length === 0) return ''
  return entries.map(([key, val]) => {
    if (typeof val === 'string') return `${key}: ${val}`
    return `${key}: ${JSON.stringify(val)}`
  }).join('\n')
}

export function getToolSummary(name, input) {
  if (!input) return ''
  const filePath = input.file_path || input.path || ''
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      return filePath ? shortenFilePath(filePath) : ''
    case 'Glob':
      return input.pattern || ''
    case 'Grep':
      return input.pattern || ''
    case 'Bash':
      return input.description || (input.command?.length <= 60 ? input.command : '') || ''
    case 'WebFetch':
      return input.url || ''
    case 'WebSearch':
      return input.query || ''
    case 'Agent':
      return input.description || ''
    case 'Skill':
      return input.skill || ''
    case 'TaskCreate': case 'TaskUpdate':
      return input.subject || ''
    default:
      return filePath ? shortenFilePath(filePath) : ''
  }
}

// Diff utilities
function lcs(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const result = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift({ ai: i - 1, bi: j - 1 }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return result
}

function inlineDiff(oldLine, newLine) {
  if (!oldLine && !newLine) return { oldParts: [{ text: '', hl: false }], newParts: [{ text: '', hl: false }] }
  let pre = 0
  while (pre < oldLine.length && pre < newLine.length && oldLine[pre] === newLine[pre]) pre++
  let suf = 0
  while (suf < oldLine.length - pre && suf < newLine.length - pre && oldLine[oldLine.length - 1 - suf] === newLine[newLine.length - 1 - suf]) suf++
  const oldMid = oldLine.slice(pre, oldLine.length - suf)
  const newMid = newLine.slice(pre, newLine.length - suf)
  const prefix = oldLine.slice(0, pre)
  const suffix = oldLine.slice(oldLine.length - suf)
  return {
    oldParts: [
      ...(prefix ? [{ text: prefix, hl: false }] : []),
      ...(oldMid ? [{ text: oldMid, hl: true }] : []),
      ...(suffix ? [{ text: suffix, hl: false }] : [])
    ],
    newParts: [
      ...(prefix ? [{ text: prefix, hl: false }] : []),
      ...(newMid ? [{ text: newMid, hl: true }] : []),
      ...(suffix ? [{ text: suffix, hl: false }] : [])
    ]
  }
}

export function formatDiffLines(oldStr, newStr) {
  const oldLines = (oldStr || '').split('\n')
  const newLines = (newStr || '').split('\n')
  const common = lcs(oldLines, newLines)
  const result = []
  let oi = 0, ni = 0, added = 0, removed = 0

  function emitChanges(toOi, toNi) {
    const delLines = oldLines.slice(oi, toOi)
    const addLines = newLines.slice(ni, toNi)
    const paired = Math.min(delLines.length, addLines.length)
    for (let k = 0; k < paired; k++) {
      const { oldParts, newParts } = inlineDiff(delLines[k], addLines[k])
      result.push({ type: 'del', sign: '-', lineNo: oi + k + 1, parts: oldParts })
      result.push({ type: 'add', sign: '+', lineNo: ni + k + 1, parts: newParts })
    }
    for (let k = paired; k < delLines.length; k++)
      result.push({ type: 'del', sign: '-', lineNo: oi + k + 1, parts: [{ text: delLines[k], hl: false }] })
    for (let k = paired; k < addLines.length; k++)
      result.push({ type: 'add', sign: '+', lineNo: ni + k + 1, parts: [{ text: addLines[k], hl: false }] })
    removed += delLines.length
    added += addLines.length
  }

  for (const { ai, bi } of common) {
    emitChanges(ai, bi)
    result.push({ type: 'ctx', sign: ' ', lineNo: ai + 1, parts: [{ text: oldLines[ai], hl: false }] })
    oi = ai + 1
    ni = bi + 1
  }
  emitChanges(oldLines.length, newLines.length)

  return { lines: result, added, removed }
}

// diff cache
const diffCache = new WeakMap()
export function getDiff(block) {
  if (diffCache.has(block)) return diffCache.get(block)
  const result = formatDiffLines(block.input?.old_string, block.input?.new_string)
  diffCache.set(block, result)
  return result
}

// Collapse state management
export function useCollapse() {
  const collapsedBlocks = ref({})
  const forceExpand = ref(false)
  function toggleCollapse(key) {
    collapsedBlocks.value[key] = !(collapsedBlocks.value[key] ?? true)
  }
  function isCollapsed(key) {
    if (forceExpand.value) return false
    return collapsedBlocks.value[key] ?? true
  }
  return { collapsedBlocks, toggleCollapse, isCollapsed, forceExpand }
}
