import {
  isWebShellAcquisitionView,
  isWebShellCommandView,
  isWebShellConnectionView,
  isWebShellProbeView,
  type WebShellAcquisitionCreateInput,
  type WebShellAcquisitionView,
  type WebShellCommandCreateInput,
  type WebShellCommandView,
  type WebShellConnectionCreateInput,
  type WebShellConnectionView,
  type WebShellProbeView,
} from '@raptix/web-contracts'
import { apiFetch } from '../../platform/transport'
import { owned } from '../../platform/ownership'
import type { WebShellAcquisitionList, WebShellCommandList, WebShellConnectionList, WebShellProbeList, WebShellUpdateInput } from './service'

const base = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}/webshell/connections`
const connection = (engagementId: string, id: string): string => `${base(engagementId)}/${encodeURIComponent(id)}`
const acqBase = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}/webshell/acquisitions`
const acq = (engagementId: string, id: string): string => `${acqBase(engagementId)}/${encodeURIComponent(id)}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWebShellConnectionList(value: unknown): value is WebShellConnectionList {
  return isRecord(value) && typeof value.engagementId === 'string' && Array.isArray(value.connections)
    && value.connections.every(isWebShellConnectionView)
}

export function isWebShellProbeList(value: unknown): value is WebShellProbeList {
  return isRecord(value) && typeof value.connectionId === 'string' && Array.isArray(value.probes)
    && value.probes.every(isWebShellProbeView)
}

export function isWebShellCommandList(value: unknown, engagementId: string): value is WebShellCommandList {
  return isRecord(value) && typeof value.connectionId === 'string' && Array.isArray(value.commands)
    && value.commands.every((command): command is WebShellCommandView => isWebShellCommandView(command) && command.engagementId === engagementId)
}

export function fetchWebShellConnections(engagementId: string): Promise<WebShellConnectionList> {
  return apiFetch(base(engagementId), owned(engagementId, isWebShellConnectionList))
}

export function fetchWebShellConnection(engagementId: string, connectionId: string): Promise<WebShellConnectionView> {
  return apiFetch(connection(engagementId, connectionId), owned(engagementId, isWebShellConnectionView))
}

export function createWebShellConnection(engagementId: string, input: WebShellConnectionCreateInput): Promise<WebShellConnectionView> {
  return apiFetch(base(engagementId), owned(engagementId, isWebShellConnectionView), { method: 'POST', body: input })
}

export function updateWebShellConnection(engagementId: string, connectionId: string, input: WebShellUpdateInput): Promise<WebShellConnectionView> {
  return apiFetch(connection(engagementId, connectionId), owned(engagementId, isWebShellConnectionView), { method: 'PATCH', body: input })
}

export function closeWebShellConnection(engagementId: string, connectionId: string): Promise<WebShellConnectionView> {
  return apiFetch(`${connection(engagementId, connectionId)}/close`, owned(engagementId, isWebShellConnectionView), { method: 'POST', body: {} })
}

export function probeWebShellConnection(engagementId: string, connectionId: string, requestId: string): Promise<WebShellProbeView> {
  return apiFetch(`${connection(engagementId, connectionId)}/probe`, (value): value is WebShellProbeView =>
    isWebShellProbeView(value) && value.engagementId === engagementId,
  { method: 'POST', body: { requestId } })
}

export function fetchWebShellProbes(engagementId: string, connectionId: string): Promise<WebShellProbeList> {
  return apiFetch(`${connection(engagementId, connectionId)}/probes`, isWebShellProbeList)
}

export function fetchWebShellCommands(engagementId: string, connectionId: string): Promise<WebShellCommandList> {
  return apiFetch(`${connection(engagementId, connectionId)}/commands`, (value): value is WebShellCommandList => isWebShellCommandList(value, engagementId))
}

export function fetchWebShellCommand(engagementId: string, connectionId: string, commandId: string): Promise<WebShellCommandView> {
  return apiFetch(`${connection(engagementId, connectionId)}/commands/${encodeURIComponent(commandId)}`, (value): value is WebShellCommandView =>
    isWebShellCommandView(value) && value.engagementId === engagementId,
  )
}

export function executeWebShellCommand(engagementId: string, connectionId: string, input: WebShellCommandCreateInput): Promise<WebShellCommandView> {
  return apiFetch(`${connection(engagementId, connectionId)}/commands`, (value): value is WebShellCommandView =>
    isWebShellCommandView(value) && value.engagementId === engagementId,
  { method: 'POST', body: input })
}

export function isWebShellAcquisitionList(value: unknown): value is WebShellAcquisitionList {
  return isRecord(value) && typeof value.engagementId === 'string' && Array.isArray(value.acquisitions)
    && value.acquisitions.every(isWebShellAcquisitionView)
}

export function fetchWebShellAcquisitions(engagementId: string): Promise<WebShellAcquisitionList> {
  return apiFetch(acqBase(engagementId), owned(engagementId, isWebShellAcquisitionList))
}

export function fetchWebShellAcquisition(engagementId: string, acquisitionId: string): Promise<WebShellAcquisitionView> {
  return apiFetch(acq(engagementId, acquisitionId), (value): value is WebShellAcquisitionView =>
    isWebShellAcquisitionView(value) && value.engagementId === engagementId,
  )
}

export function createWebShellAcquisition(engagementId: string, input: WebShellAcquisitionCreateInput): Promise<WebShellAcquisitionView> {
  return apiFetch(acqBase(engagementId), (value): value is WebShellAcquisitionView =>
    isWebShellAcquisitionView(value) && value.engagementId === engagementId,
  { method: 'POST', body: input })
}

export function retryWebShellAcquisition(engagementId: string, acquisitionId: string): Promise<WebShellAcquisitionView> {
  return apiFetch(`${acq(engagementId, acquisitionId)}/retry`, (value): value is WebShellAcquisitionView =>
    isWebShellAcquisitionView(value) && value.engagementId === engagementId,
  { method: 'POST', body: {} })
}
