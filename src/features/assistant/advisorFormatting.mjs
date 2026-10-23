const isHorizontalRule = line => /^\s*(?:(?:-{3,})|(?:\*{3,})|(?:_{3,}))\s*$/.test(line)
const isTableSeparator = cells => cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))

/** Render common Markdown conventions as clean text in the advisor chat. */
export function normalizeAdvisorAnswer(value) {
  if (typeof value !== 'string') return ''

  const source = value.replace(/\r\n?/g, '\n')
  const lines = source.split('\n').flatMap(line => {
    if (isHorizontalRule(line)) return []
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim())
      if (isTableSeparator(cells)) return []
      return [cells.length > 1 ? `• ${cells[0]}: ${cells.slice(1).join(' · ')}` : cells[0]]
    }
    return [line]
  })

  return lines.join('\n')
    .replace(/^[ \t]*```[\w-]*[ \t]*$/gm, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-+*][ \t]+/gm, '• ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/`+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim()
}
