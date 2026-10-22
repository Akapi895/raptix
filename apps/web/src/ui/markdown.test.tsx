import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders fenced code as a preformatted block and keeps its text literal', () => {
    const { container } = render(renderMarkdown('Run this:\n```bash\nls -la /workspace\n```'))
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('ls -la /workspace\n')
    expect(screen.getByText('Run this:')).toBeTruthy()
  })

  it('renders headings, bullet lists, inline code and bold', () => {
    const { container } = render(renderMarkdown('## Findings\n- **HTTP** on `80`\n- second item'))
    expect(container.querySelector('p.font-semibold')?.textContent).toBe('Findings')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('HTTP')
    expect(container.querySelector('code')?.textContent).toBe('80')
  })

  it('renders a pipe table as a real table with header, rows and inline code in cells', () => {
    const text = 'Summary:\n| Hạng mục | Giá trị |\n|---|---|\n| Phạm vi | `10.129.84.232` host |\n| Cửa sổ | 24x7 |\n\nAfter.'
    const { container } = render(renderMarkdown(text))
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('thead th')).toHaveLength(2)
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(table?.querySelector('tbody code')?.textContent).toBe('10.129.84.232')
    expect(container.textContent).not.toContain('|---|')
    expect(screen.getByText('After.')).toBeTruthy()
  })

  it('renders a table whose separator uses one dash per column, with alignment and escaped pipes', () => {
    const text = 'Ports:\n| Port | Note |\n|:-|-:|\n| 80 | a \\| b |\n| 443 | tls |'
    const { container } = render(renderMarkdown(text))
    const table = container.querySelector('table')
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(table?.querySelectorAll('tbody td')[1]?.textContent).toBe('a | b')
    expect(container.textContent).not.toContain('|:-|-:|')
  })

  it('renders numbered lists and task checklists with the checked state', () => {
    const { container } = render(renderMarkdown('1. recon\n2. exploit\n\n- [x] scope signed\n- [ ] report'))
    expect(container.querySelector('ol')?.querySelectorAll('li')).toHaveLength(2)
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect((boxes[0] as HTMLInputElement).checked).toBe(true)
    expect((boxes[1] as HTMLInputElement).checked).toBe(false)
    expect(container.textContent).not.toContain('[x]')
  })

  it('renders blockquotes and horizontal rules instead of raw markers', () => {
    const { container } = render(renderMarkdown('> take care\n\n---\n\nDone'))
    expect(container.querySelector('blockquote')?.textContent).toBe('take care')
    expect(container.querySelector('hr')).not.toBeNull()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('never injects markup from message content', () => {
    const { container } = render(renderMarkdown('<img src=x onerror="alert(1)"> **<script>x</script>**'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})
