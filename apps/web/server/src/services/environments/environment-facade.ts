import { isEnvironmentCommandRequest, type EnvironmentCommandResult, type EnvironmentStateView } from '@raptix/web-contracts';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { ProjectApiError } from '../projects-service.js';
import type { EnvironmentLifecycle } from './environment-lifecycle.js';
import type { ProjectEnvironmentService } from './project-environment-service.js';

/**
 * The one entry point for project lifecycle from the Web UI and the CLI (ADR-0092 §1.2). A decided activate or
 * stop is carried through the host controller here, so no client can reserve the slot without the work that
 * follows it.
 */
export class EnvironmentFacade {
  public constructor(private readonly service: ProjectEnvironmentService, private readonly lifecycle?: EnvironmentLifecycle) {}

  public state(userId: string, engagementId: string): Promise<EnvironmentStateView> {
    return this.service.state(userId, engagementId);
  }

  /** Busy, stale and refused answers are 409 with their reason. Accepted and replayed answers are 200. */
  public async command(userId: string, engagementId: string, input: unknown): Promise<{ statusCode: number; result: EnvironmentCommandResult }> {
    if (!isEnvironmentCommandRequest(input)) throw new ProjectPolicyError('bad_request', 'Invalid environment command');
    if (this.lifecycle === undefined) throw new ProjectApiError(503, 'The environment controller is not configured on this deployment.');
    const decided = await this.service.submit(userId, engagementId, input);
    let result = decided;
    if (decided.status === 'accepted' && input.action === 'activate' && decided.phase === 'starting') {
      result = await this.lifecycle.bringUp(engagementId, decided.commandId!, decided.version);
    } else if (decided.status === 'accepted' && input.action === 'stop' && decided.phase === 'stopping') {
      result = await this.lifecycle.shutDown(engagementId, decided.commandId!, decided.version);
    }
    const refused = result.status === 'busy' || result.status === 'stale' || result.status === 'refused';
    return { statusCode: refused ? 409 : 200, result };
  }
}
