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

  it('never injects markup from message content', () => {
    const { container } = render(renderMarkdown('<img src=x onerror="alert(1)"> **<script>x</script>**'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})
