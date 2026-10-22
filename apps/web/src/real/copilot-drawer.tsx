/** Copilot reuses the owned conversation surface and its durable request ledger. */
import { lazy, Suspense, type ReactElement } from 'react'
import { useProjectStore, useUiStore } from '../state/stores'
import { useRoute } from '../router/navigate'
import { Drawer } from '../ui/index'

const Conversation = lazy(() => import('../features/aichat').then((m) => ({ default: m.RealConversation })))

export function RealCopilotDrawer(): ReactElement {
  const open = useUiStore((s) => s.copilotOpen)
  const setOpen = useUiStore((s) => s.setCopilotOpen)
  const pid = useProjectStore((s) => s.pid)
  const route = useRoute()
  const engagementId = route.engagementId ?? (route.page === 'project' || route.page === 'ai-operator' ? route.id : undefined) ?? (pid === 'all' ? '' : pid)
  return <Drawer open={open} onClose={() => setOpen(false)} title="Engagement copilot" width={720}>
    {open && (engagementId ? <Suspense fallback={<p role="status">Loading conversation…</p>}><Conversation key={engagementId} engagementId={engagementId} /></Suspense> : <p>Select an engagement to open its real planning/execution conversation.</p>)}
  </Drawer>
}
