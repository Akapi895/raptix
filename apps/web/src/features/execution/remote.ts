import { isRuntimeContextView, type RuntimeContextView, type ThreadKind } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Execution runtime (ticket 05) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** Server-verified runtime context; `executionReady` gates execution runs. */
export function fetchRuntimeContext(engagementId: string, kind: ThreadKind, threadId: string): Promise<RuntimeContextView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/runtime-context?kind=${encodeURIComponent(kind)}&threadId=${encodeURIComponent(threadId)}`,
    (v): v is RuntimeContextView => isRuntimeContextView(v) && v.engagementId === engagementId && v.kind === kind,
  )
}
