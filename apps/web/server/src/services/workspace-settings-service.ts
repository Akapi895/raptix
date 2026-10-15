import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';

/**
 * Ticket 16: versioned workspace-level settings. The supported-key registry
 * is closed and states its actual consumer: `policy.c2_grant_max_hours`
 * propagates to every C2 grant request validation and to the grants view;
 * retention is configuration-only because this deployment runs no scheduled
 * enforcement — that absence is disclosed, never simulated. A browser
 * authority commit cannot change these values: writes are owner-role-only
 * (engagement owners are the deployment operators), optimistic through
 * `expectedVersion` and audited as consequential workspace actions.
 */

export interface WorkspaceSettingSpec {
  readonly key: string;
  readonly kind: 'policy' | 'retention';
  readonly valueType: 'number';
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  /** The consuming subsystem, or null when nothing consumes the value yet. */
  readonly consumer: string | null;
  readonly enforcement: string;
  readonly description: string;
}

export const WORKSPACE_SETTING_SPECS: readonly WorkspaceSettingSpec[] = [
  {
    key: 'policy.c2_grant_max_hours',
    kind: 'policy',
    valueType: 'number',
    min: 1,
    max: 720,
    defaultValue: 24,
    consumer: 'c2-grants',
    enforcement: 'Enforced by the C2 grants service on every grant request and surfaced by the grants view.',
    description: 'Maximum C2 session grant window in hours.',
  },
  {
    key: 'retention.audit_retention_days',
    kind: 'retention',
    valueType: 'number',
    min: 30,
    max: 3650,
    defaultValue: 365,
    consumer: null,
    enforcement: 'Configuration only: this deployment has no scheduled retention enforcement; no deletion under policy is performed or simulated.',
    description: 'Intended web audit retention in days, recorded for deployments that run their own enforcement.',
  },
];

const SPEC_BY_KEY = new Map(WORKSPACE_SETTING_SPECS.map((s) => [s.key, s]));

export interface WorkspaceSettingView {
  readonly key: string;
  readonly kind: string;
  readonly value: number;
  readonly version: number;
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
  readonly consumer: string | null;
  readonly enforcement: string;
  readonly description: string;
}

export interface WorkspaceSettingsView {
  readonly settings: readonly WorkspaceSettingView[];
  readonly source: 'db';
}

export class WorkspaceSettingsService {
  public constructor(private readonly db: PrismaClient, private readonly multiUser: boolean) {}

  /** Any authenticated actor may read workspace configuration. */
  public async list(_actorId: string): Promise<WorkspaceSettingsView> {
    const rows = await this.db.workspaceSetting.findMany();
    const byKey = new Map(rows.map((r) => [String(r.key), r as unknown as { key: string; value: unknown; version: number; updatedBy: string | null; updatedAt: Date }]));
    const settings = WORKSPACE_SETTING_SPECS.map((spec) => {
      const row = byKey.get(spec.key);
      const value = row !== undefined && this.validValue(spec, row.value) ? (row.value as number) : spec.defaultValue;
      return {
        key: spec.key,
        kind: spec.kind,
        value,
        version: row !== undefined ? Number(row.version) : 1,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
        consumer: spec.consumer,
        enforcement: spec.enforcement,
        description: spec.description,
      };
    });
    return { settings, source: 'db' };
  }

  /** Only an authoritatively absent setting uses the default policy. */
  public async maxGrantHours(): Promise<number> {
    const spec = SPEC_BY_KEY.get('policy.c2_grant_max_hours')!;
    try {
      const row = await this.db.workspaceSetting.findFirst({ where: { key: spec.key } });
      if (row === null) return spec.defaultValue;
      if (this.validValue(spec, row.value)) return row.value;
      throw new ProjectApiError(503, 'The C2 grant policy is invalid; grant creation is unavailable.');
    } catch (error) {
      if (error instanceof ProjectApiError) throw error;
      throw new ProjectApiError(503, 'The C2 grant policy could not be read; grant creation is unavailable.');
    }
  }

