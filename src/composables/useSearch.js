import { ref, computed, watch } from 'vue'

export function useSearch() {
  const searchVisible = ref(false)
  const searchText = ref('')
  const matchIndex = ref(0)
  const matchCount = ref(0)

  function openSearch() {
    searchVisible.value = true
  }

  function closeSearch() {
    searchVisible.value = false
    searchText.value = ''
    clearHighlights()
  }

  function clearHighlights() {
    document.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode
      parent.replaceChild(document.createTextNode(el.textContent), el)
      parent.normalize()
    })
    matchCount.value = 0
    matchIndex.value = 0
  }

  function doSearch() {
    clearHighlights()
    const query = searchText.value.trim()
    if (!query) return

    const container = document.querySelector('.content-body')
    if (!container) return

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.toLowerCase().includes(query.toLowerCase())) {
        textNodes.push(walker.currentNode)
      }
    }

    let count = 0
    for (const node of textNodes) {
      const text = node.textContent
      const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      const parts = text.split(regex)
      if (parts.length <= 1) continue

      const fragment = document.createDocumentFragment()
      for (const part of parts) {
        if (part.toLowerCase() === query.toLowerCase()) {
          const span = document.createElement('span')
          span.className = 'search-highlight'
          span.dataset.matchIndex = count
          span.textContent = part
          fragment.appendChild(span)
          count++
        } else {
          fragment.appendChild(document.createTextNode(part))
        }
      }
      node.parentNode.replaceChild(fragment, node)
    }
    matchCount.value = count
    matchIndex.value = count > 0 ? 0 : -1
    if (count > 0) scrollToMatch(0)
  }

  function scrollToMatch(index) {
    document.querySelectorAll('.search-highlight.active').forEach(el => el.classList.remove('active'))
    const matches = document.querySelectorAll('.search-highlight')
    if (matches[index]) {
      matches[index].classList.add('active')
      matches[index].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function nextMatch() {
    if (matchCount.value === 0) return
    matchIndex.value = (matchIndex.value + 1) % matchCount.value
    scrollToMatch(matchIndex.value)
  }

  function prevMatch() {
    if (matchCount.value === 0) return
    matchIndex.value = (matchIndex.value - 1 + matchCount.value) % matchCount.value
    scrollToMatch(matchIndex.value)
  }

  return {
    searchVisible, searchText, matchIndex, matchCount,
    openSearch, closeSearch, doSearch, nextMatch, prevMatch
  }
}
