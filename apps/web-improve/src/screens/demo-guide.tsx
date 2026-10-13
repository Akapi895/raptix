import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Compass, X } from 'lucide-react'
import { useStore } from '../store'

type Store = ReturnType<typeof useStore>
export interface Dest { page: string; id?: string; tab?: string }
export interface GStep { t: string; why: string; act: string; to: Dest; persona?: string; pid?: string; runLabel?: string; run?: (S: Store) => void }
export interface Guide { id: string; title: string; goal: string; persona: string; pid: string; expected: string; steps: GStep[] }

const s = (t: string, act: string, why: string, to: Dest, persona?: string, pid?: string): GStep => ({ t, act, why, to, persona, pid })
const sr = (t: string, act: string, why: string, to: Dest, runLabel: string, run: (S: Store) => void, persona?: string, pid?: string): GStep => ({ ...s(t, act, why, to, persona, pid), runLabel, run })
const AX = 'Alex Morgan', PK = 'Pat Kim', TC = 'Taylor Chen', RB = 'Riley Brooks'
const P14 = 'RT-2026-014', P17 = 'RT-2026-017', P15 = 'RT-2026-015'

export const GUIDES: Guide[] = [
  {
    id: 'E2E-01', title: 'Full authorized automation journey', persona: AX, pid: P14,
    goal: 'Walk RT-2026-014 from project command center to a delivered report and a closed project in 25 clicks.',
    expected: 'ROE-014-v2, PL-021 v1.2, OP-014, SS-041, EV-014-01, FD-011, REP-014 stay linked end to end; the project closes read-only.',
    steps: [
      s('Project Command Center', 'Click Open Project', 'Start from the project-scoped dashboard so every number belongs to RT-2026-014.', { page: 'command-center' }),
      s('Project Detail', 'Open the project', 'The project detail is the hub for scope, plans, operations, sessions and closure.', { page: 'project', id: P14, tab: 'overview' }),
      s('Scope & ROE', 'Click Scope & ROE', 'ROE-014-v2 is approved, so execution can become eligible. Check dates and emergency contact.', { page: 'project', id: P14, tab: 'scope' }),
      s('Approved assets and assigned agents', 'Open Approved Assets / Assigned Agents', 'Only 12 approved assets and agents assigned to this project can take part in an operation.', { page: 'assets' }),
      s('Playbook context', 'Open PB-001 and click Ask AI to Plan', 'The AI plans from an approved playbook version (2.3), not the pending 2.4 revision.', { page: 'playbook', id: 'PB-001' }),
      s('AI Operator conversation', 'Send "Propose a validation plan"', 'Chat returns Plan Card PL-021. Nothing runs from chat.', { page: 'ai-operator', id: 'CV-014-03' }, TC),
      s('Plan Builder', 'Click Open Plan', 'PL-021 v1.2 has four phases; review steps, assets and risk before requesting approval.', { page: 'ai-plan', id: 'PL-021' }, TC),
      s('Request Review', 'Click Request Review', 'The plan enters the approval queue. In the seed data PL-021 is already approved; Compare shows v1.1 superseded.', { page: 'ai-plan-compare', id: 'PL-021' }, TC),
      s('Approve Plan (Reviewer)', 'Click Approve Plan and enter a reason', 'A different person approves; actor, version, scope and time are recorded in the audit log.', { page: 'ai-plan-review', id: 'PL-021' }, PK),
      s('Create Operation', 'Click Create Operation', 'A draft operation links to the approved plan version.', { page: 'operation-new' }, TC),
      s('Run Preflight', 'Click Run Preflight', 'Preflight checks ROE, time window, assets and agents and stores a decision snapshot.', { page: 'preflight', id: 'OP-014' }, TC),
      s('Start Operation / Live Workspace', 'Click Start Operation', 'OP-014 is running 10 of 12 steps. Step S11 is waiting for review.', { page: 'operation', id: 'OP-014' }, TC),
      s('Open Session SS-041', 'Click Open Session SS-041', 'Connected is separate from your grant. Taylor Chen holds an interactive grant until 11:15 AM (UTC+7). The console is simulated.', { page: 'c2-session', id: 'SS-041' }, TC),
      s('Review Evidence EV-014-01', 'Click Review Evidence EV-014-01', 'Evidence is what supports a finding; inspect source, hash and linked step.', { page: 'operation', id: 'OP-014', tab: 'results' }, TC),
      s('Review Pending Step S11', 'Click Review Pending Step', 'The operation holds new steps while a step is in review.', { page: 'operation', id: 'OP-014', tab: 'overview' }, PK),
      s('Approve Proposed Step', 'Click Approve Step and enter a reason', 'The authorized decision is recorded, then you return to the live workspace.', { page: 'operation', id: 'OP-014', tab: 'overview' }, PK),
      s('Resume Operation', 'Click Resume Operation', 'The demo progresses to 12/12 through explicit simulated events, then OP-014 completes.', { page: 'operation', id: 'OP-014', tab: 'timeline' }, TC),
      s('Attack Analysis', 'Click Open Attack Analysis', 'Graph, MITRE matrix and detection coverage for OP-014. No detection data is not "Not detected".', { page: 'analysis', id: 'OP-014' }, RB),
      s('Review Finding FD-011', 'Click Review Finding FD-011', 'FD-011 (High) is confirmed with linked evidence. FD-012 is only an AI suggestion.', { page: 'finding', id: 'FD-011' }, RB),
      s('Create Report Draft', 'Click Create Report Draft', 'REP-014 is prefilled from verified sources only.', { page: 'report', id: 'REP-014' }, RB),
      s('Submit for Review', 'Click Submit for Review', 'The report enters the reviewer queue as In Review.', { page: 'report', id: 'REP-014' }, RB),
      s('Approve Report (Reviewer)', 'Click Approve Report and enter a reason', 'Approval pins the report version; authors cannot approve their own report.', { page: 'report-review', id: 'REP-014' }, PK),
      s('Export PDF / DOCX', 'Click Export', 'An export record is created. It is not delivered yet.', { page: 'report-preview', id: 'REP-014' }, AX),
      s('Deliver Report', 'Click Deliver and confirm the recipient', 'Delivery creates a handover record with acknowledgement and audit.', { page: 'report-preview', id: 'REP-014' }, AX),
      s('Resolve Closeout Blockers', 'Click Resolve Closeout Blockers', 'Grants are revoked, sessions ended with ACK, reservations released and AI suggestions dispositioned.', { page: 'project', id: P14, tab: 'close' }, AX),
      s('Close Project', 'Click Close Project and sign off', 'The project becomes Closed and read-only; links to the delivered report, sessions and audit remain.', { page: 'project', id: P14, tab: 'close' }, AX),
    ],
  },
  {
    id: 'E2E-02', title: 'Create project and draft approval branch', persona: AX, pid: 'all',
    goal: 'Create RT-2026-017 and see Submit for Approval blocked until emergency contact and assets exist.',
    expected: 'Eligible scope appears only after a reviewer approves; changing a label on the front end never approves anything.',
    steps: [
      s('Create Project wizard', 'Complete the 5 steps, then Create Draft', 'Drafts can always be saved.', { page: 'project-new' }, AX, 'all'),
      s('Submit for Approval is disabled', 'Click Resolve Blockers', 'Missing emergency contact and approved assets are listed with a link to Scope & ROE.', { page: 'project', id: P17, tab: 'scope' }, AX, P17),
      s('Add an asset as Pending Review', 'Add an asset, then submit for review', 'New assets start as Pending Review, never In Scope.', { page: 'assets' }, AX, P17),
      s('Reviewer receives the task', 'Open My Tasks and approve with a reason', 'Only a valid reviewer approval makes scope eligible.', { page: 'tasks' }, PK, P17),
    ],
  },
  {
    id: 'E2E-03', title: 'Draft operation allowed, execution blocked', persona: AX, pid: P17,
    goal: 'Save an operation draft in RT-2026-017, then see preflight fail and Start stay disabled.',
    expected: 'Save Draft succeeds; preflight fails on draft ROE, 0 approved assets and missing contact; Start Operation links to Scope & ROE.',
    steps: [
      s('Create Operation', 'Fill the form and Save Draft', 'You can save this operation as a draft, but cannot start it yet.', { page: 'operation-new' }),
      s('Run Preflight', 'Click Run Preflight', 'Preflight lists concrete blockers.', { page: 'preflight', id: 'OP-DRAFT-017' }),
      s('Open Scope & ROE', 'Click Open Scope & ROE', 'Start stays disabled until the ROE is approved.', { page: 'project', id: P17, tab: 'scope' }),
    ],
  },
  {
    id: 'E2E-04', title: 'AI plan revised after failure', persona: TC, pid: P14,
    goal: 'Revise PL-021 to v1.3, return it for changes, resubmit and approve.',
    expected: 'v1.2 stays an immutable reference; approved v1.3 never rewrites earlier output.',
    steps: [
      s('Step Inspector', 'Open a step in OP-014 and use AI Copilot', 'Start from the failed or reviewed step.', { page: 'operation', id: 'OP-014', tab: 'timeline' }),
      s('Propose revision', 'Click Propose revision', 'PL-021 v1.3 is created as a draft.', { page: 'ai-plan', id: 'PL-021' }),
      s('Compare revisions', 'Click Compare revisions', 'See the v1.2 to v1.3 diff.', { page: 'ai-plan-compare', id: 'PL-021' }),
      s('Reviewer returns for changes', 'Click Return for Changes with a reason', 'Revision requires re-approval because steps changed.', { page: 'ai-plan-review', id: 'PL-021' }, PK),
      s('Edit and resubmit, then approve', 'Resubmit; reviewer approves', 'The approval applies to v1.3 only.', { page: 'ai-plan-review', id: 'PL-021' }, PK),
    ],
  },
  {
    id: 'E2E-05', title: 'Agent disconnect during operation', persona: TC, pid: P14,
    goal: 'See AG-009 disconnected in OP-014 without a false Completed state.',
    expected: 'Affected steps show Interrupted or Unknown; a replacement request is offered only for a compatible, in-scope agent.',
    steps: [
      s('Warning in the live workspace', 'Open the Agents tab', 'AG-009 WIN-LAB-03 is disconnected and the operation does not show Completed.', { page: 'operation', id: 'OP-014', tab: 'agents' }),
      s('View Agent', 'Click View Agent', 'Connection details and last seen time.', { page: 'agent', id: 'AG-009' }),
      s('Request Replacement', 'Click Request Replacement', 'Only compatible agents within scope policy are offered.', { page: 'agents' }),
    ],
  },
  {
    id: 'E2E-06', title: 'Session access pending, approved, expired', persona: RB, pid: P14,
    goal: 'Request interactive access to SS-042 (AR-012), get it approved for 30m, then watch it expire.',
    expected: 'Connected stays independent of the access grant; input is disabled on expiry and Request Renewal appears.',
    steps: [
      s('Sessions list', 'Open Sessions and pick SS-042', 'SS-042 is connected, your access request AR-012 is pending.', { page: 'c2', tab: 'sessions' }),
      s('Request Access', 'Click Request Access', 'The request goes to the reviewer queue.', { page: 'c2-session', id: 'SS-042' }),
      s('Reviewer approves 30m', 'Open Access requests and Approve 30m', 'A grant is time-limited and tied to this session.', { page: 'c2', tab: 'requests' }, AX),
      s('Open the simulated console', 'Click Open Console', 'Simulated Console: no real commands are executed.', { page: 'c2-console', id: 'SS-042' }, RB),
      s('Grant expires', 'Wait for expiry, then Request Renewal', 'Input is disabled; the session is not terminated just because the grant expired.', { page: 'c2-session', id: 'SS-042' }, RB),
    ],
  },
  {
    id: 'E2E-07', title: 'Emergency Stop', persona: AX, pid: P14,
    goal: 'Stop OP-014 and watch Requested, Acknowledged, Stopped (or Failed/Unknown) with no fake success.',
    expected: 'Operations only become Stopped after acknowledgement; the audit trail links to the stop event.',
    steps: [
      s('Live Workspace', 'Click Emergency Stop', 'Choose project scope, enter a reason and acknowledge the impact.', { page: 'operation', id: 'OP-014' }),
      s('Watch acknowledgement', 'Check Node/Agent ACK status', 'Emergency stop requested. Awaiting agent acknowledgement.', { page: 'operation', id: 'OP-014', tab: 'agents' }),
      s('Audit deep link', 'Click View audit log', 'The stop request and each ACK are recorded.', { page: 'settings', tab: 'audit' }),
    ],
  },
  {
    id: 'E2E-08', title: 'Scope change invalidates approvals', persona: AX, pid: P14,
    goal: 'Add a scope asset, draft ROE v3 and see affected plans and operations need re-validation.',
    expected: 'Planning and start require re-validation; the effect on running work is shown openly.',
    steps: [
      s('Add scope asset', 'Click Add scope asset', 'New assets start as Pending Review.', { page: 'asset-new' }),
      s('ROE v3 draft', 'Open Scope & ROE', 'A scope change creates a ROE draft revision.', { page: 'project', id: P14, tab: 'scope' }),
      s('Affected plans and operations', 'Review the impact list', 'Impacted items need re-validation; rerun preflight after approval.', { page: 'project', id: P14, tab: 'plans' }),
    ],
  },
  {
    id: 'E2E-09', title: 'Evidence to report with no confirmed finding', persona: RB, pid: P15,
    goal: 'Create a report from coverage observations only; no fake finding is created.',
    expected: 'Submit for Review asks for evidence or an approved no-findings closure.',
    steps: [
      s('Coverage observations', 'Open operation results', 'Observations are not findings.', { page: 'operation', id: 'OP-015', tab: 'results' }),
      s('Create Report Draft', 'Click Create Draft', 'A draft is always allowed.', { page: 'report-new' }),
      s('Submit for Review', 'Click Submit for Review', 'Policy requires evidence or an approved no-findings closure.', { page: 'reports' }),
    ],
  },
  {
    id: 'E2E-10', title: 'Multi-project isolation', persona: TC, pid: P14,
    goal: 'Switch from RT-2026-014 to RT-2026-017 and All Projects; nothing leaks across.',
    expected: 'RT-2026-017 shows only CV-017-01; SS-041/SS-042 never appear; All Projects is read-only.',
    steps: [
      s('Open CV-014-03', 'Open the conversation and type a draft', 'Switching projects warns about unsaved changes.', { page: 'ai-operator', id: 'CV-014-03' }),
      s('Switch to RT-2026-017', 'Confirm the unsaved-changes warning', 'Only CV-017-01 is visible in the AI list.', { page: 'ai-operator' }, TC, P17),
      s('C2 in RT-2026-017', 'Open C2 & Sessions', 'No session from RT-2026-014 appears.', { page: 'c2' }, TC, P17),
      s('All Projects is read-only', 'Try to start a run or open a session', 'Select a project to start an operation or open an interactive session.', { page: 'operations' }, TC, 'all'),
    ],
  },
  {
    id: 'E2E-11', title: 'Report returned for changes', persona: AX, pid: P14,
    goal: 'Return REP-014 with a reason, edit, resubmit, approve, export and deliver.',
    expected: 'Export history contains the approved version; delivery is confirmed.',
    steps: [
      s('Draft to In Review', 'Click Submit for Review', 'REP-014 enters the reviewer queue.', { page: 'report', id: 'REP-014' }),
      s('Return with reason', 'Click Return for Changes', 'The author sees the diff and comments.', { page: 'report-review', id: 'REP-014' }, PK),
      s('Edit and resubmit', 'Address comments and resubmit', 'Each round is kept in review history.', { page: 'report', id: 'REP-014' }, RB),
      s('Approve', 'Click Approve', 'Approval pins the version.', { page: 'report-review', id: 'REP-014' }, PK),
      s('Export and deliver', 'Click Export, then Deliver', 'Formal delivery is unavailable until review is complete.', { page: 'report-preview', id: 'REP-014' }, AX),
    ],
  },
  /* ── Workflows A–G (V3.1): every step opens a real route; "Simulated action" buttons only mutate demo data ── */
  {
    id: 'WF-A', title: 'A · Observe → Propose → Plan', persona: TC, pid: P14,
    goal: 'See that a prompt never executes anything: Observe answers, Propose drafts a plan, a plan still needs approval.',
    expected: 'A plan draft or proposal exists; nothing has run. Execution needs an approved plan, eligibility, preflight and (where required) tool approval.',
    steps: [
      s('Open a conversation', 'Open CV-014-03 and read the conversation mode', 'Conversation Mode is per conversation. It is not the Default AI Mode and not Execution Eligibility.', { page: 'ai-operator', id: 'CV-014-03' }),
      s('Observe: ask a question', 'Switch the conversation to Observe and ask a question', 'Observe reads and answers only. No plan or tool call is created.', { page: 'ai-operator', id: 'CV-014-01' }),
      s('Propose: draft a plan', 'Switch to Propose and send "Propose a validation plan"', 'The assistant returns a plan card. Sending a prompt never starts a command.', { page: 'ai-operator', id: 'CV-014-03' }),
      s('Open the plan', 'Click the plan card to open PL-021 v1.2', 'Review phases, steps, targets, risk and the branch group preview before requesting approval.', { page: 'ai-plan', id: 'PL-021' }),
      s('Plan history and compare', 'Open Compare to see v1.1 (superseded) against v1.2', 'Approved versions stay immutable; changes create a new version.', { page: 'ai-plan-compare', id: 'PL-021' }),
    ],
  },
  {
    id: 'WF-B', title: 'B · Plan approval → Operation', persona: PK, pid: P14,
    goal: 'Approve a plan with a reason, create an operation from it, run preflight, and reach the live workspace.',
    expected: 'The approval records actor, version and reason. Preflight is separate from approval; starting needs an eligible project.',
    steps: [
      s('Plan review queue', 'Open the plan review for PL-021', 'A reviewer (not the author) decides. Approval needs a reason.', { page: 'ai-plan-review', id: 'PL-021' }, PK),
      s('Approval is recorded', 'Open the AI audit trail', 'Approval applies to plan version v1.2 only; it is not execution.', { page: 'ai-history', tab: 'audit' }, PK),
      s('Create Operation from plan', 'Click Create Operation', 'The operation links to the approved plan version.', { page: 'operation-new' }, TC),
      s('Run Preflight', 'Click Run Preflight', 'Preflight checks ROE, time window, assets and agents and shows blockers if any.', { page: 'preflight', id: 'OP-014' }, TC),
      s('Live workspace', 'Confirm and open the Live Workspace', 'OP-014 shows its linked plan, conversation and branch group. Runtime state is separate from eligibility.', { page: 'operation', id: 'OP-014' }, TC),
    ],
  },
  {
    id: 'WF-C', title: 'C · Multi-agent fan-out', persona: TC, pid: P14,
    goal: 'Follow BG-014-01 from the execution graph to a branch, its agent, trace, evidence and the fan-in results.',
    expected: 'Branch state, agent state and aggregation are shown separately; a failed branch never makes the group a success. Data is simulated.',
    steps: [
      s('Execution graph', 'Open the graph for BG-014-01', 'Parent step S02 fans out to parallel branches and fans in at S12. Max 2 run concurrently.', { page: 'ai-fanout', id: 'BG-014-01' }),
      s('Branch table', 'Switch to Table view', 'Progress is shown only when measured; otherwise Unknown.', { page: 'ai-fanout', id: 'BG-014-01' }),
      s('Branch inspector', 'Open branch BR-014-01', 'Identity, tool events, evidence, policy decisions and timeline for one branch.', { page: 'ai-branch', id: 'BR-014-01' }),
      s('Branch agent', 'Click the agent ID', 'Branch agents are execution agents (AG-xxx), separate from the AI workers.', { page: 'agent', id: 'AG-007' }),
      s('Tool trace', 'Open the trace for the branch event', 'Policy Allowed is not Executed; each facet is independent.', { page: 'ai-trace', id: 'TL-01' }),
      s('Evidence', 'Open EV-014-01', 'Evidence supports findings; inspect source, hash and linked step.', { page: 'evidence', id: 'EV-014-01' }),
      s('Fan-in and results', 'Return to the graph and open the Fan-In panel', 'Fan-in lists completed, failed and missing branches. Confidence stays Not assessed until data exists.', { page: 'ai-fanout', id: 'BG-014-01' }),
      s('Operation results', 'Open OP-014 results', 'Operation results link back to branches and evidence.', { page: 'operation', id: 'OP-014', tab: 'results' }),
    ],
  },
  {
    id: 'WF-D', title: 'D · Approval required', persona: PK, pid: P14,
    goal: 'Handle TL-03 (defense-sim, safe), a tool proposal that waits for explicit human approval.',
    expected: 'Policy may allow the tool, but it stays Not Executed until a reviewer approves; Allow/Deny is for the reviewer persona only.',
    steps: [
      s('Find the pending tool event', 'Open TL-03 in the trace', 'Facets are independent: Policy, Approval and Execution.', { page: 'ai-trace', id: 'TL-03' }, PK),
      s('Review as approver', 'Click Allow or Deny and enter a reason', 'Only a reviewer can decide. Other personas see Pending and the approver name.', { page: 'ai-trace', id: 'TL-03' }, PK),
      s('Step in the operation', 'Open OP-014 to see step S10', 'Step S10 waits for approval; the decision does not auto-run anything else.', { page: 'operation', id: 'OP-014', tab: 'overview' }, PK),
      s('Branch awaiting approval', 'Open branch BR-014-04', 'The branch shows approval history and stays waiting until approved.', { page: 'ai-branch', id: 'BR-014-04' }, PK),
      s('Audit trail', 'Open the audit log', 'The approver, reason and time are recorded.', { page: 'settings', tab: 'audit' }, PK),
    ],
  },
  {
    id: 'WF-E', title: 'E · Policy blocked', persona: TC, pid: P14,
    goal: 'TL-04 targets prod-payments-db, which ROE-014-v2 excludes: Blocked and Not Executed, then fix via a plan revision.',
    expected: 'The block is explained with a policy reason; scope never changes by itself. A new plan revision needs re-approval.',
    steps: [
      s('Blocked tool event', 'Open TL-04 in the trace', 'Policy Blocked, Approval not applicable, Execution Not Executed.', { page: 'ai-trace', id: 'TL-04' }),
      s('Policy details', 'Open the Tool Event Inspector', 'Reason: out of scope, asset is excluded by ROE-014-v2.', { page: 'ai-trace', id: 'TL-04' }),
      s('Check the asset', 'Open the Assets list and find prod-payments-db', 'Pending or excluded assets never become In Scope automatically.', { page: 'assets' }),
      s('Scope & ROE', 'Open Scope & ROE', 'Changing scope needs an ROE revision and reviewer approval.', { page: 'project', id: P14, tab: 'scope' }),
      s('Revise the plan', 'Open PL-021 and choose Create Plan Revision', 'v1.2 stays approved; a revision is a draft and needs re-approval.', { page: 'ai-plan', id: 'PL-021' }),
    ],
  },
  {
    id: 'WF-F', title: 'F · Agent disconnect during fan-out', persona: TC, pid: P14,
    goal: 'Simulate AG-008 losing connection and see branches pause or become Unknown, then restore it.',
    expected: 'Affected branches show Paused or Unknown, never Completed. Retry and reassign still need approval. Restore reconnects the agent only.',
    steps: [
      sr('Before: graph is healthy', 'Open the graph first', 'Note the branch states on AG-008 before the simulated disconnect.', { page: 'ai-fanout', id: 'BG-014-01' }, 'Simulate AG-008 disconnect', (S) => { S.A.loseAgent('AG-008'); S.toast('Simulated: AG-008 disconnected. Demo data only.', 'warn') }),
      s('Group impact', 'Read the group impact banner and branch states', 'Running branches on AG-008 become Unknown; queued ones are Paused.', { page: 'ai-fanout', id: 'BG-014-01' }),
      s('Inspect an affected branch', 'Open BR-014-05', 'Request Retry or Reassign: both set approval pending and never bypass preflight.', { page: 'ai-branch', id: 'BR-014-05' }),
      s('Agent detail', 'Open AG-008', 'Disconnected agents show a stale-data warning and are never listed as Available.', { page: 'agent', id: 'AG-008' }),
      s('Operation view', 'Open OP-014', 'The operation never shows success while a branch is failed or unknown.', { page: 'operation', id: 'OP-014', tab: 'agents' }),
      sr('Restore the agent', 'Click Restore AG-008', 'Restoring reconnects the agent. Paused branches still need an explicit resume or retry.', { page: 'ai-fanout', id: 'BG-014-01' }, 'Restore AG-008', (S) => { S.A.restoreAgent('AG-008'); S.toast('Simulated: AG-008 restored. Demo data only.', 'ok') }),
    ],
  },
  {
    id: 'WF-G', title: 'G · Operation → findings → report', persona: RB, pid: P14,
    goal: 'Move from OP-014 results to FD-011 and the REP-014 draft, keeping the AI suggestion FD-012 out of formal output.',
    expected: 'Only confirmed findings enter the report; FD-012 stays an AI suggestion until a reviewer verifies it.',
    steps: [
      s('Operation results', 'Open OP-014 results', 'Evidence and outputs are linked to steps and branches.', { page: 'operation', id: 'OP-014', tab: 'results' }),
      s('Attack analysis', 'Open the analysis for OP-014', 'No detection data is never shown as Not detected.', { page: 'analysis', id: 'OP-014' }),
      s('Confirmed finding', 'Open FD-011', 'High severity, confirmed, with linked evidence.', { page: 'finding', id: 'FD-011' }),
      s('AI suggestion', 'Open FD-012', 'An AI suggestion is not a verified finding and is excluded from reports.', { page: 'finding', id: 'FD-012' }),
      s('Report draft', 'Open REP-014', 'Prefilled from verified sources only.', { page: 'report', id: 'REP-014' }),
      s('Reviewer and export', 'Open the report review, then the preview', 'Review, export and delivery are separate steps and need permissions.', { page: 'report-review', id: 'REP-014' }, PK),
    ],
  },
]

