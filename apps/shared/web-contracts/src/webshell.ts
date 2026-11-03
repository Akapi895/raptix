import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'

export const WEB_SHELL_PROVIDERS = ['http-form-command'] as const
export type WebShellProvider = (typeof WEB_SHELL_PROVIDERS)[number]

export const WEB_SHELL_CONNECTION_STATES = [
  'unverified',
  'reachable',
  'reachable_no_proof',
  'unreachable',
  'unknown',
  'closed',
] as const
export type WebShellConnectionState = (typeof WEB_SHELL_CONNECTION_STATES)[number]

export const WEB_SHELL_PROBE_STATES = [
  'reachable',
  'reachable_no_proof',
  'unreachable',
  'unknown',
] as const
export type WebShellProbeState = (typeof WEB_SHELL_PROBE_STATES)[number]

export const WEB_SHELL_COMMAND_STATUSES = ['creating', 'delivered', 'failed', 'uncertain'] as const
export type WebShellCommandStatus = (typeof WEB_SHELL_COMMAND_STATUSES)[number]

export const WEB_SHELL_ACQUISITION_MODES = ['derive', 'refine'] as const
export type WebShellAcquisitionMode = (typeof WEB_SHELL_ACQUISITION_MODES)[number]

export const WEB_SHELL_ACQUISITION_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'refused',
  'cancelled',
] as const
export type WebShellAcquisitionState = (typeof WEB_SHELL_ACQUISITION_STATES)[number]

export const WEB_SHELL_SOURCES = ['manual', 'poc_acquisition'] as const
export type WebShellSource = (typeof WEB_SHELL_SOURCES)[number]

/** The typed profile a WebShell connection stores. It is data, never a curl string. */
export interface WebShellProfile {
  provider: WebShellProvider
  target: string
  endpoint: string
  method: 'POST'
  content_type: 'application/x-www-form-urlencoded'
  command_parameter: string
  headers?: Record<string, string>
  probe_command: string
  probe_pattern: string
  expected_user?: string
}

export interface WebShellConnectionCreateInput {
  requestId: string
  name: string
  profile: WebShellProfile
  assetId?: string
}

export interface WebShellCommandCreateInput {
  requestId: string
  command: string
}

export interface WebShellAcquisitionCreateInput {
  requestId: string
  findingId: string
  mode?: WebShellAcquisitionMode
}

export interface WebShellProbeView {
  id: string
  connectionId: string
  engagementId: string
  requestId: string
  state: WebShellProbeState
  httpStatus: number | null
  matched: boolean
  output: string
  outputTruncated: boolean
  error: string | null
  durationMs: number
  createdAt: string
}

export interface WebShellConnectionView {
  id: string
  engagementId: string
  name: string
  assetId: string | null
  profile: WebShellProfile
  state: WebShellConnectionState
  source: WebShellSource
  createdBy: string
  producerFindingId: string | null
  producerPocSha256: string | null
  producerSpecSha256: string | null
  producerAcquisitionId: string | null
  lastProbeState: WebShellProbeState | null
  lastProbeAt: string | null
  concurrencyVersion: number
  createdAt: string
  updatedAt: string
}

export interface WebShellCommandView {
  id: string
  connectionId: string
  engagementId: string
  requestId: string
  command: string
  status: WebShellCommandStatus
  httpStatus: number | null
  exitCode: number | null
  output: string
  outputTruncated: boolean
  error: string | null
  actorId: string
  runId: string | null
  invocationId: string | null
  createdAt: string
  updatedAt: string
}

export interface WebShellAcquisitionView {
  id: string
  engagementId: string
  findingId: string
  requestId: string
  mode: WebShellAcquisitionMode
  state: WebShellAcquisitionState
  attempt: number
  maxAttempts: number
  pocSha256: string | null
  specSha256: string | null
  profile: WebShellProfile | null
  connectionId: string | null
  error: string | null
  artifactPath: string | null
  artifactSha256: string | null
  actorId: string
  createdAt: string
  updatedAt: string
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const COMMAND_PARAMETER = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
const FINDING_REF = /^FIND-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const SHA256 = /^[a-f0-9]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const OUTPUT_LIMIT = 196608
const ERROR_LIMIT = 2048
const ENDPOINT_LIMIT = 2048

const PROFILE_KEYS = new Set([
  'provider',
  'target',
  'endpoint',
  'method',
  'content_type',
  'command_parameter',
  'headers',
  'probe_command',
  'probe_pattern',
  'expected_user',
])

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value)
}

function isDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !CONTROL.test(value)
}

function isOptionalText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max && !CONTROL.test(value))
}

function isHttpStatus(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599)
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isOptionalSha256(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SHA256.test(value))
}

function normalizeHost(value: string): string {
  const lower = value.trim().toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) return lower.slice(1, -1)
  return lower
}

/** Returns the lower-case endpoint host, or null when the endpoint is not a bare http(s) URL. */
function endpointHost(endpoint: string): string | null {
  if (endpoint.length === 0 || endpoint.length > ENDPOINT_LIMIT || CONTROL.test(endpoint) || /\s/.test(endpoint)) return null
  if (endpoint.includes('#')) return null
  const match = /^(https?):\/\/([^/?#]+)(?:[/?].*)?$/i.exec(endpoint)
  if (match === null) return null
  const authority = match[2]
  if (authority.length === 0 || authority.includes('@')) return null
  let host = authority
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) return null
    host = authority.slice(1, end)
    const rest = authority.slice(end + 1)
    if (rest !== '') {
      const port = /^:(\d{1,5})$/.exec(rest)
      if (port === null) return null
      const number = Number(port[1])
      if (number < 1 || number > 65535) return null
    }
  } else {
    const colon = authority.lastIndexOf(':')
    if (colon >= 0) {
      const port = /^\d{1,5}$/.exec(authority.slice(colon + 1))
      if (port === null) return null
      const number = Number(port[0])
      if (number < 1 || number > 65535) return null
      host = authority.slice(0, colon)
    }
  }
  if (host.length === 0 || CONTROL.test(host) || /[\s/?#@]/.test(host)) return null
  return normalizeHost(host)
}

function isHeaders(value: unknown): value is Record<string, string> | undefined {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  const seen = new Set<string>()
  for (const [key, headerValue] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (normalized !== 'user-agent' && normalized !== 'content-type') return false
    if (seen.has(normalized)) return false
    seen.add(normalized)
    if (typeof headerValue !== 'string' || headerValue.length > 1024 || /[\r\n\u0000]/.test(headerValue)) return false
    if (normalized === 'content-type' && headerValue.toLowerCase() !== 'application/x-www-form-urlencoded') return false
  }
  return true
}

function isProbePattern(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 4 || value.length > 256 || value.includes(',')) return false
  if (CONTROL.test(value)) return false
  try {
    return !new RegExp(value).test('')
  } catch {
    return false
  }
}

export function isWebShellProfile(value: unknown): value is WebShellProfile {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) if (!PROFILE_KEYS.has(key)) return false
  if (value.provider !== 'http-form-command' || value.method !== 'POST') return false
  if (value.content_type !== 'application/x-www-form-urlencoded') return false
  if (typeof value.target !== 'string' || value.target.length === 0 || value.target.length > 253 || /[\s/?#@]/.test(value.target)) return false
  if (typeof value.endpoint !== 'string') return false
  const host = endpointHost(value.endpoint)
  if (host === null || host !== normalizeHost(value.target)) return false
  if (typeof value.command_parameter !== 'string' || !COMMAND_PARAMETER.test(value.command_parameter)) return false
  if (!isHeaders(value.headers)) return false
  if (typeof value.probe_command !== 'string' || value.probe_command.length < 1 || value.probe_command.length > 1024 || CONTROL.test(value.probe_command)) return false
  if (!isProbePattern(value.probe_pattern)) return false
  if (value.expected_user !== undefined && (typeof value.expected_user !== 'string' || value.expected_user.length < 1 || value.expected_user.length > 64 || CONTROL.test(value.expected_user))) return false
  return true
}

export function isWebShellConnectionCreateInput(value: unknown): value is WebShellConnectionCreateInput {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) if (key !== 'requestId' && key !== 'name' && key !== 'profile' && key !== 'assetId') return false
  if (!isRequestId(value.requestId) || !isDisplayName(value.name) || !isWebShellProfile(value.profile)) return false
  if (value.assetId !== undefined && (typeof value.assetId !== 'string' || value.assetId.length < 1 || value.assetId.length > 128)) return false
  return true
}

export function isWebShellCommandCreateInput(value: unknown): value is WebShellCommandCreateInput {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) if (key !== 'requestId' && key !== 'command') return false
  return isRequestId(value.requestId) && typeof value.command === 'string' && value.command.length >= 1 && value.command.length <= 8192 && !/\u0000/.test(value.command)
}

