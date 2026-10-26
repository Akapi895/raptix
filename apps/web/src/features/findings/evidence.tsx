import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bug, Download, ExternalLink, Link2, Lock, Eye, EyeOff, Paperclip, ShieldCheck, Upload } from 'lucide-react'
import { useSessionStore } from '../../state/session'
import { captureRequestId, clearCaptureRequest } from './capture-session'
import { useFindingIdentity } from './presentation-context'
import { ROLE_LABEL } from '../../domain/policy'
import { type Finding } from '../../domain/entities'
import { EvidenceReadError, useEvidenceDetail, useEvidenceList, useFindingWrites } from './query'
import type { EvidenceDownload, EvidenceView } from './service'
import { useDelayedNav } from './delayed-nav'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, FilterBar, Input, Locked, Modal, Mono, PageHeader, SearchBox, Select, Skeleton, Table, Textarea, Timeline } from '../../ui/index'
import { go, useRoute } from '../../router/navigate'
import { realControlGap, useCan, useMe, useReadOnly } from '../../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../../state/stores'
function saveEvidenceFile(file: EvidenceDownload): void {
  const blob = new Blob([file.bytes.slice().buffer], { type: file.mediaType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
export function EvidenceTab({ f, evs, ro }: { f: Finding; evs: EvidenceView[]; ro: boolean }) {
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const me = useMe()
  const writes = useFindingWrites()
  const client = useQueryClient()
  const evidenceList = useEvidenceList({})
  const [view, setView] = useState<EvidenceView | null>(null)
  const [classifying, setClassifying] = useState<EvidenceView | null>(null)
  const [attach, setAttach] = useState(false)
  const [up, setUp] = useState(false)
  const canAdd = !ro && can('createFinding', f.projectId)
  const why = ro ? (me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.') : !canAdd ? `The ${ROLE_LABEL[me.role]} role cannot add evidence.` : ''
  const candidates = (evidenceList.data?.items ?? []).filter((e) => e.projectId === f.projectId && !e.findingId && !f.evidence.includes(e.ref))
  const canClassifyAny = candidates.some((e) => e.classification === 'unclassified' && e.canClassify)
  // A linked capture is not a candidate, but its owner or reviewer still classifies it from the finding.
  const classifyTarget = (ev: EvidenceView): EvidenceView | null => {
    const match = (evidenceList.data?.items ?? []).find((e) => e.ref === ev.ref)
    return match && match.classification === 'unclassified' && match.canClassify ? match : null
  }
  const refreshEvidence = (): void => {
    void client.invalidateQueries({ queryKey: ['evidence'] })
    void client.invalidateQueries({ queryKey: ['finding'] })
  }
  const link = async (evidenceId: string) => {
    const res = await writes.attachEvidence(f.id, evidenceId)
    if (res.ok) { toast(`Linked ${evidenceId} to ${f.id}.`); refreshEvidence() }
    else toast(res.failure.message, 'warn')
  }
  const download = async (evidence: EvidenceView) => {
        const result = await writes.downloadEvidence(evidence.captureId ?? evidence.ref)
    if (!result.ok) { toast(result.failure.message, 'warn'); return }
    saveEvidenceFile(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted">{evs.length} evidence item(s) — links are opaque references to retained captures; a linked claim still needs reviewer verification and is never proof of exploitability by itself. Evidence cannot be removed from history; every link is logged.</span>
        <Button icon={Link2} disabled={!canAdd && !canClassifyAny} title={!canAdd && !canClassifyAny ? why || 'No capture is awaiting your classification.' : undefined} onClick={() => setAttach(true)}>{canAdd ? 'Link Evidence' : 'Classify captures'}</Button>
        <Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>
      </div>
      <Table
        rows={evs} rowKey={(e) => e.ref} onRow={setView}
        empty={<Empty icon={Paperclip} title="No evidence yet" action={<Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>}>A finding needs at least one piece of evidence before it can be submitted for review.</Empty>}
        cols={[
          { key: 'n', header: 'Name', render: (e) => <div className="flex items-center gap-2"><Mono className="text-accent">{e.ref}</Mono><MaskedName ev={e} /></div> },
          { key: 'k', header: 'Type', render: (e) => e.kind },
          { key: 's', header: 'Source', hideBelow: 'md', render: (e) => <Mono>{e.source}</Mono> },
          { key: 'a', header: 'Captured at', hideBelow: 'lg', render: (e) => <span className="text-xs text-muted">{e.at}</span> },
          { key: 'b', header: 'Uploaded by', hideBelow: 'md', render: (e) => e.by },
          { key: 'l', header: 'Label', render: (e) => e.classification === 'unclassified' ? <span className="text-xs text-warn">Awaiting classification</span> : e.sensitive ? <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : <span className="text-xs text-muted">Standard</span> },
        ]}
      />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? <span><Mono className="text-accent">{view.ref}</Mono> · <MaskedName ev={view} /></span> : ''}
        footer={view && <><Button icon={Eye} onClick={() => go('evidence', { id: view.captureId ?? view.ref })}>Open in Evidence Inspector</Button>{classifyTarget(view) && <Button icon={ShieldCheck} onClick={() => { setClassifying(classifyTarget(view)); setView(null) }}>Classify capture</Button>}<Button icon={Download} disabled={view.masked || !view.canViewOriginal} title={view.masked ? 'Classification has not made this filename visible to your role.' : !view.canViewOriginal ? 'The current classification does not permit reading the original bytes.' : undefined} onClick={() => void download(view)}>Download original</Button></>}>
        {view && <EvidencePreview ev={view} />}
      </Drawer>
      <Modal open={attach} onClose={() => setAttach(false)} title="Link existing evidence" footer={<Button onClick={() => setAttach(false)}>Done</Button>}>
        {evidenceList.isError && <Banner tone="bad" title="Could not load retained captures">{evidenceList.error instanceof Error ? evidenceList.error.message : 'Capture inventory is unavailable.'}</Banner>}
        {evidenceList.isPending ? <Skeleton className="h-16" /> : candidates.length === 0 ? <div className="text-sm text-muted">No unlinked, classified evidence from {f.projectId} is available. Uploads appear here after an owner or reviewer classifies them.</div> : (
          <ul className="space-y-2">
            {candidates.map((e) => {
              const other = !!e.findingId && e.findingId !== f.id
              const unclassified = e.classification === 'unclassified'
              const inaccessible = e.sensitive && !e.canViewOriginal
              return (
                <li key={e.ref} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm"><Mono className="text-accent">{e.ref}</Mono> {e.masked ? 'Capture name restricted' : e.name}</div><div className="text-xs text-muted">{e.kind} · {e.source}{e.classification ? ` · ${e.classification}` : ''}{other ? ` · linked to ${e.findingId}` : ''}</div></div>
                  {unclassified && e.canClassify ? <Button size="sm" onClick={() => { setClassifying(e); setAttach(false) }}>Classify</Button> : null}
                  <Button size="sm" disabled={other || inaccessible || !canAdd} title={other ? `Already linked to ${e.findingId}` : inaccessible ? 'Classification restricts original access to owner/reviewer.' : !canAdd ? why : unclassified ? 'Linked now; original bytes stay locked until an owner or reviewer classifies the capture.' : undefined} onClick={() => { void link(e.captureId ?? e.ref) }}>Link</Button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      <CaptureClassificationModal evidence={classifying} onClose={() => setClassifying(null)} onClassified={refreshEvidence} />
      <UploadModal open={up} onClose={() => setUp(false)} f={f} onUploaded={refreshEvidence} />
    </div>
  )
}
function UploadModal({ open, onClose, f, onUploaded }: { open: boolean; onClose: () => void; f: Finding; onUploaded: () => void }) {
  return <RealCaptureUploadModal open={open} onClose={onClose} f={f} onUploaded={onUploaded} />
}
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  bin: 'application/octet-stream', csv: 'text/plain', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  json: 'application/json', log: 'text/plain', pdf: 'application/pdf', png: 'image/png', txt: 'text/plain',
}
function RealCaptureUploadModal({ open, onClose, f, onUploaded }: { open: boolean; onClose: () => void; f: Finding; onUploaded: () => void }): ReactNode {
  const identity = useFindingIdentity()
  const writes = useFindingWrites()
  const toast = useToastStore((s) => s.toast)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const [source, setSource] = useState(f.op ? `${f.op} / manual` : 'Operator upload')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    const file = fileInput.current?.files?.[0]
    if (!file) { setError('Select a capture file.'); return }
    if (file.size < 1 || file.size > 262144) { setError('Select a capture of 1–262144 bytes.'); return }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const mediaType = file.type && Object.values(MIME_BY_EXTENSION).includes(file.type) ? file.type : MIME_BY_EXTENSION[extension]
    if (!mediaType || !Object.values(MIME_BY_EXTENSION).includes(mediaType)) { setError('Unsupported media type.'); return }
    setBusy(true); setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)), (value) => value.toString(16).padStart(2, '0')).join('')
      const fingerprint = `${file.name}\u0000${mediaType}\u0000${digest}`
      const actorId = identity.uploadActorId
      const deploymentId = identity.uploadDeploymentId
      const requestId = pending.current?.fingerprint === fingerprint
        ? pending.current.requestId
        : captureRequestId(deploymentId, actorId, f.projectId, fingerprint)
      pending.current = { fingerprint, requestId }
      const result = await writes.uploadEvidence({ findingId: f.id, name: file.name, kind: mediaType, source, sensitive: false, bytes, mediaType, requestId })
      if (!result.ok) { setError(result.failure.message); return }
      pending.current = null
      clearCaptureRequest(deploymentId, actorId, f.projectId, fingerprint)
      if (fileInput.current) fileInput.current.value = ''
      toast(`Capture ${result.data.id} retained as unclassified. You can link it now; original bytes stay locked until an owner or reviewer classifies it.`)
      onUploaded()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture upload failed. Re-select the same file to reconcile this request.')
    } finally { setBusy(false) }
  }
  return <Modal open={open} onClose={onClose} title="Retain evidence capture" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} disabled={busy} onClick={() => void save()}>{busy ? 'Retaining…' : 'Retain unclassified capture'}</Button></>}>
    <div className="space-y-4">
      {error && <Banner tone="bad" title="Capture was not acknowledged">{error} If the server may have saved it, re-select the same file to retry with the same request identity.</Banner>}
      <Field label="Capture file" required hint="Maximum 256 KiB. Captures start unclassified; original bytes stay locked until an owner or reviewer classifies them."><input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.gif,.txt,.log,.json,.pdf,.bin" className="block w-full text-sm" onChange={() => setError(null)} /></Field>
      <Field label="Source context"><Input value={source} onChange={(event) => setSource(event.target.value)} /></Field>
      <p className="text-xs text-muted">This file will be retained in engagement <Mono>{f.projectId}</Mono>. The selected context is display-only; producer attribution comes from the authenticated server session.</p>
    </div>
  </Modal>
}
function CaptureClassificationModal({ evidence, onClose, onClassified }: { evidence: EvidenceView | null; onClose: () => void; onClassified: () => void }) {
  const writes = useFindingWrites()
  const toast = useToastStore((s) => s.toast)
  const [classification, setClassification] = useState<'standard' | 'sensitive'>('standard')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const classify = async () => {
    if (!evidence?.captureId || !reason.trim()) return
    const res = await writes.classifyCapture(evidence.captureId, classification, evidence.classificationVersion ?? 1, reason.trim())
    if (!res.ok) { setError(res.failure.message); return }
    toast(`Capture ${evidence.captureId} classified ${classification}.`)
    setError(null); setReason(''); onClassified(); onClose()
  }
  return <Modal open={evidence !== null} onClose={onClose} title="Classify retained capture" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!reason.trim()} onClick={() => void classify()}>Save classification</Button></>}>
    {evidence && <div className="space-y-3">
      <p className="text-sm text-muted">Original bytes remain locked until this decision. Standard captures are readable by engagement members; sensitive captures are readable only by owner/reviewer.</p>
      {error && <Banner tone="bad" title="Classification was not saved">{error}</Banner>}
      <Field label="Capture"><Mono>{evidence.captureId}</Mono></Field>
      <Field label="Classification"><Select value={classification} onChange={(event) => setClassification(event.target.value as 'standard' | 'sensitive')}><option value="standard">Standard — readable by engagement members</option><option value="sensitive">Sensitive — owner/reviewer only</option></Select></Field>
      <Field label="Reason" required><Textarea aria-label="Classification reason" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </div>}
  </Modal>
}
function useEvidenceBytes(evidenceId: string, enabled: boolean) {
  const writes = useFindingWrites()
  const [data, setData] = useState<EvidenceDownload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!enabled || !evidenceId) { setData(null); setError(null); return }
    let current = true
    setPending(true); setError(null)
    void writes.downloadEvidence(evidenceId).then((result) => {
      if (!current) return
      if (result.ok) setData(result.data)
      else setError(result.failure.message)
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Capture download failed.') })
      .finally(() => { if (current) setPending(false) })
    return () => { current = false }
  }, [enabled, evidenceId, writes])
  const imageUrl = useMemo(() => {
    if (!data || !data.mediaType.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null
    return URL.createObjectURL(new Blob([data.bytes.slice().buffer], { type: data.mediaType }))
  }, [data])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  return { data, error, imageUrl, pending }
}
type OriginalReadState = ReturnType<typeof useEvidenceBytes>
function CaptureOriginalContent({ evidence, open, original }: { evidence: EvidenceView; open: boolean; original: OriginalReadState }): ReactNode {
  if (!evidence.captureId) return <p className="text-sm text-muted">{realControlGap('evidence.original')}</p>
  if (!evidence.canViewOriginal) return <Banner tone="warn" title="Original bytes are locked">This capture is unclassified or its sensitivity classification does not permit your role to read it.</Banner>
  if (!open) return <p className="text-sm text-muted">Choose Preview original to retrieve and verify the retained bytes.</p>
  if (original.pending) return <p role="status" className="text-sm text-muted">Loading and verifying capture bytes…</p>
  if (original.error) return <Banner tone="bad" title="Original capture could not be verified">{original.error}</Banner>
  if (!original.data) return <p className="text-sm text-muted">No original bytes were returned.</p>
  const { data } = original
  const isText = data.mediaType === 'text/plain' || data.mediaType === 'application/json'
  let text: string | null = null
  if (isText) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data.bytes) }
    catch { text = null }
  }
  return <div className="space-y-2">
    <p role="status" className="break-all text-xs text-ok">Capture integrity verified · SHA-256 <Mono>{data.digest}</Mono></p>
    {text !== null ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg p-3 font-mono text-xs">{text}</pre>
      : original.imageUrl ? <img src={original.imageUrl} alt={data.filename} className="max-h-96 max-w-full rounded-lg border border-line object-contain" />
        : <p className="text-sm text-muted">Inline preview is unavailable for this media type. The verified original can be downloaded.</p>}
  </div>
}
function EvidencePreview({ ev }: { ev: EvidenceView }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const original = useEvidenceBytes(ev.captureId ?? '', previewOpen && ev.canViewOriginal === true)
  return <div className="space-y-4">
    <p className="text-sm text-muted">Capture integrity is checked against the original bytes before display. A matching digest does not validate the recorded claim.</p>
    <Button variant="secondary" disabled={!ev.canViewOriginal} title={!ev.canViewOriginal ? 'Classification or role does not permit original-byte access.' : undefined} onClick={() => setPreviewOpen(true)}>Preview original</Button>
    <CaptureOriginalContent evidence={ev} open={previewOpen} original={original} />
    <DescList cols={2} items={[{ k: 'Classification', v: ev.classification ?? 'Legacy / unclassified' }, { k: 'Digest', v: ev.digest ?? 'Not recorded' }, { k: 'Size', v: ev.sizeBytes === undefined ? 'Unknown' : `${ev.sizeBytes} bytes` }]} />
  </div>
}
/**
 * Standalone evidence list (ticket 33): the scoped rows, type options and
 * role-sensitive masking come from the typed findings service through Query
 * — every row renders its opaque reference, and a masked capture withholds
 * only its name (the reference stays visible). Missing/cross-project reads
 * are handler refusals rendered as errors, never content.
 */
