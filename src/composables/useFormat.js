export function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

export function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++ }
  return `${bytes.toFixed(1)} ${units[i]}`
}

export function shortenPath(p) {
  if (!p) return p
  const sep = p.includes('/') ? '/' : '\\'
  const parts = p.split(sep).filter(Boolean)
  if (parts.length <= 3) return p
  return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep)
}

export function shortenFilePath(p) {
  if (!p || p.length <= 40) return p
  const sep = p.includes('/') ? '/' : '\\'
  const parts = p.split(sep)
  if (parts.length <= 2) return p
  return '...' + sep + parts.slice(-2).join(sep)
}
