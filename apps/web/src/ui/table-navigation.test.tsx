/**
 * Focused accessible-widget tests for the extracted table, pagination and tab
 * navigation primitives (ticket 10). Interaction/state behavior — row click
 * and Enter activation, responsive column classing, empty states, pager page
 * changes and boundary clamping, tab selection with arrow/Home/End roving,
 * segmented selection — not render snapshots. Imports go through the `../ui`
 * compatibility barrel to pin the forwarding surface that all screens use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { FilterBar, Pager, Segmented, Table, Tabs, usePaged, type Col } from '../ui'

afterEach(cleanup)

type Row = { id: string; name: string; role: string }
const ROWS: Row[] = [
  { id: 'a', name: 'ada', role: 'admin' },
  { id: 'b', name: 'bob', role: 'viewer' },
  { id: 'c', name: 'cy', role: 'operator' },
]
const cols: Col<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name },
  { key: 'role', header: 'Role', render: (r) => r.role, hideBelow: 'md', className: 'text-muted' },
  { key: 'note', header: 'Note', render: (r) => `note-${r.id}`, hideBelow: 'lg' },
]

describe('table primitive', () => {
  it('renders headers and cells with width, className and responsive hideBelow classing', () => {
    render(<Table cols={cols} rows={ROWS} rowKey={(r) => r.id} />)
    const name = screen.getByRole('columnheader', { name: 'Name' })
    expect(name.className).toContain('h-11')
    const role = screen.getByRole('columnheader', { name: 'Role' })
    expect(role.className).toContain('max-md:hidden')
    expect(role.className).toContain('text-muted')
    expect(screen.getByRole('columnheader', { name: 'Note' }).className).toContain('max-lg:hidden')
    expect(screen.getByRole('cell', { name: 'viewer' }).className).toContain('max-md:hidden')
    expect(screen.getByRole('cell', { name: 'note-b' }).className).toContain('max-lg:hidden')
  })

  it('activates rows by click and Enter, exposes them as focusable, and highlights the selected key', async () => {
    const onRow = vi.fn()
    render(<Table cols={cols} rows={ROWS} rowKey={(r) => r.id} onRow={onRow} selectedKey="b" />)
    const ada = screen.getByRole('cell', { name: 'ada' }).closest('tr') as HTMLElement
    const bob = screen.getByRole('cell', { name: 'bob' }).closest('tr') as HTMLElement
    expect(ada.getAttribute('tabindex')).toBe('0')
    expect(ada.className).toContain('cursor-pointer')
    expect(bob.classList.contains('bg-hover')).toBe(true)
    expect(ada.classList.contains('bg-hover')).toBe(false)
    await userEvent.click(ada)
    fireEvent.keyDown(bob, { key: 'Enter' })
    expect(onRow).toHaveBeenCalledTimes(2)
    expect(onRow).toHaveBeenNthCalledWith(1, ROWS[0])
    expect(onRow).toHaveBeenNthCalledWith(2, ROWS[1])
  })

  it('renders static rows (no tabIndex, no activation) and the dense row height', () => {
    render(<Table cols={cols} rows={ROWS} rowKey={(r) => r.id} dense />)
    const row = screen.getByRole('cell', { name: 'ada' }).closest('tr') as HTMLElement
    expect(row.getAttribute('tabindex')).toBeNull()
    expect(row.className).not.toContain('cursor-pointer')
    expect(row.className).toContain('h-12')
    expect(row.className).not.toContain('h-14')
  })

  it('renders the default Empty state for no rows and honours a custom empty node', () => {
    const { unmount } = render(<Table cols={cols} rows={[]} rowKey={(r) => r.id} />)
    expect(screen.getByText('No data yet')).toBeInTheDocument()
    unmount()
    render(<Table cols={cols} rows={[]} rowKey={(r) => r.id} empty={<div>Nothing scoped</div>} />)
    expect(screen.getByText('Nothing scoped')).toBeInTheDocument()
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument()
  })
})

describe('pagination (usePaged + Pager)', () => {
  function Host({ total, size = 10 }: { total: number; size?: number }) {
    const rows = Array.from({ length: total }, (_, i) => ({ id: String(i + 1) }))
    const pg = usePaged(rows, size)
    return <>
      <ul>{pg.rows.map((r) => <li key={r.id}>{r.id}</li>)}</ul>
      <Pager page={pg.page} pages={pg.pages} setPage={pg.setPage} total={pg.total} />
    </>
  }

  it('slices rows per page and moves through pages with boundary-disabled buttons', async () => {
    render(<Host total={25} />)
    expect(screen.getByText('25 total records')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByText('10')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.queryByText('10')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByText('21')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.queryByText('11')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('collapses to a records label on a single page and for empty data', () => {
    const { unmount } = render(<Host total={5} />)
    expect(screen.getByText('Showing all 5 records')).toBeInTheDocument()
    expect(screen.queryByText(/Page /)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
    unmount()
    render(<Host total={0} />)
    expect(screen.getByText('Showing all 0 records')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('clamps the current page when the dataset shrinks below it', async () => {
    function Shrinking() {
      const [total, setTotal] = useState(25)
      const rows = Array.from({ length: total }, (_, i) => ({ id: String(i + 1) }))
      const pg = usePaged(rows, 10)
      return <>
        <button onClick={() => setTotal(5)}>shrink</button>
        <ul>{pg.rows.map((r) => <li key={r.id}>{r.id}</li>)}</ul>
        <Pager page={pg.page} pages={pg.pages} setPage={pg.setPage} total={pg.total} />
      </>
    }
    render(<Shrinking />)
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'shrink' }))
    expect(screen.getByText('Showing all 5 records')).toBeInTheDocument()
    expect(screen.queryByText(/Page /)).not.toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('21')).not.toBeInTheDocument()
  })
})

describe('tabs primitive', () => {
  const tabs = [
    { id: 'all', label: 'All', count: 12 },
    { id: 'ops', label: 'Operations', icon: Search, count: 3 },
    { id: 'log', label: 'Log' },
  ]
  function Host() {
    const [value, setValue] = useState('all')
    return <Tabs tabs={tabs} value={value} onChange={setValue} />
  }

  it('changes value on click and reflects aria-selected, roving tabindex, counts and icons', async () => {
    render(<Host />)
    const all = screen.getByRole('tab', { name: /All/ })
    const ops = screen.getByRole('tab', { name: /Operations/ })
    const log = screen.getByRole('tab', { name: 'Log' })
    expect(all.getAttribute('aria-selected')).toBe('true')
    expect(all.getAttribute('tabindex')).toBe('0')
    expect(ops.getAttribute('aria-selected')).toBe('false')
    expect(ops.getAttribute('tabindex')).toBe('-1')
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(ops.querySelector('svg')).not.toBeNull()
    expect(log.querySelector('svg')).toBeNull()
    await userEvent.click(ops)
    expect(ops.getAttribute('aria-selected')).toBe('true')
    expect(all.getAttribute('aria-selected')).toBe('false')
    expect(ops.getAttribute('tabindex')).toBe('0')
    expect(all.getAttribute('tabindex')).toBe('-1')
  })

  it('roves focus and selection with Arrow keys and jumps with Home/End', async () => {
    render(<Host />)
    const all = screen.getByRole('tab', { name: /All/ })
    const ops = screen.getByRole('tab', { name: /Operations/ })
    const log = screen.getByRole('tab', { name: 'Log' })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(log.ownerDocument.activeElement).toBe(ops)
    expect(ops.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowRight}')
    expect(log.ownerDocument.activeElement).toBe(log)
    expect(log.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowRight}')
    expect(log.ownerDocument.activeElement).toBe(all) // wraps
    expect(all.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(log.ownerDocument.activeElement).toBe(log)
    expect(log.getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{End}')
    expect(log.ownerDocument.activeElement).toBe(log)
    await userEvent.keyboard('{Home}')
    expect(log.ownerDocument.activeElement).toBe(all)
    expect(all.getAttribute('aria-selected')).toBe('true')
  })

  it('ignores unrelated keys without moving selection', async () => {
    render(<Host />)
    const all = screen.getByRole('tab', { name: /All/ })
    all.focus()
    await userEvent.keyboard('{Enter}')
    expect(all.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Operations/ }).getAttribute('aria-selected')).toBe('false')
  })
})

describe('segmented primitive', () => {
  it('selects an option on click and reflects aria-pressed', async () => {
    function Host() {
      const [v, setV] = useState<'outline' | 'detail'>('outline')
      return <Segmented options={[{ id: 'outline', label: 'Outline' }, { id: 'detail', label: 'Detail' }]} value={v} onChange={setV} />
    }
    render(<Host />)
    const outline = screen.getByRole('button', { name: 'Outline' })
    const detail = screen.getByRole('button', { name: 'Detail' })
    expect(outline.getAttribute('aria-pressed')).toBe('true')
    expect(detail.getAttribute('aria-pressed')).toBe('false')
    expect(outline.className).toContain('bg-panel')
    await userEvent.click(detail)
    expect(detail.getAttribute('aria-pressed')).toBe('true')
    expect(outline.getAttribute('aria-pressed')).toBe('false')
    expect(detail.className).toContain('bg-panel')
    expect(outline.className).not.toContain('bg-panel')
  })
})

describe('filter bar', () => {
  it('renders children and the right-aligned action slot', () => {
    render(<FilterBar right={<span>actions</span>}><span>filters</span></FilterBar>)
    expect(screen.getByText('filters')).toBeInTheDocument()
    expect(screen.getByText('actions').parentElement!.className).toContain('ml-auto')
  })
})
