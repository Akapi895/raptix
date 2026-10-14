/**
 * AI Operator workspace (ticket 38, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The migrated chat workspace: conversations read through the feature-local
 * Query binding (scope-keyed cache, ChangeSet invalidation and cancel-on-
 * switch come from the shared bridges), and conversation creation/mode
 * selection go through the typed ChatService handlers. Sending stays on the
 * bridged legacy action, which owns the demo's response orchestration
 * (busy flag + timer) and delegates the commits to the same handlers —
 * messages and plan proposals are strictly proposal-shaped (invariant 5).
 * The shared chat cards/rail (g-common/g-workspace, tickets 39–44) keep
 * their legacy seams until their owners migrate.
 */
import { useEffect, useMemo, useState } from 'react'
import { ListTree, PanelRight, Plus, Sparkles } from 'lucide-react'
import { useServices } from '../state/services'
import { eligibility } from '../features/operations/preflight'
import { actorRef } from '../auth/persona'
import { useQueryScope } from '../state/keys'
import { createChatHandlers } from '../features/aichat/handlers'
import { ChatReadError, useConversationList } from '../features/aichat/query'
import { sendChat } from '../features/demo/runtime'
import { go, useRoute } from '../router/navigate'
import { useActiveProject, useDb, useReadOnly } from '../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { Banner, Button, Drawer, Empty, PageHeader } from '../ui'
import { AiSubNav, Composer, NoProject, Pill, STARTERS, Thread } from './g-common'
import { ConvBanner, ConversationHeader, INSP, Inspector, LeftRail, RAIL, Separator, useResizable, useViewportW } from './g-workspace'
import type { AiMode } from '../domain/entities'

const LS_OPEN = 'raptix.ai.inspectorOpen'
const readOpen = () => { try { return window.localStorage.getItem(LS_OPEN) !== '0' } catch { return true } }

