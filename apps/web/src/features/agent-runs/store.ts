import { useSyncExternalStore } from 'react'
import type {
  HitlAction,
  HitlDecision,
  MockRunScenario,
  RunControlState,
  RunMessage,
  RunScenario,
  RunSnapshot,
  RunThread,
  SubAgent,
} from './model'
import {
  MAX_MESSAGES_PER_THREAD,
  MAX_RECENT_ACTIONS,
  MAX_THREADS_PER_PROJECT,
} from './model'
import { getRunScenario } from '../../mocks/fixtures/agent-runs'

const STORAGE_KEY = 'raptix.web-raptix.agent-runs.v1'
const MAX_PERSISTED_THREADS = MAX_THREADS_PER_PROJECT
const MAX_PERSISTED_MESSAGES = MAX_MESSAGES_PER_THREAD
const AGENT_REPLY_DELAY_MS = 900

interface ProjectRunState {
  projectId: string
  runState: RunControlState
  threads: RunThread[]
  activeThreadId: string | null
  agents: SubAgent[]
  approvals: Record<string, HitlDecision>
  pendingThreadIds: Set<string>
  scenario: MockRunScenario
  connectionState: 'connected' | 'disconnected' | 'reconnecting'
  executionError?: string
}

interface PersistedProject {
  threads: RunThread[]
  activeThreadId: string | null
  approvals: Record<string, HitlDecision>
  runState: RunControlState
}

type PersistedStore = Record<string, PersistedProject>

const listeners = new Set<() => void>()
const runs = new Map<string, ProjectRunState>()
const snapshots = new Map<string, RunSnapshot>()
const replyTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>()
let seq = 0
let seqSeeded = false

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

