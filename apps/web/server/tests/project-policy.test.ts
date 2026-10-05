import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PROJECT_SLUG_RE,
  ProjectPolicyError,
  assertProjectTarget,
  assertProjectTargetChangeAllowed,
  isProjectSlug,
  parseCreateProject,
  parseProjectPatch,
} from '../src/security/project-policy.js';
import {
  prepareEngagementPlanDir,
  resolveEngagementWorkspaceDir,
} from '../src/security/workspace-policy.js';
import {
  LOCAL_USER_ID,
  getLocalIdentity,
} from '../src/auth/identity-provider.js';

function expectPolicyError(
  action: () => unknown,
  code: ProjectPolicyError['code'],
  field?: string,
): ProjectPolicyError {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  const label = `expected ProjectPolicyError ${code}${field === undefined ? '' : ` (field: ${field})`}`;
  expect(thrown, label).toBeInstanceOf(ProjectPolicyError);
  const policyError = thrown as ProjectPolicyError;
  expect(policyError.code, label).toBe(code);
  if (field !== undefined) {
    expect(policyError.details?.field, label).toBe(field);
  }
  return policyError;
}

const VALID_CREATE_BASE = {
  name: 'alpha-target',
  targetType: 'web_url',
  targetValue: 'https://example.com/engagement',
};

const VALID_CREATE = { ...VALID_CREATE_BASE, authorizationConfirmed: true } as const;

describe('project slug policy', () => {
  it('matches the legacy 3-64 lowercase/digit/internal-hyphen rule', () => {
    expect(PROJECT_SLUG_RE.source).toBe('^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$');
    expect(isProjectSlug('abc')).toBe(true);
    expect(isProjectSlug('a'.repeat(64))).toBe(true);
    expect(isProjectSlug('a-b-9')).toBe(true);
  });

  it('rejects titles, separators, traversal and encoded traversal', () => {
    for (const bad of [
      'ab',
      'a'.repeat(65),
      'Project Title',
      'ABC',
      '-abc',
      'abc-',
      '../etc',
      '../../tmp/pwn',
      'a/b',
      'a\\b',
      '%2e%2e%2fetc',
      'workspace%2Fescape',
      '.hidden',
      'C:\\tmp',
    ]) {
      expect(isProjectSlug(bad)).toBe(false);
    }
  });
});

describe('parseCreateProject', () => {
  it('accepts a minimal valid create and stores the target verbatim', () => {
    const parsed = parseCreateProject(VALID_CREATE);
    expect(parsed).toEqual({
      name: 'alpha-target',
      targetType: 'web_url',
      targetValue: 'https://example.com/engagement',
      authorizationConfirmed: true,
    });
    expect('displayName' in parsed).toBe(false);
  });

  it('accepts an optional displayName', () => {
    const parsed = parseCreateProject({ ...VALID_CREATE, displayName: 'Alpha Target' });
    expect(parsed.displayName).toBe('Alpha Target');
  });

  it('rejects non-object payloads and unknown keys strictly', () => {
    for (const raw of [null, 42, 'x', [], true]) {
      expect(() => parseCreateProject(raw)).toThrow(ProjectPolicyError);
    }
    for (const key of ['workspacePath', 'userId', 'threadId', 'status', 'admin']) {
      expectPolicyError(
        () => parseCreateProject({ ...VALID_CREATE, [key]: '/tmp/evil' }),
        'bad_request',
        key,
      );
    }
  });

  it('rejects invalid names with the name field', () => {
    for (const name of ['ab', 'a'.repeat(65), 'My Project', '../../tmp/pwn', '%2e%2e%2fetc', 'a\\..\\b']) {
      expectPolicyError(() => parseCreateProject({ ...VALID_CREATE, name }), 'bad_request', 'name');
    }
  });

  it('rejects missing, empty and over-long displayName', () => {
    for (const displayName of ['', '   ', 42, 'x'.repeat(201)]) {
      expectPolicyError(
        () => parseCreateProject({ ...VALID_CREATE, displayName }),
        'bad_request',
        'displayName',
      );
    }
  });

  it('rejects unsupported target types and requires explicit authorization', () => {
    expectPolicyError(
      () => parseCreateProject({ ...VALID_CREATE, targetType: 'domain' }),
      'bad_request',
      'targetType',
    );
    expectPolicyError(
      () => parseCreateProject({ ...VALID_CREATE, authorizationConfirmed: false }),
      'bad_request',
      'authorizationConfirmed',
    );
    expectPolicyError(
      () => parseCreateProject(VALID_CREATE_BASE),
      'bad_request',
      'authorizationConfirmed',
    );
  });

  it('rejects non-string or empty targetValue', () => {
    for (const targetValue of ['', 10]) {
      expectPolicyError(
        () => parseCreateProject({ ...VALID_CREATE, targetValue }),
        'bad_request',
        'targetValue',
      );
    }
  });
});