export function isWebShellAcquisitionCreateInput(value: unknown): value is WebShellAcquisitionCreateInput {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) if (key !== 'requestId' && key !== 'findingId' && key !== 'mode') return false
  if (!isRequestId(value.requestId) || typeof value.findingId !== 'string' || !FINDING_REF.test(value.findingId)) return false
  return value.mode === undefined || WEB_SHELL_ACQUISITION_MODES.includes(value.mode as WebShellAcquisitionMode)
}

function isProbeStateOrNull(value: unknown): value is WebShellProbeState | null {
  return value === null || WEB_SHELL_PROBE_STATES.includes(value as WebShellProbeState)
}

export function isWebShellProbeView(value: unknown): value is WebShellProbeView {
  return isRecord(value) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.connectionId) && isNonEmptyString(value.engagementId) &&
    isRequestId(value.requestId) && WEB_SHELL_PROBE_STATES.includes(value.state as WebShellProbeState) &&
    isHttpStatus(value.httpStatus) && typeof value.matched === 'boolean' &&
    typeof value.output === 'string' && value.output.length <= OUTPUT_LIMIT &&
    typeof value.outputTruncated === 'boolean' && isOptionalText(value.error, ERROR_LIMIT) &&
    isDuration(value.durationMs) && isIsoUtcTimestamp(value.createdAt)
}

export function isWebShellConnectionView(value: unknown): value is WebShellConnectionView {
  return isRecord(value) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.engagementId) && isDisplayName(value.name) &&
    isOptionalText(value.assetId, 128) && isWebShellProfile(value.profile) &&
    WEB_SHELL_CONNECTION_STATES.includes(value.state as WebShellConnectionState) &&
    WEB_SHELL_SOURCES.includes(value.source as WebShellSource) && isNonEmptyString(value.createdBy) &&
    isOptionalText(value.producerFindingId, 128) && isOptionalSha256(value.producerPocSha256) &&
    isOptionalSha256(value.producerSpecSha256) && isOptionalText(value.producerAcquisitionId, 128) &&
    isProbeStateOrNull(value.lastProbeState) &&
    (value.lastProbeAt === null || isIsoUtcTimestamp(value.lastProbeAt)) &&
    isDuration(value.concurrencyVersion) && value.concurrencyVersion >= 1 &&
    isIsoUtcTimestamp(value.createdAt) && isIsoUtcTimestamp(value.updatedAt)
}

export function isWebShellCommandView(value: unknown): value is WebShellCommandView {
  return isRecord(value) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.connectionId) && isNonEmptyString(value.engagementId) &&
    isRequestId(value.requestId) && typeof value.command === 'string' && value.command.length >= 1 && value.command.length <= 8192 &&
    WEB_SHELL_COMMAND_STATUSES.includes(value.status as WebShellCommandStatus) &&
    isHttpStatus(value.httpStatus) && (value.exitCode === null || (typeof value.exitCode === 'number' && Number.isInteger(value.exitCode))) &&
    typeof value.output === 'string' && value.output.length <= OUTPUT_LIMIT && typeof value.outputTruncated === 'boolean' &&
    isOptionalText(value.error, ERROR_LIMIT) && isNonEmptyString(value.actorId) &&
    (value.runId === null || isNonEmptyString(value.runId)) && (value.invocationId === null || isNonEmptyString(value.invocationId)) &&
    isIsoUtcTimestamp(value.createdAt) && isIsoUtcTimestamp(value.updatedAt)
}

export function isWebShellAcquisitionView(value: unknown): value is WebShellAcquisitionView {
  return isRecord(value) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.engagementId) && typeof value.findingId === 'string' && FINDING_REF.test(value.findingId) &&
    isRequestId(value.requestId) && WEB_SHELL_ACQUISITION_MODES.includes(value.mode as WebShellAcquisitionMode) &&
    WEB_SHELL_ACQUISITION_STATES.includes(value.state as WebShellAcquisitionState) &&
    isDuration(value.attempt) && isDuration(value.maxAttempts) && value.maxAttempts >= 1 &&
    isOptionalSha256(value.pocSha256) && isOptionalSha256(value.specSha256) &&
    (value.profile === null || isWebShellProfile(value.profile)) && isOptionalText(value.connectionId, 128) &&
    isOptionalText(value.error, ERROR_LIMIT) && isOptionalText(value.artifactPath, 1024) &&
    isOptionalSha256(value.artifactSha256) && isNonEmptyString(value.actorId) &&
    isIsoUtcTimestamp(value.createdAt) && isIsoUtcTimestamp(value.updatedAt)
}
