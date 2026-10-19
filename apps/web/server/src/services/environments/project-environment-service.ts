import { createHash } from 'node:crypto';
import {
  isEnvironmentCommandRequest,
  type EnvironmentStateView,
  type DeploymentSlotPhase,
  type EnvironmentCommandAction,
  type EnvironmentCommandResult,
  type EnvironmentCommandStatus,
} from '@raptix/web-contracts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { requestFingerprint } from '../../security/request-fingerprint.js';
import { requireProjectAccess, type ExecutionAdmission } from '../runtime-ownership.js';

type Tx = Prisma.TransactionClient;
type Observation = 'ready' | 'stopped' | 'uncertain' | 'undrained';

/**
 * The only runtime endpoint a ready environment may record: the runtime container name the host
 * controller derives from the deployment and environment ids (apps/launcher/internal/environments).
 */
export function runtimeUrlFor(deploymentId: string, environmentId: string): string {
  const stem = createHash('sha256').update(`${deploymentId}\0${environmentId}`).digest('hex').slice(0, 12);
  return `http://raptix-env-${stem}-runtime:2024`;
}

interface SlotRow {
  phase: DeploymentSlotPhase;
  ownerEngagementId: string | null;
  commandId: string | null;
  version: number;
}

interface Decision {
  status: EnvironmentCommandStatus;
  reason?: string;
  transition?: 'reserve' | 'stop' | 'archive' | 'unarchive';
}

const conflict = (message = 'The project environment changed concurrently. Reload and retry.'): ProjectPolicyError =>
  new ProjectPolicyError('conflict', message);

// The slot row is created lazily; a missing row means idle, so existing
// deployments keep admitting work until the first environment command.
async function ensureSlot(tx: Tx, deploymentId: string): Promise<void> {
  await tx.$executeRaw`INSERT INTO "DeploymentSlot" ("deploymentId", "phase", "version", "updatedAt") VALUES (${deploymentId}, 'idle', 0, CURRENT_TIMESTAMP) ON CONFLICT ("deploymentId") DO NOTHING`;
}

// The row is created by ensureSlot in the same transaction, so a missing row here is a bug, not a state.
async function firstSlot(rows: SlotRow[]): Promise<SlotRow> {
  const row = rows[0];
  if (row === undefined) throw conflict();
  return row;
}

async function lockSlotForUpdate(tx: Tx, deploymentId: string): Promise<SlotRow> {
  return firstSlot(await tx.$queryRaw<SlotRow[]>`SELECT "phase", "ownerEngagementId", "commandId", "version" FROM "DeploymentSlot" WHERE "deploymentId" = ${deploymentId} FOR UPDATE`);
}

async function lockSlotForShare(tx: Tx, deploymentId: string): Promise<SlotRow> {
  return firstSlot(await tx.$queryRaw<SlotRow[]>`SELECT "phase", "ownerEngagementId", "commandId", "version" FROM "DeploymentSlot" WHERE "deploymentId" = ${deploymentId} FOR SHARE`);
}

// Compare-and-set on the version: a concurrent writer that slipped past the
// row lock still cannot move the slot twice.
async function writeSlot(
  tx: Tx,
  deploymentId: string,
  expectedVersion: number,
  data: { phase: DeploymentSlotPhase; ownerEngagementId: string | null; commandId: string | null },
): Promise<number> {
  const changed = await tx.deploymentSlot.updateMany({ where: { deploymentId, version: expectedVersion }, data: { ...data, version: expectedVersion + 1 } });
  if (changed.count !== 1) throw conflict();
  return expectedVersion + 1;
}

