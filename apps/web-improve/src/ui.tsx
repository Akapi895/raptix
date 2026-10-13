import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDashed, CircleDot, Clock, Eye, FileText, HelpCircle, Info, Lock, Loader2, MinusCircle, OctagonX, PauseCircle, PlayCircle, Search, Send, ShieldCheck, ShieldOff, ShieldAlert, X, XCircle, RotateCcw, Archive, Ban, Wifi, WifiOff, Power, FlaskConical, Lightbulb, Zap, TerminalSquare, Wrench, type LucideIcon } from 'lucide-react'
import { useStore } from './store'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

/* ───────────── Status (never colour alone: always icon + label) ───────────── */
type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'cyan' | 'neutral'
const TONE: Record<Tone, string> = {
  ok: 'text-ok bg-ok-soft border-ok/30', warn: 'text-warn bg-warn-soft border-warn/30', bad: 'text-bad bg-bad-soft border-bad/30',
  accent: 'text-accent bg-accent-soft border-accent-line', cyan: 'text-cyan bg-info-soft border-cyan/30', neutral: 'text-muted bg-subtle border-line',
}
const S = (label: string, tone: Tone, icon: LucideIcon) => ({ label, tone, icon })
export const STATUS = {
  project: {
    draft: S('Draft', 'neutral', CircleDashed), pending: S('Pending Approval', 'warn', Clock), approved: S('Approved', 'cyan', ShieldCheck), active: S('Active', 'ok', PlayCircle),
    review: S('Closing', 'warn', Eye), closed: S('Closed', 'neutral', Archive), rejected: S('Rejected', 'bad', XCircle), paused: S('Paused', 'warn', PauseCircle), cancelled: S('Cancelled', 'neutral', Ban),
  },
  op: {
    draft: S('Draft', 'neutral', CircleDashed), pending: S('Awaiting Approval', 'warn', Clock), ready: S('Ready', 'ok', CheckCircle2), running: S('Running', 'cyan', Loader2), paused: S('Paused', 'warn', PauseCircle),
    done: S('Completed', 'ok', CheckCircle2), error: S('Failed', 'bad', XCircle), cancelled: S('Stopped', 'neutral', Ban), estop: S('Stopped (emergency)', 'bad', OctagonX),
  },
  step: {
    ok: S('Completed', 'ok', CheckCircle2), fail: S('Failed', 'bad', XCircle), pending: S('Queued', 'neutral', Clock), running: S('Running', 'cyan', Loader2), notrun: S('Not run', 'neutral', MinusCircle), unknown: S('Unknown', 'warn', HelpCircle), review: S('Needs review', 'warn', Eye),
  },
  agent: {
    online: S('Connected', 'ok', Wifi), idle: S('Idle', 'cyan', CircleDot), lost: S('Disconnected', 'bad', WifiOff), disabled: S('Disabled', 'neutral', Power), unknown: S('Unknown', 'warn', HelpCircle), unhealthy: S('Unhealthy', 'warn', AlertTriangle),
  },
  finding: {
    draft: S('Draft', 'neutral', CircleDashed), review: S('In Review', 'warn', Eye), confirmed: S('Confirmed', 'cyan', CheckCircle2), remediation: S('In Remediation', 'cyan', Loader2),
    ai_suggested: S('AI Suggested — unverified', 'warn', Lightbulb), retest: S('Retest', 'warn', RotateCcw), resolved: S('Resolved', 'ok', ShieldCheck), returned: S('Returned', 'bad', RotateCcw),
  },
  report: {
    draft: S('Draft', 'neutral', CircleDashed), review: S('In Review', 'warn', Eye), approved: S('Approved', 'cyan', ShieldCheck), exported: S('Exported', 'cyan', FileText), delivered: S('Delivered', 'ok', Send), returned: S('Returned', 'bad', RotateCcw),
  },
  scope: { in: S('In Scope', 'ok', CheckCircle2), out: S('Out of Scope', 'bad', Ban), pending: S('Pending Approval', 'warn', Clock), unclassified: S('Unclassified', 'neutral', HelpCircle) },
  approval: { pending: S('Pending', 'warn', Clock), approved: S('Approved', 'ok', CheckCircle2), returned: S('Returned', 'bad', RotateCcw), withdrawn: S('Withdrawn', 'neutral', Ban) },
  roe: { none: S('No ROE', 'neutral', MinusCircle), draft: S('Draft', 'neutral', CircleDashed), pending: S('Pending', 'warn', Clock), approved: S('Approved', 'ok', ShieldCheck), rejected: S('Rejected', 'bad', XCircle) },
  sev: { critical: S('Critical', 'bad', ShieldAlert), high: S('High', 'bad', AlertTriangle), medium: S('Medium', 'warn', AlertTriangle), low: S('Low', 'cyan', Info), info: S('Informational', 'neutral', Info) },
  check: { pass: S('Pass', 'ok', CheckCircle2), fail: S('Fail', 'bad', XCircle), review: S('Needs review', 'warn', Eye) },
  detect: { detected: S('Detected', 'ok', CheckCircle2), undetected: S('Not Detected', 'bad', XCircle), nodata: S('Not Evaluated', 'neutral', MinusCircle) },
  integ: { connected: S('Connected', 'ok', CheckCircle2), disconnected: S('Disconnected', 'neutral', MinusCircle), authfail: S('Auth failed', 'bad', Lock) },
  generic: { ok: S('Success', 'ok', CheckCircle2), warn: S('Warning', 'warn', AlertTriangle), bad: S('Error', 'bad', XCircle), neutral: S('—', 'neutral', Circle) },
  plan: {
    draft: S('Draft', 'neutral', CircleDashed), proposed: S('Proposed', 'cyan', FileText), in_review: S('In Review', 'warn', Eye), approved: S('Approved', 'ok', ShieldCheck),
    rejected: S('Rejected', 'bad', XCircle), expired: S('Expired', 'neutral', Clock), executed: S('Executed', 'ok', PlayCircle), superseded: S('Superseded', 'neutral', Archive),
  },
  session: {
    connected: S('Connected', 'ok', Wifi), available: S('Available', 'cyan', CircleDot), awaiting: S('Awaiting Access', 'warn', Clock), suspended: S('Suspended', 'warn', PauseCircle),
    expired: S('Expired', 'neutral', Clock), terminated: S('Terminated', 'neutral', Ban), revoking: S('Revoking', 'warn', Loader2), disconnected: S('Disconnected', 'neutral', WifiOff),
  },
  perm: { none: S('No Access', 'neutral', Ban), 'read-only': S('Read-only', 'cyan', Eye), interactive: S('Interactive', 'warn', TerminalSquare) },
  c2: { healthy: S('Healthy', 'ok', CheckCircle2), degraded: S('Degraded', 'warn', AlertTriangle), offline: S('Offline', 'bad', WifiOff), maintenance: S('Maintenance', 'neutral', Wrench) },
  channel: { connected: S('Connected', 'ok', Wifi), degraded: S('Degraded', 'warn', AlertTriangle), disconnected: S('Disconnected', 'bad', WifiOff) },
  tool: {
    proposed: S('Proposed', 'neutral', CircleDashed), awaiting: S('Awaiting Approval', 'warn', Clock), allowed: S('Allowed', 'ok', CheckCircle2), denied: S('Denied', 'bad', Ban),
    running: S('Running', 'cyan', Loader2), completed: S('Completed', 'ok', CheckCircle2), failed: S('Failed', 'bad', XCircle), stopped: S('Stopped', 'neutral', OctagonX),
  },
  access: { pending: S('Pending', 'warn', Clock), approved: S('Approved', 'ok', CheckCircle2), rejected: S('Rejected', 'bad', XCircle), changes: S('Changes Requested', 'warn', RotateCcw), expired: S('Expired', 'neutral', Clock) },
  gate: { passed: S('Passed', 'ok', CheckCircle2), failed: S('Failed', 'bad', XCircle), pending: S('Pending', 'warn', Clock) },
} as const
export type StatusKind = keyof typeof STATUS

