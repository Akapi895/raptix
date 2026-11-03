import { describe, expect, it } from 'vitest';
import { buildFolders, fileComparator, fileSource, filesByParent, findFolder, isMarkdownFile, treePath, type ChatFile } from './model';

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

describe('isMarkdownFile', () => {
  it('matches .md and .markdown case-insensitively, nothing else', () => {
    expect(isMarkdownFile('FIND-001.MD')).toBe(true);
    expect(isMarkdownFile('notes.markdown')).toBe(true);
    expect(isMarkdownFile('notes.txt')).toBe(false);
    expect(isMarkdownFile('no-extension')).toBe(false);
  });
});

describe('filesByParent', () => {
  it('groups files by their immediate tree-path parent, not ancestors', () => {
    const files: ChatFile[] = [
      { relativePath: 'proj-1/findings/FIND-001.md', name: 'FIND-001.md' },
      { relativePath: 'proj-1/findings/evidence/shot.png', name: 'shot.png' },
    ];
    const map = filesByParent(files);
    expect(map.get('workspace/findings')?.map(f => f.name)).toEqual(['FIND-001.md']);
    expect(map.get('workspace/findings/evidence')?.map(f => f.name)).toEqual(['shot.png']);
  });
});

describe('fileComparator', () => {
  const files: ChatFile[] = [
    { relativePath: 'p/b.txt', name: 'b.txt', size: 10, modifiedUnix: 200 },
    { relativePath: 'p/a.txt', name: 'a.txt', size: 30, modifiedUnix: 100 },
  ];
  it('sorts by name, size or modified time in either direction', () => {
    expect([...files].sort(fileComparator('name-asc')).map(f => f.name)).toEqual(['a.txt', 'b.txt']);
    expect([...files].sort(fileComparator('size-desc')).map(f => f.name)).toEqual(['a.txt', 'b.txt']);
    expect([...files].sort(fileComparator('modified-desc')).map(f => f.name)).toEqual(['b.txt', 'a.txt']);
  });
});
