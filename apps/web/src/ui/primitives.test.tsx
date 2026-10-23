/**
 * Focused accessible-widget tests for the extracted input, button and status
 * primitives (ticket 09). Interaction/state behavior per ticket 02's allowed
 * style — typing, clicking, toggling, keyboard operation, disabled states and
 * the full STATUS icon/label/tone mapping — not render snapshots. Imports go
 * through the `../ui` compatibility barrel to pin the forwarding surface that
 * all screens still use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Avatar, Button, Check, Field, IconButton, IdLink, Input, Mono, Person, SearchBox, Segmented, Select, Sev, Status, STATUS, Textarea, Toggle,
  type StatusKind, type Tone,
} from './index'

afterEach(cleanup)

type StatusEntry = { label: string; tone: Tone; icon: LucideIcon }
const KINDS = Object.keys(STATUS) as StatusKind[]
const table = (kind: StatusKind) => STATUS[kind] as Record<string, StatusEntry>

describe('status primitives', () => {
  it('maps every STATUS category value to its icon, label and tone (never colour alone)', () => {
    expect(KINDS).toHaveLength(22)
    for (const kind of KINDS) {
      for (const [value, entry] of Object.entries(table(kind))) {
        const { container, unmount } = render(<Status kind={kind} value={value} />)
        const pill = container.firstElementChild as HTMLElement
        expect(pill.textContent, `${kind}/${value} label`).toBe(entry.label)
        const svg = pill.querySelector('svg')
        expect(svg, `${kind}/${value} icon`).not.toBeNull()
        if (kind === 'sev' && value === 'critical') {
          expect(pill.className).toContain('border-danger-fill bg-danger-fill text-white')
        } else {
          expect(pill.className, `${kind}/${value} tone`).toContain(entry.tone === 'neutral' ? 'text-muted' : `text-${entry.tone}`)
        }
        const ref = render(<entry.icon size={13} aria-hidden />)
        const refClass = (ref.container.querySelector('svg') as SVGElement).getAttribute('class')!
        expect(svg!.getAttribute('class'), `${kind}/${value} icon identity`).toContain(refClass)
        unmount()
      }
    }
  })

  it('honours label overrides, unknown-value fallback and sm/md sizes', () => {
    const override = render(<Status kind="op" value="running" label="Executing" />)
    expect(override.container.firstElementChild!.textContent).toBe('Executing')
    override.unmount()
    const fallback = render(<Status kind="op" value="mystery" />)
    const pill = fallback.container.firstElementChild as HTMLElement
    expect(pill.textContent).toBe('mystery')
    expect(pill.className).toContain('text-muted')
    fallback.unmount()
    expect((render(<Status kind="step" value="ok" />).container.firstElementChild as HTMLElement).className).toContain('h-6')
    expect((render(<Status kind="step" value="ok" size="sm" />).container.firstElementChild as HTMLElement).className).toContain('h-5')
    cleanup()
  })

  it('Sev renders severity through the sev mapping with the critical solid style', () => {
    const critical = render(<Sev v="critical" />)
    expect(critical.container.firstElementChild!.textContent).toBe('Critical')
    expect((critical.container.firstElementChild as HTMLElement).className).toContain('bg-danger-fill')
    critical.unmount()
    expect((render(<Sev v="low" />).container.firstElementChild as HTMLElement).className).toContain('text-cyan')
    cleanup()
  })
})

describe('button primitives', () => {
  const VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'dangerSolid', 'destructive'] as const
  const TOKEN: Record<(typeof VARIANTS)[number], string> = {
    primary: 'bg-primary text-primary-fg', secondary: 'bg-panel text-fg', ghost: 'bg-transparent text-muted',
    danger: 'bg-transparent text-bad', dangerSolid: 'bg-danger-fill text-white', destructive: 'bg-danger-fill text-white',
  }

  it('renders every variant with its token classes and fires clicks', async () => {
    const onClick = vi.fn()
    for (const variant of VARIANTS) {
      const { unmount } = render(<Button variant={variant} onClick={onClick}>{variant}</Button>)
      const b = screen.getByRole('button', { name: variant })
      for (const cls of TOKEN[variant].split(' ')) expect(b.className, variant).toContain(cls)
      await userEvent.click(b)
      unmount()
    }
    expect(onClick).toHaveBeenCalledTimes(VARIANTS.length)
  })

  it('stays keyboard operable, honours disabled with title, and renders the optional icon', async () => {
    const onClick = vi.fn()
    render(<><Button onClick={onClick} icon={Search}>Run</Button><Button onClick={onClick} disabled title="Not allowed">Blocked</Button></>)
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run.querySelector('svg')).not.toBeNull()
    run.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
    const blocked = screen.getByRole('button', { name: 'Blocked' })
    expect(blocked).toBeDisabled()
    expect(blocked.getAttribute('title')).toBe('Not allowed')
    await userEvent.click(blocked)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies the sm/md/lg size classes', () => {
    render(<><Button size="sm">S</Button><Button>M</Button><Button size="lg">L</Button></>)
    expect(screen.getByRole('button', { name: 'S' }).className).toContain('h-8')
    expect(screen.getByRole('button', { name: 'M' }).className).toContain('h-10')
    expect(screen.getByRole('button', { name: 'L' }).className).toContain('h-11')
  })

  it('IconButton exposes an accessible name + tooltip and forwards clicks', async () => {
    const onClick = vi.fn()
    render(<IconButton icon={Search} label="Search projects" onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Search projects' })
    expect(b.getAttribute('title')).toBe('Search projects')
    expect(b.querySelector('svg')).not.toBeNull()
    await userEvent.click(b)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('input primitives', () => {
  it('Input and Textarea type through their Field labels', async () => {
    function Hosts() {
      const [host, setHost] = useState('')
      const [notes, setNotes] = useState('')
      return <>
        <Field label="Target host" required><Input value={host} onChange={(e) => setHost(e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </>
    }
    render(<Hosts />)
    await userEvent.type(screen.getByLabelText(/Target host/), '10.0.0.8')
    await userEvent.type(screen.getByLabelText('Notes'), 'quiet scan')
    expect(screen.getByLabelText(/Target host/)).toHaveValue('10.0.0.8')
    expect(screen.getByLabelText('Notes')).toHaveValue('quiet scan')
  })

  it('Select changes value', async () => {
    function Pick() {
      const [v, setV] = useState('in')
      return <Field label="Scope status"><Select value={v} onChange={(e) => setV(e.target.value)}><option value="in">In</option><option value="out">Out</option></Select></Field>
    }
    render(<Pick />)
    await userEvent.selectOptions(screen.getByLabelText('Scope status'), 'out')
    expect(screen.getByLabelText('Scope status')).toHaveValue('out')
  })

  it('SearchBox exposes the placeholder as accessible name and reports changes', async () => {
    function Q() {
      const [q, setQ] = useState('')
      return <SearchBox value={q} onChange={setQ} placeholder="Filter findings" />
    }
    render(<Q />)
    const input = screen.getByRole('textbox', { name: 'Filter findings' })
    await userEvent.type(input, 'xss')
    expect(input).toHaveValue('xss')
  })

  it('Toggle operates by click and keyboard, reflects aria-checked, and is inert when disabled', async () => {
    function T() {
      const [on, setOn] = useState(false)
      return <Toggle on={on} onChange={setOn} label="Auto escalate" />
    }
    render(<T />)
    const sw = screen.getByRole('switch', { name: 'Auto escalate' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    const onChange = vi.fn()
    render(<Toggle on={false} onChange={onChange} label="Locked switch" disabled />)
    const locked = screen.getByRole('switch', { name: 'Locked switch' })
    expect(locked).toBeDisabled()
    await userEvent.click(locked)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Check toggles by click and stays disabled when disabled', async () => {
    function C() {
      const [c, setC] = useState(false)
      return <Check checked={c} onChange={setC} label="Redact evidence" />
    }
    render(<><C /><Check checked onChange={vi.fn()} label="Locked check" disabled /></>)
    const cb = screen.getByRole('checkbox', { name: 'Redact evidence' })
    await userEvent.click(cb)
    expect(cb).toBeChecked()
    const locked = screen.getByRole('checkbox', { name: 'Locked check' })
    expect(locked).toBeDisabled()
    await userEvent.click(locked)
    expect(locked).toBeChecked()
  })

  it('Field shows the required marker and hint, and shows the error in place of the hint', () => {
    render(<>
      <Field label="ROE version" required hint="Approved ROE required for preflight"><Input /></Field>
      <Field label="Time window" error="End must be after start"><Input /></Field>
    </>)
    expect(screen.getByText('ROE version')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Approved ROE required for preflight')).toBeInTheDocument()
    expect(screen.getByText('End must be after start')).toBeInTheDocument()
    expect(screen.getByText('Time window').closest('label')!.querySelector('.text-bad')!.textContent).toBe('End must be after start')
  })
})

describe('segmented control', () => {
  it('keeps the option label as each button accessible name inside a wrapping Field label and conveys pressed state (ticket 64)', async () => {
    function Host() {
      const [v, setV] = useState<'light' | 'dark'>('dark')
      return <Field label="Theme"><Segmented value={v} onChange={setV} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} /></Field>
    }
    render(<Host />)
    // The wrapping <label> must not override the button name ("Theme Dark").
    expect(screen.queryByRole('button', { name: /Theme / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    const dark = screen.getByRole('button', { name: 'Dark' })
    expect(dark).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('identity primitives', () => {
  it('Mono renders inline mono text', () => {
    render(<Mono className="text-bad">OP-2026-118</Mono>)
    expect(screen.getByText('OP-2026-118').className).toContain('font-mono')
  })

  it('IdLink clicks do not bubble to surrounding row handlers', async () => {
    const onId = vi.fn()
    const onRow = vi.fn()
    render(<div onClick={onRow}><IdLink onClick={onId}>RT-2026-014</IdLink></div>)
    await userEvent.click(screen.getByRole('button', { name: 'RT-2026-014' }))
    expect(onId).toHaveBeenCalledOnce()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('Avatar derives initials from the last two words and Person pairs it with the name', () => {
    render(<><Avatar name="Alex Morgan" /><Avatar name="Casey Van Der Berg" /><Person name="Taylor Chen" /></>)
    expect(screen.getByText('AM')).toBeInTheDocument()
    expect(screen.getByText('DB')).toBeInTheDocument()
    expect(screen.getByText('Taylor Chen')).toBeInTheDocument()
  })
})
