import type { ReactElement } from 'react'
import { Activity, FileText, Fingerprint, Network, Server, ShieldCheck } from 'lucide-react'
import { Banner, Button, Card, DescList, Empty, Modal, Skeleton, Status, Timeline } from '../../ui'
import { useAssetDetail } from './query'

/** Contextual asset read; relationships and evidence masking belong to the asset service. */
export function AssetPreviewModal({ id, onClose }: { id: string; onClose: () => void }): ReactElement {
  const detail = useAssetDetail(id)
  const read = detail.data
  return (
    <Modal open onClose={onClose} title="Asset details" width={920} footer={<Button onClick={onClose}>Back to scope</Button>}>
      {detail.isPending ? <Skeleton className="h-72" /> : detail.isError || !read ? (
        <Empty icon={Server} title="Asset details unavailable" action={<Button onClick={() => void detail.refetch()}>Try again</Button>}>The asset could not be loaded for your current project and account.</Empty>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-accent-line bg-accent-soft/40 p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="rounded-xl border border-accent-line bg-panel p-3 text-accent"><Server size={28} /></div>
              <div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="break-all text-xl font-semibold">{read.asset.name}</h3><Status kind="scope" value={read.asset.scope} /></div><p className="font-mono text-xs text-muted">{read.asset.id}</p><p className="mt-2 break-all font-mono text-sm">{read.asset.ident} · {read.asset.ip}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-accent-line pt-3 text-xs"><ShieldCheck size={15} className="text-accent" /><span className="text-muted">Project ROE</span><span className="font-mono">{read.project.roeVersion}</span><Status kind="roe" value={read.project.roeStatus} size="sm" /><span className="text-muted">{read.project.window || 'Window not set'}</span></div>
          </div>
          {read.asset.scope !== 'in' && <Banner tone="warn" title="Not an approved target">This asset is {read.asset.scope}. It cannot be selected for execution until the scope change is approved.</Banner>}
          <section aria-label="Asset identity">
            <h4 className="mb-3 flex items-center gap-2 font-semibold"><Fingerprint size={16} className="text-accent" />Identity & ownership</h4>
            <DescList cols={3} items={[
              { k: 'Type', v: read.asset.type }, { k: 'Operating system', v: read.asset.os }, { k: 'Owner', v: read.asset.owner },
              { k: 'Source', v: read.asset.source }, { k: 'Updated', v: read.asset.updated }, { k: 'Project', v: read.project.name },
            ]} />
          </section>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card><h4 className="mb-3 flex items-center gap-2 font-semibold"><Activity size={16} className="text-accent" />Operations <span className="text-muted">{read.operations.length}</span></h4>
              {read.operations.length ? <ul className="divide-y divide-line/60">{read.operations.map((op) => <li key={op.id} className="flex flex-wrap items-center gap-2 py-2"><span className="font-mono text-xs">{op.id}</span><span className="min-w-0 flex-1 text-xs">{op.name}</span><Status kind="op" value={op.status} size="sm" /></li>)}</ul> : <p className="text-xs text-muted">No operations reference this asset.</p>}
            </Card>
            <Card><h4 className="mb-3 flex items-center gap-2 font-semibold"><Network size={16} className="text-accent" />Associated agents <span className="text-muted">{read.agents.length}</span></h4>
              {read.agents.length ? <ul className="divide-y divide-line/60">{read.agents.map((agent) => <li key={agent.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-all font-mono text-xs">{agent.host}</span><Status kind="agent" value={agent.status} size="sm" /></li>)}</ul> : <p className="text-xs text-muted">No agents associated through operations.</p>}
            </Card>
          </div>
          <section>
            <h4 className="mb-3 flex items-center gap-2 font-semibold"><FileText size={16} className="text-accent" />Findings & evidence</h4>
            <div className="space-y-2">{read.findings.map((finding) => <div key={finding.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3"><Status kind="sev" value={finding.severity} size="sm" /><span className="min-w-0 flex-1 text-xs">{finding.title}</span><Status kind="finding" value={finding.status} size="sm" /></div>)}</div>
            <ul className="mt-3 flex flex-wrap gap-2">{read.evidence.map((evidence) => <li key={evidence.id} className="rounded-lg border border-line bg-subtle px-3 py-2 text-xs"><span className="mr-2 font-mono text-muted">{evidence.id}</span>{evidence.name}</li>)}</ul>
            {!read.findings.length && !read.evidence.length && <p className="text-xs text-muted">No linked findings or evidence.</p>}
          </section>
          <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer font-medium">Approval & update history</summary>
            <div className="mt-4 space-y-4">{read.approvals.map((approval) => <div key={approval.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="font-mono">{approval.id}</span><span>{approval.type} · {approval.reviewer}</span><Status kind="approval" value={approval.status} size="sm" /></div>)}<Timeline items={read.history} /></div>
          </details>
        </div>
      )}
    </Modal>
  )
}
