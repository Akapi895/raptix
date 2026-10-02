import type { FastifyInstance } from 'fastify';
import { probeDatabase } from './health.routes.js';
import type { DatabaseHealth } from './health.routes.js';
import type { RuntimeContextService } from '../../services/runtime/runtime-context.js';

export const CAPABILITIES_VERSION = 1;

export type CapabilityMode = 'local-single-user';

export type CapabilityState =
  | {
      readonly supported: false;
      readonly available: false;
      readonly reason: 'service_missing';
    }
  | {
      readonly supported: true;
      readonly available: false;
      readonly reason: 'database_unavailable' | 'runtime_unavailable';
    }
  | { readonly supported: true; readonly available: true };

export interface CapabilitiesResponse {
  readonly version: number;
  readonly mode: CapabilityMode;
  readonly capabilities: {
    readonly agents: CapabilityState;
    readonly projects: CapabilityState;
    readonly planning: CapabilityState;
    readonly threads: CapabilityState;
    readonly runs: CapabilityState;
    readonly approvals: CapabilityState;
    readonly artifacts: CapabilityState;
    readonly findings: CapabilityState;
    readonly graphs: CapabilityState;
    readonly reports: CapabilityState;
  };
}

function missingCapability(): CapabilityState {
  return { supported: false, available: false, reason: 'service_missing' };
}

/**
 * Truthful capability document:
 * - `supported` reflects an actually implemented route/service (injected
 *   projects service), never frontend presence.
 * - `available` requires the injected database health probe to pass when one
 *   is provided; without a probe (in-memory/bootstrap tests or no DATABASE_URL
 *   service configured) an implemented capability is available.
 * Runtime/graph/report capabilities stay service_missing until their own
 * work packages integrate.
 */
export async function buildCapabilitiesResponse(
  projectsSupported: boolean,
  databaseHealth?: DatabaseHealth,
  runtimeContext?: RuntimeContextService,
  runsSupported = false,
  approvalsSupported = false,
): Promise<CapabilitiesResponse> {
  let projects: CapabilityState;
  if (!projectsSupported) {
    projects = missingCapability();
  } else if (databaseHealth) {
    projects =
      (await probeDatabase(databaseHealth)).status === 'ok'
        ? { supported: true, available: true }
        : {
            supported: true,
            available: false,
            reason: 'database_unavailable',
          };
  } else {
    projects = { supported: true, available: true };
  }
  let agents: CapabilityState = missingCapability();
  if (runtimeContext) {
    try { agents = (await runtimeContext.agents()).graphs.length ? { supported: true, available: true } : { supported: true, available: false, reason: 'runtime_unavailable' }; }
    catch { agents = { supported: true, available: false, reason: 'runtime_unavailable' }; }
  }
  const operations: CapabilityState = !runsSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : !agents.available ? { supported: true, available: false, reason: 'runtime_unavailable' } : { supported: true, available: true };
  // Approvals are workspace-file-backed (W11): available when the owning
  // project service is ready; decision writes share the workspace root.
  const approvals: CapabilityState = !approvalsSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  return {
    version: CAPABILITIES_VERSION,
    mode: 'local-single-user',
    capabilities: {
      agents,
      projects,
      planning: projects,
      threads: operations,
      runs: operations,
      approvals,
      artifacts: missingCapability(),
      findings: missingCapability(),
      graphs: missingCapability(),
      reports: missingCapability(),
    },
  };
}

export interface CapabilitiesRouteOptions {
  readonly projectsSupported?: boolean;
  readonly databaseHealth?: DatabaseHealth;
  readonly runtimeContext?: RuntimeContextService;
  readonly runsSupported?: boolean;
  readonly approvalsSupported?: boolean;
}

export function registerCapabilitiesRoutes(
  app: FastifyInstance,
  options: CapabilitiesRouteOptions = {},
): void {
  app.get('/api/capabilities', async () =>
    buildCapabilitiesResponse(
      options.projectsSupported === true,
      options.databaseHealth,
      options.runtimeContext,
      options.runsSupported,
      options.approvalsSupported === true,
    ),
  );
}
