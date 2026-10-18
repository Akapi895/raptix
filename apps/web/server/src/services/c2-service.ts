/** Engagement-owned Sliver sessions, HTTP profiles and durable command audit. */
import { createHash } from 'node:crypto';
import { isC2Session, isC2Listener, isC2Profile, type C2View, type C2CommandView } from '@raptix/web-contracts';
import type { PrismaClient, C2Command } from '../generated/prisma/client.js';
import type { SliverClient } from '../integrations/c2/sliver-client.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
export class ProviderUnavailableError extends ProjectApiError {
  public constructor(message: string) { super(503, message); }
}
const UNAVAILABLE = 'C2 session provider not configured; no session registry exists in this build';
export class C2Service {
  public constructor(private readonly db: PrismaClient, private readonly provider?: SliverClient,
    private readonly grantGate?: (engagementId: string, sessionId: string, actorId: string, path?: string, target?: string) => Promise<void>) {}
  public get configured(): boolean { return this.provider !== undefined; }
  private async authorize(userId: string, engagementId: string): Promise<SliverClient> {
    // W02: provider operations require the operator role or above on the
    // engagement — an invited operator is authorized, a viewer is not.
    await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'operator');
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId } });
    if (!engagement || !engagement.authorizationConfirmed) throw new ProjectApiError(403, 'Confirmed engagement authorization is required');
    if (!this.provider) throw new ProviderUnavailableError(UNAVAILABLE);
    return this.provider;
  }

  /** W13: read policy for the durable ledger — any member may read without a mounted provider. */
  private async authorizeRead(userId: string, engagementId: string): Promise<void> {
    // W02: authorized members (viewer and above) may read the scoped ledger;
    // foreign or removed actors keep answering 404.
    await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId } });
    if (!engagement || !engagement.authorizationConfirmed) throw new ProjectApiError(403, 'Confirmed engagement authorization is required');
  }
  public async sessions(userId: string, engagementId: string): Promise<C2View> {
    const provider = await this.authorize(userId, engagementId);
    const [sessions, listeners, profiles] = await Promise.all(['sessions.list','listeners.list','profiles.list'].map(op => provider.call({ op, engagementId })));
    if (!Array.isArray(sessions!.sessions) || !sessions!.sessions.every(isC2Session) || !Array.isArray(listeners!.listeners) ||
      !listeners!.listeners.every(isC2Listener) || listeners!.listeners.some(l => l.engagementId !== engagementId) ||
      !Array.isArray(profiles!.profiles) || !profiles!.profiles.every(isC2Profile)) throw new ProviderUnavailableError('Invalid scoped Sliver registry response');
    return { engagementId, source: 'sliver', sessions: sessions!.sessions, listeners: listeners!.listeners, profiles: profiles!.profiles };
  }
  public async configure(userId: string, engagementId: string, kind: 'listener' | 'profile', body: unknown): Promise<Record<string, unknown>> {
    const provider = await this.authorize(userId, engagementId);
    const input = object(body); const key = kind === 'listener' ? 'protocol' : 'name';
    if (Object.keys(input).length !== 1 || (kind === 'listener' ? !['mtls','http'].includes(String(input[key])) :
      typeof input[key] !== 'string' || !/^[a-z0-9-]{1,48}$/.test(input[key]))) throw new ProjectApiError(400, 'Invalid lab listener or profile configuration');
    const result = await provider.call({ op: kind === 'listener' ? 'listeners.start' : 'profiles.create', engagementId, [key]: input[key] });
    if (kind === 'listener' ? !isC2Listener(result.listener) || result.listener.engagementId !== engagementId : !isC2Profile(result.profile)) throw new ProviderUnavailableError('Invalid Sliver configuration response');
    return result;
  }
  public async stopListener(userId: string, engagementId: string, jobId: number): Promise<Record<string, unknown>> {
    const provider = await this.authorize(userId, engagementId);
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new ProjectApiError(400, 'Invalid listener job ID');
    return provider.call({ op: 'listeners.stop', engagementId, jobId });
  }
  /**
   * P12 grant verification: a grant names a session the provider reports in this engagement's namespace.
   * The caller has already checked membership; an unconfigured or unreadable provider is refused, never assumed.
   */
  public async assertSessionReported(engagementId: string, sessionId: string): Promise<void> {
    if (!this.provider) throw new ProviderUnavailableError(UNAVAILABLE);
    const reply = await this.provider.call({ op: 'sessions.list', engagementId });
    if (!Array.isArray(reply.sessions) || !reply.sessions.every(isC2Session)) throw new ProviderUnavailableError('Invalid scoped Sliver session response');
    if (!reply.sessions.some(session => session.id === sessionId)) throw new ProjectApiError(409, `Session ${sessionId} is not reported by the provider for this engagement`);
  }
  public async dispatchCommand(userId: string, engagementId: string, sessionId: string, body?: unknown): Promise<C2CommandView> {
    if (!sessionId.trim()) throw new ProjectApiError(400, 'sessionId is required');
    const provider = await this.authorize(userId, engagementId);
    const input = command(body);
    // Ticket 12 / IW-09: a connected session is not an authorization. Every
    // command authorizes against the actor's live approved grant at three
    // points — before reservation, after reservation (before the provider is
    // invoked) and after the provider answered (before the result is handed
    // back). A command that already executed is never "un-executed" by a
    // later revocation: the truthful outcome is retained in the durable audit
    // and the authorization failure is surfaced to the caller.
    if (this.grantGate !== undefined) await this.grantGate(engagementId, sessionId, userId, input.path);
    const payloadHash = createHash('sha256').update(JSON.stringify([sessionId,input.path,input.args])).digest('hex');
    const where = { engagementId_requestId: { engagementId, requestId: input.requestId } };
    const previous = await this.db.c2Command.findUnique({ where });
    if (previous) { if (previous.payloadHash !== payloadHash) throw new ProjectApiError(409, 'Command identity was reused with different input'); return view(previous); }
    const owned = await provider.call({ op: 'sessions.get', engagementId, sessionId });
    if (!isC2Session(owned.session) || owned.session.id !== sessionId) throw new ProviderUnavailableError('Invalid owned session response');
    if (owned.session.isDead || Date.now()/1000 - owned.session.lastCheckin > 90) throw new ProjectApiError(409, 'Session is stale or disconnected');
    let reserved: C2Command;
    try { reserved = await this.db.c2Command.create({ data: { engagementId, sessionId, ...input, payloadHash, activeSessionId: sessionId } }); }
    catch (error) { if ((error as { code?: string }).code !== 'P2002') throw error;
      const winner = await this.db.c2Command.findUnique({ where });
      if (!winner) throw new ProjectApiError(409, 'Session has an unresolved command');
      if (winner.payloadHash !== payloadHash) throw new ProjectApiError(409, 'Command identity conflicts'); return view(winner); }
    if (this.grantGate !== undefined) {
      try { await this.grantGate(engagementId, sessionId, userId, input.path, owned.session.remoteAddress); }
      catch (gateError) {
        // W13: the provider was never invoked, so the reservation slot is
        // released and the command is finalized as failed — a refusal must not
        // leave the session holding an unresolved command forever.
        await this.db.c2Command.updateMany({ where: { id: reserved.id, status: { in: ['creating'] } }, data: { status: 'failed', activeSessionId: null } });
        throw gateError;
      }
    }
    let response: Record<string, unknown>;
    try { response = await provider.call({ op: 'sessions.execute', engagementId, sessionId, ...input }); }
    catch (error) { if (!(error instanceof ProjectApiError)) throw error;
      await this.db.c2Command.updateMany({ where: { id: reserved.id, status: { in: ['creating','uncertain'] } }, data: { status: 'uncertain' } });
      return view(await this.db.c2Command.findUniqueOrThrow({ where: { id: reserved.id } })); }
    if (this.grantGate !== undefined) {
      try { await this.grantGate(engagementId, sessionId, userId, input.path, owned.session.remoteAddress); }
      catch (gateError) {
        await this.observe(reserved, response).catch(() => undefined);
        throw gateError;
      }
    }
    return await this.observe(reserved, response);
  }
  public async history(userId: string, engagementId: string): Promise<C2CommandView[]> {
    // W13: audit reads work without a mounted provider — the ledger is durable.
    await this.authorizeRead(userId, engagementId);
    return (await this.db.c2Command.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' }, take: 100 })).map(view);
  }
  public async reconcile(userId: string, engagementId: string, commandId: string): Promise<C2CommandView> {
    // W13: reconcile is a read path — it never dispatches new work and an
    // authorization revocation cannot hide an outcome that already happened.
    // The three grant rechecks stay on the dispatch path only.
    await this.authorizeRead(userId, engagementId);
    const row = await this.db.c2Command.findFirst({ where: { id: commandId, engagementId } });
    if (!row) throw new ProjectApiError(404, 'Owned command not found');
    if (['succeeded','failed'].includes(row.status)) return view(row);
    if (!this.provider) throw new ProviderUnavailableError(UNAVAILABLE);
    return await this.observe(row, await this.provider.call({ op: 'commands.get', engagementId, requestId: row.requestId }));
  }
  private async observe(row: C2Command, response: Record<string, unknown>): Promise<C2CommandView> {
    if (!['creating','succeeded','failed','uncertain'].includes(String(response.state))) throw new ProviderUnavailableError('Invalid command state');
    if (!['succeeded','failed'].includes(String(response.state))) {
      await this.db.c2Command.updateMany({ where: { id: row.id, status: { in: ['creating','uncertain'] } }, data: { status: response.state as string } });
      return view(await this.db.c2Command.findUniqueOrThrow({ where: { id: row.id } }));
    }
    const outcome = object(response.outcome), stdout = object(outcome.stdout), stderr = object(outcome.stderr);
    if (!Number.isSafeInteger(outcome.status) || !Number.isSafeInteger(outcome.pid) || typeof stdout.text !== 'string' || stdout.text.length > 196608 ||
      typeof stderr.text !== 'string' || stderr.text.length > 196608 || typeof stdout.truncated !== 'boolean' || typeof stderr.truncated !== 'boolean') throw new ProviderUnavailableError('Invalid bounded command output');
    await this.db.c2Command.updateMany({ where: { id: row.id, status: { in: ['creating','uncertain'] } }, data: { status: (outcome.status === 0 ? 'succeeded' : 'failed'), activeSessionId: null,
      exitCode: outcome.status as number, pid: outcome.pid as number, stdout: stdout.text, stderr: stderr.text, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated } });
    return view(await this.db.c2Command.findUniqueOrThrow({ where: { id: row.id } }));
  }
}
function object(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ProjectApiError(400, 'JSON object required');
  return body as Record<string, unknown>;
}
function command(body: unknown): { requestId: string; path: string; args: string[] } {
  const input = object(body);
  if (Object.keys(input).some(k => !['requestId','path','args'].includes(k)) || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId) ||
    typeof input.path !== 'string' || !/^(?:\/|[A-Za-z]:\\)[\x20-\x7e]{1,511}$/.test(input.path) || !Array.isArray(input.args) || input.args.length > 16 ||
    !input.args.every(arg => typeof arg === 'string' && arg.length <= 512 && !/[\x00\r\n]/.test(arg))) throw new ProjectApiError(400, 'Command requires requestId, absolute binary path and bounded args array');
  return { requestId: input.requestId, path: input.path, args: input.args as string[] };
}
function view(row: C2Command): C2CommandView {
  return { id: row.id, engagementId: row.engagementId, sessionId: row.sessionId, requestId: row.requestId, path: row.path, args: row.args as string[],
    status: row.status as C2CommandView['status'], exitCode: row.exitCode, pid: row.pid, stdout: row.stdout, stderr: row.stderr,
    stdoutTruncated: row.stdoutTruncated, stderrTruncated: row.stderrTruncated, createdAt: row.createdAt.toISOString() };
}
