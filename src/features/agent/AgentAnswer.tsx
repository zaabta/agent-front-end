import type { ReactNode } from 'react'
import { FileCode, FileSpreadsheet, FileText, FileType, Table2 } from 'lucide-react'

export function readableAgentText(text: string) {
  return text.replace(/Sources?:\s*((?:\[\[[^\]]+\]\]\s*,?\s*)+)/gi, (_match, block: string) => `Sources: ${[...block.matchAll(/\[\[([^\]]+)\]\]/g)].map(source => source[1]!.trim()).join(', ')}`)
}

export function hasAgentSourceReferences(text: string) {
  return text.split(/\r?\n/).some(isAgentSourceLine)
}

function extractSourceReferences(line: string) {
  const bracketed = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1]!.trim())
  if (bracketed.length) return bracketed
  const plainSources = /(?:^|,\s*)([^,]+?\.(?:pdf|docx|xlsx|xls|csv|md|txt|png|jpe?g)(?:\s+\((?:page|pages|line|lines|paragraph|paragraphs)\s+[^)]+\))?)(?=,\s*|$)/gi
  return [...line.replace(/^Sources?:\s*/i, '').matchAll(plainSources)].map(match => match[1]!.trim())
}

function isAgentSourceLine(line: string) {
  if (!/^Sources?:\s*/i.test(line)) return false
  const sources = extractSourceReferences(line)
  return sources.length > 0 && !sources.reduce((remainder, source) => remainder.replace(source, ''), line.replace(/^Sources?:\s*/i, '')).replace(/[\s,;\[\]]/g, '')
}

function sourceFileIcon(filename: string) {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension === 'pdf' || extension === 'txt') return FileText
  if (extension === 'docx') return FileType
  if (extension === 'xlsx' || extension === 'xls') return FileSpreadsheet
  if (extension === 'csv') return Table2
  if (extension === 'md') return FileCode
  return FileText
}

function AgentSourceFiles({ sources }: { sources: string[] }) {
  return <section className="agent-answer-sources" aria-label="Answer sources"><div className="agent-answer-sources-label">Sources</div><div className="agent-answer-source-list">{sources.map((source, index) => {
    const match = /^(.*?)(?:\s+\((page|pages|line|lines|paragraph|paragraphs)\s+([^)]*)\))$/i.exec(source.trim())
    const filename = (match?.[1] ?? source).trim()
    const location = match ? `${match[2]!.replace(/s$/i, '')} ${match[3]}` : ''
    const extension = filename.split('.').pop()?.toUpperCase() ?? 'FILE'
    const Icon = sourceFileIcon(filename)
    return <div className="agent-answer-source-card" key={`${source}-${index}`}><span className={`agent-answer-source-icon type-${extension.toLowerCase()}`}><Icon size={18}/><i>{extension}</i></span><span className="agent-answer-source-copy"><b title={filename}>{filename}</b><small>{location||`${extension} document`}</small></span></div>
  })}</div></section>
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
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      nodes.push(<h4 key={`h-${nodes.length}`}>{renderInline(heading[2]!)}</h4>)
      continue
    }
    const sourceReferences = extractSourceReferences(line)
    if (isAgentSourceLine(line)) {
      flushParagraph()
      flushList()
      nodes.push(<AgentSourceFiles sources={sourceReferences} key={`sources-${nodes.length}`}/>)
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