export function Status({ kind, value, size = 'md', label }: { kind: StatusKind; value: string; size?: 'sm' | 'md'; label?: string }) {
  const m = (STATUS[kind] as any)[value] as ReturnType<typeof S> | undefined
  const x = m || S(value, 'neutral', Circle)
  const I = x.icon
  const solid = kind === 'sev' && value === 'critical'
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium', solid ? 'border-bad bg-bad text-white' : TONE[x.tone], size === 'sm' ? 'h-5 px-2 text-xs' : 'h-6 px-2.5 text-xs')}>
      <I size={size === 'sm' ? 12 : 13} className={I === Loader2 ? 'motion-safe:animate-spin' : ''} aria-hidden />
      {label || x.label}
    </span>
  )
}
export const Sev = ({ v }: { v: string }) => <Status kind="sev" value={v} />
export const toneText = (t: Tone) => ({ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent', cyan: 'text-cyan', neutral: 'text-neutral' })[t]

/* ───────────── V2 badges / banners ───────────── */
export function AiModeBadge({ mode }: { mode: 'observe' | 'propose' | 'execution' }) {
  const m = {
    observe: { label: 'Observe', icon: Eye, cls: 'border-cyan/30 bg-info-soft text-cyan' },
    propose: { label: 'Propose', icon: Lightbulb, cls: 'border-warn/30 bg-warn-soft text-warn' },
    execution: { label: 'Approved Execution', icon: Zap, cls: 'border-accent bg-panel text-accent' },
  }[mode]
  return <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', m.cls)}><m.icon size={13} aria-hidden />{m.label}</span>
}
export function ApprovalBanner({ state, title, children, action }: { state: 'none' | 'waiting' | 'approved' | 'rejected' | 'expired'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const m = {
    none: { t: 'Approval not requested', icon: ShieldOff, cls: 'border-line bg-subtle text-muted' },
    waiting: { t: 'Waiting for approval', icon: Clock, cls: 'border-warn/30 bg-warn-soft text-warn' },
    approved: { t: 'Approved', icon: ShieldCheck, cls: 'border-ok/30 bg-ok-soft text-ok' },
    rejected: { t: 'Rejected', icon: XCircle, cls: 'border-bad/30 bg-bad-soft text-bad' },
    expired: { t: 'Approval expired', icon: Clock, cls: 'border-line bg-subtle text-muted' },
  }[state]
  return (
    <div role={state === 'rejected' ? 'alert' : 'status'} className={cx('flex w-full items-start gap-3 rounded-xl border px-4 py-3', m.cls)}>
      <m.icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{title || m.t}</div>
        {children && <div className="mt-0.5 text-fg/90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
export const DemoTag = () => <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border border-line bg-subtle px-2 text-xs font-medium text-muted"><FlaskConical size={12} aria-hidden />Demo data</span>
export const ConsolePane = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('no-scrollbar overflow-auto rounded-lg border border-console-line bg-console font-mono text-[12.5px] leading-relaxed text-console-fg', className)}>{children}</div>
)
export type ReasonCodeValue = 'Missing approval' | 'Out of scope' | 'Expired grant' | 'Agent unavailable' | 'Project not selected' | 'Permission denied'
export function ReasonCode({ code }: { code: ReasonCodeValue }) {
  const I = ({ 'Missing approval': Clock, 'Out of scope': Ban, 'Expired grant': Clock, 'Agent unavailable': WifiOff, 'Project not selected': Info, 'Permission denied': Lock } as Record<string, LucideIcon>)[code] || Info
  return <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-subtle px-1.5 text-xs font-medium text-muted"><I size={12} aria-hidden />{code}</span>
}

/* ───────────── Button ───────────── */
type BtnV = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid' | 'destructive'
const BV: Record<BtnV, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-press border border-transparent',
  secondary: 'bg-panel text-fg border border-line hover:bg-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-fg border border-transparent',
  danger: 'bg-transparent text-bad border border-bad/50 hover:bg-bad-soft',
  dangerSolid: 'bg-bad text-white hover:brightness-110 border border-transparent',
  destructive: 'bg-bad text-white hover:brightness-110 border border-transparent',
}
export function Button({ variant = 'secondary', size = 'md', icon: I, children, className, disabled, title, ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnV; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  return (
    <button
      {...r} disabled={disabled} title={title}
      className={cx('inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45', size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-11 px-5 text-sm' : 'h-10 px-4 text-sm', BV[variant], className)}
    >
      {I && <I size={size === 'sm' ? 14 : 16} aria-hidden />}
      {children}
    </button>
  )
}
export function IconButton({ icon: I, label, className, ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button {...r} aria-label={label} title={label} className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40', className)}>
      <I size={18} aria-hidden />
    </button>
  )
}

/* ───────────── Layout ───────────── */
export const Card = ({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) => (
  <div className={cx('rounded-xl border border-line bg-panel', pad && 'p-5', className)}>{children}</div>
)
export function CardHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
export function PageHeader({ title, sub, actions, back, meta, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { label: string; to: () => void }; meta?: ReactNode; crumbs?: { label: string; to?: () => void }[] }) {
  return (
    <div className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {c.to ? <button onClick={c.to} className="hover:text-fg hover:underline">{c.label}</button> : <span className="text-fg">{c.label}</span>}
              {i < crumbs.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
        </nav>
      )}
      {back && (
        <button onClick={back.to} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ChevronLeft size={14} /> {back.label}
        </button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
            {meta}
          </div>
          {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; count?: number; icon?: LucideIcon }[]; value: string; onChange: (id: string) => void }) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])
    if (!buttons.length) return
    e.preventDefault()
    const current = buttons.indexOf(e.currentTarget)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    buttons[next].click()
  }
  return (
    <div role="tablist" className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onKeyDown={onKeyDown} onClick={() => onChange(t.id)}
          className={cx('-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition', value === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.icon && <t.icon size={15} aria-hidden />}
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-hover px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[10px] border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id} className={cx('h-8 rounded-md px-3 text-xs font-medium transition', value === o.id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}>{o.label}</button>
      ))}
    </div>
  )
}

/* ───────────── Banner / empty / skeleton ───────────── */
export function Banner({ tone = 'info', title, children, action, icon }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
    const m = { info: ['text-cyan bg-info-soft border-cyan/30', Info], warn: ['text-warn bg-warn-soft border-warn/30', AlertTriangle], bad: ['text-bad bg-bad-soft border-bad/30', XCircle], ok: ['text-ok bg-ok-soft border-ok/30', CheckCircle2] }[tone] as [string, LucideIcon]
  const I = icon || m[1]
  return (
    <div role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'} className={cx('mb-4 flex items-start gap-3 rounded-xl border px-4 py-3', m[0])}>
      <I size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-fg/90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
export function Empty({ icon: I = FileText, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-hover text-muted"><I size={22} aria-hidden /></div>
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('animate-pulse rounded-md bg-hover', className)} />
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading data">
      <Skeleton className="mb-3 h-7 w-64" /><Skeleton className="mb-8 h-4 w-96" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-72" />
    </div>
  )
}

/* ───────────── Forms ───────────── */
const fieldCls = 'w-full rounded-[10px] border border-line bg-panel px-3 text-sm text-fg placeholder:text-neutral outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50'
export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}{required && <span className="text-bad"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{error}</span> : hint ? <span className="mt-1 block text-xs text-neutral">{hint}</span> : null}
    </label>
  )
}
export const Input = ({ className, ...r }: InputHTMLAttributes<HTMLInputElement>) => <input {...r} className={cx(fieldCls, 'h-10', className)} />
export const Textarea = ({ className, ...r }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...r} className={cx(fieldCls, 'min-h-24 py-2.5 leading-relaxed', className)} />
export const Select = ({ className, children, ...r }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...r} className={cx(fieldCls, 'h-10 appearance-none pr-8', className)}>{children}</select>
export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral" aria-hidden />
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(fieldCls, 'h-10 pl-9')} />
    </div>
  )
}
export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--c-accent)]" />
      {label}
    </label>
  )
}
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cx('relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50', on ? 'border-accent bg-accent' : 'border-line bg-hover')}>
      <span className={cx('absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all', on ? 'left-[22px]' : 'left-0.5')} style={{ width: 18, height: 18 }} />
    </button>
  )
}
export function FilterBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  )
}

