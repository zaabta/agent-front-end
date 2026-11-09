import type { ReactNode } from 'react'

export function readableAgentText(text: string) {
  return text
}

function renderLines(text: string): ReactNode[] {
  const lines = text.split(/\r?\n/)
  const nodes: ReactNode[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let code: string[] | null = null

  const flushParagraph = () => {
    if (paragraph.length) nodes.push(<p dir="auto" key={`p-${nodes.length}`}>{renderInline(paragraph.join(' '))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const List = list.ordered ? 'ol' : 'ul'
    nodes.push(<List key={`list-${nodes.length}`} dir="auto">{list.items.map((item, index) => <li dir="auto" key={index}>{renderInline(item)}</li>)}</List>)
    list = null
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex]!
    const line = rawLine.trim()
    if (/^```/.test(line)) {
      flushParagraph()
      flushList()
      if (code) {
        nodes.push(<pre key={`code-${nodes.length}`} dir="ltr"><code>{code.join('\n')}</code></pre>)
        code = null
      } else code = []
      continue
    }
    if (code) {
      code.push(rawLine)
      continue
    }
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      nodes.push(<h4 key={`h-${nodes.length}`}>{renderInline(heading[2]!)}</h4>)
      continue
    }
    if (/^\|.*\|$/.test(line)) {
      flushParagraph()
      flushList()
      const rows: string[][] = []
      let cursor = lineIndex
      while (cursor < lines.length && /^\s*\|.*\|\s*$/.test(lines[cursor]!)) {
        const cells = lines[cursor]!.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
        if (!cells.every(cell => /^:?-{3,}:?$/.test(cell))) rows.push(cells)
        cursor++
      }
      nodes.push(<div className="agent-table-scroll" key={`table-${nodes.length}`}><table dir="auto"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{renderInline(cell)}</th> : <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>)}</tbody></table></div>)
      lineIndex = cursor - 1
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!)
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  if (code) nodes.push(<pre key={`code-${nodes.length}`} dir="ltr"><code>{code.join('\n')}</code></pre>)
  return nodes
}

function renderInline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  return text.split(pattern).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code dir="ltr" key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

export function AgentAnswer({ content }: { content: string }) {
  const readableContent = readableAgentText(content)
  return <div className="agent-answer-content" dir="auto">{renderLines(readableContent)}</div>
}