/* ── module state (no localStorage) ── */
interface GS { id: string | null; step: number; collapsed: boolean }
let gs: GS = { id: null, step: 0, collapsed: false }
const subs = new Set<() => void>()
const setGs = (n: Partial<GS>) => { gs = { ...gs, ...n }; subs.forEach((f) => f()) }
const useGs = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => gs)
export const stopGuide = () => setGs({ id: null, step: 0 })

/** Switch persona/project as needed (entering the app if needed), then navigate. */
export function jump(getS: () => Store, to: Dest, persona?: string, pid?: string) {
  const S = getS()
  if (persona && S.me.name !== persona) S.setMe(persona)
  if (!S.authed) S.login()
  if (pid && S.pid !== pid) S.setPid(pid)
  setTimeout(() => getS().go(to.page, { id: to.id, tab: to.tab }), 120)
}
const stepArgs = (g: Guide, i: number) => ({ persona: g.steps[i].persona || g.persona, pid: g.steps[i].pid || g.pid })

export function launchGuide(getS: () => Store, id: string, at = 0) {
  const g = GUIDES.find((x) => x.id === id)
  if (!g) return
  setGs({ id, step: at, collapsed: false })
  const a = stepArgs(g, at)
  jump(getS, g.steps[at].to, a.persona, a.pid)
  setTimeout(() => getS().toast(`${g.id} started as ${a.persona}. Use the Demo walkthrough panel (bottom-left) to follow the steps.`, 'info'), 200)
}