describe('web_url target policy', () => {
  it('accepts http and https URLs with host and port', () => {
    for (const url of [
      'http://example.com',
      'https://example.com/p?x=1#frag',
      'http://127.0.0.1:8080/admin',
      'https://sub.domain.example/x',
    ]) {
      expect(() => assertProjectTarget('web_url', url)).not.toThrow();
    }
  });

  it('rejects non-HTTP(S) schemes and credential-embedded URLs', () => {
    for (const url of [
      'ftp://example.com/pub',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'gopher://example.com',
    ]) {
      expectPolicyError(() => assertProjectTarget('web_url', url), 'bad_request', 'targetValue');
    }
    for (const url of [
      'https://user:pass@example.com/',
      'https://user@example.com/',
      'http://:secret@example.com/',
    ]) {
      expectPolicyError(() => assertProjectTarget('web_url', url), 'bad_request', 'targetValue');
    }
  });

  it('rejects URLs with whitespace, missing host and non-URL strings', () => {
    for (const url of [
      ' http://example.com',
      'https://exa mple.com',
      'https://example.com/a b',
      'not a url',
      'example.com/path',
      '',
    ]) {
      expectPolicyError(() => assertProjectTarget('web_url', url), 'bad_request', 'targetValue');
    }
  });
});

describe('ip_range target policy', () => {
  it('accepts IPv4/IPv6 addresses and CIDRs at the prefix boundaries', () => {
    for (const target of [
      '10.0.0.1',
      '255.255.255.255',
      '10.0.0.0/8',
      '0.0.0.0/0',
      '10.1.2.3/32',
      '::1',
      '::ffff:10.0.0.1',
      '2001:db8::/32',
      '::/0',
      '2001:db8::1/128',
    ]) {
      expect(() => assertProjectTarget('ip_range', target)).not.toThrow();
    }
  });

  it('rejects out-of-bounds and malformed CIDR prefixes', () => {
    for (const target of [
      '10.0.0.0/33',
      '::1/129',
      '10.0.0.0/-1',
      '10.0.0.0/+8',
      '10.0.0.0/ 8',
      '10.0.0.0/08',
      '10.0.0.0/8/8',
      '10.0.0.0/',
      '10.0.0.0/2.5',
    ]) {
      expectPolicyError(() => assertProjectTarget('ip_range', target), 'bad_request', 'targetValue');
    }
  });

  it('rejects hostnames, ranges, zone IDs, leading-zero octets and empties', () => {
    for (const target of [
      'example.com',
      '10.0.0.1-10.0.0.5',
      'fe80::1%eth0',
      '1.2.3.04',
      '01.2.3.4',
      ' ',
      '',
    ]) {
      expectPolicyError(() => assertProjectTarget('ip_range', target), 'bad_request', 'targetValue');
    }
  });
});

