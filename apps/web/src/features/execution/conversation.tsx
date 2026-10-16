import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { Bot, Hand, Send } from 'lucide-react'
import { Banner, Button, Select, Textarea, cx } from '../../ui'
import type { AgentInstance, AgentWorkspace, InstanceRequest, Outcome } from './model'
import { InstanceBadge } from './agents-panel'

export function InstanceConversation({ workspace, instance, writable, outcome, onOutcome, onDraft, onSend, onObserve, onRoot, decisions }: {
  workspace: AgentWorkspace; instance: AgentInstance; writable: boolean; outcome: Outcome; onOutcome: (outcome: Outcome) => void
  onDraft: (text: string, questionId?: string) => void
  onSend: (text: string, questionId?: string) => void
  onObserve: (request: InstanceRequest) => void
  onRoot: () => void
  decisions?: ReactNode
}): ReactElement {
  const transcript = useRef<HTMLDivElement>(null)
  const messages = workspace.messages.filter((message) => message.instanceId === instance.id)
  const questions = workspace.questions.filter((question) => question.instanceId === instance.id && question.answer === undefined)
  const requests = workspace.requests.filter((request) => request.instanceId === instance.id)
  const pending = requests.some((request) => ['pending', 'uncertain'].includes(request.state))
  const readOnly = !writable || instance.path === 'observe' || (instance.path === 'direct' && ['completed', 'failed', 'cancelled'].includes(instance.status))
  const recipient = instance.path === 'forward' ? `Send instructions via Raptix for ${instance.name}` : `Send to ${instance.name}`
  const label = (id: string): string => workspace.instances.find((row) => row.id === id)?.name ?? id
  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'smooth' }) }, [instance.id, messages.length])
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversation with ${instance.name}`}>
    <header className="shrink-0 border-b border-line p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="mb-1 text-[11px] uppercase tracking-wider text-muted">Communicating with</p><h2 className="flex items-center gap-2 text-lg font-semibold"><Bot size={20} className="text-accent" />{instance.name}</h2></div><InstanceBadge instance={instance} waiting={questions.length > 0} /></div><p className="mt-2 text-sm text-muted">{instance.objective}</p>{instance.role !== 'Orchestrator' && <button onClick={onRoot} className="mt-2 text-xs font-medium text-accent">← Back to Raptix</button>}</header>
    <div ref={transcript} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-label="Instance conversation and activity">
      {decisions}
      {workspace.questions.some((question) => question.instanceId === instance.id && question.answer !== undefined) && <details className="rounded-lg border border-line p-3 text-xs"><summary className="cursor-pointer font-medium">Answered questions</summary>{workspace.questions.filter((question) => question.instanceId === instance.id && question.answer !== undefined).map((question) => <div key={question.id} className="mt-3"><p className="font-medium">{question.text}</p><p className="mt-1 text-muted">Answered: {question.answer}</p></div>)}</details>}
      {questions.map((question) => <section key={question.id} className="space-y-2 rounded-xl border border-warn/40 bg-warn-soft/40 p-4" aria-label={`Question from ${instance.name}`}><h3 className="flex items-center gap-2 text-sm font-semibold text-warn"><Hand size={16} />{instance.name} needs your input</h3><p className="text-sm">{question.text}</p><Textarea aria-label={`Answer ${question.id}`} value={workspace.drafts[`${instance.id}/${question.id}`] ?? ''} onChange={(event) => onDraft(event.target.value, question.id)} disabled={readOnly || pending} /><Button size="sm" disabled={readOnly || pending || !workspace.drafts[`${instance.id}/${question.id}`]?.trim()} onClick={() => onSend(workspace.drafts[`${instance.id}/${question.id}`]!, question.id)}>Answer {instance.name}</Button></section>)}
      {messages.map((message) => <div key={message.id} className={cx('max-w-[94%] rounded-xl border p-4', message.sender === instance.id || message.id.endsWith('/receipt') ? 'border-line bg-subtle/40' : 'ml-auto border-accent-line bg-accent-soft/30')}><p className="mb-2 text-[11px] text-muted">{label(message.sender)} → {label(message.recipient)} · {message.path === 'forward' ? `via Raptix for ${instance.name}` : message.path} · {message.at}</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p><p className="mt-2 text-[11px] font-medium text-muted">{message.delivery === 'uncertain' ? 'Acknowledgement unknown — reconcile this request' : message.delivery}</p></div>)}
      {requests.filter((request) => request.state !== 'acknowledged' || (request.action !== 'message' && request.action !== 'answer')).map((request) => <div key={request.id} className="rounded-lg border border-line p-3 text-xs" role="status"><p className="font-medium">{request.action} · {request.state === 'pending' ? 'Requested → pending acknowledgement' : request.state}</p><p className="mt-1 break-words text-muted">{request.reason}</p>{['pending', 'uncertain'].includes(request.state) && <Button className="mt-2" size="sm" onClick={() => onObserve(request)}>Observe simulated ACK</Button>}{request.state === 'failed' && request.action === 'message' && <Button className="mt-2" size="sm" disabled={readOnly || pending} onClick={() => onSend(request.reason)}>Retry message as new request</Button>}<details className="mt-1"><summary className="cursor-pointer text-muted">Request details</summary><p className="break-all font-mono">{request.id} · {request.instanceId}</p></details></div>)}
    </div>
    <div className="shrink-0 space-y-2 border-t border-line bg-panel p-4">
      {readOnly ? <Banner tone="info" title="Observe-only channel">{!writable ? 'The project or your role is read-only.' : 'This instance has no active messaging channel. Viewing it does not spawn or retry a task.'}</Banner> : <><label className="block text-xs font-semibold" htmlFor="execution-message">{recipient}</label><Textarea id="execution-message" aria-label={recipient} value={workspace.drafts[instance.id] ?? ''} onChange={(event) => onDraft(event.target.value)} placeholder={instance.path === 'forward' ? 'Instructions will be recorded via the orchestrator…' : 'Answer, add context/evidence references, or request an explanation…'} disabled={pending} /><div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted">{pending ? 'Reconcile the current request before another send.' : 'Instructions are separate from tool approval and instance controls.'}</span><Button variant="primary" size="sm" icon={Send} disabled={pending || !workspace.drafts[instance.id]?.trim()} onClick={() => onSend(workspace.drafts[instance.id]!)}>Send</Button></div></>}
      <details><summary className="cursor-pointer text-[11px] text-muted">Demo delivery / acknowledgement scenario</summary><Select className="mt-2" aria-label="Demo acknowledgement outcome" value={outcome} onChange={(event) => onOutcome(event.target.value as Outcome)}><option value="delivered">Delivered / acknowledged</option><option value="queued">Queued until observed checkpoint</option><option value="failed">Delivery failed</option><option value="uncertain">ACK unknown</option></Select></details>
    </div>
  </section>
}
