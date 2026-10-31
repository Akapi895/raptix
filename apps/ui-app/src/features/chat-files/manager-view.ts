import { bytes, fileSource, storageRoots, treePath, type ChatFile, type Folder } from './model';

export const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paths = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
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
export function pathButton(path: string, label: string, cls = '', extra = ''): string {
    return `<button type="button" class="${cls}" data-action="chat-files.navigate" data-path="${esc(path)}" ${extra}>${label}</button>`;
}
export function explorerMarkup(root: Folder, selected: string, expanded: Set<string>, files: ChatFile[], limits: Map<string, number>): string {
    const render = (node: Folder, depth: number): string => {
        const hasChildren = node.children.size > 0;
        const open = expanded.has(node.path);
        const label = folderLabel(node.path, files);
        return `<li><div class="fm-tree-row" style="--fm-depth:${depth}">${hasChildren ? `<button type="button" class="fm-tree-expand ${open ? 'is-open' : ''}" data-action="chat-files.expand" data-path="${esc(node.path)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(label)}">${icon('chevron')}</button>` : '<span class="fm-tree-spacer"></span>'}${pathButton(node.path, `${icon('folder')}<span title="${esc(node.path)}">${esc(label)}</span><small>${node.count}</small>`, 'fm-tree-folder', selected === node.path ? 'aria-current="location"' : '')}</div>${hasChildren && open ? `<ul>${children(node, depth + 1)}</ul>` : ''}</li>`;
    };
    const children = (node: Folder, depth: number): string => {
        const items = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const limit = limits.get(node.path) || 100;
        return items.slice(0, limit).map(child => render(child, depth)).join('') + (items.length > limit ? `<li><button type="button" class="fm-tree-more" data-action="chat-files.moreFolders" data-path="${esc(node.path)}">Show more folders (${items.length - limit})</button></li>` : '');
    };
    return pathButton('', `${icon('file')}<span>All project files</span><small>${root.count}</small>`, 'fm-tree-all', !selected ? 'aria-current="location"' : '') + `<ul class="fm-tree-roots">${[...root.children.values()].map(node => render(node, 0)).join('')}</ul>`;
}
export function fileRow(file: ChatFile, idx: number, allow: (permission: string) => boolean): string {
    const uploaded = fileSource(file) === 'upload';
    const date = file.modifiedUnix ? new Date(file.modifiedUnix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const action = (name: string, text: string, permission?: string) => !permission || allow(permission) ? `<button type="button" role="menuitem" data-action="chat-files.menu.${name}" data-idx="${idx}">${text}</button>` : '';
    const conversation = file.conversationTitle || (file.conversationId && !file.conversationId.startsWith('_') ? file.conversationId : fileSource(file) !== 'upload' && file.projectId ? 'Project workspace' : 'No conversation');
    return `<tr><td class="fm-name-cell"><button type="button" class="fm-file-open" data-action="chat-files.preview" data-idx="${idx}" title="${esc(file.relativePath)}">${icon('file')}<span><strong>${esc(file.name)}</strong><small>${esc(conversation)}<span aria-hidden="true"> · </span>${esc(file.subPath || treePath(file).split('/').slice(0, -1).join('/'))}</small></span></button></td><td class="fm-source-cell">${esc(sourceLabel(file))}</td><td class="fm-size-cell">${bytes(file.size)}</td><td class="fm-date-cell">${esc(date)}</td><td class="fm-action-cell"><div class="fm-row-actions"><button type="button" class="btn-icon" data-action="chat-files.download" data-idx="${idx}" aria-label="Download ${esc(file.name)}" title="Download">${icon('download')}</button><button type="button" class="btn-icon" data-action="chat-files.moreMenu" data-idx="${idx}" aria-label="More actions for ${esc(file.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button><div class="fm-menu" role="menu" id="chat-files-menu-${idx}" hidden>${action('download', 'Download')}${action('copy', 'Copy path')}${file.conversationId && !file.conversationId.startsWith('_') ? action('conversation', 'Open conversation') : ''}${uploaded ? action('edit', 'Edit as text', 'files:write') + action('rename', 'Rename', 'files:write') + action('delete', 'Delete file', 'files:delete') : '<span>Read-only source</span>'}</div></div></td></tr>`;
}
export function folderRow(folder: Folder, files: ChatFile[]): string {
    return `<tr class="fm-folder-row"><td>${pathButton(folder.path, `${icon('folder')}<span>${esc(folderLabel(folder.path, files))}</span>`, 'fm-folder-open')}</td><td class="fm-source-cell">Folder</td><td class="fm-size-cell">${folder.count} files</td><td class="fm-date-cell">—</td><td class="fm-action-cell">${icon('chevron')}</td></tr>`;
}
export const tableHead = '<thead><tr><th scope="col">Name</th><th scope="col" class="fm-source-cell">Source</th><th scope="col" class="fm-size-cell">Size</th><th scope="col" class="fm-date-cell">Modified</th><th scope="col" class="fm-action-cell"><span class="fm-sr-only">Actions</span></th></tr></thead>';