  public async put(actorId: string, key: string, input: unknown): Promise<WorkspaceSettingView> {
    const spec = SPEC_BY_KEY.get(key);
    if (spec === undefined) {
      throw new ProjectApiError(404, `Unsupported workspace setting key: ${key}. Supported keys: ${WORKSPACE_SETTING_SPECS.map((s) => s.key).join(', ')}.`);
    }
    await this.requireWorkspaceAdmin(actorId);
    const body = (input ?? {}) as { value?: unknown; expectedVersion?: unknown; reason?: unknown };
    if (!this.validValue(spec, body.value)) {
      throw new ProjectApiError(400, `value must be an integer between ${spec.min} and ${spec.max}.`);
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) throw new ProjectApiError(400, 'A reason is required for a workspace settings change.');
    const expectedVersion = typeof body.expectedVersion === 'number' && Number.isInteger(body.expectedVersion) && body.expectedVersion >= 1 ? body.expectedVersion : Number.NaN;
    if (Number.isNaN(expectedVersion)) throw new ProjectApiError(400, 'expectedVersion (a positive integer) is required for a conflict-safe write.');
    const row = await this.db.workspaceSetting.findFirst({ where: { key } }) as unknown as { value: unknown; version: number; updatedBy: string | null; updatedAt: Date } | null;
    if (row === null) {
      if (expectedVersion !== 1) throw new ProjectApiError(409, `Version conflict: ${key} is at the default (version 1), not version ${expectedVersion}.`);
      const created = await this.db.workspaceSetting.create({
        data: { key, value: body.value as number, version: 2, updatedBy: actorId },
      }) as unknown as { value: unknown; version: number; updatedBy: string | null; updatedAt: Date };
      await this.audit(actorId, key, `default (${spec.defaultValue}) -> ${String(body.value)}; ${reason}`);
      return this.toView(spec, created);
    }
    if (Number(row.version) !== expectedVersion) {
      throw new ProjectApiError(409, `Version conflict: ${key} is at version ${row.version}, not ${expectedVersion}. Reload and retry.`);
    }
    await this.db.workspaceSetting.update({ where: { key, version: expectedVersion }, data: { value: body.value as number, version: expectedVersion + 1, updatedBy: actorId } });
    await this.audit(actorId, key, `v${expectedVersion} -> v${expectedVersion + 1}; ${reason}`);
    const updated = await this.db.workspaceSetting.findFirst({ where: { key } }) as unknown as { value: unknown; version: number; updatedBy: string | null; updatedAt: Date };
    return this.toView(spec, updated);
  }

  private toView(spec: WorkspaceSettingSpec, row: { value: unknown; version: number; updatedBy: string | null; updatedAt: Date }): WorkspaceSettingView {
    return {
      key: spec.key,
      kind: spec.kind,
      value: this.validValue(spec, row.value) ? (row.value as number) : spec.defaultValue,
      version: Number(row.version),
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
      consumer: spec.consumer,
      enforcement: spec.enforcement,
      description: spec.description,
    };
  }

  private validValue(spec: WorkspaceSettingSpec, value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max;
  }

  /** Workspace writes need a deployment operator: engagement owners in multi-user mode, the local operator otherwise. */
  private async requireWorkspaceAdmin(actorId: string): Promise<void> {
    if (!this.multiUser) return;
    const owned = await this.db.engagement.findFirst({ where: { userId: actorId }, select: { id: true } });
    if (owned !== null) return;
    const membership = await this.db.webMembership.findFirst({ where: { userId: actorId, role: 'owner' } });
    if (membership === null) {
      throw new ProjectApiError(403, 'Workspace settings changes require a deployment operator (an engagement owner); your memberships do not grant it.');
    }
  }

  private async audit(actorId: string, key: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId: null, actorId, action: 'workspace.setting_updated', targetType: 'workspace_setting', targetId: key, reason } });
  }
}