describe('parseProjectPatch', () => {
  it('accepts each supported field alone and combined', () => {
    expect(parseProjectPatch({ displayName: 'New Name' })).toEqual({ displayName: 'New Name' });
    expect(parseProjectPatch({ targetType: 'ip_range' })).toEqual({ targetType: 'ip_range' });
    expect(parseProjectPatch({ targetValue: '10.0.0.0/8' })).toEqual({ targetValue: '10.0.0.0/8' });
    expect(
      parseProjectPatch({ displayName: 'N', targetType: 'web_url', targetValue: 'https://a.dev' }),
    ).toEqual({ displayName: 'N', targetType: 'web_url', targetValue: 'https://a.dev' });
  });

  it('rejects immutable/authority/control fields with their field key', () => {
    const base = { displayName: 'ok' };
    expectPolicyError(() => parseProjectPatch({ ...base, name: 'renamed-project' }), 'bad_request', 'name');
    expectPolicyError(() => parseProjectPatch({ ...base, userId: 'someone-else' }), 'bad_request', 'userId');
    expectPolicyError(() => parseProjectPatch({ ...base, threadId: 'thread-1' }), 'bad_request', 'threadId');
    expectPolicyError(
      () => parseProjectPatch({ ...base, workspacePath: 'D:\\abs\\path' }),
      'bad_request',
      'workspacePath',
    );
    expectPolicyError(() => parseProjectPatch({ ...base, status: 'running' }), 'bad_request', 'status');
  });

  it('rejects unknown keys, empty patches and non-object payloads', () => {
    expectPolicyError(() => parseProjectPatch({ admin: true }), 'bad_request', 'admin');
    expect(() => parseProjectPatch({})).toThrow(ProjectPolicyError);
    for (const raw of [null, 'x', 5, []]) {
      expect(() => parseProjectPatch(raw)).toThrow(ProjectPolicyError);
    }
  });

  it('validates patch values and cross-validates a full target pair', () => {
    expectPolicyError(() => parseProjectPatch({ displayName: 9 }), 'bad_request', 'displayName');
    expectPolicyError(() => parseProjectPatch({ targetType: 'domain' }), 'bad_request', 'targetType');
    expectPolicyError(() => parseProjectPatch({ targetValue: '' }), 'bad_request', 'targetValue');
    expectPolicyError(
      () => parseProjectPatch({ targetType: 'web_url', targetValue: '10.0.0.0/8' }),
      'bad_request',
      'targetValue',
    );
    expectPolicyError(
      () => parseProjectPatch({ targetType: 'ip_range', targetValue: 'ftp://x' }),
      'bad_request',
      'targetValue',
    );
  });
});

describe('assertProjectTargetChangeAllowed', () => {
  it('allows draft projects without a linked thread', () => {
    expect(() =>
      assertProjectTargetChangeAllowed({ lifecycleStatus: 'draft', threadId: null }),
    ).not.toThrow();
  });

  it('conflicts for non-draft lifecycle states', () => {
    for (const lifecycleStatus of ['planning', 'running', 'completed', 'failed']) {
      expectPolicyError(
        () => assertProjectTargetChangeAllowed({ lifecycleStatus, threadId: null }),
        'conflict',
      );
    }
  });

  it('conflicts once a runtime thread is linked, even in draft', () => {
    expectPolicyError(
      () => assertProjectTargetChangeAllowed({ lifecycleStatus: 'draft', threadId: 'thread-1' }),
      'conflict',
      'targetValue',
    );
  });
});

describe('ProjectPolicyError', () => {
  it('carries code, message and optional details for route mapping', () => {
    const error = new ProjectPolicyError('conflict', 'duplicate', { field: 'name' });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('conflict');
    expect(error.message).toBe('duplicate');
    expect(error.details?.field).toBe('name');
    expect(new ProjectPolicyError('not_found', 'missing').details).toBeUndefined();
  });
});

