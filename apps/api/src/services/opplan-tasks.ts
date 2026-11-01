import type { SandboxFilesTransport } from "../adapters/sandbox/client.js";

export interface PlanTaskWire {
  id: string;
  subject: string;
  status: string;
  activeForm?: string;
  blockedBy: string[];
}

const KNOWN_STATUSES = new Set(["pending", "in_progress", "completed", "blocked", "cancelled"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Raptix's real plan is workspace/plan/opplan.json (OPPLAN objectives, ADR-0040)
 * -- a project sandbox file, never a per-conversation "todo list" tool. Its
 * `objectives[]` already carries exactly the shape apps/ui-app's Progress tab
 * wants (id, title, status, blocked_by), including a pre-computed `summary`
 * total/completed -- a direct field mapping, not an invented one.
 */
export async function readPlanTasks(
  sandbox: SandboxFilesTransport,
  workspaceSlug: string,
): Promise<{ tasks: PlanTaskWire[]; total: number; completed: number } | null> {
  const raw = await sandbox.read(workspaceSlug, "plan/opplan.json").catch(() => null);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  const root = record(parsed);
  const objectives = Array.isArray(root.objectives) ? root.objectives : [];
  const tasks: PlanTaskWire[] = objectives.map((entry) => {
    const objective = record(entry);
    const status = asString(objective.status);
    return {
      id: asString(objective.id),
      subject: asString(objective.title) || asString(objective.id),
      status: KNOWN_STATUSES.has(status) ? status : "pending",
      ...(status === "in_progress" ? { activeForm: asString(objective.description) || asString(objective.notes) } : {}),
      blockedBy: asStringArray(objective.blocked_by),
    };
  });
  const summary = record(root.summary);
  const total = typeof summary.total === "number" ? summary.total : tasks.length;
  const completed = typeof summary.completed === "number" ? summary.completed : tasks.filter((task) => task.status === "completed").length;
  return { tasks, total, completed };
}
