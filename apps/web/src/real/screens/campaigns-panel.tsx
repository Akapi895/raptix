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
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'campaigns', engagementId] })
  }

  const create = useMutation({
    mutationFn: () => createCampaign(engagementId, { name: name.trim(), vector, ...(scenario.trim() === '' ? {} : { scenario: scenario.trim() }) }),
    onSuccess: () => { setName(''); setScenario(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The campaign draft was refused.'),
  })
  const runJob = useMutation({
    mutationFn: (input: { campaignId: string; kind: 'generate' | 'deploy' }) => runCampaignJob(engagementId, input.campaignId, input.kind),
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
                  onRun={(kind) => runJob.mutate({ campaignId: c.id, kind })}
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
        <CardHeader title="New campaign draft" sub="A draft is a persisted engagement record; nothing is delivered from this surface" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate() }}
        >
          <label className="text-sm text-muted" htmlFor="campaign-name">Name</label>
          <Input id="campaign-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 phishing drill" />
          <label className="text-sm text-muted" htmlFor="campaign-vector">Vector</label>
          <Select id="campaign-vector" aria-label="Campaign vector" value={vector} onChange={(e) => setVector(e.target.value as typeof vector)}>
            <option value="phishing">phishing</option>
            <option value="web">web</option>
            <option value="mobile">mobile</option>
          </Select>
          <label className="text-sm text-muted" htmlFor="campaign-scenario">Scenario (optional)</label>
          <Textarea id="campaign-scenario" maxLength={200} value={scenario} onChange={(e) => setScenario(e.target.value)} />
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
