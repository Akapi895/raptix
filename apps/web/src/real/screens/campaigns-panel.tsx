/**
 * Real campaign surface (integration ticket 12, D5 placement). Campaign
 * drafts persist through the real API; provider jobs report the actual
 * provider configuration — an unconfigured provider is a truthful job error,
 * never a fabricated campaign or fake delivery state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Megaphone, Loader2 } from 'lucide-react'
import { createCampaign, fetchCampaignCapabilities, fetchCampaigns, reconcileCampaignJob, runCampaignJob } from '../api'
import type { CampaignView } from '@raptix/web-contracts'
import { Banner, Button, Card, CardHeader, Empty, Input, Select, Skeleton, Status, Textarea } from '../../ui'

export function RealCampaignsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const capabilities = useQuery({ queryKey: ['real', 'campaign-capabilities', engagementId], queryFn: () => fetchCampaignCapabilities(engagementId), retry: false })
  const campaigns = useQuery({ queryKey: ['real', 'campaigns', engagementId], queryFn: () => fetchCampaigns(engagementId), retry: false })
  const [name, setName] = useState('')
  const [vector, setVector] = useState<'phishing' | 'web' | 'mobile'>('phishing')
  const [scenario, setScenario] = useState('')
  const [gophish, setGophish] = useState({ templateId: '', pageId: '', groupId: '', smtpId: '' })
  const [evilginxLab, setEvilginxLab] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'campaigns', engagementId] })
  }

  // W15: GoPhish assets and the Evilginx synthetic lab profile are mutually
  // exclusive by the server contract; partial GoPhish IDs are a local refusal.
  const parseGophish = (): { templateId: number; pageId: number; groupId: number; smtpId: number } | null => {
    const ids = [gophish.templateId, gophish.pageId, gophish.groupId, gophish.smtpId].map((v) => v.trim())
    if (ids.every((v) => v === '')) return null
    if (ids.some((v) => v === '')) { setError('GoPhish requires all four asset IDs (template, page, group, smtp).'); throw new Error('partial') }
    const parsed = ids.map((v) => Number(v))
    if (!parsed.every((n) => Number.isSafeInteger(n) && n > 0)) { setError('GoPhish asset IDs must be positive integers.'); throw new Error('invalid') }
    return { templateId: parsed[0]!, pageId: parsed[1]!, groupId: parsed[2]!, smtpId: parsed[3]! }
  }

  const create = useMutation({
    mutationFn: () => {
      const assets = parseGophish()
      return createCampaign(engagementId, {
        name: name.trim(),
        vector,
        ...(scenario.trim() === '' ? {} : { scenario: scenario.trim() }),
        ...(assets !== null ? { gophish: assets } : {}),
        ...(evilginxLab && assets === null ? { evilginxLab: true } : {}),
      })
    },
    onSuccess: () => { setName(''); setScenario(''); setGophish({ templateId: '', pageId: '', groupId: '', smtpId: '' }); setEvilginxLab(false); setError(null); invalidate() },
    onError: (err) => { if (err instanceof Error && err.message === 'partial') return; if (err instanceof Error && err.message === 'invalid') return; setError(err instanceof Error ? err.message : 'The campaign draft was refused.') },
  })
  const runJob = useMutation({
    mutationFn: (input: { campaignId: string; kind: 'generate' | 'deploy'; version: number }) => runCampaignJob(engagementId, input.campaignId, input.kind, { requestId: crypto.randomUUID(), version: input.version }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The provider job was refused or the provider is unavailable.'),
  })
  const reconcile = useMutation({
    mutationFn: (input: { campaignId: string; jobId: string }) => reconcileCampaignJob(engagementId, input.campaignId, input.jobId),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'Reconciliation was refused.'),
  })

  if (campaigns.isPending || capabilities.isPending) {
    return <Card><CardHeader title="Campaigns" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (campaigns.isError || !campaigns.data) {
    return <Empty icon={Megaphone} title="Campaigns are unavailable" action={<Button onClick={() => void campaigns.refetch()}>Retry</Button>}>
      {campaigns.error instanceof Error ? campaigns.error.message : 'The campaign read failed.'}
    </Empty>
  }
  const view = campaigns.data
  const caps = capabilities.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Campaign drafts" sub={`${view.campaigns.length} draft(s) persisted for this engagement; jobs report the real provider configuration${view.truncated ? ' — list truncated at 100' : ''}`} />
        <div className="p-4">
          {view.campaigns.length === 0 ? (
            <p className="text-sm text-muted">No campaigns yet. Create a draft below; generate/deploy run as provider jobs with truthful outcomes.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Name</th><th className="pb-2">Vector</th><th className="pb-2">Status</th>
                  <th className="pb-2">Jobs</th><th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.campaigns.map((c) => <CampaignRow key={c.id} campaign={c}
                  onRun={(kind) => runJob.mutate({ campaignId: c.id, kind, version: c.version })}
                  onReconcile={(jobId) => reconcile.mutate({ campaignId: c.id, jobId })}
                  busy={runJob.isPending || reconcile.isPending} />)}
              </tbody>
            </table>
          )}
          {caps !== undefined && (
            <p className="mt-3 text-xs text-muted">
              Providers: {caps.providers.map((p) => `${p.provider} (generate ${p.generateConfigured ? 'configured' : 'not configured'}, deploy ${p.deployConfigured ? 'configured' : 'not configured'}, ${p.deploymentScope})`).join(' · ')}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="New campaign draft" sub="A draft is a persisted engagement record; nothing is delivered from this surface. Web and mobile drafts persist without a provider workflow — only phishing has a supported provider pipeline (GoPhish isolated lab, Evilginx synthetic lab profile)" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate() }}
        >
          <label className="text-sm text-muted" htmlFor="campaign-name">Name</label>
          <Input id="campaign-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 phishing drill" />
          <label className="text-sm text-muted" htmlFor="campaign-vector">Vector</label>
          <Select id="campaign-vector" aria-label="Campaign vector" value={vector} onChange={(e) => setVector(e.target.value as typeof vector)}>
            <option value="phishing">phishing</option>
            <option value="web">web (persist only)</option>
            <option value="mobile">mobile (persist only)</option>
          </Select>
          <label className="text-sm text-muted" htmlFor="campaign-scenario">Scenario (optional)</label>
          <Textarea id="campaign-scenario" maxLength={200} value={scenario} onChange={(e) => setScenario(e.target.value)} />
          {vector === 'phishing' && (
            <>
              <p className="sm:col-span-2 text-xs text-muted">GoPhish assets (isolated lab): all four numeric IDs, or the Evilginx synthetic lab profile — never both.</p>
              <label className="text-sm text-muted" htmlFor="gophish-template">GoPhish template ID
                <Input id="gophish-template" aria-label="GoPhish template ID" inputMode="numeric" disabled={evilginxLab} value={gophish.templateId} onChange={(e) => setGophish({ ...gophish, templateId: e.target.value })} />
              </label>
              <label className="text-sm text-muted" htmlFor="gophish-page">GoPhish page ID
                <Input id="gophish-page" aria-label="GoPhish page ID" inputMode="numeric" disabled={evilginxLab} value={gophish.pageId} onChange={(e) => setGophish({ ...gophish, pageId: e.target.value })} />
              </label>
              <label className="text-sm text-muted" htmlFor="gophish-group">GoPhish group ID
                <Input id="gophish-group" aria-label="GoPhish group ID" inputMode="numeric" disabled={evilginxLab} value={gophish.groupId} onChange={(e) => setGophish({ ...gophish, groupId: e.target.value })} />
              </label>
              <label className="text-sm text-muted" htmlFor="gophish-smtp">GoPhish smtp ID
                <Input id="gophish-smtp" aria-label="GoPhish smtp ID" inputMode="numeric" disabled={evilginxLab} value={gophish.smtpId} onChange={(e) => setGophish({ ...gophish, smtpId: e.target.value })} />
              </label>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm text-muted" htmlFor="evilginx-lab">
                <input id="evilginx-lab" type="checkbox" aria-label="Evilginx synthetic lab profile" checked={evilginxLab}
                  onChange={(e) => setEvilginxLab(e.target.checked)} disabled={gophish.templateId !== '' || gophish.pageId !== '' || gophish.groupId !== '' || gophish.smtpId !== ''} />
                Evilginx synthetic lab profile (no live recipients — synthetic/isolated lab only)
              </label>
            </>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={Megaphone} disabled={create.isPending}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Create draft
            </Button>
          </div>
        </form>
      </Card>

      {caps === undefined && capabilities.isError && (
        <Banner tone="warn" title="Provider capabilities unavailable">
          {capabilities.error instanceof Error ? capabilities.error.message : 'The provider configuration read failed.'}
        </Banner>
      )}
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}

function CampaignRow({ campaign, onRun, onReconcile, busy }: { campaign: CampaignView; onRun: (kind: 'generate' | 'deploy') => void; onReconcile: (jobId: string) => void; busy: boolean }): ReactElement {
  const pending = campaign.jobs.filter((j) => ['pending', 'running', 'uncertain', 'creating'].includes(j.status))
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3 text-xs font-medium">{campaign.name}</td>
      <td className="py-2 pr-3 text-xs">{campaign.vector}</td>
      <td className="py-2 pr-3"><Status kind="gate" value={campaign.status === 'draft' ? 'pending' : 'passed'} size="sm" label={campaign.status} /></td>
      <td className="py-2 pr-3 text-xs">
        {campaign.jobs.length === 0 ? <span className="text-muted">—</span> : (
          <ul className="space-y-1">
            {campaign.jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-neutral">{j.kind}</span>
                <Status kind="gate" value={j.status === 'succeeded' ? 'passed' : j.status === 'failed' ? 'failed' : 'pending'} size="sm" label={j.status} />
                {j.error !== null && <span className="text-[10px] text-bad">{j.error.slice(0, 80)}</span>}
                {['pending', 'running', 'uncertain', 'creating'].includes(j.status) && (
                  <Button variant="secondary" disabled={busy} onClick={() => onReconcile(j.id)}>Reconcile</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="py-2 text-xs">
        <span className="flex gap-2">
          <Button variant="secondary" disabled={busy || pending.length > 0} onClick={() => onRun('generate')}>Generate</Button>
          <Button variant="secondary" disabled={busy || pending.length > 0} onClick={() => onRun('deploy')}>Deploy</Button>
        </span>
      </td>
    </tr>
  )
}
