/**
 * Focused accessible-widget tests for the extracted composed and domain/guard
 * blocks (ticket 12): banners, layout blocks, data display, skeletons and the
 * gating family — Gated's hover/focus/click/keyboard reason tooltip, Locked's
 * reason, ApprovalBanner states with approve/return actions, Banner tones and
 * the Card/Kpi/Progress/Skeleton/PageHeader render contracts — not render
 * snapshots. Imports go through the `../ui` compatibility barrel to pin the
 * forwarding surface that all screens still use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Search, ShieldCheck } from 'lucide-react'
import { StoreProvider } from '../store'
import { useAuthStore } from '../state/stores'
import {
  ApprovalBanner, Banner, Button, Card, CardHeader, DemoTag, DescList, Gated, Kpi, Locked, PageHeader, PageSkeleton, PersonaHint, Progress, Skeleton, Stepper, Timeline,
} from '../ui'

afterEach(cleanup)

describe('gated controls', () => {
  it('Gated renders its children interactive when allowed', async () => {
    const onRun = vi.fn()
    const { container } = render(<Gated allowed reason="Unused reason"><Button onClick={onRun}>Run scan</Button></Gated>)
    expect(container.firstElementChild).toBe(screen.getByRole('button', { name: 'Run scan' }))
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }))
    expect(onRun).toHaveBeenCalledOnce()
  })

  it('Gated keeps children visibly disabled with the reason behind hover, focus and click', async () => {
    const { container } = render(<Gated allowed={false} reason="Approval expired 24h ago"><Button>Run scan</Button></Gated>)
    const host = container.firstElementChild as HTMLElement
    const wrapper = host.firstElementChild as HTMLElement
    expect(host).toHaveAttribute('aria-disabled', 'true')
    expect(host).toHaveAttribute('tabindex', '0')
    expect(wrapper).toHaveAttribute('inert')
    expect(wrapper.className).toContain('cursor-not-allowed opacity-50')
    expect(screen.queryByRole('tooltip')).toBeNull()

    await userEvent.hover(host)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Why is this disabled?')
    expect(tip.textContent).toContain('Approval expired 24h ago')
    await userEvent.unhover(host)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(host)
    expect(screen.getByRole('tooltip')).not.toBeNull()
    fireEvent.blur(host)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(host)
    expect(screen.getByRole('tooltip')).not.toBeNull()
    fireEvent.keyDown(host, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(host, { key: 'Enter' })
    expect(screen.getByRole('tooltip')).not.toBeNull()
    fireEvent.keyDown(host, { key: 'Escape' })
    fireEvent.keyDown(host, { key: ' ' })
    expect(screen.getByRole('tooltip')).not.toBeNull()
  })

  it('Locked shows its reason with the lock icon', () => {
    const { container } = render(<Locked reason="Viewer role is read-only" />)
    expect(screen.getByText('Viewer role is read-only')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('banners', () => {
  it('ApprovalBanner renders every state title, rejected as alert, others as status', () => {
    const states = [
      ['none', 'Approval not requested', 'status'],
      ['waiting', 'Waiting for approval', 'status'],
      ['approved', 'Approved', 'status'],
      ['rejected', 'Rejected', 'alert'],
      ['expired', 'Approval expired', 'status'],
    ] as const
    for (const [state, title, role] of states) {
      const { unmount } = render(<ApprovalBanner state={state} />)
      expect(screen.getByRole(role).textContent).toContain(title)
      unmount()
    }
  })

  it('ApprovalBanner renders approve/return actions, title override and detail copy', async () => {
    const onApprove = vi.fn()
    const onReturn = vi.fn()
    render(
      <ApprovalBanner state="waiting" title="Plan needs your review" action={<><Button onClick={onApprove}>Approve</Button><Button onClick={onReturn}>Return</Button></>}>
        Submitted by Taylor Chen 24h ago.
      </ApprovalBanner>,
    )
    expect(screen.getByRole('status').textContent).toContain('Plan needs your review')
    expect(screen.getByText('Submitted by Taylor Chen 24h ago.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('button', { name: 'Return' }))
    expect(onApprove).toHaveBeenCalledOnce()
    expect(onReturn).toHaveBeenCalledOnce()
  })

  it('Banner maps each tone to its classes, default icon and alert/status role', () => {
    const tones = [
      ['info', 'text-cyan bg-info-soft border-cyan/30', 'status'],
      ['warn', 'text-warn bg-warn-soft border-warn/30', 'alert'],
      ['bad', 'text-bad bg-bad-soft border-bad/30', 'alert'],
      ['ok', 'text-ok bg-ok-soft border-ok/30', 'status'],
    ] as const
    for (const [tone, cls, role] of tones) {
      const { container, unmount } = render(<Banner tone={tone} title={`${tone} title`}>{`${tone} body`}</Banner>)
      const el = screen.getByRole(role)
      for (const c of cls.split(' ')) expect(el.className, tone).toContain(c)
      expect(el.textContent).toContain(`${tone} title`)
      expect(el.textContent).toContain(`${tone} body`)
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })

  it('Banner honours a custom icon and an action node', async () => {
    const onAction = vi.fn()
    const ref = render(<Search size={18} aria-hidden />)
    const refClass = (ref.container.querySelector('svg') as SVGElement).getAttribute('class')!
    const { container } = render(<Banner tone="info" icon={Search} action={<Button size="sm" onClick={onAction}>Fix</Button>}>body</Banner>)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('class')).toContain(refClass)
    await userEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('layout blocks', () => {
  it('Card renders children in a panel with optional padding and className', () => {
    const { container, unmount } = render(<Card className="extra">card body</Card>)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('rounded-xl border border-line bg-panel p-5 extra')
    expect(el.textContent).toBe('card body')
    unmount()
    const bare = render(<Card pad={false}>x</Card>)
    expect((bare.container.firstElementChild as HTMLElement).className).not.toContain('p-5')
  })

  it('CardHeader renders title, sub and clickable actions', async () => {
    const onAction = vi.fn()
    render(<CardHeader title="Evidence" sub="3 items attached" actions={<Button size="sm" onClick={onAction}>Attach</Button>} />)
    expect(screen.getByText('Evidence').tagName).toBe('H3')
    expect(screen.getByText('3 items attached')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('PageHeader renders title, sub, meta, actions, back navigation and breadcrumbs', async () => {
    const onBack = vi.fn()
    const onCrumb = vi.fn()
    const onAction = vi.fn()
    render(
      <PageHeader
        title="Operations" sub="All engagements" meta={<DemoTag />}
        crumbs={[{ label: 'Projects', to: onCrumb }, { label: 'RT-2026-014' }]}
        back={{ label: 'Back to projects', to: onBack }}
        actions={<Button onClick={onAction}>New operation</Button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeInTheDocument()
    expect(screen.getByText('All engagements')).toBeInTheDocument()
    expect(screen.getByText('Demo data')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to projects' }))
    expect(onBack).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(onCrumb).toHaveBeenCalledOnce()
    const current = screen.getByText('RT-2026-014')
    expect(current.tagName).toBe('SPAN')
    expect(current.closest('nav')).toHaveAttribute('aria-label', 'Breadcrumb')
    await userEvent.click(screen.getByRole('button', { name: 'New operation' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('PageHeader renders without back/crumbs/actions when omitted', () => {
    render(<PageHeader title="Dashboard" />)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('data display', () => {
  it('Kpi renders label/value/sub with tone and icon, and becomes a clickable button with onClick', async () => {
    const onClick = vi.fn()
    const { container, unmount } = render(<Kpi label="Findings" value={12} sub="still open" tone="bad" icon={Search} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.tagName).toBe('DIV')
    expect(el.textContent).toContain('Findings')
    expect(el.textContent).toContain('12')
    expect(el.textContent).toContain('still open')
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.className).not.toContain('hover:bg-hover')
    unmount()
    render(<Kpi label="Sessions" value={4} tone="ok" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: /Sessions/ })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toContain('hover:bg-hover')
    expect((btn.querySelector('.text-2xl') as HTMLElement).className).toContain('text-ok')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('Progress renders a labelled progressbar with clamped width and percentage', () => {
    render(<Progress value={42} tone="warn" label="Scan progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Scan progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = bar.firstElementChild as HTMLElement
    expect(fill.className).toContain('bg-warn')
    expect(fill.style.width).toBe('42%')
    expect(screen.getByText('42%')).toBeInTheDocument()
    cleanup()
    render(<><Progress value={150} label="Over" /><Progress value={-5} label="Under" /></>)
    const [over, under] = screen.getAllByRole('progressbar')
    expect((over.firstElementChild as HTMLElement).style.width).toBe('100%')
    expect((under.firstElementChild as HTMLElement).style.width).toBe('0%')
  })

  it('DescList renders key/value pairs and an em-dash fallback for empty values', () => {
    render(<DescList items={[{ k: 'Owner', v: 'Alex Morgan' }, { k: 'ROE', v: '' }]} cols={3} />)
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    const dl = screen.getByText('Owner').closest('dl') as HTMLElement
    expect(dl.className).toContain('lg:grid-cols-3')
  })

  it('Timeline renders entries with tone dots, sub copy and timestamps', () => {
    const { container } = render(<Timeline items={[{ at: '10:42', title: 'Preflight passed', sub: 'All checks green', tone: 'ok' }, { at: '11:00', title: 'Executed' }]} />)
    expect(screen.getByText('Preflight passed')).toBeInTheDocument()
    expect(screen.getByText('All checks green')).toBeInTheDocument()
    expect(screen.getByText('10:42')).toBeInTheDocument()
    expect(screen.getByText('Executed')).toBeInTheDocument()
    const dots = container.querySelectorAll('li span')
    expect(dots[0].className).toContain('bg-ok')
    expect(dots[1].className).toContain('bg-accent')
  })

  it('Stepper marks progress, disables future steps and jumps only to reachable steps', async () => {
    const onJump = vi.fn()
    render(<Stepper steps={['Scope', 'Preflight', 'Execute']} current={1} onJump={onJump} />)
    const done = screen.getByRole('button', { name: /Scope/ })
    const current = screen.getByRole('button', { name: /Preflight/ })
    const future = screen.getByRole('button', { name: /Execute/ })
    expect(done).toBeEnabled()
    expect(done.textContent).toContain('✓')
    expect(current).toBeEnabled()
    expect(current.className).toContain('border-accent bg-accent-soft')
    expect(future).toBeDisabled()
    await userEvent.click(done)
    expect(onJump).toHaveBeenCalledWith(0)
    await userEvent.click(future)
    expect(onJump).toHaveBeenCalledOnce()
    cleanup()
    render(<Stepper steps={['Scope']} current={0} />)
    expect(screen.getByRole('button', { name: /Scope/ })).toBeDisabled()
  })
})

describe('skeletons and tags', () => {
  it('Skeleton renders a pulsing block with merged classes', () => {
    const { container } = render(<Skeleton className="h-4 w-40" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('animate-pulse rounded-md bg-hover h-4 w-40')
  })

  it('PageSkeleton announces loading with the full block layout', () => {
    const { container } = render(<PageSkeleton />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(root).toHaveAttribute('aria-label', 'Loading data')
    expect(root.querySelectorAll('.animate-pulse')).toHaveLength(7)
  })

  it('DemoTag renders the demo-data pill', () => {
    const { container } = render(<DemoTag />)
    expect(screen.getByText('Demo data')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('persona hint', () => {
  it('explains the requirement for the current role and switches persona on click', async () => {
    useAuthStore.getState().setMe('Alex Morgan')
    render(<StoreProvider><PersonaHint need="an approved plan" persona="Taylor Chen" /></StoreProvider>)
    expect(screen.getByText('This step requires an approved plan. You are signed in as manager.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Taylor Chen' }))
    expect(screen.getByText('This step requires an approved plan. You are signed in as operator.')).toBeInTheDocument()
  })

  it('renders custom children instead of the default hint', () => {
    render(<StoreProvider><PersonaHint need="x" persona="y">Custom hint copy</PersonaHint></StoreProvider>)
    expect(screen.getByText('Custom hint copy')).toBeInTheDocument()
  })
})

describe('approval banner icon identity', () => {
  it('renders the state icon through its tone mapping', () => {
    const ref = render(<ShieldCheck size={18} aria-hidden />)
    const refClass = (ref.container.querySelector('svg') as SVGElement).getAttribute('class')!
    const { container } = render(<ApprovalBanner state="approved" />)
    expect((container.querySelector('svg') as SVGElement).getAttribute('class')).toContain(refClass)
  })
})
