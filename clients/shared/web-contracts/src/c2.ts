import { isRecord } from './guards.js'

export interface C2Session {
  id: string; name: string; hostname: string; username: string; os: string; arch: string
  transport: string; remoteAddress: string; activeC2: string; version: string
  pid: number; listenerPort: number; lastCheckin: number; isDead: boolean
}
export interface C2Listener { engagementId: string; protocol: 'mtls' | 'http'; port: number; jobId: number; active: boolean }
export interface C2Profile { name: string; created: number; userAgent: string; headerCount: number; cookieCount: number; parameterCount: number; pathSegmentCount: number }
export interface C2View { engagementId: string; sessions: C2Session[]; listeners: C2Listener[]; profiles: C2Profile[]; source: 'sliver' }
export interface C2CommandView {
  id: string; engagementId: string; sessionId: string; requestId: string; path: string; args: string[]
  status: 'creating' | 'succeeded' | 'failed' | 'uncertain'; exitCode: number | null; pid: number | null
  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean; createdAt: string
}
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export function isC2Session(v: unknown): v is C2Session {
  return isRecord(v) && ['id','name','hostname','username','os','arch','transport','remoteAddress','activeC2','version'].every(k => text(v[k])) &&
    typeof v.id === 'string' && v.id.length > 0 && ['pid','lastCheckin','listenerPort'].every(k => count(v[k])) && typeof v.isDead === 'boolean'
}
export function isC2Listener(v: unknown): v is C2Listener {
  return isRecord(v) && text(v.engagementId) && ['mtls','http'].includes(String(v.protocol)) && count(v.port) && v.port > 0 && v.port <= 65535 && count(v.jobId) && typeof v.active === 'boolean'
}
export function isC2Profile(v: unknown): v is C2Profile {
  return isRecord(v) && text(v.name) && text(v.userAgent) && ['created','headerCount','cookieCount','parameterCount','pathSegmentCount'].every(k => count(v[k]))
}
export function isC2View(v: unknown): v is C2View {
  return isRecord(v) && text(v.engagementId) && v.source === 'sliver' && Array.isArray(v.sessions) && v.sessions.every(isC2Session) &&
    Array.isArray(v.listeners) && v.listeners.every(isC2Listener) && Array.isArray(v.profiles) && v.profiles.every(isC2Profile)
}
export function isC2CommandView(v: unknown): v is C2CommandView {
  return isRecord(v) && ['id','engagementId','sessionId','requestId','path','createdAt'].every(k => text(v[k])) &&
    ['creating','succeeded','failed','uncertain'].includes(String(v.status)) && Array.isArray(v.args) && v.args.every(text) &&
    (v.exitCode === null || count(v.exitCode)) && (v.pid === null || count(v.pid)) && typeof v.stdout === 'string' && v.stdout.length <= 196608 &&
    typeof v.stderr === 'string' && v.stderr.length <= 196608 && typeof v.stdoutTruncated === 'boolean' && typeof v.stderrTruncated === 'boolean'
}
