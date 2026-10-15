/**
 * Real settings (integration ticket 16). The six-tab surface distinguishes
 * its three data classes honestly: UI-only preferences live in this browser
 * only; engagement settings stay on each project's detail screen; the
 * workspace policy/retention keys are persisted, versioned server contracts
 * with their actual consumers disclosed. Integrations render the server's
 * capability document — unavailable providers disclose the real reason
 * instead of simulated connect actions, and the audit tab projects the
 * authoritative web/vault records with truthful attribution.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Loader2, Save, Settings as SettingsIcon } from 'lucide-react'
import {
  fetchCapabilities,
  fetchWorkspaceAudit,
  fetchWorkspaceSettings,
  saveWorkspaceSetting,
  type AuditEntryView,
  type WorkspaceSettingView,
} from '../api'
import { REAL_IDENTITY } from '../identity'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, DescList, Empty, Input, PageHeader, Skeleton, Status, Tabs } from '../../ui'
import { utcMinute, utcMinuteOr } from '../format'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'organization', label: 'Organization' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'policies', label: 'Policies' },
  { id: 'retention', label: 'Retention' },
  { id: 'audit', label: 'Audit' },
]

const PROVIDER_LABEL: Record<string, string> = {
  projects: 'Engagements API',
  runs: 'Runtime execution',
  approvals: 'HITL approvals',
  findings: 'Observed findings',
  artifacts: 'Artifacts',
  graphs: 'Knowledge graph',
  timeline: 'Timeline',
  reports: 'Report export',
  campaigns: 'Campaign providers',
  c2: 'C2 provider',
  vault: 'Credentials vault',
  members: 'Memberships',
}

export function RealSettings(): ReactElement {
  const route = useRoute()
  const initialTab = route.tab !== undefined && TABS.some((t) => t.id === route.tab) ? route.tab : 'profile'
  const [tab, setTab] = useState(initialTab)
  const switchTab = (id: string): void => {
    setTab(id)
    go('settings', { tab: id })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" sub="UI-only preferences, engagement settings and workspace-level configuration are distinct data classes — each tab states which one it renders" />
      <Tabs value={tab} onChange={switchTab} tabs={TABS} />
      <div className="mt-2">
        {tab === 'profile' ? <ProfileTab /> : tab === 'organization' ? <OrganizationTab /> : tab === 'integrations' ? <IntegrationsTab /> : tab === 'policies' ? <WorkspaceSettingsTab kind="policy" /> : tab === 'retention' ? <WorkspaceSettingsTab kind="retention" /> : <AuditTab />}
      </div>
    </div>
  )
}

function ProfileTab(): ReactElement {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Trusted identity" sub="Resolved by the deployment's identity boundary, not by the browser" />
        <div className="p-4">
          <DescList
            items={[
              { k: 'Actor', v: REAL_IDENTITY.name },
              { k: 'Actor id', v: <span className="font-mono">{REAL_IDENTITY.id}</span> },
              { k: 'Deployment mode', v: REAL_IDENTITY.deploymentMode },
            ]}
          />
        </div>
      </Card>
      <Banner tone="info" title="UI-only preferences stay in this browser">
        Theme and console preferences are browser-local state. They are never persisted server-side, never authorize anything and do not survive switching devices.
      </Banner>
      <Card>
        <CardHeader title="Engagement settings" sub="Per-project, persisted through the engagement API" />
        <div className="p-4 text-sm text-muted">
          Target, authorization and lifecycle settings belong to each engagement and live on its <span className="font-mono text-[13px]">Settings</span> tab
          (opened from the project header). Workspace-level policy and retention are under the Policies and Retention tabs here.
          <div className="mt-3"><Button variant="secondary" onClick={() => go('projects')}>Open Projects</Button></div>
        </div>
      </Card>
    </div>
  )
}

function OrganizationTab(): ReactElement {
  return (
    <Card>
      <CardHeader title="Organization" sub="Membership administration is engagement-scoped in this deployment" />
      <div className="space-y-3 p-4 text-sm text-muted">
        <p>
          There is no organization-level member registry in the current deployment model. Accounts and roles are managed
          per engagement on its <span className="font-mono text-[13px]">Team</span> tab (owner-only writes, server-enforced),
          and workspace policy changes are restricted to deployment operators on the Policies tab.
        </p>
        <Button variant="secondary" onClick={() => go('projects')}>Open a project's Team tab</Button>
      </div>
    </Card>
  )
}

function IntegrationsTab(): ReactElement {
  const capabilities = useQuery({ queryKey: ['real', 'capabilities'], queryFn: () => fetchCapabilities() })
  if (capabilities.isPending) return <Card><CardHeader title="Integrations" /><div className="p-4"><Skeleton className="h-32" /></div></Card>
  if (capabilities.isError || !capabilities.data) {
    return <Empty icon={SettingsIcon} title="The capability document is unavailable" action={<Button onClick={() => void capabilities.refetch()}>Retry</Button>}>
      {capabilities.error instanceof Error ? capabilities.error.message : 'The capability read failed.'}
    </Empty>
  }
  const doc = capabilities.data
  return (
    <Card>
      <CardHeader title={`Integrations (${doc.mode})`} sub="Straight from the server capability document — unavailable providers state the actual reason; there is no simulated connect/disconnect" />
      <div className="p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2">Provider</th>
              <th className="pb-2">State</th>
              <th className="pb-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(doc.capabilities).map(([name, cap]) => (
              <tr key={name} className="border-t border-line">
                <td className="py-2 pr-3 font-medium text-fg">{PROVIDER_LABEL[name] ?? name}</td>
                <td className="py-2 pr-3">
                  <Status kind="gate" value={cap.available ? 'passed' : cap.supported ? 'pending' : 'failed'} size="sm" label={cap.available ? 'Available' : cap.supported ? 'Config missing' : 'Unsupported'} />
                </td>
                <td className="py-2 text-xs text-muted">{cap.reason ?? (cap.available ? '—' : 'Not available in this deployment.')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function WorkspaceSettingsTab({ kind }: { kind: 'policy' | 'retention' }): ReactElement {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['real', 'workspace-settings'], queryFn: () => fetchWorkspaceSettings() })
  const [draft, setDraft] = useState<Record<string, { value: string; reason: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: { setting: WorkspaceSettingView; value: number; reason: string }) =>
      saveWorkspaceSetting(input.setting.key, { value: input.value, expectedVersion: input.setting.version, reason: input.reason }),
    onSuccess: (_data, input) => {
      setError(null)
      setNotice(`${input.setting.key} saved; the new version applies to its consumers immediately.`)
      setDraft((d) => ({ ...d, [input.setting.key]: { value: '', reason: '' } }))
      void client.invalidateQueries({ queryKey: ['real', 'workspace-settings'] })
    },
    onError: (err) => {
      setNotice(null)
      setError(err instanceof Error ? err.message : 'The settings write was refused.')
    },
  })

  if (settings.isPending) return <Card><CardHeader title={kind === 'policy' ? 'Policies' : 'Retention'} /><div className="p-4"><Skeleton className="h-32" /></div></Card>
  if (settings.isError || !settings.data) {
    return <Empty icon={SettingsIcon} title="Workspace settings are unavailable" action={<Button onClick={() => void settings.refetch()}>Retry</Button>}>
      {settings.error instanceof Error ? settings.error.message : 'The workspace settings read failed.'}
    </Empty>
  }
  const rows = settings.data.settings.filter((s) => s.kind === kind)

  return (
    <div className="space-y-4">
      {kind === 'retention' && (
        <Banner tone="info" title="No scheduled retention enforcement exists in this deployment">
          Saving a retention value records configuration only. Nothing is deleted under policy here — no simulated delete is offered, because that would not be legal-hold or retention enforcement.
        </Banner>
      )}
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}
      {rows.map((s) => {
        const form = draft[s.key] ?? { value: String(s.value), reason: '' }
        const parsed = Number(form.value)
        const dirty = form.value !== String(s.value)
        return (
          <Card key={s.key}>
            <CardHeader title={s.key} sub={s.description} />
            <div className="space-y-3 p-4">
              <DescList
                items={[
                  { k: 'Persisted value', v: <span className="font-mono">{s.value}</span> },
                  { k: 'Version', v: <span className="font-mono">{s.version}</span> },
                  { k: 'Last updated by', v: s.updatedBy ? <span className="font-mono">{s.updatedBy}</span> : 'default (never changed)' },
                  { k: 'Last updated at', v: utcMinuteOr(s.updatedAt) },
                  { k: 'Consumer', v: s.consumer ? <span className="font-mono">{s.consumer}</span> : 'none yet — configuration only' },
                  { k: 'Enforcement', v: s.enforcement },
                ]}
              />
              <form
                className="grid items-end gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!Number.isInteger(parsed) || !form.reason.trim()) return
                  save.mutate({ setting: s, value: parsed, reason: form.reason.trim() })
                }}
              >
                <label className="grid gap-1 text-xs text-muted" htmlFor={`value-${s.key}`}>
                  New value ({s.value} now)
                  <Input id={`value-${s.key}`} type="number" value={form.value} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: { ...form, value: e.target.value } }))} />
                </label>
                <label className="grid gap-1 text-xs text-muted" htmlFor={`reason-${s.key}`}>
                  Reason (audited, required)
                  <Input id={`reason-${s.key}`} required value={form.reason} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: { ...form, reason: e.target.value } }))} placeholder="Why this change" />
                </label>
                <Button type="submit" variant="primary" icon={Save} disabled={save.isPending || !dirty || !form.reason.trim() || !Number.isInteger(parsed)}>
                  {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                  Save (version {s.version} → {s.version + 1})
                </Button>
              </form>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function AuditTab(): ReactElement {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const audit = useQuery({
    queryKey: ['real', 'workspace-audit', action, q],
    queryFn: () => fetchWorkspaceAudit({ action: action || undefined, q: q || undefined }),
  })
  return (
    <Card>
      <CardHeader title="Workspace audit" sub="Consequential actions recorded by this server (web records and vault lifecycle); actors, scopes and timestamps come from the records — never fabricated" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Filter by action prefix" placeholder="action prefix, e.g. scope." value={action} onChange={(e) => setAction(e.target.value)} className="max-w-56" />
          <Input aria-label="Search audit entries" placeholder="search action / target / reason" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-72" />
        </div>
        {audit.isPending ? <Skeleton className="h-40" /> : audit.isError || !audit.data ? (
          <Empty icon={SettingsIcon} title="The audit log is unavailable" action={<Button onClick={() => void audit.refetch()}>Retry</Button>}>
            {audit.error instanceof Error ? audit.error.message : 'The audit read failed.'}
          </Empty>
        ) : (
          <>
            {audit.data.truncated && <p className="text-xs text-muted" role="note">Showing the newest {audit.data.entries.length} of {audit.data.total} matching entries; narrow the filters for more.</p>}
            <AuditTable entries={audit.data.entries} />
          </>
        )}
      </div>
    </Card>
  )
}

export function AuditTable({ entries }: { entries: readonly AuditEntryView[] }): ReactElement {
  if (entries.length === 0) return <p className="text-sm text-muted">No audit entries match.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2">When</th>
          <th className="pb-2">Action</th>
          <th className="pb-2">Actor</th>
          <th className="pb-2">Scope</th>
          <th className="pb-2">Reason</th>
          <th className="pb-2">Source</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-t border-line align-top">
            <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">{utcMinute(e.createdAt)}</td>
            <td className="py-2 pr-3 font-mono text-xs text-fg">{e.action}</td>
            <td className="py-2 pr-3 text-xs">{e.actorId ?? <span className="text-muted">not recorded</span>}</td>
            <td className="py-2 pr-3 text-xs">
              {e.engagementId === null ? <span className="text-muted">workspace</span> : (
                <button className="font-mono text-xs text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: e.engagementId as string })}>{e.engagementId}</button>
              )}
              {e.targetType !== null && <span className="text-muted"> · {e.targetType}</span>}
            </td>
            <td className="py-2 pr-3 text-xs">{e.reason ?? <span className="text-muted">—</span>}</td>
            <td className="py-2 text-xs"><Status kind="gate" value={e.source === 'vault' ? 'pending' : 'passed'} size="sm" label={e.source} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
