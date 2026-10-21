/**
 * Shared document reader/editor for Scope & ROE and Planning (plan
 * 2026-10-16 §4): one document model per entry — the same list, reader and
 * draft store on both surfaces, only the entry differs. Readable/Source edit
 * the same draft; invalid JSON keeps the draft and reports the error instead
 * of a fake save; saves are simulated mock-authority writes and are labelled
 * as such. The applied scope is never overwritten by a draft — it changes
 * only through the approval workflow.
 */
import { useMemo, useState } from 'react'
import { CircleAlert, Download, FileText, FileWarning, Pencil, Save, Trash2 } from 'lucide-react'
import type { Project } from '../../data'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { useQueryScope } from '../../state/keys'
import { useDirty, useSessionStore } from '../../state/session'
import { useToastStore } from '../../state/stores'
import { DATA_MODE } from '../../state/mode'
import { Banner, Button, Card, Empty, Segmented, Status, Textarea, cx } from '../../ui/index'
import { discardDocumentDraft, saveDocumentDraft, useProjectDocuments, type DocView } from './service'
import { PlanDocument } from './plan-document'

const ORIGIN_CLS: Record<DocView['origin'], string> = {
  'Applied scope': 'border-accent/40 bg-accent-soft text-accent',
  'AI-generated': 'border-cyan/40 bg-info-soft text-cyan',
  'Human-authored': 'border-line bg-subtle text-muted',
}

/** Generic readable rendering of a draft JSON document (one section per field). */
function readableFromJson(text: string): { ok: true; text: string } | { ok: false } {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    const lines: string[] = []
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) { lines.push(`## ${k}`, ...v.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`), '') }
      else if (v !== null && typeof v === 'object') { lines.push(`## ${k}`, JSON.stringify(v, null, 2), '') }
      else lines.push(`## ${k}`, String(v), '')
    }
    return { ok: true, text: lines.join('\n') }
  } catch { return { ok: false } }
}

