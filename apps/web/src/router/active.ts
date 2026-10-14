import type { DataRouter } from 'react-router'

/**
 * Pointer to the app's active data router (ticket 07). App installs it during
 * render; the legacy store forwards every navigation here so the React Router
 * history stays the single location writer. Null for router-less mounts.
 */
let active: DataRouter | null = null
export function setActiveRouter(router: DataRouter | null) { active = router }
export function getActiveRouter(): DataRouter | null { return active }