const same = (a: Dest, b: Dest) => a.page === b.page && (a.id ?? '') === (b.id ?? '') && (a.tab ?? '') === (b.tab ?? '')

export function DemoGuide() {
  const S = useStore()
  const st = useGs()
  const ref = useRef(S)
  ref.current = S
  const g = GUIDES.find((x) => x.id === st.id)
  const { route } = S

  // Auto-advance when the user reaches the next step's screen on their own.
  useEffect(() => {
    if (!g) return
    const nx = g.steps[st.step + 1]
    if (!nx) return
    const cur: Dest = g.steps[st.step].to
    if (same(nx.to, cur)) return
    if (nx.to.page === route.page && (!nx.to.id || nx.to.id === route.id) && (!nx.to.tab || nx.to.tab === route.tab) && !same(cur, route)) setGs({ step: st.step + 1 })
  }, [route.page, route.id, route.tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!g || !S.authed) return null
  const step = g.steps[st.step]
  const total = g.steps.length
  const a = stepArgs(g, st.step)
  const go = (i: number) => { setGs({ step: i }); const b = stepArgs(g, i); jump(() => ref.current, g.steps[i].to, b.persona, b.pid) }
  const onScreen = same(step.to, route)
  const personaMismatch = S.me.name !== a.persona

  if (st.collapsed) {
    return (
      <button className="fixed bottom-3 left-3 z-40 flex items-center gap-2 rounded-full border border-accent-line bg-panel px-3 py-1.5 text-xs font-medium text-accent shadow-md hover:bg-accent-soft" onClick={() => setGs({ collapsed: false })} aria-label="Expand demo walkthrough">
        <Compass size={14} aria-hidden />Demo {g.id} · Step {st.step + 1}/{total}
      </button>
    )
  }
  return (
    <aside className="fixed bottom-3 left-3 z-40 w-72 rounded-lg border border-accent-line bg-panel text-sm shadow-lg" aria-label="Demo walkthrough">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Compass size={14} className="text-accent" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Demo walkthrough · {g.id}</div></div>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => setGs({ collapsed: true })} aria-label="Collapse walkthrough"><ChevronDown size={14} /></button>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={stopGuide} aria-label="End walkthrough"><X size={14} /></button>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-accent">Step {st.step + 1}/{total}</span><span className="truncate text-[11px] text-muted">{a.persona}</span></div>
        <div className="font-medium leading-snug">{step.t}</div>
        <p className="text-xs text-muted"><b className="text-fg">Why it matters:</b> {step.why}</p>
        <p className="text-xs text-muted"><b className="text-fg">Do this:</b> {step.act}</p>
        {personaMismatch && <p className="rounded border border-line bg-side px-2 py-1 text-[11px] text-muted">This step is played by {a.persona}; Go to this screen switches the demo persona.</p>}
        {onScreen
          ? <p className="text-[11px] text-ok">You are on this screen. Click Next when done{g.steps[st.step + 1] ? ', or open the next screen and the guide advances itself.' : '.'}</p>
          : <p className="text-[11px] text-muted">Tip: opening the next step's screen advances this guide automatically.</p>}
        {step.run && <button className="h-8 w-full rounded-md border border-accent-line bg-accent-soft px-3 text-xs font-medium text-accent hover:opacity-90" onClick={() => step.run!(ref.current)}>Simulated action: {step.runLabel}</button>}
        <button className="h-8 w-full rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90" onClick={() => go(st.step)}>Go to this screen</button>
        <div className="flex items-center justify-between gap-2">
          <button className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-hover disabled:opacity-40" disabled={st.step === 0} onClick={() => go(st.step - 1)}><ChevronLeft size={13} aria-hidden />Prev</button>
          {st.step === total - 1
            ? <button className="h-7 rounded-md border border-line px-2 text-xs hover:bg-hover" onClick={stopGuide}>Finish</button>
            : <button className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-hover" onClick={() => go(st.step + 1)}>Next<ChevronRight size={13} aria-hidden /></button>}
        </div>
      </div>
    </aside>
  )
}
