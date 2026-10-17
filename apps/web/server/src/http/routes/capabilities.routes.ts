import type { FastifyInstance } from 'fastify';
import { probeDatabase } from './health.routes.js';
import type { DatabaseHealth } from './health.routes.js';
import type { RuntimeContextService } from '../../services/runtime/runtime-context.js';

export const CAPABILITIES_VERSION = 1;

export type CapabilityMode = 'local-single-user' | 'multi-user';

export type CapabilityState =
  | {
      readonly supported: false;
      readonly available: false;
      readonly reason: 'service_missing';
    }
  | {
      readonly supported: true;
      readonly available: false;
      readonly reason: 'database_unavailable' | 'runtime_unavailable' | 'provider_unavailable' | 'configuration_missing';
    }
  | { readonly supported: true; readonly available: true };

export interface CapabilitiesResponse {
  readonly deploymentId?: string;
  readonly version: number;
  readonly mode: CapabilityMode;
  readonly capabilities: {
    readonly agents: CapabilityState;
    readonly projects: CapabilityState;
    readonly planning: CapabilityState;
    readonly assets: CapabilityState;
    readonly threads: CapabilityState;
    readonly runs: CapabilityState;
    readonly approvals: CapabilityState;
    readonly artifacts: CapabilityState;
    readonly findings: CapabilityState;
    readonly graphs: CapabilityState;
    readonly timeline: CapabilityState;
    readonly reports: CapabilityState;
    readonly campaigns: CapabilityState;
    readonly c2: CapabilityState;
    readonly vault: CapabilityState;
    readonly members: CapabilityState;
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
  findingsSupported = false,
  artifactsSupported = false,
  graphsSupported = false,
  timelineSupported = false,
  reportsSupported = false,
  campaignsSupported = false,
  c2Supported = false,
  vaultSupported = false,
  vaultKeyConfigured = false,
  membersSupported = false,
  c2ProviderConfigured = false,
  mode: CapabilityMode = 'local-single-user',
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
  // Findings/artifacts are workspace-file-backed projections (W12) scoped by
  // owned engagement id with a tightened path boundary.
  const filesBacked: CapabilityState = !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  const findings: CapabilityState = findingsSupported ? filesBacked : missingCapability();
  const artifacts: CapabilityState = artifactsSupported ? filesBacked : missingCapability();
  // Graphs/assets are Neo4j-backed projections (W13): configured only when a
  // non-default NEO4J_PASSWORD is present; availability is decided per request
  // (503 unavailable vs 200 empty), the capability only reflects wiring.
  const graphs: CapabilityState = !graphsSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  // Timeline/logs and report export are W14: the timeline merges runtime,
  // checkpoint and workspace sources; export validates formats server-side.
  const operationsBacked: CapabilityState = !runsSupported ? missingCapability() : !operations.available ? { supported: true, available: false, reason: 'runtime_unavailable' } : { supported: true, available: true };
  const timeline: CapabilityState = !timelineSupported ? missingCapability() : !operationsBacked.available ? { supported: true, available: false, reason: operationsBacked.reason === 'database_unavailable' ? 'database_unavailable' : 'runtime_unavailable' } : { supported: true, available: true };
  const reports: CapabilityState = !reportsSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  // Campaigns are DB-backed drafts plus truthful provider jobs (W17): the
  // draft persistence is available with the projects stack, while every
  // generate/deploy job honestly reports the absent provider per request.
  const campaigns: CapabilityState = !campaignsSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  // C2 availability denotes configured service wiring. Native connectivity
  // and session ownership are checked by the scoped Sliver registry routes.
  const c2: CapabilityState = !c2Supported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : c2ProviderConfigured ? { supported: true, available: true } : { supported: true, available: false, reason: 'provider_unavailable' };
  // Vault (W18): the encrypted storage service is wired with the database,
  // but it stays unavailable until VAULT_ENCRYPTION_KEY decodes to a usable
  // AES-256 key — it never degrades to plaintext storage.
  const vault: CapabilityState = !vaultSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : !vaultKeyConfigured ? { supported: true, available: false, reason: 'configuration_missing' } : { supported: true, available: true };
  // Members (W19): the truthful local single-user members view is real;
  // invite/RBAC APIs stay absent with explicit reasons, never faked.
  const members: CapabilityState = !membersSupported ? missingCapability() : !projects.available ? { supported: true, available: false, reason: 'database_unavailable' } : { supported: true, available: true };
  return {
    version: CAPABILITIES_VERSION,
    mode,
    capabilities: {
      agents,
      projects,
      planning: projects,
      // The managed asset inventory is a DB-backed, engagement-scoped resource, so it shares the projects availability.
      assets: projects,
      threads: operations,
      runs: operations,
      approvals,
      artifacts,
      findings,
      graphs,
      timeline,
      reports,
      campaigns,
      c2,
      vault,
      members,
    },
  };
}

export interface CapabilitiesRouteOptions {
  readonly deploymentId?: string;
  readonly mode?: CapabilityMode;
  readonly projectsSupported?: boolean;
  readonly databaseHealth?: DatabaseHealth;
  readonly runtimeContext?: RuntimeContextService;
  readonly runsSupported?: boolean;
  readonly approvalsSupported?: boolean;
  readonly findingsSupported?: boolean;
  readonly artifactsSupported?: boolean;
  readonly graphsSupported?: boolean;
  readonly timelineSupported?: boolean;
  readonly reportsSupported?: boolean;
  readonly campaignsSupported?: boolean;
  readonly c2Supported?: boolean;
  readonly vaultSupported?: boolean;
  readonly vaultKeyConfigured?: boolean;
  readonly membersSupported?: boolean;
  readonly c2ProviderConfigured?: boolean;
}

export function registerCapabilitiesRoutes(
  app: FastifyInstance,
  options: CapabilitiesRouteOptions = {},
): void {
  app.get('/api/capabilities', async () => ({
    ...(options.deploymentId === undefined ? {} : { deploymentId: options.deploymentId }),
    ...await buildCapabilitiesResponse(
      options.projectsSupported === true,
      options.databaseHealth,
      options.runtimeContext,
      options.runsSupported,
      options.approvalsSupported === true,
      options.findingsSupported === true,
      options.artifactsSupported === true,
      options.graphsSupported === true,
      options.timelineSupported === true,
      options.reportsSupported === true,
      options.campaignsSupported === true,
      options.c2Supported === true,
      options.vaultSupported === true,
      options.vaultKeyConfigured === true,
      options.membersSupported === true,
      options.c2ProviderConfigured === true,
      options.mode,
    ),
  }));
}
