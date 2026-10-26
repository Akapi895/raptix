import type {
  WebShellAcquisitionCreateInput,
  WebShellAcquisitionView,
  WebShellCommandCreateInput,
  WebShellCommandView,
  WebShellConnectionCreateInput,
  WebShellConnectionView,
  WebShellProbeView,
  WebShellProfile,
} from '@raptix/web-contracts'
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface WebShellConnectionList {
  engagementId: string
  connections: WebShellConnectionView[]
}

export interface WebShellProbeList {
  connectionId: string
  probes: WebShellProbeView[]
}

export interface WebShellCommandList {
  connectionId: string
  commands: WebShellCommandView[]
}

export interface WebShellUpdateInput {
  name?: string
  assetId?: string | null
  profile?: WebShellProfile
}

export interface WebShellAcquisitionList {
  engagementId: string
  acquisitions: WebShellAcquisitionView[]
}

export interface WebShellService {
  list(ctx: RequestContext): Promise<ServiceResult<WebShellConnectionList>>
  get(ctx: RequestContext, connectionId: string): Promise<ServiceResult<WebShellConnectionView>>
  create(ctx: RequestContext, input: WebShellConnectionCreateInput): Promise<ServiceResult<WebShellConnectionView>>
  update(ctx: RequestContext, connectionId: string, input: WebShellUpdateInput): Promise<ServiceResult<WebShellConnectionView>>
  close(ctx: RequestContext, connectionId: string): Promise<ServiceResult<WebShellConnectionView>>
  probe(ctx: RequestContext, connectionId: string, requestId: string): Promise<ServiceResult<WebShellProbeView>>
  probes(ctx: RequestContext, connectionId: string): Promise<ServiceResult<WebShellProbeList>>
  commands(ctx: RequestContext, connectionId: string): Promise<ServiceResult<WebShellCommandList>>
  command(ctx: RequestContext, connectionId: string, commandId: string): Promise<ServiceResult<WebShellCommandView>>
  execute(ctx: RequestContext, connectionId: string, input: WebShellCommandCreateInput): Promise<ServiceResult<WebShellCommandView>>
  listAcquisitions(ctx: RequestContext): Promise<ServiceResult<WebShellAcquisitionList>>
  getAcquisition(ctx: RequestContext, acquisitionId: string): Promise<ServiceResult<WebShellAcquisitionView>>
  createAcquisition(ctx: RequestContext, input: WebShellAcquisitionCreateInput): Promise<ServiceResult<WebShellAcquisitionView>>
  retryAcquisition(ctx: RequestContext, acquisitionId: string): Promise<ServiceResult<WebShellAcquisitionView>>
}
