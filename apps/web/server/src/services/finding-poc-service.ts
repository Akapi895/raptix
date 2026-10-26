import type { PrismaClient } from '../generated/prisma/client.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';
import { ProjectApiError } from './projects-service.js';
import { sandboxTokenFor, sandboxUrlFor } from './runtime/sandbox-routing.js';

/**
 * The sealed Proof of Concept of a workspace finding, read from the project sandbox by the runtime (ADR-0104). The shapes
 * mirror `read_sealed_poc` and `reproduce_sealed` in the runtime.
 */
export interface SealedPocView {
  finding_id: string;
  status: string;
  refusal?: string;
  file?: string;
  command?: string;
  negative_command?: string;
  success_patterns?: string[];
  negative_patterns?: string[];
  cvss_vector?: string;
  run_time_value?: boolean;
}

export interface ReproductionOutput {
  exit_code: number;
  matched_patterns: string[];
  output: string;
}

export interface ReproductionView {
  finding_id: string;
  outcome: 'ran' | 'refused';
  reproduced?: boolean;
  refusal?: string;
  command?: string;
  negative_command?: string;
  positive?: ReproductionOutput;
  negative?: ReproductionOutput;
  recorded_at?: string;
}

const WORKSPACE_FINDING_REF = /^FIND-\d{3}$/;
/** Two bounded sandbox runs, each up to 60 seconds, plus the gates. */
const RUNTIME_TIMEOUT_MS = 180_000;

export interface FindingPocServiceOptions {
  readonly db: PrismaClient;
  readonly runtimeApiUrl: string;
  readonly runtimeApiToken: string;
  readonly sandboxKey: string;
  /** Reproduction needs the project's own sandbox (ADR-0102); a shared sandbox is refused. */
  readonly perProjectSandbox: boolean;
}

export class FindingPocService {
  constructor(private readonly options: FindingPocServiceOptions) {}

  /** The sealed PoC as the runtime reads it. Viewers may read it; reading changes nothing. */
  async read(actorId: string, engagementId: string, ref: string): Promise<SealedPocView> {
    const sandbox = await this.sandboxFor(actorId, engagementId, ref, 'viewer');
    return this.call<SealedPocView>(`/_raptix/findings/${ref}/poc`, { sandbox_url: sandbox.url, sandbox_token: sandbox.token });
  }

  /**
   * Reproduce the sealed PoC once with the value the operator entered for this run. The value is passed to the runtime
   * and to nothing else: it is not stored and not written to the audit entry.
   */
  async reproduce(actorId: string, engagementId: string, ref: string, input: { token?: unknown }): Promise<ReproductionView> {
    const sandbox = await this.sandboxFor(actorId, engagementId, ref, 'operator');
    await assertEngagementOpen(this.options.db, engagementId);
    const token = typeof input.token === 'string' ? input.token : undefined;
    const result = await this.call<ReproductionView>(`/_raptix/findings/${ref}/reproduce`, {
      sandbox_url: sandbox.url,
      sandbox_token: sandbox.token,
      ...(token === undefined ? {} : { token }),
    });
    const reason = result.outcome === 'ran' ? `reproduced=${result.reproduced === true}` : `refused: ${result.refusal ?? 'unknown'}`;
    await this.options.db.webAuditEntry.create({
      data: { engagementId, actorId, action: 'finding.poc_reproduced', targetType: 'workspace_finding', targetId: ref, reason: reason.slice(0, 500) },
    });
    return result;
  }

  private async sandboxFor(actorId: string, engagementId: string, ref: string, minRole: 'viewer' | 'operator'): Promise<{ url: string; token: string }> {
    if (!WORKSPACE_FINDING_REF.test(ref)) throw new ProjectApiError(400, 'The finding reference must look like FIND-001.');
    await requireEngagementAccess({ db: this.options.db, actorId, multiUser: true }, engagementId, minRole);
    if (!this.options.perProjectSandbox) throw new ProjectApiError(409, 'A sealed PoC runs only in the project’s own sandbox, and this deployment has none.');
    const engagement = await this.options.db.engagement.findFirst({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (engagement === null) throw new ProjectApiError(404, 'Project not found');
    return { url: sandboxUrlFor(engagement.workspaceSlug), token: sandboxTokenFor(this.options.sandboxKey, engagement.workspaceSlug) };
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.options.runtimeApiUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.runtimeApiToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
      });
    } catch {
      throw new ProjectApiError(503, 'The runtime did not answer. Check that it is running.');
    }
    if (response.status === 503) throw new ProjectApiError(503, 'The project sandbox is not reachable, so the PoC cannot be read or run.');
    if (!response.ok) throw new ProjectApiError(502, `The runtime refused the PoC request (${response.status}).`);
    return (await response.json()) as T;
  }
}
