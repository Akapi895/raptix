/**
 * Minimal Markdown for assistant messages: fenced code, headings, bullet lists, paragraphs, inline code and bold.
 * Everything is rendered as React text nodes; no HTML is ever injected, so message content cannot run markup.
 */
import { Fragment, type ReactElement, type ReactNode } from 'react'
import { cx } from '../ui'

const FENCE = /```[\w+-]*\n([\s\S]*?)```/g
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g

export function renderMarkdown(text: string): ReactElement {
  const blocks: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0
    if (index > last) blocks.push(...renderText(text.slice(last, index), `t${last}`))
    blocks.push(
      <pre key={`code-${index}`} className="max-h-72 overflow-auto whitespace-pre rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed text-fg">
        {match[1]}
      </pre>,
    )
    last = index + match[0].length
  }
  if (last < text.length) blocks.push(...renderText(text.slice(last), `t${last}`))
  return <div className="space-y-2">{blocks}</div>
}

function renderText(chunk: string, base: string): ReactNode[] {
  const out: ReactNode[] = []
  let paragraph: string[] = []
  let items: string[] = []
  const flush = (): void => {
    if (paragraph.length > 0) {
      out.push(<p key={`${base}-p${out.length}`} className="whitespace-pre-wrap break-words">{inline(paragraph.join('\n'))}</p>)
      paragraph = []
    }
    if (items.length > 0) {
      out.push(
        <ul key={`${base}-ul${out.length}`} className="list-disc space-y-1 pl-5">
          {items.map((item, i) => <li key={i} className="break-words">{inline(item)}</li>)}
        </ul>,
      )
      items = []
    }
  }
  const lines = chunk.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]!.trim())) {
      flush()
      const header = splitRow(line)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j]!.includes('|') && lines[j]!.trim() !== '') {
        rows.push(splitRow(lines[j]!))
        j++
      }
      out.push(renderTable(header, rows, `${base}-tbl${out.length}`))
      i = j - 1
    } else if (heading) {
      flush()
      out.push(<p key={`${base}-h${out.length}`} className={cx('font-semibold text-fg', heading[1]!.length === 1 ? 'text-base' : 'text-sm')}>{inline(heading[2]!)}</p>)
    } else if (bullet) {
      if (paragraph.length > 0) flush()
      items.push(bullet[1]!)
    } else if (line.trim() === '') {
      flush()
    } else {
      if (items.length > 0) flush()
      paragraph.push(line)
    }
  }
  flush()
  return out
}

const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderTable(header: string[], rows: string[][], key: string): ReactElement {
  return (
    <div key={key} className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-subtle">
          <tr>{header.map((cell, c) => <th key={c} className="border-b border-line px-3 py-2 text-left font-semibold text-fg">{inline(cell)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line/60 last:border-0">
              {row.map((cell, c) => <td key={c} className="px-3 py-2 align-top text-fg">{inline(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const token = match[0]
    parts.push(token.startsWith('`')
      ? <code key={index} className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>
      : <strong key={index} className="font-semibold">{token.slice(2, -2)}</strong>)
    last = index + token.length
  }
  if (last < text.length) parts.push(<Fragment key={`tail-${last}`}>{text.slice(last)}</Fragment>)
  return parts
}
