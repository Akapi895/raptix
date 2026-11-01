import { bytes, fileSource, storageRoots, treePath, type ChatFile } from './model';

export const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paths = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13"/>',
};
export function icon(name: keyof typeof paths): string { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }
export function sourceLabel(file: ChatFile): string { return storageRoots.find(root => root.source === fileSource(file))?.label || 'Chat uploads'; }
export function folderLabel(path: string, files: ChatFile[]): string {
    const parts = path.split('/');
    if (parts.length === 1) return storageRoots.find(root => root.key === path)?.label || path;
    const name = parts.at(-1)!;
    const file = files.find(item => treePath(item).startsWith(path + '/'));
    if (file && ((parts[0] === 'uploads' && parts.length === 3) || (parts[1] === 'conversations' && parts.length === 3) || (parts[0] === 'conversation_artifacts' && parts.length === 2))) return file.conversationTitle || name;
    if (file && parts[1] === 'projects' && parts.length === 3) return file.projectName || name;
    return name;
}
/** Nodes the controller already filtered, sorted and bounded -- this module only turns them into markup. */
export interface TreeFileNode { kind: 'file'; file: ChatFile; idx: number; depth: number; secondary: string }
export interface TreeFolderNode {
    kind: 'folder'; path: string; name: string; depth: number; open: boolean;
    visibleCount: number; tag?: string; children: TreeNode[]; moreFiles?: number;
    /** A date/conversation/project group header, not a real sandbox folder: no actions, no disclosure, always open. */
    virtual?: boolean;
}
export type TreeNode = TreeFileNode | TreeFolderNode;