export function DocumentWorkspace({ p, kindFilter = 'all' }: { p: Project; kindFilter?: 'all' | 'planning' }) {
  const services = useServices()
  const me = useMe()
  const scope = useQueryScope()
  const toast = useToastStore((s) => s.toast)
  const read = useProjectDocuments(p.id)
  const [selected, setSelected] = useState('roe')
  const [mode, setMode] = useState<'readable' | 'source'>('readable')
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [saveError, setSaveError] = useState('')

  const docs = kindFilter === 'planning' ? read.docs.filter((d) => d.kind === 'Planning').sort((a, b) => Number(a.status === 'superseded') - Number(b.status === 'superseded')) : read.docs
  const doc = docs.find((d) => d.id === selected) ?? docs[0]
  const baseline = doc?.draft?.text ?? doc?.raw ?? ''
  const dirty = editing && draftText !== baseline
  const jsonError = useMemo(() => (doc?.format === 'json' && editing ? (readableFromJson(draftText).ok ? '' : 'The draft source is not valid JSON. Fix it in Source mode; the draft is kept and nothing is saved.') : ''), [doc?.format, editing, draftText])
  const readable = useMemo(() => {
    if (!doc) return ''
    if (!doc.draft) return doc.readable
    if (doc.format !== 'json') return doc.draft.text
    const r = readableFromJson(doc.draft.text)
    return r.ok ? r.text : doc.draft.text
  }, [doc])
  useDirty(dirty, editing && doc ? () => { if (!save()) throw new Error('The draft was not saved. Fix the document before continuing.') } : undefined)

  if (DATA_MODE === 'real') {
    return <Empty icon={FileWarning} title="Document workspace is demo-only">Real engagements use their API-backed planning and scope panels; there is no simulated draft store here.</Empty>
  }
  if (!doc) {
    return <Empty icon={FileWarning} title={kindFilter === 'planning' ? 'No AI plans for this project' : 'No documents yet'}>Create a plan with AI to start an OPPLAN document. Its content, revisions and review status will appear here.</Empty>
  }

  const open = (id: string) => {
    if (id === doc.id) return
    useSessionStore.getState().guarded(() => { setSelected(id); setEditing(false); setSaveState('idle'); setSaveError(''); setMode('readable') })
  }
  const startEdit = () => { setDraftText(doc.draft?.text ?? (mode === 'source' ? doc.raw : doc.format === 'json' ? doc.raw : doc.readable)); setEditing(true); setSaveState('idle'); setSaveError('') }
  const cancelEdit = () => { setEditing(false); setDraftText(''); setSaveState('idle'); setSaveError('') }
  const save = (): boolean => {
    if (jsonError) { setSaveState('failed'); setSaveError(jsonError); return false }
    setSaveState('saving')
    try {
      const res = saveDocumentDraft(services.authority, services.clock, { actor: { id: scope.actor, role: scope.role }, projectId: p.id, corr: 'doc-draft' }, p.id, doc.id, draftText)
      if (!res.ok) { setSaveState('failed'); setSaveError(res.failure.message); return false }
      setSaveState('saved'); setEditing(false); setSaveError('')
      toast('Draft saved — simulated mock write, not a real file')
      return true
    } catch (err) {
      setSaveState('failed'); setSaveError(err instanceof Error ? err.message : 'The draft could not be saved.')
      return false
    }
  }
  const discard = () => {
    const res = discardDocumentDraft(services.authority, { actor: { id: scope.actor, role: scope.role }, projectId: p.id, corr: 'doc-draft' }, p.id, doc.id)
    if (!res.ok) { toast(res.failure.message, 'bad'); return }
    setEditing(false); setDraftText(''); setSaveState('idle'); setSaveError('')
    toast('Draft discarded')
  }
  const download = () => toast(`Downloading ${doc.name} (simulated)`, 'info')

  const draftReadableInvalid = !!doc.draft && doc.format === 'json' && !readableFromJson(doc.draft.text).ok
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[272px_minmax(0,1fr)]">
      <Card className="min-w-0 self-start" pad={false}>
        <div className="border-b border-line p-4"><h3 className="text-sm font-semibold">{kindFilter === 'planning' ? 'OPPLAN documents' : 'Project documents'}</h3><p className="mt-1 text-xs text-muted">{docs.length} documents · select to read here</p></div>
        <ul className="divide-y divide-line/60">
          {docs.map((d) => (
            <li key={d.id}>
              <button onClick={() => open(d.id)} aria-label={d.plan ? `Open OPPLAN ${d.id}` : undefined} aria-current={d.id === doc.id ? 'true' : undefined} className={cx('flex w-full flex-col gap-2 border-l-2 px-4 py-4 text-left transition hover:bg-hover', d.id === doc.id ? 'border-accent bg-accent-soft/50' : 'border-transparent')}>
                <span className="flex items-start gap-2"><FileText size={16} className="mt-0.5 shrink-0 text-accent" /><span className="min-w-0 flex-1 text-sm font-medium leading-snug">{d.plan?.title ?? d.name}</span>{d.draft && <span className="shrink-0 rounded-full bg-warn-soft px-1.5 text-[10px] font-semibold uppercase text-warn">Draft</span>}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className="font-mono">{d.plan ? d.id : d.kind}</span>·<span className="font-mono">{d.version}</span>{d.plan ? <Status kind="plan" value={d.status} size="sm" /> : <Status kind="generic" value={d.statusTone} size="sm" label={d.status} />}
                </span>
                <span className="text-[11px] text-muted">{d.updated} · {d.origin}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 truncate text-sm font-semibold">{doc.name}</h3><Status kind="generic" value={doc.statusTone} size="sm" label={doc.status} /></div>
            <p className="mt-0.5 text-xs text-muted">Version <span className="font-mono">{doc.version}</span> · {doc.source} · updated {doc.updated} · <span className={cx('rounded-full border px-1.5', ORIGIN_CLS[doc.origin])}>{doc.origin}</span></p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!editing && <Button size="sm" icon={Download} onClick={download}>Download</Button>}
            {!editing && <Button size="sm" icon={Pencil} disabled={!doc.editable} title={doc.editable ? 'Edit a working draft (simulated save)' : 'This document has no editable content in the demo dataset'} onClick={startEdit}>Edit draft</Button>}
          </div>
        </div>
        {draftReadableInvalid && <Banner tone="warn" icon={CircleAlert} title="The saved draft is not valid JSON">Readable shows the raw draft text. Open Source mode to fix or discard the draft.</Banner>}
        {editing && jsonError && <Banner tone="bad" icon={CircleAlert} title="Not saved">{jsonError}</Banner>}
        {saveState === 'failed' && saveError && <Banner tone="bad" icon={CircleAlert} title="The draft was not saved">{saveError} Your edits are kept.</Banner>}
        <Segmented value={mode} onChange={setMode} options={[{ id: 'readable', label: 'Readable' }, { id: 'source', label: doc.format === 'json' ? 'Source (JSON)' : 'Source' }]} />
        {saveState === 'saved' && <p className="text-xs text-ok" role="status">Draft saved {doc.draft?.at} by {doc.draft?.by} — simulated mock write.</p>}
        {editing ? (
          <>
            <Textarea aria-label={`${doc.name} draft`} className="min-h-[320px] font-mono text-[13px]" value={draftText} onChange={(e) => { setDraftText(e.target.value); if (saveState !== 'idle') setSaveState('idle') }} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={Save} disabled={saveState === 'saving' || !!jsonError} title={jsonError || undefined} onClick={save}>{saveState === 'saving' ? 'Saving…' : 'Save draft'}</Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={cancelEdit}>Discard edits</Button>
              <span className="text-xs text-muted">{dirty ? 'Unsaved changes.' : 'No changes yet.'} Drafts never change the applied scope — that stays with the approval workflow.</span>
            </div>
            {dirty && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-accent">Compare changes (applied vs draft)</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral">Applied</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-subtle p-3 font-mono text-xs">{mode === 'source' ? doc.raw : doc.readable}</pre></div>
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral">Draft</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-warn/40 bg-warn-soft/40 p-3 font-mono text-xs">{draftText}</pre></div>
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            {mode === 'readable' && doc.plan && !doc.draft ? <PlanDocument plan={doc.plan} project={p} /> : <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-panel p-4 font-mono text-[13px] leading-relaxed">{mode === 'source' ? (doc.draft?.text ?? doc.raw ?? '(no source available)') : readable}</pre>}
            {doc.draft && <p className="text-xs text-warn">A working draft exists ({doc.draft.at} by {doc.draft.by}); the applied version is unchanged until the approval workflow runs. <button className="text-accent underline" onClick={discard}>Discard draft</button></p>}
            {!doc.editable && <p className="text-xs text-muted">{me.role === 'viewer' ? 'Demo file entry — download is simulated.' : 'No document content exists in this demo dataset; only the file name and simulated download.'}</p>}
          </>
        )}
      </div>
    </div>
  )
}
