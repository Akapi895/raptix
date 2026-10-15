/**
 * W19: filesystem failures inside the artifact listing are an explicit
 * unavailability, never an empty list — ENOENT (folder simply absent) stays
 * an allowed empty outcome, but anything else must surface.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as FsPromises from 'node:fs/promises';

const readdir = vi.fn();

vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof FsPromises>();
  return { ...actual, readdir: (...a: unknown[]) => readdir(...a) };
});

const { ArtifactsService } = await import('../src/services/artifacts-service.js');

const db = {
  engagement: { findFirst: async () => ({ id: 'eng-1', workspaceSlug: 'w-slug' }) },
  webMembership: { findFirst: async () => null },
} as never;

describe('W19 artifact listing failure semantics', () => {
  beforeEach(() => {
    readdir.mockReset();
  });

  it('surfaces a filesystem error other than a missing folder as an explicit 503', async () => {
    const { mkdtemp, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(`${tmpdir()}/w19-`);
    await mkdir(`${root}/w-slug/findings`, { recursive: true });
    const service = new ArtifactsService(db, root);
    readdir.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    await expect(service.list('local', 'eng-1')).rejects.toMatchObject({
      name: 'ProjectApiError',
      statusCode: 503,
      message: expect.stringMatching(/unavailable/i),
    });
  });

  it('still treats a missing folder as an empty listing, not an outage', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(`${tmpdir()}/w19-`);
    const service = new ArtifactsService(db, root);
    const view = await service.list('local', 'eng-1');
    expect(view.folders).toEqual([]);
  });
});