function fileMenu(file: ChatFile, idx: number, allow: (permission: string) => boolean): string {
    const uploaded = fileSource(file) === 'upload';
    const action = (name: string, text: string, permission?: string) => !permission || allow(permission) ? `<button type="button" role="menuitem" data-action="chat-files.menu.${name}" data-idx="${idx}">${text}</button>` : '';
    return `<div class="fm-menu" role="menu" id="chat-files-menu-${idx}" hidden>${action('download', 'Download')}${action('copy', 'Copy path')}${file.conversationId && !file.conversationId.startsWith('_') ? action('conversation', 'Open conversation') : ''}${uploaded ? action('edit', 'Edit as text', 'files:write') + action('rename', 'Rename', 'files:write') + action('delete', 'Delete file', 'files:delete') : '<span>Read-only source</span>'}</div>`;
}
function fileNodeMarkup(node: TreeFileNode, allow: (permission: string) => boolean): string {
    const { file, idx, depth } = node;
    const date = file.modifiedUnix ? new Date(file.modifiedUnix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    return `<li role="treeitem" aria-level="${depth + 1}" data-tree-kind="file" data-idx="${idx}"><div class="fm-row fm-row-file" style="--fm-depth:${depth}" data-rel="${esc(file.relativePath)}" tabindex="-1">` +
        `<span class="fm-row-spacer" aria-hidden="true"></span>` +
        `<button type="button" class="fm-row-main fm-file-open" data-action="chat-files.preview" data-idx="${idx}" title="${esc(file.relativePath)}">${icon('file')}<span class="fm-row-label"><strong>${esc(file.name)}</strong>${node.secondary ? `<small>${esc(node.secondary)}</small>` : ''}</span></button>` +
        `<span class="fm-row-source">${esc(sourceLabel(file))}</span><span class="fm-row-size">${bytes(file.size)}</span><span class="fm-row-date">${esc(date)}</span>` +
        `<div class="fm-row-actions"><button type="button" class="btn-icon" data-action="chat-files.download" data-idx="${idx}" aria-label="Download ${esc(file.name)}" title="Download">${icon('download')}</button><button type="button" class="btn-icon" data-action="chat-files.moreMenu" data-idx="${idx}" aria-label="More actions for ${esc(file.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>${fileMenu(file, idx, allow)}</div>` +
        `</div></li>`;
}
function folderMenu(folder: TreeFolderNode, allow: (permission: string) => boolean): string {
    const inUploads = folder.path === 'uploads' || folder.path.startsWith('uploads/');
    const isUploadsRoot = folder.path === 'uploads';
    const items = `<button type="button" role="menuitem" data-action="chat-files.menu.copyFolder" data-path="${esc(folder.path)}">Copy folder path</button>` +
        (inUploads && allow('files:write') ? `<button type="button" role="menuitem" data-action="chat-files.menu.mkdir" data-path="${esc(folder.path)}">New folder</button><button type="button" role="menuitem" data-action="chat-files.menu.uploadHere" data-path="${esc(folder.path)}">Upload here</button>` : '') +
        (inUploads && !isUploadsRoot && allow('files:delete') ? `<button type="button" role="menuitem" data-action="chat-files.menu.deleteFolder" data-path="${esc(folder.path)}">Delete folder</button>` : '');
    return `<div class="fm-menu" role="menu" id="chat-files-fmenu-${esc(folder.path)}" hidden>${items}</div>`;
}
function folderNodeMarkup(node: TreeFolderNode, allow: (permission: string) => boolean): string {
    const { path, name, depth, open, children } = node;
    if (node.virtual) {
        return `<li role="presentation" class="fm-group-divider"><div class="fm-row fm-row-group" style="--fm-depth:${depth}"><span class="fm-row-label"><strong>${esc(name)}</strong></span><span class="fm-row-count">${node.visibleCount} item${node.visibleCount === 1 ? '' : 's'}</span></div><ul role="group">${children.map(child => treeNodeMarkup(child, allow)).join('')}</ul></li>`;
    }
    const hasChildren = children.length > 0 || node.visibleCount > 0;
    return `<li role="treeitem" aria-expanded="${open}" aria-level="${depth + 1}" data-tree-kind="folder" data-path="${esc(path)}"><div class="fm-row fm-row-folder" style="--fm-depth:${depth}" data-path="${esc(path)}" tabindex="-1">` +
        (hasChildren ? `<button type="button" class="fm-row-disclosure ${open ? 'is-open' : ''}" data-action="chat-files.expand" data-path="${esc(path)}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(name)}">${icon('chevron')}</button>` : '<span class="fm-row-spacer" aria-hidden="true"></span>') +
        `<button type="button" class="fm-row-main" data-action="chat-files.expand" data-path="${esc(path)}">${icon('folder')}<span class="fm-row-label"><strong>${esc(name)}</strong></span></button>` +
        (node.tag ? `<span class="fm-row-tag">${esc(node.tag)}</span>` : '') +
        `<span class="fm-row-count">${node.visibleCount} item${node.visibleCount === 1 ? '' : 's'}</span>` +
        `<div class="fm-row-actions"><button type="button" class="btn-icon" data-action="chat-files.folderMenu" data-path="${esc(path)}" aria-label="More actions for ${esc(name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>${folderMenu(node, allow)}</div>` +
        `</div>` +
        (open ? `<ul role="group">${children.map(child => treeNodeMarkup(child, allow)).join('')}${node.moreFiles ? `<li><button type="button" class="fm-tree-more" data-action="chat-files.moreFiles" data-path="${esc(path)}">Show ${node.moreFiles} more files</button></li>` : ''}</ul>` : '') +
        `</li>`;
}
export function treeNodeMarkup(node: TreeNode, allow: (permission: string) => boolean): string {
    return node.kind === 'folder' ? folderNodeMarkup(node, allow) : fileNodeMarkup(node, allow);
}
export function treeMarkup(nodes: TreeNode[], allow: (permission: string) => boolean): string {
    return `<ul role="tree" aria-label="Project files" id="chat-files-tree-root" class="fm-tree">${nodes.map(node => treeNodeMarkup(node, allow)).join('')}</ul>`;
}
export const sourceOptions = storageRoots;
