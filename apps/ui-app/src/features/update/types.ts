import type { Request, Translate } from '../notifications';
import type { NotificationRuntime } from '../../platform/notification-browser';

// internal/update/{update,apply,adopt}.go and internal/handler/update.go.
// Fields are optional at the UI boundary: demo routes deliberately return sparse DTOs.
export interface UpdateChange { path: string; status: string; protected: boolean }
export interface UpdateStatus {
  root?: string; installed?: boolean; branch?: string; repo?: string; repoConfigured?: boolean;
  targetBranch?: string; commit?: string; subject?: string; committedAt?: string;
  behind?: number; ahead?: number; diverged?: boolean; updateAvailable?: boolean;
  remoteCommit?: string; remoteSubject?: string; incoming?: { commit: string; subject: string }[] | null;
  incomingTotal?: number; localChanges?: UpdateChange[] | null; blockingChanges?: UpdateChange[] | null;
  goToolchain?: string; canBuild?: boolean; hasBinary?: boolean; hasRollback?: boolean;
  rollbackTo?: string; buildPending?: boolean; rollbackPending?: boolean; checkError?: string;
}
export interface UpdateResult {
  fromCommit?: string; toCommit?: string; commits?: number; filesTouched?: number; keptContent?: string[] | null;
  overwritten?: string[] | null; adopted?: boolean; binaryPath?: string; binaryBuilt?: boolean;
  prevBinary?: string; backupDir?: string; needsRestart?: boolean; duration?: string;
}
export interface UpdateFailure { reason?: string; message?: string; items?: string[] | null }
export interface UpdateStep { phase: string; message: string; at: string }
export interface UpdateJob {
  id?: string; kind?: string; state?: string; started?: string; finished?: string;
  steps?: UpdateStep[] | null; result?: UpdateResult | null; failure?: UpdateFailure | null; restartRequested?: boolean;
}
export interface UpdateSource { repo?: string; configured?: boolean; defaultRepo?: string }
export interface AdoptPlan {
  root?: string; source?: string; branch?: string; commit?: string; subject?: string; incoming?: number;
  overwrittenTotal?: number; overwritten?: string[] | null; protectedTotal?: number; protected?: string[] | null;
}
export interface UpdateResponse {
  status?: UpdateStatus | string; job?: UpdateJob | null; canRestart?: boolean; supervised?: boolean;
  needsRestart?: boolean; binaryBuiltAt?: string; source?: UpdateSource; error?: string;
  items?: string[]; result?: UpdateResult; plan?: AdoptPlan; job_id?: string;
}
export interface UpdateConsole {
  status: UpdateStatus; job: UpdateJob | null; canRestart: boolean; supervised: boolean;
  needsRestart: boolean; binaryBuiltAt: string; source: UpdateSource;
}
export interface UpdateModel {
  console: UpdateConsole | null; check: { done: boolean; error: string }; busy: boolean; checking: boolean;
  restartChoice: boolean; restartPending: boolean; watchdog: boolean; watchdogSlow: 'running' | 'down' | null;
  sourceDraft: string | null; sourceError: string; actionError: string; adoptPlan: AdoptPlan | null;
  loading: boolean; loadError: string;
}
export interface UpdateDependencies {
  request: Request; translate: Translate; runtime: NotificationRuntime; isActive(): boolean;
  confirm(text: string): boolean; notify(text: string, type: 'success' | 'error' | 'info'): void;
  applyPermissions(root: HTMLElement): void; probe(): Promise<Response>; restarted(): void; reload(): void;
}