export function EvidenceList() {
  const pid = useProjectStore((s) => s.pid)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const list = useEvidenceList({ q: q || undefined, kind: kind || undefined })
  const writes = useFindingWrites()
  const toast = useToastStore((s) => s.toast)
  const queryClient = useQueryClient()
  const [importing, setImporting] = useState(false)
  const rows = list.data?.items ?? []
  const importWorkspace = async () => {
    setImporting(true)
    const res = await writes.importWorkspaceEvidence()
    setImporting(false)
    if (!res.ok) { toast(res.failure.message, 'warn'); return }
    const { files, skipped } = res.data
    toast(`${files} workspace evidence file${files === 1 ? '' : 's'} in the inventory${skipped.length ? `; ${skipped.length} skipped` : ''}.`, skipped.length ? 'warn' : undefined)
    void queryClient.invalidateQueries({ queryKey: ['evidence'] })
  }
  return (
    <div>
      <PageHeader title="Evidence" sub={pid === 'all' ? 'Evidence across accessible projects (read-only).' : `Evidence recorded for ${pid}. Open an item to inspect metadata and chain of custody.`} />
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID, name or source…" className="w-full sm:w-72" />
        <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto"><option value="">All types</option>{(list.data?.kinds ?? []).map((k) => <option key={k}>{k}</option>)}</Select>
        <Button onClick={() => void importWorkspace()} disabled={pid === 'all' || importing} title={pid === 'all' ? 'Select an engagement to import its workspace evidence.' : 'Adds the files the agent wrote under findings/evidence/ to this inventory as unclassified captures. Their bytes stay locked until an owner or reviewer classifies them.'}>{importing ? 'Importing…' : 'Import workspace evidence'}</Button>
      </FilterBar>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading evidence"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Could not load evidence" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as EvidenceReadError).failure.message}
        </Empty>
      ) : (
        <Table
          rows={rows} rowKey={(e) => e.ref} onRow={(e) => go('evidence', { id: e.ref })}
          empty={<Empty icon={Paperclip} title="No evidence in this project yet" action={<Button onClick={() => go('operations')}>Open Operations</Button>}>Evidence is captured when operation steps produce output. Next: run an operation, or upload from a finding.</Empty>}
          cols={[
            { key: 'id', header: 'Evidence ID', render: (e) => <span className="whitespace-nowrap"><Mono className="text-accent">{e.ref}</Mono></span> },
            { key: 'n', header: 'Name', render: (e) => (e.masked ? <span className="text-warn">Sensitive file — redacted</span> : <span>{e.name}</span>) },
            { key: 'k', header: 'Type', render: (e) => <span className="whitespace-nowrap">{e.kind}</span> },
            { key: 's', header: 'Source event', hideBelow: 'md', render: (e) => <span className="whitespace-nowrap"><Mono>{e.source}</Mono></span> },
            { key: 'f', header: 'Finding', hideBelow: 'md', render: (e) => (e.findingId ? <span className="whitespace-nowrap"><Mono>{e.findingId}</Mono></span> : '—') },
            { key: 'r', header: 'Redaction', render: (e) => <span className="whitespace-nowrap text-xs">{e.sensitive ? <span className="text-warn">Redacted by default</span> : 'None needed'}</span> },
            { key: 'a', header: 'Captured', hideBelow: 'lg', render: (e) => <span className="whitespace-nowrap text-xs text-muted">{e.at}</span> },
          ]}
        />
      )}
    </div>
  )
}
/**
 * Standalone evidence inspector (ticket 33): both route aliases render this
 * typed read — metadata, producer links (resolved by the handler from real
 * record links, never parsed from the source string) and the simulated
 * capture integrity, which describes the retained capture and is never
 * proof of a finding. Masking and the display/download gates are handler
 * decisions, identical whichever screen linked the capture; a
 * missing/out-of-scope record reveals no content and a cross-project record
 * offers an explicit, access-checked switch.
 */
