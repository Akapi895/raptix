import { mkdir, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { isProjectSlug, ProjectPolicyError } from './project-policy.js';

/** Lazily-created planning root inside every engagement workspace dir. */
export const WORKSPACE_PLAN_SUBDIR = 'plan';

async function safeRealpath(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

function assertInsideRoot(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new ProjectPolicyError(
      'bad_request',
      'Resolved workspace path escapes the workspace root',
      { field: 'slug' },
    );
  }
}

/**
 * Resolve the on-disk engagement directory for a workspace slug: lexical
 * containment under the API-side workspace root first, then realpath
 * containment of the nearest existing ancestor so symlinked/junctioned dirs
 * cannot point outside. Checks compare against the canonical root, so a
 * symlinked workspace root itself stays trusted.
 */
export async function resolveEngagementWorkspaceDir(workspaceRoot: string, slug: string): Promise<string> {
  if (!isProjectSlug(slug)) {
    throw new ProjectPolicyError(
      'bad_request',
      'Invalid workspace slug — must be a project slug, not a path',
      { field: 'slug' },
    );
  }
  const root = path.resolve(workspaceRoot);
  const dir = path.resolve(root, slug);
  assertInsideRoot(root, dir);
  const realRoot = (await safeRealpath(root)) ?? root;
  let probe = dir;
  for (;;) {
    const realProbe = await safeRealpath(probe);
    if (realProbe !== null) {
      assertInsideRoot(realRoot, realProbe);
      break;
    }
    if (probe === root) break;
    probe = path.dirname(probe);
  }
  return dir;
}

/** Existing plan link containment: a symlink/junction must stay in the canonical root. */
async function assertPlanInsideRoot(realRoot: string, planDir: string): Promise<void> {
  const real = await safeRealpath(planDir);
  if (real !== null) assertInsideRoot(realRoot, real);
}

/**
 * Create (idempotently) the planning directory for an engagement workspace.
 * Before- and after-mkdir containment checks mean an existing or swapped plan
 * symlink/junction can never yield an unsafe plan root; a dangling link fails
 * closed on realpath/mkdir. Takes a slug, never an absolute browser path.
 */
export async function prepareEngagementPlanDir(workspaceRoot: string, slug: string): Promise<string> {
  const dir = await resolveEngagementWorkspaceDir(workspaceRoot, slug);
  const root = path.resolve(workspaceRoot);
  const realRoot = (await safeRealpath(root)) ?? root;
  const planDir = path.join(dir, WORKSPACE_PLAN_SUBDIR);
  await assertPlanInsideRoot(realRoot, planDir);
  await mkdir(planDir, { recursive: true });
  await assertPlanInsideRoot(realRoot, planDir);
  return planDir;
}