/* ───────────── Table ───────────── */
export interface Col<T> { key: string; header: ReactNode; render: (r: T) => ReactNode; width?: string; className?: string; hideBelow?: 'md' | 'lg' }
export function Table<T>({ cols, rows, rowKey, onRow, empty, dense, selectedKey }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode; dense?: boolean; selectedKey?: string }) {
  if (!rows.length) return <>{empty || <Empty title="No data yet" />}</>
  return (
    <div className="no-scrollbar overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
            {cols.map((c) => <th key={c.key} style={{ width: c.width }} className={cx('h-11 whitespace-nowrap px-4 font-medium', c.hideBelow === 'md' && 'max-md:hidden', c.hideBelow === 'lg' && 'max-lg:hidden', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
              className={cx('border-b border-line/60 last:border-0', dense ? 'h-12' : 'h-14', onRow && 'cursor-pointer transition hover:bg-hover', selectedKey === rowKey(r) && 'bg-hover')}
            >
              {cols.map((c) => <td key={c.key} className={cx('px-4 align-middle', c.hideBelow === 'md' && 'max-md:hidden', c.hideBelow === 'lg' && 'max-lg:hidden', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function usePaged<T>(rows: T[], size = 10) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(page, pages)
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, setPage, total: rows.length }
}
export function Pager({ page, pages, setPage, total }: { page: number; pages: number; setPage: (n: number) => void; total: number }) {
  if (pages <= 1) return <div className="mt-3 text-xs text-muted">{total} records</div>
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>{total} records</span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="!h-8 !w-8" />
        <span className="px-2">Page {page} of {pages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="!h-8 !w-8" />
      </div>
    </div>
  )
}

/* ───────────── Modal / Drawer ───────────── */
function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => !el.closest('[inert]'))
    const topmost = () => {
      const layers = document.querySelectorAll('[data-dialog-layer]')
      return layers[layers.length - 1] === dialog
    }
    const h = (e: KeyboardEvent) => {
      if (!topmost()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', h)
    requestAnimationFrame(() => (focusable()[0] || dialog).focus())
    return () => {
      document.removeEventListener('keydown', h)
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus())
    }
  }, [open])
  return ref
}

export function Modal({ open, onClose, title, children, footer, width = 520, danger }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; danger?: boolean }) {
  const titleId = useId()
  const ref = useDialogFocus<HTMLDivElement>(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div ref={ref} data-dialog-layer role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ maxWidth: width }} className={cx('relative flex max-h-[90vh] w-full flex-col rounded-2xl border bg-panel shadow-xl outline-none', danger ? 'border-bad/50' : 'border-line')}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} className="!h-8 !w-8" />
        </div>
        <div className="overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
export function Drawer({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const titleId = useId()
  const ref = useDialogFocus<HTMLElement>(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside ref={ref} data-dialog-layer role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ maxWidth: width }} className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} className="!h-8 !w-8" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </aside>
    </div>
  )
}
export function Menu({ trigger, items, align = 'right' }: { trigger: ReactNode; items: { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div role="menu" className={cx('absolute top-full z-50 mt-1 min-w-52 rounded-xl border border-line bg-panel p-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint} onClick={() => { setOpen(false); it.onClick() }} className={cx('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-hover disabled:opacity-40', it.danger ? 'text-bad' : 'text-fg')}>
              {it.icon && <it.icon size={15} aria-hidden />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────── Data display ───────────── */
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('font-mono text-[13px]', className)}>{children}</span>
export const IdLink = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={(e) => { e.stopPropagation(); onClick() }} className="font-mono text-[13px] text-accent hover:underline">{children}</button>
export function DescList({ items, cols = 2 }: { items: { k: ReactNode; v: ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-8 gap-y-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((i, n) => (
        <div key={n} className="min-w-0"><dt className="mb-1 text-xs text-muted">{i.k}</dt><dd className="break-words text-sm text-fg">{i.v || '—'}</dd></div>
      ))}
    </dl>
  )
}
export function Kpi({ label, value, sub, tone, onClick, icon: I }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void; icon?: LucideIcon }) {
  const C: any = onClick ? 'button' : 'div'
  return (
    <C onClick={onClick} className={cx('rounded-xl border border-line bg-panel p-4 text-left', onClick && 'transition hover:bg-hover')}>
      <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>{label}</span>{I && <I size={15} aria-hidden className={tone ? toneText(tone) : ''} />}</div>
      <div className={cx('text-2xl font-semibold tabular-nums', tone && toneText(tone))}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </C>
  )
}
export function Progress({ value, tone = 'accent', label }: { value: number; tone?: Tone; label?: string }) {
  const bg = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-accent', cyan: 'bg-cyan', neutral: 'bg-neutral' }[tone]
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover"><div className={cx('h-full rounded-full', bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
      <span className="w-9 text-right text-xs tabular-nums text-muted">{value}%</span>
    </div>
  )
}
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const ini = name.split(' ').slice(-2).map((x) => x[0]).join('').toUpperCase()
  return <span style={{ width: size, height: size, fontSize: size * 0.4 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent" aria-hidden>{ini}</span>
}
export const Person = ({ name }: { name: string }) => <span className="inline-flex items-center gap-2"><Avatar name={name} size={24} />{name}</span>
export function Timeline({ items }: { items: { at: string; title: ReactNode; sub?: ReactNode; tone?: Tone }[] }) {
  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((i, n) => (
        <li key={n} className="relative pb-5 pl-6 last:pb-0">
          <span className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-panel', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-accent', cyan: 'bg-cyan', neutral: 'bg-neutral' }[i.tone || 'accent'])} />
          <div className="text-sm text-fg">{i.title}</div>
          {i.sub && <div className="mt-0.5 text-xs text-muted">{i.sub}</div>}
          <div className="mt-0.5 font-mono text-xs text-neutral">{i.at}</div>
        </li>
      ))}
    </ol>
  )
}
export function Stepper({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="no-scrollbar mb-6 flex gap-2 overflow-x-auto">
      {steps.map((s, i) => (
        <li key={s} className="flex-1" style={{ minWidth: 130 }}>
          <button disabled={!onJump || i > current} onClick={() => onJump?.(i)} className={cx('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition', i === current ? 'border-accent bg-accent-soft text-fg' : i < current ? 'border-ok/40 text-fg hover:bg-hover' : 'border-line text-muted')}>
            <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold', i < current ? 'bg-ok text-white' : i === current ? 'bg-accent text-white' : 'bg-hover')}>{i < current ? '✓' : i + 1}</span>
            <span className="font-medium">{s}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ───────────── SVG charts ───────────── */
export function Donut({ data, size = 140, center }: { data: { label: string; value: number; color: string }[]; size?: number; center?: ReactNode }) {
  const total = data.reduce((a, b) => a + b.value, 0)
  const r = size / 2 - 12, c = 2 * Math.PI * r
  let off = 0
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-hover)" strokeWidth={14} />
        {total > 0 && data.map((d) => { const len = (d.value / total) * c; const el = <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={14} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />; off += len; return el })}
      </svg>
      <div className="absolute text-center">{center}</div>
    </div>
  )
}
export function Legend({ data }: { data: { label: string; value: number | string; color: string }[] }) {
  return <ul className="space-y-1.5 text-xs">{data.map((d) => <li key={d.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} /><span className="text-muted">{d.label}</span><span className="ml-auto font-medium tabular-nums">{d.value}</span></li>)}</ul>
}
export function BarChart({ data, height = 160, color = 'var(--c-accent)' }: { data: { label: string; value: number; color?: string }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')} className="flex items-end gap-3" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
          <span className="text-xs tabular-nums text-muted">{d.value}</span>
          <div className="w-full max-w-10 rounded-t-md" style={{ height: `${(d.value / max) * (height - 44)}px`, minHeight: 2, background: d.color || color }} />
          <span className="truncate text-xs text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  )
}
export function LineChart({ series, labels, height = 160 }: { series: { name: string; values: number[]; color: string }[]; labels: string[]; height?: number }) {
  const W = 480, H = height, pad = 24
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, labels.length - 1)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {[0, 0.5, 1].map((t) => <line key={t} x1={pad} x2={W - pad} y1={y(max * t)} y2={y(max * t)} stroke="var(--c-line)" strokeDasharray="3 4" />)}
      {series.map((s) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />)}
        </g>
      ))}
      {labels.map((l, i) => <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--c-muted)">{l}</text>)}
    </svg>
  )
}

