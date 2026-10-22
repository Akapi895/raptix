/**
 * System error pages (ticket 61a) — the semantic owners of the 403/404/500/
 * offline/session-expired routes (`forbidden`, `notfound`, `error`, `offline`,
 * `session-expired`; route-inventory rows 2–6). Every page renders its
 * failure reason and a recovery path: navigation goes through the router seam
 * (`src/shell/system/nav.ts`), persona writes through the ticket-06 auth
 * actions, panels/toasts through the ticket-05 shared authorities. Retry and
 * reconnect timers are tracked and disposed on unmount so a stale callback
 * can never navigate after the page is gone.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Clock, FileSearch, FolderKanban, Home, LifeBuoy, Loader2, Lock, LogIn, RefreshCw, ShieldOff, ServerCrash, UserCog, WifiOff } from 'lucide-react'
import { USERS } from '../../domain/catalog';
import type { Role } from '../../domain/entities'
import { personaRole, signOut, switchPersona } from '../../demo/persona'
import { useAuthStore, useToastStore, useUiStore } from '../../state/stores'
import { Button, Mono } from '../../ui/index'
import { useSystemGo, useSystemRoute } from './nav'

/** Role display labels (kept local to avoid a store cycle, like the feature services). */
const ROLE_LABEL: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/* ───────── Shared error page frame ───────── */
function ErrorFrame({ code, icon: I, tone, title, desc, reason, children, actions }: { code?: string; icon: typeof Lock; tone: string; title: string; desc: string; reason?: ReactNode; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-10 text-center sm:py-16">
      <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel ${tone}`}><I size={30} aria-hidden /></div>
      {code && <div className="mb-2 font-mono text-sm tracking-widest text-neutral">{code}</div>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{desc}</p>
      {reason && <div className="mt-5 w-full rounded-xl border border-line bg-panel p-4 text-left text-sm">{reason}</div>}
      {children}
      <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      <p className="mt-8 flex items-center gap-1.5 text-xs text-muted"><LifeBuoy size={13} aria-hidden />Need help? Contact your organization admin or send the incident ID to operations.</p>
    </div>
  )
}

const REQUIRED: Record<string, string[]> = { default: ['manager', 'admin'] }

export function Forbidden() {
  const go = useSystemGo()
  const meName = useAuthStore((s) => s.meName)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const toast = useToastStore((s) => s.toast)
  const route = useSystemRoute()
  const me = { name: meName, role: personaRole(meName) }
  const need = (REQUIRED[route.id || ''] || REQUIRED.default) as Role[]
  const suggest = USERS.find((u) => need.includes(u.role))
  return (
    <ErrorFrame
      code="403" icon={ShieldOff} tone="text-bad" title="Access denied"
      desc="You are signed in, but your current role is not allowed to view or perform this action. Names and data of restricted content are not shown."
      reason={
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><dt className="mb-1 text-xs text-muted">Current role</dt><dd className="font-medium">{ROLE_LABEL[me.role]}</dd><dd className="text-xs text-muted">{me.name}</dd></div>
          <div><dt className="mb-1 text-xs text-muted">Required role</dt><dd className="font-medium">{need.map((r) => ROLE_LABEL[r]).join(' or ')}</dd><dd className="text-xs text-muted">Per the organization's access policy</dd></div>
        </dl>
      }
      actions={<>
        <Button variant="primary" icon={Home} onClick={() => go('overview')}>Back to System Overview</Button>
        <Button icon={FolderKanban} onClick={() => setSwitcherOpen(true)}>Switch project</Button>
        {suggest && <Button icon={UserCog} onClick={() => { switchPersona(suggest.name); toast(`Switched to ${suggest.name} (${ROLE_LABEL[suggest.role]}) — demo only.`, 'info'); go('overview') }}>Switch to {suggest.name}</Button>}
        <Button variant="ghost" onClick={() => toast('Access request sent to the organization admin (simulated).', 'info')}>Request access</Button>
      </>}
    />
  )
}

export function NotFound() {
  const go = useSystemGo()
  const route = useSystemRoute()
  return (
    <ErrorFrame
      code="404" icon={FileSearch} tone="text-warn" title="Page not found"
      desc="The link does not exist, was removed, or you do not have permission to view it. Check the link or go back to a list to find the right item."
      reason={<div className="flex items-center gap-2 text-xs text-muted"><span>Requested path:</span><Mono className="break-all text-fg">#/{route.page}{route.id ? '/' + route.id : ''}</Mono></div>}
      actions={<>
        <Button variant="primary" icon={Home} onClick={() => go('overview')}>Back to System Overview</Button>
        <Button icon={ArrowLeft} onClick={() => window.history.back()}>Go back</Button>
        <Button icon={FolderKanban} onClick={() => go('projects')}>View projects</Button>
      </>}
    />
  )
}

const INCIDENT_ID = 'INC-20261013-0427'

export function ServerError() {
  const go = useSystemGo()
  const toast = useToastStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = [] }, [])
  const retry = () => {
    setBusy(true)
    timers.current.push(window.setTimeout(() => {
      setBusy(false); setTries(tries + 1)
      if (tries >= 1) { toast('Reloaded successfully.'); go('overview') } else toast('The server is still not responding. Try again in a few seconds.', 'warn')
    }, 900))
  }
  return (
    <ErrorFrame
      code="500" icon={ServerCrash} tone="text-bad" title="Something went wrong"
      desc="The request could not be completed because of a server error. Data you already saved is not affected. Try again; if it keeps failing, send the incident ID below to operations."
      reason={<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>Incident ID</span><Mono className="text-fg">{INCIDENT_ID}</Mono></div>}
      actions={<>
        <Button variant="primary" icon={busy ? Loader2 : RefreshCw} disabled={busy} onClick={retry}>{busy ? 'Retrying…' : 'Retry'}</Button>
        <Button icon={Home} onClick={() => go('overview')}>Back to System Overview</Button>
        <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(INCIDENT_ID); toast('Incident ID copied.', 'info') }}>Copy incident ID</Button>
      </>}
    />
  )
}

export function Offline() {
  const go = useSystemGo()
  const toast = useToastStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = [] }, [])
  const check = () => {
    setBusy(true)
    timers.current.push(window.setTimeout(() => {
      setBusy(false); setN(n + 1)
      if (n >= 1) { toast('Reconnected. Data is in sync.'); go('overview') } else toast('Still no connection to the workspace.', 'warn')
    }, 1000))
  }
  return (
    <ErrorFrame
      icon={WifiOff} tone="text-warn" title="Workspace temporarily unavailable"
      desc="The connection to the server was lost. Displayed data may be stale and write actions are locked to avoid inconsistencies. Running operations continue to be orchestrated by the execution system and are not stopped."
      reason={<ul className="space-y-1.5 text-xs text-muted"><li className="flex gap-2"><Clock size={13} className="mt-0.5 shrink-0" aria-hidden />Last successful sync: Oct 13, 2026, 10:42 AM (UTC+7)</li><li className="flex gap-2"><Lock size={13} className="mt-0.5 shrink-0" aria-hidden />Start, stop and approval actions are available only while connected.</li></ul>}
      actions={<>
        <Button variant="primary" icon={busy ? Loader2 : RefreshCw} disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check connection again'}</Button>
        <Button icon={Home} onClick={() => go('overview')}>Back to System Overview (saved data)</Button>
      </>}
    />
  )
}

export function SessionExpired() {
  const go = useSystemGo()
  const meName = useAuthStore((s) => s.meName)
  const me = USERS.find((u) => u.name === meName)!
  return (
    <ErrorFrame
      icon={Clock} tone="text-warn" title="Your session has expired"
      desc="For safety, sessions end automatically after a period of inactivity. Sign in again to continue; your saved drafts are kept."
      reason={<div className="text-xs text-muted">Account: <span className="text-fg">{me.email}</span> · Unsaved changes in open forms may be lost.</div>}
      actions={<Button variant="primary" icon={LogIn} onClick={() => { signOut(); go('login') }}>Sign in again</Button>}
    />
  )
}
