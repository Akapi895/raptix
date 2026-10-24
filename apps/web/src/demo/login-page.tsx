import { useState } from 'react'
import { ArrowLeft, Building2, Check, Crosshair, KeyRound, Loader2, LogIn, ShieldCheck, Eye, EyeOff, LifeBuoy, Lock, FlaskConical } from 'lucide-react'
import { ROLE_LABEL } from '../domain/policy'
import { USERS } from '../domain/catalog';
import { signIn, switchPersona } from './persona'
import { useMe } from '../state/console'
import { useAuthStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { currentRoute, navRawRoute } from '../router/navigate'
import { isKnownPage } from '../router/history'
import { Banner, Button, Field, Input, Avatar, cx } from '../ui/index'

const ORGS = [
  { id: 'Raptix Workspace — Test Lab', name: 'Raptix Workspace — Test Lab', sub: 'Acme Security (Demo) · 4 projects · synthetic data', tag: 'Default' },
  { id: 'Cyber Range Training — Sandbox', name: 'Cyber Range Training — Sandbox', sub: 'Acme Security (Demo) · training sandbox · simulated data', tag: 'Sandbox' },
]
const ORG_NAME = 'Acme Security (Demo)'
const DEMO_PASSWORD = 'Raptix@2026'
type Stage = 'form' | 'mfa' | 'sso' | 'org'
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Login() {
  const me = useMe()
  const clearDirty = useSessionStore((s) => s.clearDirty)
  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('alex.morgan@acme-security.example.test')
  const [pw, setPw] = useState(DEMO_PASSWORD)
  const [show, setShow] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [org, setOrg] = useState(ORGS[0].id)

  const emailErr = touched && !email.trim() ? 'Enter your work email.' : touched && !emailRe.test(email.trim()) ? 'Enter a valid email address, for example name@company.example.' : ''
  const pwErr = touched && !pw ? 'Enter your password.' : ''

  const after = (fn: () => void, ms = 700) => { setBusy(true); setErr(''); setTimeout(() => { setBusy(false); fn() }, ms) }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!email.trim() || !emailRe.test(email.trim()) || !pw) return
    after(() => {
      if (/^locked@/i.test(email.trim())) { setErr('This account is locked after 5 failed attempts. Contact your organization admin to unlock it.'); return }
      const u = USERS.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
      if (!u || pw !== DEMO_PASSWORD) { setErr('Incorrect email or password. Check your details and try again.'); return }
      switchPersona(u.name)
      setStage(u.role === 'admin' ? 'mfa' : 'org')
    })
  }
  const verify = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) { setErr('The verification code is exactly 6 digits.'); return }
    after(() => { if (code === '000000') { setErr('The code is incorrect or expired. Enter a new code from your authenticator app (demo: any code other than 000000).'); return } setStage('org') }, 500)
  }
  const sso = () => after(() => setStage('sso'), 600)
  const ssoDone = (r: 'ok' | 'fail' | 'locked') => after(() => {
    if (r === 'fail') { setStage('form'); setErr('SSO failed: the identity provider did not return a valid assertion. Try again or sign in with email and password.'); return }
    if (r === 'locked') { setStage('form'); setErr('SSO account is locked by your identity provider. Contact your organization admin.'); return }
    const u = USERS.find((x) => x.email.toLowerCase() === email.trim().toLowerCase()) || USERS.find((x) => x.name === me.name) || USERS[0]
    switchPersona(u.name); setEmail(u.email); setStage(u.role === 'admin' ? 'mfa' : 'org')
  }, 700)
  /* Ticket 67 wave 3: the store's `login` entry, mirrored — sign in through
     the auth action, then either reveal the requested route (the guard renders
     login in place for protected URLs, so the safe return needs no redirect)
     or fall back to the Command Center for public and unknown destinations. */
  const login = (o?: string) => {
    signIn(useAuthStore.getState().meName, o)
    const r = currentRoute()
    if (isKnownPage(r.page) && r.page !== 'login') {
      clearDirty()
      return
    }
    navRawRoute({ page: 'overview' })
  }
  const quick = (name: string) => { switchPersona(name); login(ORG_NAME) }

  const u = USERS.find((x) => x.name === me.name)!

  return (
    <div className="grid min-h-screen grid-cols-1 bg-bg text-fg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-side p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--c-accent) 22%, transparent), transparent 45%), radial-gradient(circle at 85% 90%, color-mix(in srgb, var(--c-cyan) 16%, transparent), transparent 40%)' }} aria-hidden />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white"><Crosshair size={22} aria-hidden /></div>
          <div className="leading-tight"><div className="text-lg font-semibold tracking-tight">Raptix</div><div className="text-xs text-muted">Red Team Orchestration Platform</div></div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight">Orchestrate adversary simulation within approved scope.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">Manage projects, ROE, operations, findings and reports in a single workspace, with scope controls and an audit trail for every action.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {['Mandatory preflight before every operation: ROE, scope, time window, agents', 'Emergency stop recorded with reason, actor and timestamp', 'Reports export only after approval; delivery is a separate step'].map((t) => (
              <li key={t} className="flex items-start gap-3 text-fg/90"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok"><Check size={12} aria-hidden /></span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted"><ShieldCheck size={14} className="text-cyan" aria-hidden />Demo environment, Acme Security (Demo) — all data is synthetic, with no real IP addresses or credentials.</div>
      </aside>

      {/* Form */}
      <main className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white"><Crosshair size={20} aria-hidden /></div>
          <div className="text-lg font-semibold">Raptix</div>
        </div>
        <div className="w-full max-w-[420px]">
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-fg"><FlaskConical size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span><b>Demo mode — synthetic accounts.</b> Sign-in, SSO and MFA are simulated. Demo accounts and the role picker are available only in demo mode.</span></div>
          {stage === 'form' && (
            <form onSubmit={submit} noValidate aria-busy={busy}>
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1 mb-6 text-sm text-muted">Use your organization account to access the workspace.</p>
              {err && <Banner tone="bad" title="Sign-in failed">{err}</Banner>}
              <div className="space-y-4">
                <Field label="Work email" required error={emailErr}>
                  <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.example" aria-invalid={!!emailErr} />
                </Field>
                <Field label="Password" required error={pwErr}>
                  <div className="relative">
                    <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Enter password" className="pr-11" aria-invalid={!!pwErr} />
                    <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                </Field>
              </div>
              <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" disabled={busy} icon={busy ? Loader2 : LogIn}>{busy ? 'Verifying…' : 'Continue'}</Button>
              <div className="my-5 flex items-center gap-3 text-xs text-neutral"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
              <Button type="button" size="lg" className="w-full" onClick={sso} disabled={busy} icon={KeyRound}>Continue with organization SSO</Button>
              <div className="mt-5 flex items-start gap-2 rounded-lg bg-hover/50 px-3 py-2.5 text-xs text-muted"><LifeBuoy size={14} className="mt-0.5 shrink-0" aria-hidden /><span>Forgot your password or locked out? Contact your organization admin. Admin accounts require an additional two-factor code (MFA). Demo: use locked@acme-security.example.test to preview a locked account.</span></div>
            </form>
          )}

          {stage === 'sso' && (
            <div aria-busy={busy}>
              <button type="button" onClick={() => { setStage('form'); setErr('') }} className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={14} />Back</button>
              <h2 className="text-2xl font-semibold tracking-tight">Organization SSO</h2>
              <p className="mt-1 mb-5 text-sm text-muted">Simulated identity provider for Acme Security (Demo). No real redirect happens. Choose the outcome to preview.</p>
              <div className="space-y-2">
                <Button type="button" variant="primary" size="lg" className="w-full" disabled={busy} icon={busy ? Loader2 : KeyRound} onClick={() => ssoDone('ok')}>{busy ? 'Waiting for identity provider…' : 'Approve sign-in (simulated)'}</Button>
                <Button type="button" size="lg" className="w-full" disabled={busy} onClick={() => ssoDone('fail')}>Simulate SSO failure</Button>
                <Button type="button" size="lg" className="w-full" disabled={busy} onClick={() => ssoDone('locked')}>Simulate account locked</Button>
              </div>
            </div>
          )}

          {stage === 'mfa' && (
            <form onSubmit={verify} noValidate aria-busy={busy}>
              <button type="button" onClick={() => { setStage('form'); setErr(''); setCode('') }} className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={14} />Back</button>
              <h2 className="text-2xl font-semibold tracking-tight">Additional verification</h2>
              <p className="mt-1 mb-6 text-sm text-muted">Organization policy requires a 6-digit code for the <b className="text-fg">{ROLE_LABEL[u.role]}</b> role. Open your authenticator app and enter the current code.</p>
              {err && <Banner tone="bad" title="Verification failed">{err}</Banner>}
              <Field label="Verification code" required>
                <Input inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000 000" className="text-center font-mono text-lg tracking-[0.4em]" />
              </Field>
              <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" disabled={busy} icon={busy ? Loader2 : ShieldCheck}>{busy ? 'Checking…' : 'Confirm'}</Button>
            </form>
          )}

          {stage === 'org' && (
            <div>
              <button type="button" onClick={() => { setStage('form'); setErr('') }} className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={14} />Change account</button>
              <h2 className="text-2xl font-semibold tracking-tight">Choose workspace</h2>
              <p className="mt-1 mb-5 flex items-center gap-2 text-sm text-muted"><Avatar name={u.name} size={22} />{u.name} · {ROLE_LABEL[u.role]}</p>
              <div role="radiogroup" aria-label="Organization workspaces" className="space-y-2">
                {ORGS.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={org === o.id} onClick={() => setOrg(o.id)} className={cx('flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition', org === o.id ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:bg-hover')}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-hover text-cyan"><Building2 size={18} aria-hidden /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{o.name}</span><span className="block truncate text-xs text-muted">{o.sub}</span></span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{o.tag}</span>
                    {org === o.id && <Check size={16} className="text-accent" aria-label="Selected" />}
                  </button>
                ))}
              </div>
              <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => login(ORG_NAME)} icon={LogIn}>Enter workspace</Button>
            </div>
          )}

          {/* Persona quick pick */}
          {stage !== 'mfa' && (
            <section className="mt-8 border-t border-line pt-5" aria-label="Quick role picker (demo)">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted"><Lock size={12} aria-hidden />Demo mode — synthetic accounts</div>
              <div className="flex flex-wrap gap-2">
                {USERS.map((p) => (
                  <button key={p.name} type="button" onClick={() => quick(p.name)} title={`${p.email} — ${ROLE_LABEL[p.role]}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-panel pl-1.5 pr-3 text-xs transition hover:bg-hover">
                    <Avatar name={p.name} size={24} />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted max-sm:hidden">· {ROLE_LABEL[p.role]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
