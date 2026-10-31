export interface ChatFile {
    relativePath: string; name: string; source?: string; absolutePath?: string;
    projectId?: string; projectName?: string; conversationId?: string; conversationTitle?: string;
    date?: string; subPath?: string; size?: number; modifiedUnix?: number;
}
export interface TreeNode { dirs: Record<string, TreeNode>; files: { idx: number; name: string }[] }
export interface FileGroup { key: string; items: { idx: number; f: ChatFile }[] }
export type GroupMode = 'none' | 'date' | 'conversation' | 'project' | 'folder';
export interface UploadTarget { relativeDir?: string; conversationId?: string }
export interface FileFilters { conversation: string; project: string; source: string; search: string }
export function fileQuery(filters: FileFilters, page?: number, pageSize?: number | 'all'): URLSearchParams {
    const params = new URLSearchParams();
    if (filters.conversation) params.set('conversation', filters.conversation);
    if (filters.project) params.set('project', filters.project);
    if (filters.source && filters.source !== 'all') params.set('source', filters.source);
    if (filters.search) params.set('search', filters.search);
    if (page !== undefined) params.set('page', String(page));
    if (pageSize !== undefined) params.set('pageSize', String(pageSize));
    return params;
}

export const storageRoots = [
    { key: 'uploads', label: 'Chat uploads', prefix: '', source: 'upload' },
    { key: 'workspace', label: 'Workspace', prefix: '__workspace__/', source: 'workspace' },
    { key: 'tool_outputs', label: 'Tool outputs', prefix: '__reduction__/', source: 'reduction' },
    { key: 'conversation_artifacts', label: 'Conversation artifacts', prefix: '__conversation_artifact__/', source: 'conversation_artifact' },
] as const;
export function fileSource(file: ChatFile): string {
    return storageRoots.find(root => root.prefix && file.relativePath.startsWith(root.prefix))?.source || file.source || 'upload';
}
export function treePath(file: ChatFile): string {
    const root = storageRoots.find(root => root.source === fileSource(file)) || storageRoots[0];
    return root.key + '/' + file.relativePath.slice(root.prefix.length);
}
export function validPath(path: string): boolean {
    return !!path && !path.includes('\\') && !path.startsWith('/') && !path.includes('\0') && !path.split('/').some(part => part === '.' || part === '..' || !part);
}
export type PreviewKind = 'text' | 'image' | 'pdf' | 'other';
export function previewKind(name: string): PreviewKind {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config', 'html', 'htm', 'svg', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sh', 'bash', 'ps1', 'sql', 'http', 'diff', 'env'].includes(ext) || ['Dockerfile', 'Makefile', 'README', 'LICENSE'].includes(name)) return 'text';
    return 'other';
}
export interface Folder { path: string; name: string; children: Map<string, Folder>; count: number }
export function buildFolders(files: ChatFile[], folders: string[]): Folder {
    const root: Folder = { path: '', name: 'All files', children: new Map(), count: files.length };
    function insert(path: string, file: boolean) {
        if (!validPath(path)) return;
        let current = root;
        for (const part of path.split('/')) {
            if (!current.children.has(part)) current.children.set(part, { path: current.path ? current.path + '/' + part : part, name: part, children: new Map(), count: 0 });
            current = current.children.get(part)!;
            if (file) current.count++;
        }
    }
    storageRoots.forEach(item => insert(item.key, false));
    files.forEach(file => insert(treePath(file).split('/').slice(0, -1).join('/'), true));
    folders.forEach(path => insert('uploads/' + path, false));
    return root;
}
export function findFolder(root: Folder, path: string): Folder | undefined {
    let current: Folder | undefined = root;
    for (const part of path.split('/').filter(Boolean)) current = current?.children.get(part);
    return current;
}
export function bytes(size = 0): string {
    if (size < 1024) return size + ' B';
    if (size < 1024 ** 2) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1024 ** 2).toFixed(1) + ' MB';
}