function view(status: EnvironmentCommandStatus, slot: SlotRow, engagementId: string | null, commandId: string | null, reason?: string): EnvironmentCommandResult {
  // Naming the active project is allowed only to the project's own caller.
  const own = engagementId !== null && slot.ownerEngagementId === engagementId;
  return {
    status,
    phase: slot.phase,
    version: slot.version,
    commandId,
    ...(own ? { activeEngagementId: slot.ownerEngagementId } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
}

function decide(slot: SlotRow, engagementId: string, action: EnvironmentCommandAction, expectedVersion: number): Decision {
  if (expectedVersion !== slot.version) return { status: 'stale', reason: 'stale_version' };
  const own = slot.ownerEngagementId === engagementId;
  if (action === 'activate') {
    if (slot.phase === 'idle') return { status: 'accepted', transition: 'reserve' };
    if (!own) return { status: 'busy', reason: 'slot_held' };
    if (slot.phase === 'starting' || slot.phase === 'ready') return { status: 'accepted' };
    return { status: 'refused', reason: 'uncertain' };
  }
  if (own && (slot.phase === 'starting' || slot.phase === 'ready' || slot.phase === 'uncertain')) return { status: 'accepted', transition: 'stop' };
  if (own && slot.phase === 'stopping') return { status: 'accepted' };
  return { status: 'refused', reason: 'not_active' };
}

/**
 * Archive, unarchive, and the activate refusal for an archived project. Archive is refused while the project's own
 * environment is held or not stopped, so its containers are never left behind a flag.
 */
function decideLifecycle(slot: SlotRow, engagementId: string, action: EnvironmentCommandAction, expectedVersion: number, row: { archivedAt: Date | null; observedState: string } | null): Decision {
  if (expectedVersion !== slot.version) return { status: 'stale', reason: 'stale_version' };
  if (action === 'archive') {
    if (slot.ownerEngagementId === engagementId && slot.phase !== 'idle') return { status: 'refused', reason: 'held' };
    if (row !== null && ['starting', 'ready', 'stopping', 'uncertain'].includes(row.observedState)) return { status: 'refused', reason: 'not_stopped' };
    return { status: 'accepted', transition: 'archive' };
  }
  if (action === 'unarchive') return { status: 'accepted', transition: 'unarchive' };
  if (action === 'activate' && row?.archivedAt) return { status: 'refused', reason: 'archived' };
  return decide(slot, engagementId, action, expectedVersion);
}

export class ProjectEnvironmentService implements ExecutionAdmission {
  public constructor(private readonly db: PrismaClient, private readonly deploymentId: string) {}

  private async transaction<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(action); }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict();
      throw error;
    }
  }

  /**
   * Activate or stop one project. A decided answer, including a refusal, is
   * committed and recorded so the same requestId replays it. Only a payload
   * mismatch throws.
   */
  public async submit(userId: string, engagementId: string, input: unknown): Promise<EnvironmentCommandResult> {
    if (!isEnvironmentCommandRequest(input)) throw new ProjectPolicyError('bad_request', 'Invalid environment command');
    const { requestId, action, expectedVersion } = input;
    const fingerprint = requestFingerprint({ actorUserId: userId, engagementId, action, expectedVersion });
    return this.transaction(async tx => {
      await requireProjectAccess(tx, userId, engagementId, 'operator');
      await ensureSlot(tx, this.deploymentId);
      const slot = await lockSlotForUpdate(tx, this.deploymentId);
      const existing = await tx.environmentCommand.findUnique({ where: { deploymentId_requestId: { deploymentId: this.deploymentId, requestId } } });
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) throw conflict('This request id was already used for a different command.');
        return view('replayed', slot, engagementId, existing.id, existing.reason ?? undefined);
      }
      const row = await tx.projectEnvironment.findUnique({ where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId } }, select: { archivedAt: true, observedState: true } });
      const decision = decideLifecycle(slot, engagementId, action, expectedVersion, row);
      const outcome = decision.status === 'accepted' ? 'accepted' : 'refused';
      const command = await tx.environmentCommand.create({
        data: { deploymentId: this.deploymentId, requestId, engagementId, actorUserId: userId, action, expectedVersion, payloadFingerprint: fingerprint, outcome, reason: decision.reason ?? null },
      });
      if (decision.transition === 'archive' || decision.transition === 'unarchive') {
        const archivedAt = decision.transition === 'archive' ? new Date() : null;
        await tx.projectEnvironment.upsert({
          where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId } },
          create: { deploymentId: this.deploymentId, engagementId, desiredState: 'stopped', archivedAt },
          update: { archivedAt },
        });
        return view('accepted', slot, engagementId, command.id);
      }
      if (decision.transition === 'reserve') {
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'starting', ownerEngagementId: engagementId, commandId: command.id });
        await tx.projectEnvironment.upsert({
          where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId } },
          create: { deploymentId: this.deploymentId, engagementId, desiredState: 'ready', observedState: 'starting' },
          update: { desiredState: 'ready', observedState: 'starting' },
        });
        return view('accepted', { phase: 'starting', ownerEngagementId: engagementId, commandId: command.id, version }, engagementId, command.id);
      }
      if (decision.transition === 'stop') {
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'stopping', ownerEngagementId: slot.ownerEngagementId, commandId: command.id });
        await tx.projectEnvironment.updateMany({ where: { deploymentId: this.deploymentId, engagementId }, data: { desiredState: 'stopped', observedState: 'stopping' } });
        return view('accepted', { phase: 'stopping', ownerEngagementId: slot.ownerEngagementId, commandId: command.id, version }, engagementId, command.id);
      }
      if (outcome === 'accepted') return view('accepted', slot, engagementId, slot.commandId);
      return view(decision.status, slot, engagementId, command.id, decision.reason);
    });
  }

  /**
   * What one caller may see of a project's environment. The slot is shared, so another project appears only as
   * `held`, and its id is never returned.
   */
  public async state(userId: string, engagementId: string): Promise<EnvironmentStateView> {
    return this.transaction(async tx => {
      await requireProjectAccess(tx, userId, engagementId, 'viewer');
      await ensureSlot(tx, this.deploymentId);
      const slot = await lockSlotForShare(tx, this.deploymentId);
      const row = await tx.projectEnvironment.findUnique({
        where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId } },
        select: { observedState: true, desiredState: true, generation: true, observedAt: true, archivedAt: true, lastError: true },
      });
      const own = slot.ownerEngagementId === engagementId;
      return {
        engagementId,
        environment: row === null
          ? { observedState: 'unprovisioned', desiredState: 'stopped', generation: 0, observedAt: null, archived: false, lastError: null }
          : { observedState: row.observedState, desiredState: row.desiredState, generation: row.generation, observedAt: row.observedAt?.toISOString() ?? null, archived: row.archivedAt !== null, lastError: row.lastError },
        slot: { phase: slot.phase, version: slot.version, held: slot.phase !== 'idle', ownedByThisProject: own, activeEngagementId: own ? engagementId : null },
      };
    });
  }

  /**
   * Controller observation of the active environment. Internal: it is not
   * exposed to a browser, CLI or model. The slot is released only by an
   * observed `stopped`; elapsed time never releases it.
   */
  public async observe(input: { commandId: string; expectedVersion: number; observation: Observation; runtimeUrl?: string; generation?: number; reason?: string }): Promise<EnvironmentCommandResult> {
    return this.transaction(async tx => {
      await ensureSlot(tx, this.deploymentId);
      const slot = await lockSlotForUpdate(tx, this.deploymentId);
      if (input.expectedVersion !== slot.version) return view('stale', slot, null, null, 'stale_version');
      if (slot.commandId === null || slot.commandId !== input.commandId) return view('stale', slot, null, null, 'stale_command');
      const owner = slot.ownerEngagementId;
      if (owner === null) return view('refused', slot, null, input.commandId, 'invalid_transition');
      const from = slot.phase;
      if (input.observation === 'ready' && (from === 'starting' || from === 'uncertain')) {
        const row = await tx.projectEnvironment.findUniqueOrThrow({ where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId: owner } } });
        if (input.runtimeUrl !== runtimeUrlFor(this.deploymentId, row.id)) return view('refused', slot, null, slot.commandId, 'invalid_endpoint');
        // The generation names the container incarnation the endpoint belongs to. It is recorded as given, not counted.
        if (input.generation === undefined || !Number.isSafeInteger(input.generation) || input.generation < 1) return view('refused', slot, null, slot.commandId, 'invalid_generation');
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'ready', ownerEngagementId: owner, commandId: slot.commandId });
        await tx.projectEnvironment.updateMany({ where: { deploymentId: this.deploymentId, engagementId: owner }, data: { observedState: 'ready', observedAt: new Date(), generation: input.generation, runtimeUrl: input.runtimeUrl, lastError: null } });
        await tx.environmentCommand.update({ where: { id: slot.commandId }, data: { outcome: 'observed' } });
        return view('accepted', { ...slot, phase: 'ready', version }, null, slot.commandId);
      }
      if (input.observation === 'stopped' && (from === 'starting' || from === 'stopping' || from === 'uncertain')) {
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'idle', ownerEngagementId: null, commandId: null });
        await tx.projectEnvironment.updateMany({ where: { deploymentId: this.deploymentId, engagementId: owner }, data: { observedState: 'stopped', desiredState: 'stopped', observedAt: new Date(), runtimeUrl: null, lastError: input.reason ?? null } });
        await tx.environmentCommand.update({ where: { id: slot.commandId }, data: { outcome: 'observed', reason: input.reason ?? null } });
        return view('accepted', { phase: 'idle', ownerEngagementId: null, commandId: null, version }, null, slot.commandId);
      }
      // The stop was not carried out: a run is still active, so the containers keep running and the slot returns to ready.
      if (input.observation === 'undrained' && from === 'stopping') {
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'ready', ownerEngagementId: owner, commandId: slot.commandId });
        await tx.projectEnvironment.updateMany({ where: { deploymentId: this.deploymentId, engagementId: owner }, data: { observedState: 'ready', desiredState: 'ready', observedAt: new Date(), lastError: input.reason ?? 'undrained' } });
        await tx.environmentCommand.update({ where: { id: slot.commandId }, data: { outcome: 'refused', reason: input.reason ?? 'undrained' } });
        return view('accepted', { ...slot, phase: 'ready', version }, null, slot.commandId);
      }
      if (input.observation === 'uncertain' && (from === 'starting' || from === 'ready' || from === 'stopping')) {
        const version = await writeSlot(tx, this.deploymentId, slot.version, { phase: 'uncertain', ownerEngagementId: owner, commandId: slot.commandId });
        await tx.projectEnvironment.updateMany({ where: { deploymentId: this.deploymentId, engagementId: owner }, data: { observedState: 'uncertain', observedAt: new Date(), lastError: input.reason ?? null } });
        await tx.environmentCommand.update({ where: { id: slot.commandId }, data: { outcome: 'uncertain', reason: input.reason ?? null } });
        return view('accepted', { ...slot, phase: 'uncertain', version }, null, slot.commandId);
      }
      return view('refused', slot, null, input.commandId, 'invalid_transition');
    });
  }

  /**
   * Called inside the run-reserving transaction. A deployment with no slot
   * row or an idle slot admits. Otherwise only the owner's ready environment
   * admits, and the refusal never names the other project.
   */
  public async assertAdmits(tx: Tx, engagementId: string): Promise<void> {
    await ensureSlot(tx, this.deploymentId);
    const slot = await lockSlotForShare(tx, this.deploymentId);
    if (slot.phase !== 'idle' && !(slot.ownerEngagementId === engagementId && slot.phase === 'ready')) {
      throw new ProjectPolicyError('conflict', slot.ownerEngagementId === engagementId
        ? 'The project environment is not ready for execution.'
        : 'Another project environment is active on this deployment.');
    }
    // A managed project whose environment is stopped starts no run, even while the slot is free. Refusing here keeps
    // the ledger from recording a run the routed runtime cannot take.
    const row = await tx.projectEnvironment.findUnique({
      where: { deploymentId_engagementId: { deploymentId: this.deploymentId, engagementId } },
      select: { observedState: true, archivedAt: true },
    });
    if (row !== null && row.archivedAt !== null) throw new ProjectPolicyError('conflict', 'The project is archived. Unarchive it to run.');
    if (row !== null && row.observedState !== 'ready') {
      throw new ProjectPolicyError('conflict', 'The project environment is not running. Activate it to start a run.');
    }
  }
}
