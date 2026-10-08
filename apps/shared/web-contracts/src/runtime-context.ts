import type { ThreadKind } from './ownership.js'
import { isNonEmptyString, isRecord } from './guards.js'
export interface RuntimeContextView {
  engagementId: string; workspaceSlug: string; assistantId: string; kind: ThreadKind
  authorizationConfirmed: boolean; planningState: 'ready' | 'blocked'; executionReady: boolean
  threadVerified: boolean; source: 'runtime'
}
export function isRuntimeContextView(v: unknown): v is RuntimeContextView {
  return isRecord(v) && ['engagementId', 'workspaceSlug', 'assistantId'].every(k => isNonEmptyString(v[k])) &&
    ['planning', 'execution'].includes(String(v.kind)) && ['ready', 'blocked'].includes(String(v.planningState)) &&
    ['authorizationConfirmed', 'executionReady', 'threadVerified'].every(k => typeof v[k] === 'boolean') &&
    (!v.executionReady || v.authorizationConfirmed === true && v.planningState === 'ready') && v.source === 'runtime'
}