export function EvidenceInspector() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const writes = useFindingWrites()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const readOnly = useReadOnly()
  const nav = useDelayedNav()
  const [orig, setOrig] = useState(true)
  const [log, setLog] = useState<{ at: string; text: string }[]>([])
  const detail = useEvidenceDetail(route.id || undefined)
  const original = useEvidenceBytes(route.id ?? '', !!detail.data?.canViewOriginal && orig)
  useEffect(() => { setOrig(true); setLog([]) }, [route.id])
  if (!route.id) return <EvidenceList />
  if (detail.isError) {
    const err = (detail.error as EvidenceReadError).failure
    const other = err.kind === 'forbidden' ? err.entity?.projectId : undefined
    if (other) {
      return (
        <Empty icon={Lock} title={`Evidence ${route.id} belongs to another project`} action={<div className="flex gap-2"><Button variant="primary" onClick={() => { setPid(other); nav(() => go('evidence', { id: route.id }), 80) }}>Switch to {other}</Button><Button onClick={() => setSwitcherOpen(true)}>Select another project</Button></div>}>
          The selected project is {pid}. To avoid mixing data, content from {other} is not shown in this context.
        </Empty>
      )
    }
    return <Empty icon={AlertTriangle} title="Evidence not found" action={<Button onClick={() => go('evidence')}>Back to evidence</Button>}>ID {route.id} does not exist or is not available for your account.</Empty>
  }
  if (detail.isPending || !detail.data) {
    return <div aria-busy="true" aria-label="Loading evidence"><Skeleton className="h-72" /></div>
  }
  const data = detail.data
  const ev = data.evidence
  const producer = data.producer
    const origWhy = (!ev.captureId ? (realControlGap('evidence.original') ?? 'Original bytes are unavailable for this legacy reference.') : !data.canViewOriginal ? (me.role === 'viewer' ? 'The viewer role cannot read original bytes.' : 'The capture is unclassified or its classification does not permit your role.') : '')
  const masked = !orig
  const ro = readOnly(ev.projectId)
  const createWhy = realControlGap('finding.evidenceLink') ?? (ro ? 'Project is read-only.' : !can('createFinding', ev.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot create findings.` : '')
  const toggle = () => {
    if (!orig) {
      confirm({ title: 'View original content?', confirmLabel: 'View original', body: 'The server re-checks capture classification and role before returning original bytes. The browser verifies SHA-256 before display.', onConfirm: async () => {
                setOrig(true)
      } })
    } else { setOrig(false); toast('Masked view restored.', 'info') }
  }
  const download = async () => {
        const result = await writes.downloadEvidence(ev.captureId ?? ev.ref)
    if (!result.ok) { toast(result.failure.message, 'warn'); return }
    saveEvidenceFile(result.data)
  }
  const createFinding = () => {
    setFilter('finding-prefill', { projectId: ev.projectId, op: producer?.operation?.id, technique: producer?.step?.technique, asset: producer?.step?.asset, stepId: producer?.step?.id, evidence: [ev.ref], title: producer?.step ? `Finding from ${ev.ref}: ${producer.step.name}` : `Finding from ${ev.ref}`, desc: `Observed in ${ev.source}. Evidence ${ev.ref} (${ev.kind}) captured ${ev.at}.` })
    go('finding-new')
  }
  const chain = [
    { at: ev.at, title: `Captured by agent ${producer?.step?.agent || producer?.invocation?.producer || '—'}`, sub: `${ev.source} · collector ${producer?.agent ? producer.agent.host : ('—')}`, tone: 'cyan' as const },
    ...([]),
    { at: ev.at, title: `Collected by ${ev.by}`, sub: 'Attached to the operation record', tone: 'accent' as const },
    ...data.findings.map((f) => ({ at: f.updated, title: `Linked to ${f.id}`, sub: 'Link cannot be removed from history', tone: 'ok' as const })),
  ]

  return (
    <div>
      <PageHeader
        back={{ label: 'Evidence', to: () => go('evidence') }}
        title={<span className="flex flex-wrap items-center gap-2"><Mono className="text-accent">{ev.ref}</Mono><span className="text-base font-medium">{ev.masked ? 'Sensitive file — redacted' : ev.name}</span></span>}
        meta={ev.sensitive ? <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2.5 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : undefined}
        sub={`Project ${ev.projectId} · captured ${ev.at}`}
        actions={<Button variant="primary" icon={Bug} disabled={!!createWhy} title={createWhy || 'Open the finding form prefilled from this evidence'} onClick={createFinding}>Create finding from evidence</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Content" sub={undefined} actions={
              <Button size="sm" icon={orig ? EyeOff : Eye} disabled={!!origWhy} title={origWhy || (orig ? 'Return to masked view' : 'Show original content')} onClick={toggle}>{orig ? 'Mask content' : 'View Original'}</Button>
            } />
            {origWhy && ev.sensitive && <div className="mb-3"><Locked reason={origWhy} /></div>}
            {masked ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-line bg-bg text-center text-muted" role="img" aria-label="Masked content"><div><Lock size={28} className="mx-auto mb-2 text-warn" aria-hidden /><div className="text-sm">Content hidden</div><div className="text-xs">Choose View Original to show it again</div></div></div>
            ) : (
              <CaptureOriginalContent evidence={ev} open={orig} original={original} />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={Download} disabled={!data.canViewOriginal} title={(origWhy || undefined)} onClick={() => void download()}>Download original</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Chain of custody" />
            <Timeline items={chain} />
          </Card>
          <Card>
            <CardHeader title="Review log" />
            {log.length === 0 ? <div className="text-sm text-muted">No access to original content recorded in this session.</div> : <Timeline items={log.map((l) => ({ ...l, title: l.text, tone: 'warn' as const }))} />}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Metadata" />
            <DescList cols={1} items={[
              { k: 'Evidence ID', v: <Mono>{ev.ref}</Mono> },
              { k: 'Source event', v: <Mono>{ev.source}</Mono> },
              { k: 'Operation', v: producer?.operation ? <button className="font-mono text-[13px] text-link hover:underline" onClick={() => go('operation', { id: producer.operation!.id })}>{producer.operation.id}</button> : '—' },
              { k: 'Agent / Session', v: <span className="whitespace-nowrap">{producer?.agent ? <Mono>{producer.agent.id} · {producer.agent.host}</Mono> : '—'}{producer?.session && <> · <button className="font-mono text-[13px] text-link hover:underline" onClick={() => go('c2-session', { id: producer.session!.id })}>{producer.session.id}</button></>}</span> },
              { k: 'Captured time', v: ev.at },
              { k: 'Collector', v: ev.by },
              { k: 'Content type', v: ev.kind },
              { k: 'Hash / integrity', v: (ev.captureId ? <span><Mono className="break-all text-xs">sha256:{original.data?.digest ?? ev.digest ?? '—'}</Mono><div className={`mt-1 text-xs ${original.data ? 'text-ok' : 'text-muted'}`}>{original.data ? 'Capture integrity verified' : 'Not checked until original bytes are read'}</div><div className="mt-1 text-xs text-muted">Integrity describes bytes, not the truth of a finding.</div></span> : <span className="text-muted">{realControlGap('evidence.integrity')}</span>) },
              { k: 'Redaction status', v: !ev.sensitive ? 'None needed' : orig ? 'Redacted by default — original shown (logged)' : 'Redacted (masked)' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Linked records" />
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Operation step</span>{producer?.operation && producer?.step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('operation', { id: producer.operation!.id, tab: 'console' })}>{producer.operation.id} / {producer.step.id}</Button> : '—'}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Finding</span>{data.findings.length ? <span className="flex flex-wrap justify-end gap-1.5">{data.findings.map((f) => <Button key={f.id} size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('finding', { id: f.id })}>{f.id}{f.status === 'ai_suggested' ? ' (AI, unverified)' : ''}</Button>)}</span> : <span className="text-muted">Not linked yet</span>}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">ATT&CK technique</span>{producer?.step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('analysis', { id: producer.operation?.id, tab: 'matrix' })}>{producer.step.technique}</Button> : '—'}</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
const MaskedName = ({ ev }: { ev: EvidenceView }) =>
  ev.masked ? <span className="inline-flex items-center gap-1.5 text-warn"><Lock size={13} aria-hidden />Sensitive file — redacted</span> : <span>{ev.name ?? ev.ref}</span>
