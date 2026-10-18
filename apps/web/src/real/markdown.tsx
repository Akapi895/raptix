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
  for (const line of chunk.split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (heading) {
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
