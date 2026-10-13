import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { AiModeBadge, Button, Gated, IconButton, Modal } from '../ui'
import { Composer, EligBadge, NoProject, Thread } from './g-common'

const SUGGEST: Record<string, string[]> = {
  operation: ['Explain recent operation results', 'Summarize this operation', 'Review agent readiness'],
  console: ['Explain recent operation results', 'Summarize this operation'],
  analysis: ['Explain recent operation results', 'Summarize detection coverage'],
  findings: ['Summarize open findings', 'Explain the highest-severity finding'],
  finding: ['Explain this finding', 'Summarize evidence for this finding'],
  reports: ['Summarize report readiness', 'Summarize open findings'],
  report: ['Summarize this report', 'Summarize open findings'],
  project: ['Summarize the approved scope', 'Review agent readiness'],
}
const has = (kind: string, ...ks: string[]) => ks.some((k) => kind.includes(k))
const pick = (kind: string) => {
  const k = Object.keys(SUGGEST).find((x) => kind.includes(x))
  return k ? SUGGEST[k] : ['Summarize the approved scope', 'Review agent readiness', 'Explain recent operation results']
}

export function CopilotDrawer() {
  const { copilotOpen, copilotCtx, setCopilotOpen, db, pid, project, A, aiMode, go, can, readOnly, toast } = useStore()
  const [confirm, setConfirm] = useState<'plan' | 'finding' | null>(null)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<Element | null>(null)
  const conv = db.conversations.find((c) => c.projectId === pid)
  const creating = useRef(false)
  const lastPid = useRef(pid)
  const close = () => setCopilotOpen(false)

  useEffect(() => { if (lastPid.current !== pid) { lastPid.current = pid; if (copilotOpen) close() } }) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (copilotOpen && pid !== 'all' && !conv && !creating.current) { creating.current = true; A.createConversation(pid, aiMode) }
    if (conv) creating.current = false
  }, [copilotOpen, pid, conv]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!copilotOpen) return
    opener.current = document.activeElement
    const el = panel.current
    el?.querySelector<HTMLElement>('textarea, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key !== 'Tab' || !el) return
      const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled])')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); (opener.current as HTMLElement | null)?.focus?.() }
  }, [copilotOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!copilotOpen) return null
  const ctxLabel = copilotCtx?.label
  const kind = copilotCtx?.kind || ''
  const ro = pid !== 'all' && readOnly(pid)
  const ask = (t: string) => { if (conv) A.sendChat(conv.id, t) }
  const canPropose = !!conv && conv.mode !== 'observe' && !ro && can('plan')
  const proposeWhy = !conv ? 'No conversation yet.' : ro ? 'This project is read-only.' : conv.mode === 'observe' ? 'AI mode is Observe (read-only). Switch to Propose in the full workspace.' : !can('plan') ? 'Your role cannot create plan proposals.' : ''
  const findWhy = ro ? 'This project is read-only.' : !can('createFinding') ? 'Your role cannot create findings.' : ''
  const subject = ctxLabel || 'this page'
  return (
    <div className="fixed inset-0 z-[75]">
      <div className="absolute inset-0 bg-black/20" onClick={close} aria-hidden />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="copilot-title" className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id="copilot-title" className="flex items-center gap-2 text-base font-semibold"><Sparkles size={16} className="text-accent" aria-hidden />Ask AI</h2>
          <IconButton icon={X} label="Close Ask AI" onClick={close} className="!h-8 !w-8" />
        </div>
        <div className="space-y-2 border-b border-line px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-subtle px-2 py-0.5">Project: <span className="font-mono">{project?.id || 'None'}</span></span>
            {ctxLabel && <span className="rounded-full border border-line bg-subtle px-2 py-0.5">Context: {ctxLabel}</span>}
            <AiModeBadge mode={conv?.mode || 'observe'} />
          </div>
          {pid !== 'all' && <EligBadge pid={pid} />}
          <p className="text-muted">Context follows the page you opened it from. Answers are read-only analysis; anything that changes state asks you to review and confirm first.</p>
        </div>
        {pid === 'all' ? <div className="p-4"><NoProject compact /></div> : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {conv && conv.messages.length === 0 && <p className="mb-3 text-sm text-muted">Ask about {ctxLabel || 'this project'}. Answers are based on available project data.</p>}
              <Thread conv={conv} compact />
            </div>
            <div className="px-4 pb-3">
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Copilot actions">
                {has(kind, 'operation', 'console', 'analysis', 'step', 'finding', 'report', 'project', 'asset') && <Button size="sm" disabled={!conv || ro} onClick={() => ask(`Explain recent results for ${subject}`)}>Explain Result</Button>}
                {has(kind, 'operation', 'console', 'finding', 'report', 'step', 'analysis') && <Button size="sm" disabled={!conv || ro} onClick={() => ask(`Summarize evidence for ${subject}`)}>Summarize Evidence</Button>}
                {has(kind, 'operation', 'console', 'analysis', 'step', 'project', 'asset') && <Gated allowed={!proposeWhy} reason={proposeWhy}><Button size="sm" onClick={() => setConfirm('plan')}>Propose Next Step</Button></Gated>}
                {has(kind, 'operation', 'console', 'analysis', 'step', 'finding') && <Gated allowed={!findWhy} reason={findWhy}><Button size="sm" onClick={() => setConfirm('finding')}>Create Draft Finding</Button></Gated>}
              </div>
              <Composer conv={conv} suggestions={pick(copilotCtx?.kind || '')} compact />
              <Button className="mt-2 w-full" icon={ExternalLink} onClick={() => { close(); go('ai-operator', { id: conv?.id }) }}>Open full workspace</Button>
            </div>
          </>
        )}
      </aside>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'plan' ? 'Review and confirm: propose next step' : 'Review and confirm: create draft finding'}
        footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={() => {
          if (confirm === 'plan') { ask(`Propose the next step for ${subject}`); toast('Proposal requested. It stays a proposal until a reviewer approves it.', 'info') }
          else { setConfirm(null); close(); go('finding-new'); return }
          setConfirm(null)
        }}>{confirm === 'plan' ? 'Request proposal' : 'Open draft finding form'}</Button></>}>
        <p className="text-sm">{confirm === 'plan' ? `The AI will draft a proposal for ${subject} in project ${pid}. Nothing is executed and the proposal needs reviewer approval.` : `Opens the new-finding form for ${pid}. AI suggestions are not verified findings: you check the evidence and scope, then save it as a draft.`}</p>
      </Modal>
    </div>
  )
}