function loadPersistedStore(projectId?: string): PersistedStore {
  try {
    if (projectId) {
      const scopedRaw = window.localStorage.getItem(`${STORAGE_KEY}.${encodeURIComponent(projectId)}`)
      if (scopedRaw) {
        const scoped: unknown = JSON.parse(scopedRaw)
        return scoped && typeof scoped === 'object' && !Array.isArray(scoped) ? { [projectId]: scoped as PersistedProject } : {}
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as PersistedStore
  } catch {
    return {}
  }
}

function persistRun(projectId: string, st: ProjectRunState): void {
  try {
    const createdThreads = st.threads
      .slice(0, MAX_PERSISTED_THREADS)
      .map(t => ({ ...t, messages: t.messages.slice(-MAX_PERSISTED_MESSAGES) }))
    const persisted: PersistedProject = {
      threads: createdThreads,
      activeThreadId: st.activeThreadId,
      approvals: st.approvals,
      runState: st.runState,
    }
    window.localStorage.setItem(`${STORAGE_KEY}.${encodeURIComponent(projectId)}`, JSON.stringify(persisted))
  } catch {
    // Best-effort demo persistence: ignore quota/serialization failures.
  }
}

const SEQ_RE = /-(\d+)$/

function bumpSeqFromId(id: unknown): void {
  if (typeof id !== 'string') return
  const m = SEQ_RE.exec(id)
  if (!m) return
  const n = Number(m[1])
  if (Number.isSafeInteger(n) && n > seq) seq = n
}

function seedSeqFromPersisted(): void {
  const store = loadPersistedStore()
  for (const p of Object.values(store)) {
    if (!p || !Array.isArray(p.threads)) continue
    for (const t of p.threads) {
      bumpSeqFromId(t?.id)
      for (const m of Array.isArray(t?.messages) ? t.messages : []) bumpSeqFromId(m?.id)
    }
  }
}

function ensureSeqSeeded(): void {
  if (seqSeeded) return
  seqSeeded = true
  seedSeqFromPersisted()
}

function cloneAgent(agent: SubAgent): SubAgent {
  return {
    ...agent,
    skills: [...agent.skills],
    tools: [...agent.tools],
    recentActions: agent.recentActions.map(a => ({ ...a })),
    children: agent.children?.map(cloneAgent),
  }
}

function cloneThread(thread: RunThread): RunThread {
  return {
    ...thread,
    messages: thread.messages.map(m => ({
      ...m,
      toolCalls: m.toolCalls?.map(tc => ({ ...tc })),
    })),
  }
}

function isRunThread(candidate: unknown): candidate is RunThread {
  if (!candidate || typeof candidate !== 'object') return false
  const thread = candidate as Record<string, unknown>
  return ['id', 'title', 'preview', 'timestamp'].every(field => typeof thread[field] === 'string')
    && Array.isArray(thread.messages) && thread.messages.every(message =>
      message && typeof message.id === 'string' && ['user', 'agent'].includes(message.role)
      && typeof message.content === 'string' && typeof message.timestamp === 'string'
      && (message.toolCalls === undefined || (Array.isArray(message.toolCalls) && message.toolCalls.every((call: { name?: unknown; result?: unknown } | null) => call && typeof call.name === 'string' && typeof call.result === 'string'))))
}

function agentsForRunControl(agents: SubAgent[], runState: RunControlState): SubAgent[] {
  return agents.map(agent => {
    if (runState === 'running' && agent.id === 'root') return { ...agent, status: 'running' }
    if (runState === 'stopped' && agent.status === 'running') return { ...agent, status: 'idle' }
    return agent
  })
}

function seedRun(projectId: string, scenario: RunScenario): ProjectRunState {
  const persisted = loadPersistedStore(projectId)[projectId]
  const threads = scenario.threads.map(cloneThread)
  let activeThreadId: string | null = threads[0]?.id ?? null
  if (persisted && Array.isArray(persisted.threads)) {
    const restored = persisted.threads.filter(isRunThread).slice(0, MAX_THREADS_PER_PROJECT).map(thread => cloneThread({ ...thread, messages: thread.messages.slice(-MAX_MESSAGES_PER_THREAD) }))
    const restoredIds = new Set(restored.map(thread => thread.id))
    const merged = [...restored, ...threads.filter(thread => !restoredIds.has(thread.id))].slice(0, MAX_THREADS_PER_PROJECT)
    threads.splice(0, threads.length, ...merged)
    if (persisted.activeThreadId && threads.some(thread => thread.id === persisted.activeThreadId)) {
      activeThreadId = persisted.activeThreadId
    } else activeThreadId = threads[0]?.id ?? null
  }
  const approvals: Record<string, HitlDecision> = {}
  if (persisted?.approvals && typeof persisted.approvals === 'object') {
    for (const [agentId, decision] of Object.entries(persisted.approvals)) {
      if (decision === 'approved' || decision === 'rejected') approvals[agentId] = decision
    }
  }
  const runState: RunControlState = persisted?.runState === 'stopped' || persisted?.runState === 'running'
    ? persisted.runState
    : scenario.runState
  return {
    projectId,
    runState,
    threads,
    activeThreadId,
    agents: agentsForRunControl([cloneAgent(scenario.rootAgent), ...scenario.subAgents.map(cloneAgent)].map(agent => agent.status === 'blocked' && approvals[agent.id] === 'approved' ? { ...agent, status: 'running' } : agent), runState),
    approvals,
    pendingThreadIds: new Set<string>(),
    scenario: 'default',
    connectionState: 'connected',
  }
}

function buildSnapshot(st: ProjectRunState): RunSnapshot {
  return {
    projectId: st.projectId,
    runState: st.runState,
    threads: st.threads,
    activeThreadId: st.activeThreadId,
    agents: st.agents,
    approvals: { ...st.approvals },
    pendingThreadIds: [...st.pendingThreadIds],
    source: 'mock-demo',
    scenario: st.scenario,
    connectionState: st.connectionState,
    executionError: st.executionError,
  }
}

function getOrCreateRun(projectId: string): ProjectRunState {
  ensureSeqSeeded()
  const existing = runs.get(projectId)
  if (existing) return existing
  const seeded = seedRun(projectId, getRunScenario(projectId))
  for (const thread of seeded.threads) {
    bumpSeqFromId(thread.id)
    for (const message of thread.messages) bumpSeqFromId(message.id)
  }
  runs.set(projectId, seeded)
  snapshots.set(projectId, buildSnapshot(seeded))
  return seeded
}

function publish(projectId: string): void {
  const st = runs.get(projectId)
  if (!st) return
  snapshots.set(projectId, buildSnapshot(st))
  persistRun(projectId, st)
  for (const listener of listeners) listener()
}

function withRootAction(agents: SubAgent[], label: string, ts: string): SubAgent[] {
  return agents.map(a =>
    a.id === 'root'
      ? { ...a, recentActions: [{ label, ts }, ...a.recentActions].slice(0, MAX_RECENT_ACTIONS) }
      : a
  )
}

function clearPendingReplies(projectId: string): void {
  const timers = replyTimers.get(projectId)
  if (timers) {
    for (const timer of timers) clearTimeout(timer)
    replyTimers.delete(projectId)
  }
  runs.get(projectId)?.pendingThreadIds.clear()
}

function scheduleAgentReply(projectId: string, threadId: string): void {
  const timer = setTimeout(() => {
    const timers = replyTimers.get(projectId)
    timers?.delete(timer)
    if (timers && timers.size === 0) replyTimers.delete(projectId)
    const st = runs.get(projectId)
    if (!st) return
    st.pendingThreadIds.delete(threadId)
    if (st.runState !== 'running' || !st.threads.some(t => t.id === threadId)) {
      publish(projectId)
      return
    }
    const reply: RunMessage = {
      id: nextId('msg'),
      role: 'agent',
      agentName: 'Root Agent',
      content:
        "I'm processing your request and coordinating with the relevant subagents. I'll have a detailed response momentarily. (Demo reply — mock fixtures, not a live agent.)",
      timestamp: nowTime(),
    }
    st.threads = st.threads.map(t =>
      t.id === threadId
        ? { ...t, messages: [...t.messages, reply].slice(-MAX_MESSAGES_PER_THREAD) }
        : t
    )
    publish(projectId)
  }, AGENT_REPLY_DELAY_MS)
  let timers = replyTimers.get(projectId)
  if (!timers) {
    timers = new Set()
    replyTimers.set(projectId, timers)
  }
  timers.add(timer)
}

export function getRunSnapshot(projectId: string): RunSnapshot {
  getOrCreateRun(projectId)
  return snapshots.get(projectId)!
}

export function subscribeRuns(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function useRunSnapshot(projectId: string): RunSnapshot {
  return useSyncExternalStore(subscribeRuns, () => getRunSnapshot(projectId))
}

export function createThread(projectId: string): string {
  const st = getOrCreateRun(projectId)
  const scenario = getRunScenario(projectId)
  const ts = nowTime()
  const threadId = nextId('thread')
  const thread: RunThread = {
    id: threadId,
    title: 'New chat',
    preview: 'Start a conversation with the root agent…',
    timestamp: ts,
    messages: [
      {
        id: nextId('msg'),
        role: 'agent',
        agentName: 'Root Agent',
        content: scenario.greeting,
        timestamp: ts,
      },
    ],
  }
  st.threads = [thread, ...st.threads].slice(0, MAX_THREADS_PER_PROJECT)
  st.activeThreadId = threadId
  publish(projectId)
  return threadId
}

export function selectThread(projectId: string, threadId: string): void {
  const st = getOrCreateRun(projectId)
  if (!st.threads.some(t => t.id === threadId)) return
  if (st.activeThreadId === threadId) return
  st.activeThreadId = threadId
  publish(projectId)
}

export function submitMessage(projectId: string, threadId: string, text: string): boolean {
  const st = getOrCreateRun(projectId)
  const trimmed = text.trim()
  if (!trimmed || st.runState !== 'running') return false
  if (!st.threads.some(t => t.id === threadId)) return false
  if (st.pendingThreadIds.has(threadId)) return false
  const ts = nowTime()
  const userMsg: RunMessage = {
    id: nextId('msg'),
    role: 'user',
    content: trimmed,
    timestamp: ts,
  }
  st.threads = st.threads.map(t =>
    t.id === threadId
      ? {
          ...t,
          messages: [...t.messages, userMsg].slice(-MAX_MESSAGES_PER_THREAD),
          preview: trimmed,
          timestamp: ts,
        }
      : t
  )
  st.pendingThreadIds.add(threadId)
  publish(projectId)
  scheduleAgentReply(projectId, threadId)
  return true
}

export function decideApproval(projectId: string, action: HitlAction): boolean {
  const st = getOrCreateRun(projectId)
  const acknowledged = loadPersistedStore(projectId)[projectId]?.approvals?.[action.agentId]
  if (acknowledged === 'approved' || acknowledged === 'rejected') {
    st.approvals = { ...st.approvals, [action.agentId]: acknowledged }
    if (acknowledged === 'approved') st.agents = st.agents.map(agent => agent.id === action.agentId ? { ...agent, status: st.runState === 'running' ? 'running' : 'idle' } : agent)
    publish(projectId)
    return false
  }
  const agent = st.agents.find(a => a.id === action.agentId)
  if (!agent || agent.status !== 'blocked') return false
  if (st.approvals[action.agentId]) return false
  st.approvals = { ...st.approvals, [action.agentId]: action.decision }
  const ts = nowTime()
  st.agents = st.agents.map(a => {
    if (a.id !== action.agentId) return a
    if (action.decision === 'approved') {
      return {
        ...a,
        status: st.runState === 'running' ? 'running' : 'idle',
        recentActions: [
          { label: 'HITL approval granted — blocked task resumed (demo)', ts },
          ...a.recentActions,
        ].slice(0, MAX_RECENT_ACTIONS),
      }
    }
    return {
      ...a,
      recentActions: [
        { label: 'HITL rejection recorded — agent halted (demo)', ts },
        ...a.recentActions,
      ].slice(0, MAX_RECENT_ACTIONS),
    }
  })
  publish(projectId)
  return true
}

export function setRunState(projectId: string, next: RunControlState): void {
  const st = getOrCreateRun(projectId)
  if (st.runState === next) return
  const ts = nowTime()
  if (next === 'stopped') {
    clearPendingReplies(projectId)
    st.runState = 'stopped'
    st.agents = withRootAction(
      st.agents,
      'Run stopped by operator — pending agent replies discarded',
      ts
    )
  } else {
    st.runState = 'running'
    st.executionError = undefined
    st.scenario = 'active'
    st.agents = withRootAction(st.agents, 'Demo run resumed by operator', ts)
  }
  st.agents = agentsForRunControl(st.agents, next)
  publish(projectId)
}

export function configureMockScenario(projectId: string, scenario: MockRunScenario): void {
  const state = getOrCreateRun(projectId)
  clearPendingReplies(projectId)
  state.scenario = scenario
  state.connectionState = scenario === 'disconnected' || scenario === 'reconnecting' ? scenario : 'connected'
  state.executionError = scenario === 'failed' ? 'Simulated runtime failure. No live request was submitted.' : undefined
  if (scenario === 'disconnected' || scenario === 'reconnecting') {
    publish(projectId)
    return
  }
  if (scenario === 'default') {
    const original = getRunScenario(projectId)
    state.runState = original.runState
    state.agents = [cloneAgent(original.rootAgent), ...original.subAgents.map(cloneAgent)]
    state.approvals = {}
    publish(projectId)
    return
  }
  state.runState = ['ready', 'completed', 'failed'].includes(scenario) ? 'stopped' : 'running'
  state.agents = state.agents.filter(agent => agent.id !== 'demo-approval').map(agent => ({ ...agent, status: scenario === 'completed' ? 'done' : agent.id === 'root' && state.runState === 'running' ? 'running' : 'idle' }))
  if (scenario === 'hitl') {
    state.approvals = {}
    state.agents = [...state.agents, {
      id: 'demo-approval', name: 'Demo tool agent', type: 'Mock execution', status: 'blocked',
      task: 'A simulated tool inspection is awaiting an operator allow/deny decision.',
      skills: [], tools: ['demo.inspect'], recentActions: [],
    }]
  }
  publish(projectId)
}
