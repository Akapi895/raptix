import { isEnvironmentCommandRequest, type EnvironmentCommandResult, type EnvironmentStateView } from '@raptix/web-contracts';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { ProjectApiError } from '../projects-service.js';
import type { EnvironmentLifecycle } from './environment-lifecycle.js';
import type { ProjectEnvironmentService } from './project-environment-service.js';

export interface FacadeOptions {
  /** Receives a lifecycle failure that happened after the answer was sent. Defaults to silence. */
  onLifecycleError?: (error: unknown) => void;
}

/**
 * The one entry point for project lifecycle from the Web UI and the CLI (ADR-0092 §1.2). A decided activate or stop
 * is carried through the host controller here, so no client can reserve the slot without the work that follows it.
 * The work runs in the background, because bringing a runtime up takes minutes. Clients read the phase, which is
 * `starting` or `stopping` while it runs, and poll the state until it settles.
 */
export class EnvironmentFacade {
  private readonly running = new Set<string>();

  public constructor(
    private readonly service: ProjectEnvironmentService,
    private readonly lifecycle?: EnvironmentLifecycle,
    private readonly options: FacadeOptions = {},
  ) {}

  public state(userId: string, engagementId: string): Promise<EnvironmentStateView> {
    return this.service.state(userId, engagementId);
  }

  /**
   * A decided answer is data with its status, including busy, stale and refused. Only malformed, unauthorized or
   * unconfigured requests are errors, so a client can always read the reason the slot gave.
   */
  public async command(userId: string, engagementId: string, input: unknown): Promise<EnvironmentCommandResult> {
    if (!isEnvironmentCommandRequest(input)) throw new ProjectPolicyError('bad_request', 'Invalid environment command');
    const lifecycle = this.lifecycle;
    if (lifecycle === undefined) throw new ProjectApiError(503, 'The environment controller is not configured on this deployment.');
    const decided = await this.service.submit(userId, engagementId, input);
    if (decided.status === 'accepted' && input.action === 'activate' && decided.phase === 'starting') {
      this.inBackground(decided.commandId!, () => lifecycle.bringUp(engagementId, decided.commandId!, decided.version));
    } else if (decided.status === 'accepted' && input.action === 'stop' && decided.phase === 'stopping') {
      this.inBackground(decided.commandId!, () => lifecycle.shutDown(engagementId, decided.commandId!, decided.version));
    }
    return decided;
  }

  /**
   * One run per command. A repeated activate or stop reports the command that is already running, so it must not
   * start a second run against the same containers.
   */
  private inBackground(commandId: string, work: () => Promise<unknown>): void {
    if (this.running.has(commandId)) return;
    this.running.add(commandId);
    work()
      .catch(error => this.options.onLifecycleError?.(error))
      .finally(() => this.running.delete(commandId));
  }
}
