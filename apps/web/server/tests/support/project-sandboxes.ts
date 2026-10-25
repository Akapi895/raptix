import type { ProjectSandboxes } from '../../src/services/projects-service.js';

/**
 * Records each project sandbox a test asks for and starts nothing. Tests that are not about sandboxes use it; the
 * sandbox tests assert on `started` to show a project's container is requested before the project is persisted.
 */
export function recordingSandboxes(): ProjectSandboxes & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    async ensure(workspaceSlug: string): Promise<void> {
      started.push(workspaceSlug);
    },
  };
}
