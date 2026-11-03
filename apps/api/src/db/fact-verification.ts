/** Project-scoped review contracts. Snapshots are immutable, bounded graph projections. */
export type VerificationState = "observed" | "proposed" | "verified" | "rejected" | "stale";

export const TRANSITIONS: Record<VerificationState, readonly VerificationState[]> = {
  observed: ["proposed"], proposed: ["verified", "rejected"],
  verified: ["stale"], rejected: ["proposed"], stale: ["proposed"],
};

export interface FactEvidenceInput {
  engagement: string;
  akgObservationKind: string;
  akgObservationKey: string;
  observationId: string;
  provenanceChannel: string;
  snapshotJson: string;
  snapshotHash: string;
}

export interface FactEvidenceRecord extends FactEvidenceInput {
  id: string;
  factId: string;
  projectId: string;
  createdAt: Date;
}

export interface FactVerificationRecord {
  id: string;
  fromState: string;
  toState: string;
  actor: string;
  note: string;
  factRevision: number;
  snapshotJson: string;
  createdAt: Date;
}

export interface LinkedFinding {
  id: string;
  fact_key: string;
  summary: string;
  verification_state: string;
  observation_kind: string;
  observation_key: string;
  snapshot_hash: string;
}

export class FactConflictError extends Error {
  public readonly statusCode = 409;
  public constructor() { super("Fact changed or is not in the expected verification state"); }
}
