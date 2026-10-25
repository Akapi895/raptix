/**
 * W19: a failure inside the project sandbox while listing artifacts is an explicit unavailability, never an empty
 * list. A folder the sandbox reports as absent (null from the port) stays an allowed empty outcome (ADR-0102).
 */
import { describe, expect, it } from 'vitest';
import { ArtifactsService } from '../src/services/artifacts-service.js';
import { ProjectFileError, type ProjectFiles } from '../src/services/project-files.js';

const db = {
  engagement: { findFirst: async () => ({ id: 'eng-1', workspaceSlug: 'w-slug' }) },
} as never;

function filesWith(list: ProjectFiles['list']): ProjectFiles {
  return {
    list,
    stat: async () => null,
    read: async () => null,
    write: async () => undefined,
    writeNew: async () => undefined,
    append: async () => undefined,
    rename: async () => undefined,
    remove: async () => undefined,
    mkdir: async () => undefined,
    exists: async () => false,
  } as unknown as ProjectFiles;
}

describe('W19 artifact listing failure semantics', () => {
  it('surfaces a sandbox failure as an explicit 503, not an empty list', async () => {
    const service = new ArtifactsService(db, filesWith(async () => { throw new ProjectFileError(); }));
    await expect(service.list('local', 'eng-1')).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringMatching(/could not/i),
    });
  });

  it('still treats a missing folder as an empty listing, not an outage', async () => {
    const service = new ArtifactsService(db, filesWith(async () => null));
    const view = await service.list('local', 'eng-1');
    expect(view.folders).toEqual([]);
  });
});