describe('workspace policy', () => {
  let tmpDir: string;
  let root: string;
  let outside: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'w02-policy-'));
    root = path.join(tmpDir, 'ws');
    outside = path.join(tmpDir, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves a slug lexically inside the root', async () => {
    const dir = await resolveEngagementWorkspaceDir(root, 'alpha-target');
    expect(dir).toBe(path.resolve(root, 'alpha-target'));
  });

  it('resolves an existing directory inside the root', async () => {
    await mkdir(path.join(root, 'real-dir'), { recursive: true });
    const dir = await resolveEngagementWorkspaceDir(root, 'real-dir');
    expect(dir).toBe(path.resolve(root, 'real-dir'));
  });

  it('rejects path-shaped and traversal slugs without touching the filesystem', async () => {
    for (const slug of [
      '..',
      '.',
      'a/b',
      'a\\b',
      '../../tmp/pwn',
      '%2e%2e%2fetc',
      '.hidden',
      'C:\\tmp',
      '/abs',
      'ab',
      'UPPER',
    ]) {
      await expect(resolveEngagementWorkspaceDir(root, slug)).rejects.toMatchObject({
        code: 'bad_request',
        details: { field: 'slug' },
      });
    }
  });

  it('refuses symlinked workspace directories that point outside the root', async () => {
    symlinkSync(
      outside,
      path.join(root, 'linkdir'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(resolveEngagementWorkspaceDir(root, 'linkdir')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(existsSync(path.join(outside, 'plan'))).toBe(false);
  });

  it('prepares the plan directory inside the checked root, idempotently', async () => {
    const planDir = await prepareEngagementPlanDir(root, 'alpha-target');
    expect(planDir).toBe(path.resolve(root, 'alpha-target', 'plan'));
    expect(existsSync(planDir)).toBe(true);
    expect(existsSync(path.join(root, 'alpha-target'))).toBe(true);
    const again = await prepareEngagementPlanDir(root, 'alpha-target');
    expect(again).toBe(planDir);
  });

  it('refuses an existing plan directory that links outside the root', async () => {
    await mkdir(path.join(root, 'plan-escape'), { recursive: true });
    symlinkSync(
      outside,
      path.join(root, 'plan-escape', 'plan'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(prepareEngagementPlanDir(root, 'plan-escape')).rejects.toMatchObject({
      code: 'bad_request',
      details: { field: 'slug' },
    });
    expect(existsSync(path.join(outside, 'plan'))).toBe(false);
  });

  it('never reports success when the plan link is dangling or escapes after mkdir', async () => {
    await mkdir(path.join(root, 'plan-swap'), { recursive: true });
    symlinkSync(
      path.join(outside, 'swap-target'),
      path.join(root, 'plan-swap', 'plan'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(prepareEngagementPlanDir(root, 'plan-swap')).rejects.toThrow();
    expect(existsSync(path.join(root, 'plan-swap', 'plan', 'plan'))).toBe(false);
  });

  it('treats a symlinked workspace root as trusted and checks against the canonical root', async () => {
    const realWs = path.join(tmpDir, 'real-ws');
    await mkdir(realWs, { recursive: true });
    const linkRoot = path.join(tmpDir, 'link-root');
    symlinkSync(realWs, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const planDir = await prepareEngagementPlanDir(linkRoot, 'canonical-slug');
    expect(planDir).toBe(path.resolve(linkRoot, 'canonical-slug', 'plan'));
    expect(existsSync(path.join(realWs, 'canonical-slug', 'plan'))).toBe(true);
  });

  it('never accepts an absolute browser path as a slug', async () => {
    await expect(prepareEngagementPlanDir(root, 'C:\\Windows\\Temp')).rejects.toMatchObject({
      code: 'bad_request',
      details: { field: 'slug' },
    });
    await expect(prepareEngagementPlanDir(root, '/etc')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(existsSync(path.join(outside, 'plan'))).toBe(false);
  });
});

describe('local identity provider', () => {
  it('returns exactly the fixed local single-user identity', () => {
    expect(getLocalIdentity()).toEqual({ id: 'local', mode: 'local-single-user' });
    expect(Object.keys(getLocalIdentity()).sort()).toEqual(['id', 'mode']);
    expect(LOCAL_USER_ID).toBe('local');
  });
});