export function AiOperator() {
  /* Ticket 67 wave 7: the legacy store reads leave the context — the console
     read seam (db/project/readOnly), the router module (route/go), the shared
     authorities (pid/aiMode/toast/guard) and the demo runtime's sendChat (the
     A.sendChat delegate). */
  const db = useDb()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const route = useRoute()
  const aiMode = useUiStore((s) => s.aiMode)
  const readOnly = useReadOnly()
  const guarded = useSessionStore((s) => s.guarded)
  const toast = useToastStore((s) => s.toast)
  const services = useServices()
  const scope = useQueryScope()
  const vw = useViewportW()
  const wide = vw >= 1280
  const rail = useResizable('raptix.ai.railW', RAIL)
  const insp = useResizable('raptix.ai.inspectorW', INSP)
  const [ctxOpen, setCtxOpen] = useState(readOpen)
  const [sheet, setSheet] = useState<'rail' | 'ctx' | null>(null)
  /* Typed chat handlers for the active actor/project scope; context is built
     per call so a switch never retargets an in-flight request. */
  const chat = useMemo(
    () => createChatHandlers(services, actorRef(scope.actor), scope.project),
    [services, scope.actor, scope.project],
  )
  const convsQ = useConversationList()
  const convs = convsQ.data?.conversations ?? []
  const conv = convs.find((c) => c.id === route.id) || convs[0]
  useEffect(() => { if (wide) setSheet(null) }, [wide])
  const toggleCtx = () => { if (!wide) return setSheet(sheet === 'ctx' ? null : 'ctx'); const n = !ctxOpen; setCtxOpen(n); try { window.localStorage.setItem(LS_OPEN, n ? '1' : '0') } catch { /* ignore */ } }
  const newConv = () => {
    if (pid === 'all') return
    guarded(() => {
      const res = chat.create(pid, aiMode)
      if (res.ok) go('ai-operator', { id: res.data.id })
      else toast(res.failure.message, 'bad')
    })
  }
  const setMode = (m: AiMode) => {
    if (!conv) return
    const res = chat.setMode(conv.id, m)
    if (!res.ok) toast(res.failure.message, 'bad')
  }

  if (pid === 'all' || !project) {
    return (
      <>
        <PageHeader title="AI Operator" sub="Plan, review and coordinate authorized red team activities." />
        <AiSubNav current="ai-operator" />
        <Banner tone="info" title="All Projects view">AI Observe can summarize aggregate data you have access to. Proposing plans and Approved Execution are disabled until a project is selected.</Banner>
        <div className="mt-4"><NoProject /></div>
        <div className="mt-4 flex flex-wrap gap-2 opacity-60" aria-hidden>{STARTERS.map((s) => <span key={s} className="rounded-full border border-line px-2.5 py-1 text-xs">{s}</span>)}</div>
      </>
    )
  }
  const ro = readOnly(pid)
  const locked = conv && conv.mode !== 'observe' && eligibility(db, pid).kind === 'locked' && !ro
  const showCtx = wide && ctxOpen
  return (
    <>
      <PageHeader title="AI Operator" sub="Plan, review and coordinate authorized red team activities."
        actions={<>
          {!wide && <Button icon={ListTree} onClick={() => setSheet(sheet === 'rail' ? null : 'rail')} aria-pressed={sheet === 'rail'}>Conversations</Button>}
          <Button icon={PanelRight} onClick={toggleCtx} aria-pressed={wide ? ctxOpen : sheet === 'ctx'}>{(wide ? ctxOpen : sheet === 'ctx') ? 'Hide Context' : 'Show Context'}</Button>
          <Button variant="primary" icon={Plus} disabled={ro} title={ro ? 'This project is read-only.' : 'Inherits the Default AI Mode. Nothing runs.'} onClick={newConv}>New Conversation</Button>
        </>} />
      <AiSubNav current="ai-operator" />
      {convsQ.isError && (
        <div className="mb-4">
          <Banner tone="bad" title="Could not load conversations" action={<Button onClick={() => convsQ.refetch()}>Retry</Button>}>
            {(convsQ.error as ChatReadError).failure.message}
          </Banner>
        </div>
      )}
      <div className="flex h-[calc(100vh-250px)] min-h-[520px] min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
        {wide && (
          <>
            <div style={{ width: rail.w }} className="min-w-0 shrink-0 overflow-hidden bg-side"><LeftRail pid={pid} selId={conv?.id} onNew={newConv} /></div>
            <Separator label="Resize conversation list" side="left" r={rail} cfg={RAIL} />
          </>
        )}
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
          {conv ? (
            <>
              <ConversationHeader conv={conv} onMode={setMode} />
              <ConvBanner conv={conv} />
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {conv.messages.length === 0 ? (
                  <Empty icon={Sparkles} title="Start a new conversation" action={<div className="flex flex-wrap justify-center gap-2">{STARTERS.map((s) => <Button key={s} size="sm" disabled={ro} onClick={() => sendChat(conv.id, s)}>{s}</Button>)}</div>}>
                    Ask about {project.id} scope, agents or results. Answers are based on available project data only.
                  </Empty>
                ) : <Thread conv={conv} />}
              </div>
              <div className="shrink-0 px-4 pb-3">
                <Composer key={conv.id} conv={conv} />
                {locked && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Button size="sm" onClick={() => sendChat(conv.id, 'Draft a plan outline for scope review')}>Save a draft plan outline</Button><span className="text-muted">Saved as Draft only. <Pill tone="bad">Request approval locked</Pill></span></div>}
              </div>
            </>
          ) : (
            <div className="p-6"><Empty icon={Sparkles} title="No conversations yet for this project" action={<Button variant="primary" icon={Plus} disabled={ro} onClick={newConv}>New Conversation</Button>}>Conversations are kept per project and are never mixed with other projects.</Empty></div>
          )}
        </section>
        {showCtx && (
          <>
            <Separator label="Resize context inspector" side="right" r={insp} cfg={INSP} />
            <div style={{ width: insp.w }} className="min-w-0 shrink-0 overflow-hidden bg-side"><Inspector pid={pid} conv={conv} /></div>
          </>
        )}
      </div>
      <div className="mt-2 text-xs"><button className="text-accent hover:underline" onClick={() => go('ai-history')}>Conversation history & provenance</button></div>
      <Drawer open={!wide && sheet === 'rail'} onClose={() => setSheet(null)} title="Conversations & plans" width={380}><div className="-mx-6 -my-5 h-[calc(100vh-80px)]"><LeftRail pid={pid} selId={conv?.id} onNew={() => { setSheet(null); newConv() }} onPicked={() => setSheet(null)} /></div></Drawer>
      <Drawer open={!wide && sheet === 'ctx'} onClose={() => setSheet(null)} title="Context inspector" width={460}><div className="-mx-6 -my-5 h-[calc(100vh-80px)]"><Inspector pid={pid} conv={conv} /></div></Drawer>
    </>
  )
}
