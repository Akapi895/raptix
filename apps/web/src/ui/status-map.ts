import { AlertTriangle, Archive, Ban, CheckCircle2, Circle, CircleDashed, CircleDot, Clock, Eye, FileText, HelpCircle, Info, Lightbulb, Loader2, Lock, MinusCircle, OctagonX, PauseCircle, PlayCircle, Power, RotateCcw, Send, ShieldAlert, ShieldCheck, TerminalSquare, Wifi, WifiOff, Wrench, XCircle, type LucideIcon } from 'lucide-react'

/* ───────────── Status (never colour alone: always icon + label) ───────────── */
export type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'cyan' | 'neutral'
export const TONE: Record<Tone, string> = {
  ok: 'text-ok bg-ok-soft border-ok/30', warn: 'text-warn-text bg-warn-soft border-warn/30', bad: 'text-bad bg-bad-soft border-bad/30',
  accent: 'text-accent bg-accent-soft border-accent-line', cyan: 'text-cyan bg-info-soft border-cyan/30', neutral: 'text-muted bg-subtle border-line',
}
export const S = (label: string, tone: Tone, icon: LucideIcon) => ({ label, tone, icon })
export const STATUS = {
  project: {
    draft: S('Draft', 'neutral', CircleDashed), pending: S('Pending Approval', 'warn', Clock), approved: S('Approved', 'cyan', ShieldCheck), active: S('Active', 'ok', PlayCircle),
    review: S('Closing', 'warn', Eye), closed: S('Closed', 'neutral', Archive), rejected: S('Rejected', 'bad', XCircle), paused: S('Paused', 'warn', PauseCircle), cancelled: S('Cancelled', 'neutral', Ban),
    planning: S('Planning', 'cyan', CircleDashed), running: S('Running', 'cyan', Loader2), completed: S('Completed', 'ok', CheckCircle2), failed: S('Failed', 'bad', XCircle),
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
export const toneText = (t: Tone) => ({ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent', cyan: 'text-cyan', neutral: 'text-neutral' })[t]
