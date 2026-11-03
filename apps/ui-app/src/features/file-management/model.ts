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
/** The real backend's relativePath is "<projectId>/<relPathInSandbox>" with none of the mock's __workspace__/-style
 *  markers -- strip the leading project-id segment to get the path actually inside the sandbox. */
function sandboxRelativePath(relativePath: string): string {
    return relativePath.split('/').slice(1).join('/');
}
/** Everything under a project's one sandbox is genuinely workspace content except an actual uploads/ subtree
 *  (written by the chat-upload flow itself), so that's the only case classified as 'upload' by default. */
function isUploadsPath(relativePath: string): boolean {
    const rel = sandboxRelativePath(relativePath);
    return rel === 'uploads' || rel.startsWith('uploads/');
}
export function fileSource(file: ChatFile): string {
    const special = storageRoots.find(root => root.prefix && file.relativePath.startsWith(root.prefix))?.source;
    if (special) return special;
    if (file.source) return file.source;
    return isUploadsPath(file.relativePath) ? 'upload' : 'workspace';
}
export function treePath(file: ChatFile): string {
    const matched = storageRoots.find(root => root.prefix && file.relativePath.startsWith(root.prefix));
    if (matched) return matched.key + '/' + file.relativePath.slice(matched.prefix.length);
    const bucket = storageRoots.find(root => root.source === fileSource(file)) || storageRoots[0];
    return bucket.key + '/' + sandboxRelativePath(file.relativePath);
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
export function isMarkdownFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ext === 'md' || ext === 'markdown';
}
/** Direct (non-recursive) children of each folder, keyed by the folder's tree path ('' for the tree roots). */
export function filesByParent(files: ChatFile[]): Map<string, ChatFile[]> {
    const map = new Map<string, ChatFile[]>();
    for (const file of files) {
        const parent = treePath(file).split('/').slice(0, -1).join('/');
        (map.get(parent) ?? map.set(parent, []).get(parent)!).push(file);
    }
    return map;
}
export type SortKey = 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' | 'modified-asc' | 'modified-desc';
/** Files sort by the chosen key; a folder's position among its siblings is always alphabetical (it has no size/date of its own). */
export function fileComparator(sort: SortKey): (a: ChatFile, b: ChatFile) => number {
    return (a, b) => {
        const diff = sort.startsWith('name') ? a.name.localeCompare(b.name, undefined, { numeric: true })
            : sort.startsWith('size') ? (a.size || 0) - (b.size || 0)
                : (a.modifiedUnix || 0) - (b.modifiedUnix || 0);
        return (sort.endsWith('desc') ? -diff : diff) || a.relativePath.localeCompare(b.relativePath);
    };
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
    folders.forEach(path => insert(path === 'uploads' ? 'uploads' : 'workspace/' + path, false));
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
