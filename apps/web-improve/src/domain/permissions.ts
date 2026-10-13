/**
 * Authorization action vocabulary — the 19-action role model (ADR-0067).
 *
 * One definition; `src/store.tsx` re-exports it so legacy imports keep
 * working. The role × action matrix and its enforcement move to the shared
 * auth authority in ticket 06; this union only fixes the action names.
 */
export type CanAction =
  | 'createProject'
  | 'approve'
  | 'editScope'
  | 'run'
  | 'createFinding'
  | 'reviewFinding'
  | 'editReport'
  | 'approveReport'
  | 'requestClose'
  | 'confirmClose'
  | 'reopen'
  | 'admin'
  | 'viewSensitive'
  | 'estop'
  | 'plan'
  | 'approvePlan'
  | 'interactive'
  | 'approveAccess'
  | 'terminate'
