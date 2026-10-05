/**
 * Persisted campaign drafts, optional native GoPhish asset selection and
 * preparation results. Preparation never implies delivery.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import type { CampaignJobView, CampaignView, CampaignsView, CampaignVector, CampaignProviderCapabilities } from '@raptix/web-contracts'
import { ApiClientError } from '../../shared/api/errors'
import { CAMPAIGN_VECTOR_OPTIONS, createCampaign, listCampaigns, runCampaignJob, reconcileCampaignJob, campaignProviderCapabilities, type CampaignDraftInput } from './real-campaigns-api'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626', green: '#15803D', amber: '#B45309' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }
const INPUT: CSSProperties = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px', fontSize: 13, color: C.ink, background: C.card, boxSizing: 'border-box' }

interface LoadState {
  loading: boolean
  data: CampaignsView | null
  error: string | null
}

interface CreateState {
  busy: boolean
  error: string | null
}

interface JobState {
  busyId: string | null
  last: CampaignJobView | null
  error: string | null
}

export default function RealCampaigns({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ loading: true, data: null, error: null })
  const [draft, setDraft] = useState<CampaignDraftInput>({ name: '', vector: 'phishing', scenario: '' })
  const [create, setCreate] = useState<CreateState>({ busy: false, error: null })
  const [job, setJob] = useState<JobState>({ busyId: null, last: null, error: null })
  const [useGoPhish, setUseGoPhish] = useState(false)
  const [useEvilginx, setUseEvilginx] = useState(false)
  const [assetIds, setAssetIds] = useState({ templateId: '', pageId: '', groupId: '', smtpId: '' })
  const validAssets = Object.values(assetIds).every(value => value.trim().length > 0 && Number.isSafeInteger(Number(value)) && Number(value) > 0)
  const requests = useRef(new Map<string, { requestId: string; version: number }>())
  const [capabilities, setCapabilities] = useState<CampaignProviderCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState<string | null>(null)

  const refresh = useCallback(async (signal: AbortSignal): Promise<void> => {
    setLoad(prev => ({ ...prev, loading: true, error: null }))
    try {
      const view = await listCampaigns(project.id, signal)
      setLoad({ loading: false, data: view, error: null })
    } catch (cause) {
      if (signal.aborted) return
      setLoad({ loading: false, data: null, error: cause instanceof Error ? cause.message : 'Campaign list failed' })
    }
  }, [project.id])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    const controller = new AbortController()
    setCapabilities(null); setCapabilityError(null)
    void campaignProviderCapabilities(project.id, controller.signal).then(view => { if (!controller.signal.aborted) setCapabilities(view) })
      .catch(cause => { if (!controller.signal.aborted) setCapabilityError(cause instanceof Error ? cause.message : 'Provider configuration could not be read') })
    return () => controller.abort()
  }, [project.id])

  async function submitDraft(): Promise<void> {
    if (create.busy || draft.name.trim().length === 0) return
    setCreate({ busy: true, error: null })
    const scenario = (draft.scenario ?? '').trim()
    try {
      const gophish = useGoPhish && draft.vector === 'phishing' ? {
        templateId: Number(assetIds.templateId), pageId: Number(assetIds.pageId), groupId: Number(assetIds.groupId), smtpId: Number(assetIds.smtpId),
      } : undefined
      const evilginx = useEvilginx && draft.vector === 'phishing' ? { profile: 'lab' as const } : undefined
      await createCampaign(project.id, { name: draft.name.trim(), vector: draft.vector, scenario: scenario.length > 0 ? scenario : undefined, gophish, evilginx }, new AbortController().signal)
      setCreate({ busy: false, error: null })
      setDraft({ name: '', vector: draft.vector, scenario: '' })
      await refresh(new AbortController().signal)
    } catch (cause) {
      setCreate({ busy: false, error: cause instanceof ApiClientError ? cause.message : 'Campaign creation failed' })
    }
  }

  async function runJob(campaign: CampaignView, kind: 'generate' | 'deploy'): Promise<void> {
    if (job.busyId !== null) return
    setJob({ busyId: campaign.id, last: null, error: null })
    const key = `${campaign.id}:${kind}`
    const request = requests.current.get(key) ?? { requestId: crypto.randomUUID(), version: campaign.version }
    requests.current.set(key, request)
    try {
      const view = await runCampaignJob(project.id, campaign.id, kind, new AbortController().signal, request)
      if (['succeeded', 'failed', 'unavailable', 'submitted', 'emails_sent', 'partial_failure', 'enabled', 'disabled'].includes(view.status)) requests.current.delete(key)
      setJob({ busyId: null, last: view, error: null })
      await refresh(new AbortController().signal)
    } catch (cause) {
      setJob({ busyId: null, last: null, error: cause instanceof Error ? cause.message : 'Campaign job failed' })
    }
  }

  async function reconcile(campaign: CampaignView, entry: CampaignJobView): Promise<void> {
    if (job.busyId !== null) return
    setJob({ busyId: campaign.id, last: null, error: null })
    try {
      const view = await reconcileCampaignJob(project.id, campaign.id, entry.id, new AbortController().signal)
      setJob({ busyId: null, last: view, error: null })
      await refresh(new AbortController().signal)
    } catch (cause) { setJob({ busyId: null, last: null, error: cause instanceof Error ? cause.message : 'Reconciliation failed' }) }
  }

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Vector Campaigns</h1>
        <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>Generate prepares provider assets. GoPhish lab Deploy uses example.test recipients, mail-sink SMTP and a non-capturing page. Evilginx2 uses the synthetic login.origin.test lab through a typed console bridge. Reconcile reads native outcomes; SMTP acceptance or enabled proxy configuration is not delivery. Missing providers remain unavailable.</p>
        {capabilities && <div style={{ ...PARA, marginTop: 8 }}>Draft persistence available. Provider configuration (not a connectivity probe):
          {capabilities.providers.map(provider => <div key={provider.provider}>{provider.provider}: Generate {provider.generateConfigured ? 'configured' : 'not configured'} · Deploy {provider.deployConfigured ? 'configured' : 'not configured'} · isolated lab</div>)}
        </div>}
        {capabilityError && <div role="alert" style={{ ...PARA, color: C.red }}>{capabilityError}</div>}
      </div>

      <div style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={LABEL}>New campaign draft</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Campaign name</span>
            <input style={INPUT} value={draft.name} maxLength={120} aria-label="Campaign name" placeholder="e.g. Phishing wave 1" onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 160 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Vector</span>
            <select style={INPUT} value={draft.vector} aria-label="Campaign vector" onChange={event => setDraft(prev => ({ ...prev, vector: event.target.value as CampaignVector }))}>
              {CAMPAIGN_VECTOR_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Scenario (optional)</span>
            <input style={INPUT} value={draft.scenario} maxLength={200} aria-label="Campaign scenario" placeholder="e.g. it-security-alert" onChange={event => setDraft(prev => ({ ...prev, scenario: event.target.value }))} />
          </label>
          <button disabled={create.busy || draft.name.trim().length === 0 || (useGoPhish && draft.vector === 'phishing' && !validAssets)} onClick={() => { void submitDraft() }}
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: C.ink, background: C.card, cursor: create.busy ? 'wait' : 'pointer' }}>
            {create.busy ? 'Creating…' : 'Create draft'}
          </button>
        </div>
        {draft.vector === 'phishing' && <div>
          <label style={PARA}><input type="checkbox" checked={useGoPhish} onChange={event => { setUseGoPhish(event.target.checked); if (event.target.checked) setUseEvilginx(false) }} /> Select native GoPhish assets</label>
          <label style={{ ...PARA, marginLeft: 12 }}><input type="checkbox" checked={useEvilginx} onChange={event => { setUseEvilginx(event.target.checked); if (event.target.checked) setUseGoPhish(false) }} /> Select synthetic evilginx2 lab profile</label>
          {useGoPhish && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {(Object.keys(assetIds) as Array<keyof typeof assetIds>).map(key => <label key={key} style={{ ...PARA, flex: '1 1 140px' }}>
              {key}<input type="number" min={1} step={1} aria-label={`GoPhish ${key}`} style={INPUT} value={assetIds[key]} onChange={event => setAssetIds(prev => ({ ...prev, [key]: event.target.value }))} />
            </label>)}
          </div>}
        </div>}
        {create.error && <div role="alert" style={{ fontSize: 12, color: C.red }}>{create.error}</div>}
      </div>

      {job.error && <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{job.error}</div>}
      {job.last && (
        <div role="status" style={{ ...CARD, padding: '12px 16px', ...PARA, fontSize: 12, color: C.amber, background: '#FFFBEB' }}>
          Job <span style={{ fontFamily: MONO }}>{job.last.id}</span> ({job.last.kind}) recorded with status <b>{job.last.status}</b>{job.last.error ? ` — ${job.last.error}` : ''}.
        </div>
      )}

      {load.loading && <div style={PARA}>Loading campaigns…</div>}
      {load.error && <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{load.error}</div>}
      {load.data && load.data.campaigns.length === 0 && !load.loading && (
        <div style={{ ...CARD, padding: 20, ...PARA }}>No campaign drafts yet for this engagement.</div>
      )}

      {load.data?.campaigns.map(campaign => (
        <div key={campaign.id} style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{campaign.name}</div>
              <div style={{ ...PARA, fontSize: 11, color: C.muted, fontFamily: MONO }}>{campaign.id} · vector {campaign.vector} · status {campaign.status} · v{campaign.version}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={job.busyId !== null} onClick={() => { void runJob(campaign, 'generate') }}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: C.ink, background: C.card, cursor: job.busyId ? 'wait' : 'pointer' }}>
                Generate
              </button>
              <button disabled={job.busyId !== null} onClick={() => { void runJob(campaign, 'deploy') }}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: C.ink, background: C.card, cursor: job.busyId ? 'wait' : 'pointer' }}>
                Deploy
              </button>
            </div>
          </div>
          {campaign.spec.prepared !== undefined && <div>
            <div style={LABEL}>Prepared provider asset bundle · campaign v{campaign.version}</div>
            <pre style={{ ...PARA, fontFamily: MONO, fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(campaign.spec.prepared, null, 2)}</pre>
          </div>}
          <div>
            <div style={LABEL}>Job history (server-persisted)</div>
            {campaign.jobs.length === 0 && <div style={PARA}>No jobs recorded for this campaign.</div>}
            {campaign.jobs.map(entry => (
              <div key={entry.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', fontSize: 12, color: C.body, borderBottom: '1px solid #F1F5F9', padding: '4px 0' }}>
                <span style={{ fontFamily: MONO, color: C.muted }}>{entry.createdAt}</span>
                <span style={{ fontWeight: 600, color: entry.status === 'unavailable' ? C.amber : C.ink }}>{entry.kind}:{entry.status}</span>
                {entry.provider && <span style={{ fontFamily: MONO }}>{entry.provider}</span>}
                {entry.requestId && <span style={{ fontFamily: MONO, overflowWrap: 'anywhere' }}>request {entry.requestId}</span>}
                {entry.providerId && <span style={{ fontFamily: MONO }}>native {entry.providerId} · {entry.providerStatus}</span>}
                {entry.summary && <span>sent {entry.summary.sent}/{entry.summary.total} · errors {entry.summary.errors}</span>}
                {entry.provider !== null && ['creating', 'uncertain', 'submitted', 'emails_sent', 'partial_failure', 'enabled', 'disabled'].includes(entry.status) &&
                  <button disabled={job.busyId !== null} onClick={() => { void reconcile(campaign, entry) }} aria-label={`Reconcile job ${entry.id}`}>Reconcile</button>}
                {entry.error && <span style={{ color: C.muted }}>{entry.error}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {load.data?.truncated && (
        <div style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.muted }}>Campaign list is truncated at 100 drafts (oldest omitted).</div>
      )}
    </div>
  )
}