/* ───────────── Guards ───────────── */
/** Visibly disabled control; hover, focus or click explains why */
export function Gated({ allowed, reason, children }: { allowed: boolean; reason: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (allowed) return <>{children}</>
  return (
    <span
      className="relative inline-flex" aria-disabled="true" tabIndex={0}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' || e.key === ' ') setOpen(true) }}
    >
      <span className="inline-flex cursor-not-allowed opacity-50" inert>{children}</span>
      {open && (
        <span role="tooltip" className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-line bg-panel p-3 text-left shadow-xl">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg"><Lock size={12} aria-hidden />Why is this disabled?</span>
          <span className="block text-xs font-normal text-muted">{reason}</span>
        </span>
      )}
    </span>
  )
}
/** Shows why an action is locked (no permission / read-only) */
export function Locked({ reason }: { reason: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Lock size={13} aria-hidden />{reason}</span>
}
/** Blocks actions on read-only projects; always with a reason */
export function useGuard(projectId?: string) {
  const s = useStore()
  const ro = s.readOnly(projectId)
  const p = s.db.projects.find((x) => x.id === (projectId || s.pid))
  const reason = !ro ? '' : s.me.role === 'viewer' ? 'The Viewer role has read-only access.' : p && p.status === 'closed' ? 'Project is closed — read-only.' : 'Project is read-only.'
  return { ro, reason }
}
/** Suggests switching persona when the current role cannot perform the next demo step */
export function PersonaHint({ need, persona, children }: { need: string; persona: string; children?: ReactNode }) {
  const { me, setMe } = useStore()
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-hover/50 px-4 py-3 text-sm">
      <Info size={16} className="text-cyan" aria-hidden />
      <span className="flex-1 text-muted">{children || `This step requires ${need}. You are signed in as ${me.role}.`}</span>
      <Button size="sm" onClick={() => setMe(persona)}>Switch to {persona}</Button>
    </div>
  )
}

export function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}
export const useMemoList = useMemo
