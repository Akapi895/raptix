import { describe, expect, it } from 'vitest';
import { buildFolders, fileSource, findFolder, treePath, type ChatFile } from './model';

describe('fileSource / treePath on the real backend wire shape (no __workspace__/-style markers)', () => {
  it('classifies a plain sandbox-root file as workspace, not upload', () => {
    const file: ChatFile = { relativePath: 'proj-1/findings/FIND-001.md', name: 'FIND-001.md' };
    expect(fileSource(file)).toBe('workspace');
    expect(treePath(file)).toBe('workspace/findings/FIND-001.md');
  });

  it('classifies a real chat-upload subtree as upload', () => {
    const file: ChatFile = { relativePath: 'proj-1/uploads/conv-1/scope.txt', name: 'scope.txt' };
    expect(fileSource(file)).toBe('upload');
    expect(treePath(file)).toBe('uploads/uploads/conv-1/scope.txt');
  });

  it('still honors the mock-style __workspace__/ prefix marker (no project-id segment)', () => {
    const marked: ChatFile = { relativePath: '__workspace__/recon/nmap.txt', name: 'nmap.txt' };
    expect(fileSource(marked)).toBe('workspace');
    expect(treePath(marked)).toBe('workspace/recon/nmap.txt');
  });
});

describe('buildFolders roots real sandbox folders under Workspace, not Chat uploads', () => {
  it('nests discovered sandbox folders under the workspace bucket', () => {
    const files: ChatFile[] = [{ relativePath: 'proj-1/findings/FIND-001.md', name: 'FIND-001.md' }];
    const root = buildFolders(files, ['findings', 'findings/evidence']);
    expect(findFolder(root, 'workspace/findings')).toBeDefined();
    expect(findFolder(root, 'workspace/findings/evidence')).toBeDefined();
    expect(findFolder(root, 'uploads/findings')).toBeUndefined();
  });

  it('keeps a folder literally named uploads under the uploads bucket', () => {
    const root = buildFolders([], ['uploads']);
    expect(findFolder(root, 'uploads')).toBeDefined();
  });
});
