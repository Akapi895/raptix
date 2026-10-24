// Authorization matrix over the real API (test stack only). Each write is sent as each actor; the expected outcome follows the
// membership rank the server declares: owner 4, operator 3, reviewer 2, viewer 1. A member below the minimum gets 403; a
// non-member gets 404 (the project's existence is not revealed); an actor at or above the minimum passes the authority check
// and then fails only on the request's own validation or state (400 or 409), which changes nothing when the body is invalid
// or the plan is a draft. The matrix never approves, dispatches or deletes anything.
// Usage: node tools/verify/acceptance/authz-matrix.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { loadConnection, parseArgs, ApiSession, dbScalar, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const recorder = new Recorder('authz-matrix', args.out ?? 'authz-matrix.json');
const RANK = { owner: 4, operator: 3, reviewer: 2, viewer: 1 };
const shared = conn.project;

const sessions = {};
sessions.owner = await new ApiSession(conn.api, 'owner').login(conn.owner.username, conn.owner.password);
sessions.operator = await new ApiSession(conn.api, 'operator').login(conn.operator.username, conn.operator.password);
sessions.reviewer = await new ApiSession(conn.api, 'reviewer').login(conn.reviewer.username, conn.reviewer.password);
sessions.viewer = await new ApiSession(conn.api, 'viewer').login(conn.viewer.username, conn.viewer.password);

// An outsider: an account that is a member of a project that is not the shared one. The owner creates that project.
const stamp = Date.now().toString(36);
const created = await sessions.owner.call('POST', '/api/engagements', {
  name: `authz-${stamp}`, displayName: `Authz matrix ${stamp}`, targetType: 'web_url', targetValue: 'https://authz.verification.invalid',
  authorizationConfirmed: true, brief: 'Generated fixture for the authorization matrix. No target contact.',
});
const otherProject = created.json?.id;
const outsiderPassword = `Outsider-${stamp}-pass`;
await sessions.owner.call('POST', `/api/engagements/${otherProject}/members`, { username: `outsider${stamp}`, displayName: 'Outsider', password: outsiderPassword, role: 'viewer' });
sessions.outsider = await new ApiSession(conn.api, 'outsider').login(`outsider${stamp}`, outsiderPassword);

// A draft plan written by the operator (the author). Deciding a draft is refused by state, after the authority check.
const draft = await sessions.operator.call('POST', `/api/engagements/${shared}/plans`, { objective: `Authz draft ${stamp}`, methods: [] });
const draftPlanId = draft.json?.id;

const writes = [
  { id: 'plan.create', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/plans`, body: { objective: '' } },
  { id: 'plan.decide', minRole: 'reviewer', method: 'POST', path: `/api/engagements/${shared}/plans/${draftPlanId}/decision`, body: { decision: 'approved' } },
  { id: 'scope.revision.create', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/scope/revisions`, body: {} },
  { id: 'finding.create', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/curated-findings`, body: {} },
  { id: 'report.create', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/report-records`, body: {} },
  { id: 'library.proposal.create', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/library-proposals`, body: {} },
  { id: 'c2.grant.request', minRole: 'operator', method: 'POST', path: `/api/engagements/${shared}/c2/grants`, body: {} },
  { id: 'member.manage', minRole: 'owner', method: 'POST', path: `/api/engagements/${shared}/members`, body: {} },
];
const reads = [
  { id: 'plans.read', minRole: 'viewer', method: 'GET', path: `/api/engagements/${shared}/plans` },
  { id: 'members.read', minRole: 'viewer', method: 'GET', path: `/api/engagements/${shared}/members` },
];

function expectedOf(actor, minRole) {
  if (actor === 'outsider') return 404;
  return RANK[actor] >= RANK[minRole] ? 'pass' : 403;
}

function observedOf(response) {
  if (response.status === 403) return 403;
  if (response.status === 404) return 404;
  return 'pass';
}

for (const action of [...writes, ...reads]) {
  for (const actor of ['owner', 'operator', 'reviewer', 'viewer', 'outsider']) {
    const id = `${action.id}.${actor}`;
    await recorder.check(id, async () => {
      const response = await sessions[actor].call(action.method, action.path, action.body);
      const observed = observedOf(response);
      const expected = expectedOf(actor, action.minRole);
      const ok = observed === expected;
      return { ok, detail: `expected ${expected}, observed ${observed} (HTTP ${response.status})`, evidence: { status: response.status } };
    });
  }
}

// Four-eyes: the operator who proposed a plan cannot decide it. The guard runs after the state check, so the plan must be
// proposed first (a draft would answer 409 and prove nothing). The refused decision must leave the plan proposed.
const proposed = await sessions.operator.call('POST', `/api/engagements/${shared}/plans`, { objective: `Authz proposed ${stamp}`, methods: [] });
const proposedPlanId = proposed.json?.id;
const proposing = proposedPlanId ? await sessions.operator.call('POST', `/api/engagements/${shared}/plans/${proposedPlanId}/propose`) : { status: 0 };
await recorder.check('plan.decide.independence', async () => {
  if (proposing.status >= 300) return { ok: false, detail: `setup: the operator could not propose the plan (HTTP ${proposing.status})` };
  const response = await sessions.operator.call('POST', `/api/engagements/${shared}/plans/${proposedPlanId}/decision`, { decision: 'approved' });
  const status = dbScalar(conn.db, `select status from "BusinessPlan" where id='${proposedPlanId}'`);
  const message = /requires an independent actor/.test(response.text);
  return { ok: response.status === 403 && message && status === 'proposed', detail: `author decision HTTP ${response.status}; independence message ${message}; database ${status}`, evidence: { status: response.status } };
});

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
