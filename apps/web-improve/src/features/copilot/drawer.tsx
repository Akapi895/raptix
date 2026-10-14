/**
 * Context-aware copilot drawer (ticket 60) — the `copilotDrawer` shell slot
 * implementation (ticket 08 contract, wired at the mount site in
 * src/router/host.tsx and, since ticket 66 retired the legacy drawer screen,
 * also the shell's omitted-slot default).
 *
 * Composition mirrors the migrated AI workspace (ticket 38): the conversation
 * read is the typed ChatService list through the feature-local Query binding —
 * keys embed the auth/project scope, so the drawer renders only the current
 * project's accessible conversations and a persona/project switch re-scopes or
 * refuses without exposing old engagement content. Conversation creation goes
 * through the typed handlers; sending goes through the demo runtime's chat
 * orchestration (busy flag + timer, the exact engine the legacy action
 * delegates to), which commits through the same handlers — a mutation from
 * either path publishes the ChangeSet that refetches this drawer live.
 * Visibility stays in the shared ticket-05 UI authority
 * (`copilotOpen`/`copilotCtx`); nothing is duplicated. Proposal invariant
 * (execution.md requirement 5): every surface action is a chat message, a
 * proposal request or permission-gated navigation — the drawer exposes no
 * execution, approval or tool-allow control.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Sparkles, X } from 'lucide-react'
import { useServices } from '../../store'
import { actorRef } from '../../auth/persona'
import { useQueryScope } from '../../state/keys'
import { useActiveProject, useCan, useReadOnly } from '../../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../../state/stores'
import { go } from '../../router/navigate'
import { createChatHandlers } from '../aichat/handlers'
import { sendChat } from '../demo/runtime'
import { ChatReadError, useConversationList } from '../aichat/query'
import { AiModeBadge, Banner, Button, Gated, IconButton, Modal } from '../../ui'
import { Composer, EligBadge, NoProject, Thread } from '../../screens/g-common'

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
  const copilotOpen = useUiStore((s) => s.copilotOpen)
  const copilotCtx = useUiStore((s) => s.copilotCtx)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const aiMode = useUiStore((s) => s.aiMode)
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const can = useCan()
  const readOnly = useReadOnly()
  const toast = useToastStore((s) => s.toast)
  const services = useServices()
  const scope = useQueryScope()
  /* Typed chat handlers for the active actor/project scope; context is built
     per call so a persona/project switch never retargets an in-flight request. */
  const chat = useMemo(
    () => createChatHandlers(services, actorRef(scope.actor), scope.project),
    [services, scope.actor, scope.project],
  )
  /* Scoped read: only the active scope's conversations, fetched while open. */
  const convsQ = useConversationList({ enabled: copilotOpen })
  const conv = convsQ.data?.conversations.find((c) => c.projectId === pid)
  const [confirm, setConfirm] = useState<'plan' | 'finding' | null>(null)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<Element | null>(null)
  const creating = useRef(false)
  const lastPid = useRef(pid)
  const close = useCallback(() => setCopilotOpen(false), [setCopilotOpen])

  /* A project switch closes the drawer: no other project's engagement content
     is exposed; the next open re-reads the new scope. */
  useEffect(() => {
    if (lastPid.current !== pid) { lastPid.current = pid; if (copilotOpen) close() }
  }, [pid, copilotOpen, close])

  /* Ensure a conversation exists once the scoped read has resolved; refusals
     surface as the read error below instead of a failed silent create. */
  useEffect(() => {
    if (copilotOpen && pid !== 'all' && convsQ.data && !conv && !creating.current) {
      creating.current = true
      const res = chat.create(pid, aiMode)
      if (!res.ok) { creating.current = false; toast(res.failure.message, 'warn') }
    }
    if (conv) creating.current = false
  }, [copilotOpen, pid, conv, convsQ.data, chat, aiMode, toast])

  /* Accessible focus lifecycle: focus moves into the dialog, Tab is trapped,
     Escape closes and focus returns to the opener. */
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
  }, [copilotOpen, close])

  if (!copilotOpen) return null
  const ctxLabel = copilotCtx?.label
  const kind = copilotCtx?.kind || ''
  const ro = pid !== 'all' && readOnly(pid)
  const ask = (t: string) => { if (conv) sendChat(conv.id, t) }
  const proposeWhy = !conv ? 'No conversation yet.' : ro ? 'This project is read-only.' : conv.mode === 'observe' ? 'AI mode is Observe (read-only). Switch to Propose in the full workspace.' : !can('plan') ? 'Your role cannot create plan proposals.' : ''
  const findWhy = ro ? 'This project is read-only.' : !can('createFinding') ? 'Your role cannot create findings.' : ''
  const subject = ctxLabel || 'this page'
  return (
    <div className="fixed inset-0 z-[75]">
      <div className="absolute inset-0 bg-black/20" onClick={close} aria-hidden />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="copilot-title" data-testid="copilot-drawer" className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-line bg-panel shadow-2xl">
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
        {convsQ.isError ? (
          <div className="flex-1 p-4" data-testid="copilot-refusal">
            <Banner tone="warn" title="Conversations are not available here">
              {(convsQ.error as ChatReadError).failure.message}
            </Banner>
          </div>
        ) : !convsQ.data ? (
          <div className="flex-1 p-4 text-sm text-muted" role="status" aria-busy="true" data-testid="copilot-loading">Loading conversation…</div>
        ) : pid === 'all' ? (
          <div className="p-4"><NoProject compact /></div>
        ) : (
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
