import { openAppModal, closeAppModal } from '../../ui/modal';
import type { Translate } from '../chat/types';
import type { ChatFilesService } from './service';
import { bindChatFilesActions } from './view';
import { buildFolders, bytes, fileSource, findFolder, previewKind, storageRoots, treePath, validPath, type ChatFile, type UploadTarget } from './model';
import { esc, explorerMarkup, fileRow, folderLabel, folderRow, icon, pathButton, sourceLabel, tableHead } from './manager-view';

export interface ChatFilesDependencies {
    service: ChatFilesService;
    translate?: Translate;
    applyTranslations?(root: HTMLElement): void;
    initPaginationSelects?(root: HTMLElement): void;
    currentPage(): string;
    switchPage(page: string): void;
    loadConversation(id: string): void;
    activeProjectId?(): string;
    onProjectChange?(listener: () => void): () => void;
    allow?(permission: string): boolean;
}

/** Owns project-scoped inventory. Storage tokens are passed back unchanged to the API. */
export function createChatFiles(document: Document, deps: ChatFilesDependencies) {
    const browser = document.defaultView!;
    const lifecycle = new AbortController();
    const el = (id: string) => document.getElementById(id);
    const field = (id: string) => document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('#' + id);
    const value = (id: string) => field(id)?.value || '';
    const setValue = (id: string, text: string) => { const node = field(id); if (node) node.value = text; };
    const allow = (permission: string) => deps.allow?.(permission) ?? true;
    let files: ChatFile[] = [], folders: string[] = [], displayed: ChatFile[] = [];
    let root = buildFolders([], []);
    let path = '', project = '', page = 1, pageSize = 20, total = 0;
    let generation = 0, conversationGeneration = 0, previewGeneration = 0, disposed = false, uploadBusy = false, loading = false;
    let previewUrl = '', editing = '', renaming = '';
    let previewRequest: AbortController | undefined;
    let unbind: (() => void) | undefined, unsubscribe: (() => void) | undefined;
    let searchTimer: number | undefined;
    let requestedConversation = '';
    let explorerOpen = !browser.matchMedia('(max-width: 1100px)').matches;
    const expanded = new Set<string>();
    const folderLimits = new Map<string, number>();
    const filters = () => ({ project: deps.activeProjectId?.() || '', conversation: value('chat-files-filter-conv'), source: value('chat-files-filter-source') || 'all', search: value('chat-files-filter-name').trim() });
    function status(text: string) {
        const node = el('chat-files-status'); if (node) node.textContent = text;
        const preview = el('chat-files-preview-modal');
        if (preview && preview.style.display !== 'none') el('chat-files-preview-feedback')!.textContent = text;
        for (const kind of ['edit', 'rename', 'mkdir']) {
            const modal = el(`chat-files-${kind}-modal`);
            if (modal && modal.style.display && modal.style.display !== 'none') {
                let feedback = modal.querySelector<HTMLElement>('.fm-form-feedback');
                if (!feedback) { feedback = document.createElement('p'); feedback.className = 'fm-form-feedback'; feedback.setAttribute('role', 'status'); modal.querySelector('.modal-body')?.appendChild(feedback); }
                feedback.textContent = text;
            }
        }
    }
    function closeMenus() {
        document.querySelectorAll<HTMLElement>('.fm-menu').forEach(menu => { menu.hidden = true; });
        document.querySelectorAll('[data-action="chat-files.moreMenu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
    function syncExplorer() {
        const panel = el('chat-files-explorer'); if (panel) panel.hidden = !explorerOpen;
        el('chat-files-layout')?.classList.toggle('is-explorer-collapsed', !explorerOpen);
        el('chat-files-explorer-toggle')?.setAttribute('aria-expanded', String(explorerOpen));
    }
    function renderTree() { const tree = el('chat-files-tree'); if (tree) tree.innerHTML = explorerMarkup(root, path, expanded, files, folderLimits); }
    function navigate(next: string) {
        if (next && (!validPath(next) || !findFolder(root, next))) return;
        path = next; page = 1;
        const parts = path.split('/');
        for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
        render(); renderTree();
    }
    function render() {
        if (loading) return;
        const wrap = el('chat-files-list-wrap'); if (!wrap) return;
        closeMenus();
        const current = findFolder(root, path) || root;
        const query = value('chat-files-filter-name').trim().toLocaleLowerCase();
        const source = value('chat-files-filter-source') || 'all';
        const type = value('chat-files-filter-type') || 'all';
        const group = value('chat-files-group-by');
        const filtered = files.filter(file => (!path || treePath(file).startsWith(path + '/')) &&
            (query || (!path && group !== 'folder') || treePath(file).split('/').slice(0, -1).join('/') === path) &&
            (source === 'all' || fileSource(file) === source) && (type === 'all' || previewKind(file.name) === type) &&
            (!query || [file.name, file.relativePath, file.conversationTitle].some(text => text?.toLocaleLowerCase().includes(query))));
        const sort = value('chat-files-sort');
        filtered.sort((a, b) => {
            const diff = sort.startsWith('name') ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort.startsWith('size') ? (a.size || 0) - (b.size || 0) : (a.modifiedUnix || 0) - (b.modifiedUnix || 0);
            return (sort.endsWith('desc') ? -diff : diff) || a.relativePath.localeCompare(b.relativePath);
        });
        const childFolders = (path || group === 'folder') && !query ? [...current.children.values()].filter(folder => source === 'all' || storageRoots.find(storage => folder.path === storage.key || folder.path.startsWith(storage.key + '/'))?.source === source).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [];
        total = filtered.length + childFolders.length;
        page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        const offset = (page - 1) * pageSize;
        const visibleFolders = childFolders.slice(offset, offset + pageSize);
        displayed = filtered.slice(Math.max(0, offset - childFolders.length), Math.max(0, offset + pageSize - childFolders.length));
        let rows = visibleFolders.map(folder => folderRow(folder, files)).join('');
        if (['date', 'conversation', 'project'].includes(group)) {
            const groups = new Map<string, { file: ChatFile; idx: number }[]>();
            displayed.forEach((file, idx) => { const key = group === 'date' ? file.date || 'No date' : group === 'project' ? file.projectName || file.projectId || 'No project' : file.conversationTitle || file.conversationId || 'No conversation'; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push({ file, idx }); });
            rows += [...groups].map(([key, entries]) => `<tr class="fm-group-row"><th colspan="5" scope="rowgroup">${esc(key)} <small>${entries.length} on this page</small></th></tr>` + entries.map(item => fileRow(item.file, item.idx, allow)).join('')).join('');
        } else rows += displayed.map((file, idx) => fileRow(file, idx, allow)).join('');
        wrap.setAttribute('aria-busy', 'false');
        wrap.innerHTML = total ? `<table class="fm-table">${tableHead}<tbody>${rows}</tbody></table>` : `<div class="fm-empty">${icon('folder')}<h3>${query || source !== 'all' || type !== 'all' ? 'No matching files' : path ? 'This folder is empty' : 'No project files yet'}</h3><p>${query || source !== 'all' || type !== 'all' ? 'Try another search or clear your filters.' : 'Upload files to a conversation, or generate files in the workspace.'}</p>${query || source !== 'all' || type !== 'all' ? '<button type="button" class="btn-secondary" data-action="chat-files.clear">Clear filters</button>' : ''}</div>`;
        const crumbs = el('chat-files-breadcrumb');
        if (crumbs) crumbs.innerHTML = pathButton('', 'All files', 'fm-crumb', !path ? 'aria-current="location"' : '') + path.split('/').filter(Boolean).map((_, index, parts) => {
            const location = parts.slice(0, index + 1).join('/');
            return `<span aria-hidden="true">/</span>${pathButton(location, esc(folderLabel(location, files)), 'fm-crumb', index === parts.length - 1 ? 'aria-current="location"' : '')}`;
        }).join('');
        const tools = el('chat-files-folder-tools');
        if (tools) {
            tools.hidden = !path;
            tools.innerHTML = `<span>${path.startsWith('uploads') ? 'Chat upload folder' : 'Read-only storage'}</span><button type="button" class="btn-secondary" data-action="chat-files.copyFolderPath">Copy folder path</button>` +
                (path.startsWith('uploads') && allow('files:write') ? '<button type="button" class="btn-secondary" data-action="chat-files.mkdir">New folder</button>' : '') +
                (path.startsWith('uploads/') && allow('files:delete') ? '<button type="button" class="btn-secondary" data-action="chat-files.deleteFolder">Delete folder</button>' : '');
        }
        const pager = el('chat-files-pagination');
        if (pager) {
            pager.hidden = !total;
            pager.innerHTML = `<span>${total ? offset + 1 : 0}–${Math.min(offset + pageSize, total)} of ${total} items</span><label>Per page <select aria-label="Files per page" data-change="chat-files.pageSize">${[10, 20, 50, 100].map(size => `<option ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label>` +
                (total > pageSize ? `<div><button type="button" class="btn-secondary" data-action="chat-files.page" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button><span>${page} / ${Math.ceil(total / pageSize)}</span><button type="button" class="btn-secondary" data-action="chat-files.page" data-page="${page + 1}" ${page * pageSize >= total ? 'disabled' : ''}>Next</button></div>` : '');
        }
        const count = el('chat-files-filter-count'); if (count) { const n = Number(source !== 'all') + Number(type !== 'all') + Number(group !== 'none'); count.textContent = n ? String(n) : ''; }
        const upload = document.querySelector<HTMLButtonElement>('#chat-files-header-upload-btn');
        if (upload) { upload.disabled = uploadBusy || !allow('files:write'); upload.title = path.startsWith('uploads/') ? 'Upload to this folder' : 'Upload to the selected conversation'; }
        const exportButton = document.querySelector<HTMLButtonElement>('#chat-files-export-btn');
        if (exportButton) { exportButton.disabled = !!path || type !== 'all'; exportButton.title = path || type !== 'all' ? 'Return to All files and clear the file type filter to export results.' : 'Export files matching the current project, conversation, source and search.'; }
        const summary = el('chat-files-summary');
        if (summary) summary.textContent = `${filtered.length} files${path ? ' in this location' : ' in this project'} · ${bytes(filtered.reduce((sum, file) => sum + (file.size || 0), 0))}`;
    }
    async function responseError(response: Response | { status: number; text(): Promise<string> }): Promise<Error> {
        if (response.status === 403) return new Error('You do not have permission to access this location. Choose another folder or contact your administrator.');
        if (response.status === 404) return new Error('This file or folder is no longer available. Refresh the file list.');
        if (response.status === 413) return new Error('This file is too large to edit here. Download it to edit locally.');
        let text = await response.text(); try { const data = JSON.parse(text); text = data.error || text; } catch { /* plain error */ }
        return new Error(text || 'The operation failed. Please try again.');
    }
    async function run(task: () => Promise<void>) { try { await task(); } catch (error) { if (!disposed) status(error instanceof Error ? error.message : 'The operation failed. Please try again.'); } }
    async function load() {
        const wrap = el('chat-files-list-wrap'); if (!wrap || disposed) return;
        const token = ++generation;
        const context = filters();
        loading = true;
        closePreview(); closeMenus(); displayed = []; files = []; folders = []; root = buildFolders([], []);
        const tools = el('chat-files-folder-tools'); if (tools) tools.hidden = true;
        el('chat-files-breadcrumb')?.replaceChildren(); el('chat-files-summary')?.replaceChildren(); status('');
        wrap.setAttribute('aria-busy', 'true'); wrap.innerHTML = '<div class="fm-empty" role="status">Loading project files…</div>';
        const pager = el('chat-files-pagination'); if (pager) pager.hidden = true;
        const tree = el('chat-files-tree'); if (tree) tree.innerHTML = '<p role="status">Loading folders…</p>';
        if (!context.project) { loading = false; wrap.setAttribute('aria-busy', 'false'); wrap.innerHTML = '<div class="fm-empty"><h3>Select a project</h3><p>Choose a project in the header to browse its files.</p></div>'; if (tree) tree.textContent = 'No project selected'; status(''); return; }
        try {
            // The existing API has no directory endpoint. Fetch one scoped inventory; filter and paginate its render locally.
            const response = await deps.service.list({ ...context, source: 'all', search: '' }, 1, 'all');
            if (!response.ok) throw await responseError(response);
            const data = await response.json();
            if (disposed || token !== generation) return;
            loading = false;
            files = data.files.filter(file => validPath(file.relativePath) && (!file.projectId || file.projectId === context.project));
            folders = data.folders.filter(validPath);
            root = buildFolders(files, folders);
            if (path && !findFolder(root, path)) path = '';
            render(); renderTree();
        } catch (error) {
            if (disposed || token !== generation) return;
            loading = false;
            wrap.setAttribute('aria-busy', 'false');
            wrap.innerHTML = `<div class="fm-empty" role="alert"><h3>Files unavailable</h3><p>${esc(error instanceof Error ? error.message : 'Could not load files.')}</p><button type="button" class="btn-secondary" data-action="chat-files.load">Try again</button></div>`;
            if (tree) tree.textContent = 'Folders unavailable'; status('');
        }
    }
    async function loadConversations() {
        const token = ++conversationGeneration;
        const context = project;
        const select = document.querySelector<HTMLSelectElement>('#chat-files-filter-conv'); if (!select) return;
        if (!context) { select.innerHTML = '<option value="">Select a project first</option>'; select.disabled = true; return; }
        const selected = select.value;
        // Keep the current scope available to a simultaneous inventory refresh.
        select.disabled = true;
        select.innerHTML = selected ? `<option value="${esc(selected)}">Loading conversations…</option>` : '<option value="">Loading conversations…</option>';
        try {
            const items: { id: string; title: string }[] = [];
            for (let offset = 0; ; offset += 200) {
                const result = await deps.service.conversations(context, offset);
                if (disposed || context !== project || token !== conversationGeneration) return;
                const fresh = result.items.filter(item => !items.some(known => known.id === item.id)); items.push(...fresh);
                if (!fresh.length || items.length >= result.total || result.items.length < 200) break;
            }
            select.innerHTML = '<option value="">All conversations</option>' + items.map(item => `<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');
            if (items.some(item => item.id === selected)) select.value = selected;
            else if (selected) { page = 1; void load(); }
            if (requestedConversation) {
                const requested = requestedConversation; requestedConversation = '';
                if (items.some(item => item.id === requested)) { select.value = requested; page = 1; void load(); }
                else status('This conversation is not available in the selected project. Showing project files.');
            }
        } catch (error) { if (context !== project || disposed || token !== conversationGeneration) return; select.innerHTML = selected ? `<option value="${esc(selected)}">Selected conversation (unavailable)</option>` : '<option value="">Conversations unavailable</option>'; status(error instanceof Error ? error.message : 'Could not load conversations.'); }
        select.disabled = false;
    }
    function projectChanged(force = false) {
        const next = deps.activeProjectId?.() || '';
        if (!force && project === next) return;
        if (!force) requestedConversation = '';
        project = next; path = ''; page = 1; expanded.clear(); folderLimits.clear(); closePreview();
        for (const kind of ['edit', 'rename', 'mkdir']) closeAppModal(`chat-files-${kind}-modal`);
        editing = ''; renaming = '';
        setValue('chat-files-filter-conv', '');
        if (deps.currentPage() === 'chat-files') { void loadConversations(); void load(); }
        else { ++generation; files = []; folders = []; displayed = []; }
    }
    function saveBlob(blob: Blob, name: string) {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
        browser.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function download(file: ChatFile) { const response = await deps.service.download(file.relativePath); if (!response.ok) throw await responseError(response); saveBlob(await response.blob(), file.name); status('Download started: ' + file.name); }
    async function copy(text: string) {
        try { await browser.navigator.clipboard.writeText(text); }
        catch {
            const previous = document.activeElement;
            const textarea = document.createElement('textarea'); textarea.value = text; textarea.className = 'fm-sr-only';
            document.body.appendChild(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove();
            if (previous instanceof HTMLElement) previous.focus();
            if (!copied) throw new Error('Could not copy the path. Select and copy it from the file details.');
        }
        status('Path copied. Paste it into chat to reference the file.'); const feedback = el('chat-files-preview-feedback'); if (feedback) feedback.textContent = 'Path copied';
    }
    function closePreview() {
        ++previewGeneration; previewRequest?.abort(); previewRequest = undefined; closeAppModal('chat-files-preview-modal');
        if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = '';
        const body = el('chat-files-preview-body'); if (body) body.replaceChildren();
    }
    async function preview(file: ChatFile) {
        closePreview();
        const token = ++previewGeneration;
        previewRequest = new AbortController();
        const modal = el('chat-files-preview-modal')!;
        const title = el('chat-files-preview-title')!; title.textContent = file.name;
        el('chat-files-preview-meta')!.innerHTML = `<div><dt>Source</dt><dd>${esc(sourceLabel(file))}</dd></div><div><dt>Size</dt><dd>${bytes(file.size)}</dd></div><div><dt>Modified</dt><dd>${file.modifiedUnix ? esc(new Date(file.modifiedUnix * 1000).toLocaleString()) : '—'}</dd></div><div><dt>Conversation</dt><dd>${esc(file.conversationTitle || file.conversationId || 'Project workspace')}</dd></div><div class="fm-meta-path"><dt>Path</dt><dd><code>${esc(file.absolutePath || file.relativePath)}</code></dd></div>`;
        const downloadButton = document.querySelector<HTMLButtonElement>('#chat-files-preview-download')!;
        downloadButton.onclick = () => { void run(() => download(file)); };
        document.querySelector<HTMLButtonElement>('#chat-files-preview-copy')!.onclick = () => { void run(() => copy(file.absolutePath || file.relativePath)); };
        el('chat-files-preview-feedback')!.textContent = '';
        const body = el('chat-files-preview-body')!;
        openAppModal(modal, { display: 'flex', focusSelector: '[data-action="chat-files.previewClose"]' });
        const kind = previewKind(file.name);
        const limit = kind === 'text' ? 2 * 1024 ** 2 : 20 * 1024 ** 2;
        if (kind === 'other' || (file.size || 0) > limit) { body.innerHTML = `<div class="fm-empty">${icon('file')}<h3>${kind === 'other' ? 'Preview not available' : 'File too large to preview'}</h3><p>Download this file to open it on your device.</p></div>`; return; }
        body.innerHTML = '<div class="fm-empty" role="status">Loading preview…</div>';
        try {
            // Download resolves each store's authorized virtual token; /content is upload-only.
            const response = await deps.service.download(file.relativePath, previewRequest.signal);
            if (!response.ok) throw await responseError(response);
            const length = Number(response.headers.get('Content-Length'));
            if (length > limit) { await response.body?.cancel(); throw new Error('File too large to preview. Download it to open locally.'); }
            // Bound reads even when a proxy omits Content-Length or file metadata is stale.
            const chunks: BlobPart[] = []; let received = 0;
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Preview content is unavailable. Download the file instead.');
            for (;;) {
                const chunk = await reader.read(); if (chunk.done) break;
                received += chunk.value.byteLength;
                if (received > limit) { await reader.cancel(); throw new Error('File too large to preview. Download it to open locally.'); }
                chunks.push(chunk.value);
            }
            const blob = new Blob(chunks);
            if (token !== previewGeneration || disposed) return;
            if (blob.size > limit) throw new Error('File too large to preview. Download it to open locally.');
            body.replaceChildren();
            if (kind === 'text') {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
                if (token !== previewGeneration || disposed) return;
                if (text.includes('\0')) throw new Error('This file contains binary data. Download it to open locally.');
                const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'File contents'); pre.textContent = text || 'This file is empty.'; body.appendChild(pre);
            } else if (kind === 'image') {
                const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
                previewUrl = URL.createObjectURL(new Blob([blob], { type: types[file.name.split('.').pop()!.toLowerCase()] }));
                const image = document.createElement('img'); image.src = previewUrl; image.alt = 'Preview of ' + file.name;
                image.onerror = () => { if (token === previewGeneration) body.innerHTML = '<div class="fm-empty" role="alert">This image could not be displayed. Download it to open locally.</div>'; }; body.appendChild(image);
            } else {
                const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
                if (token !== previewGeneration || disposed) return;
                if (signature !== '%PDF-') throw new Error('This file is not a valid PDF. Download it to inspect locally.');
                previewUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
                const frame = document.createElement('iframe'); frame.title = 'PDF preview of ' + file.name; frame.setAttribute('sandbox', ''); frame.src = previewUrl; body.appendChild(frame);
                const fallback = document.createElement('p'); fallback.className = 'fm-preview-fallback'; fallback.textContent = 'If your browser cannot display this PDF securely, use Download to open it locally.'; body.appendChild(fallback);
            }
        } catch (error) { if (token === previewGeneration && !disposed) body.innerHTML = `<div class="fm-empty" role="alert"><h3>Preview unavailable</h3><p>${esc(error instanceof Error ? error.message : 'Could not load preview. Download this file instead.')}</p></div>`; }
    }
    function uploadTarget(): UploadTarget | undefined {
        if (path.startsWith('uploads/')) return { relativeDir: path.slice('uploads/'.length) };
        const conversationId = value('chat-files-filter-conv');
        if (!conversationId) { status('Choose a conversation before uploading. Files will stay associated with that conversation.'); field('chat-files-filter-conv')?.focus(); return; }
        return { conversationId };
    }
    async function upload(fileList: FileList | File[]) {
        if (uploadBusy || !allow('files:write')) return;
        const target = uploadTarget(); if (!target) return;
        const context = project;
        uploadBusy = true; render();
        const progress = el('chat-files-upload-progress')!; progress.hidden = false;
        try {
            for (const file of Array.from(fileList)) {
                if (disposed || context !== project) break;
                const update = (percent: number) => { el('chat-files-upload-progress-fill')!.style.width = Math.max(0, Math.min(100, percent)) + '%'; el('chat-files-upload-progress-label')!.textContent = `Uploading ${file.name} · ${Math.round(percent)}%`; };
                update(0); const response = await deps.service.upload(file, target, update);
                if (!response.ok) throw await responseError(response);
            }
            if (context === project) { page = 1; await load(); status('Upload complete. Your files are ready.'); }
        } finally { uploadBusy = false; progress.hidden = true; if (!disposed) render(); }
    }
    function mutable(file: ChatFile | undefined, permission: string): file is ChatFile { return !!file && fileSource(file) === 'upload' && validPath(file.relativePath) && allow(permission); }
    async function edit(file: ChatFile) {
        if (!mutable(file, 'files:write')) return;
        if (previewKind(file.name) !== 'text' || (file.size || 0) > 2 * 1024 ** 2) { status('This file cannot be edited as text here. Download it to edit locally.'); return; }
        const context = project, conversation = value('chat-files-filter-conv');
        const response = await deps.service.content(file.relativePath); if (!response.ok) throw await responseError(response);
        const data = await response.json(); if (disposed || context !== project || conversation !== value('chat-files-filter-conv')) return;
        editing = file.relativePath; el('chat-files-edit-path')!.textContent = editing; setValue('chat-files-edit-textarea', String(data.content ?? '')); openAppModal('chat-files-edit-modal');
    }
    async function remove(pathToDelete: string, folder = false) {
        if (!allow('files:delete') || !validPath(pathToDelete)) return;
        if (!browser.confirm(folder ? 'Delete this folder and everything inside it? This cannot be undone.' : 'Delete this file? This cannot be undone.')) return;
        const response = await deps.service.remove(pathToDelete); if (!response.ok) throw await responseError(response); await load();
    }
    function relativeFolder() { const storage = storageRoots.find(item => path === item.key || path.startsWith(item.key + '/')); return storage ? storage.prefix + path.slice(storage.key.length + 1) || '.' : ''; }
    async function copyFolder() { const response = await deps.service.directory(relativeFolder()); if (!response.ok) throw await responseError(response); const data = await response.json(); if (!data.absolutePath) throw new Error('Folder path unavailable.'); await copy(data.absolutePath); }
    function clearFilters() { setValue('chat-files-filter-name', ''); setValue('chat-files-filter-source', 'all'); setValue('chat-files-filter-type', 'all'); setValue('chat-files-group-by', 'none'); page = 1; render(); }
    const selectedFile = (element: HTMLElement) => displayed[Number(element.dataset.idx)];
    const withFile = (element: HTMLElement, action: (file: ChatFile) => Promise<void>) => { const file = selectedFile(element); closeMenus(); if (file) void run(() => action(file)); };
    const actions = {
        'chat-files.load': () => { void loadConversations(); void load(); },
        'chat-files.reset': () => { page = 1; try { browser.localStorage.setItem('csai_chat_files_group_by', value('chat-files-group-by')); } catch { /* storage may be unavailable */ } render(); },
        'chat-files.clear': clearFilters,
        'chat-files.filterName': () => { browser.clearTimeout(searchTimer); searchTimer = browser.setTimeout(() => { page = 1; render(); }, 150); },
        'chat-files.conversation': () => { path = ''; page = 1; void load(); },
        'chat-files.navigate': (element: HTMLElement) => navigate(element.dataset.path || ''),
        'chat-files.expand': (element: HTMLElement) => { const key = element.dataset.path || ''; if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderTree(); document.querySelector<HTMLElement>(`[data-action="chat-files.expand"][data-path="${CSS.escape(key)}"]`)?.focus(); },
        'chat-files.moreFolders': (element: HTMLElement) => { const key = element.dataset.path || ''; folderLimits.set(key, (folderLimits.get(key) || 100) + 100); renderTree(); },
        'chat-files.explorer': () => { explorerOpen = !explorerOpen; syncExplorer(); if (!explorerOpen) el('chat-files-explorer-toggle')?.focus(); },
        'chat-files.page': (element: HTMLElement) => { page = Math.min(Math.max(1, Number(element.dataset.page)), Math.max(1, Math.ceil(total / pageSize))); render(); el('chat-files-list-wrap')?.scrollTo(0, 0); },
        'chat-files.pageSize': (element: HTMLElement) => { const size = Number((element as HTMLSelectElement).value); if (![10, 20, 50, 100].includes(size)) return; pageSize = size; try { browser.localStorage.setItem('csai_chat_files_page_size', String(size)); } catch { /* storage may be unavailable */ } page = 1; render(); },
        'chat-files.preview': (element: HTMLElement) => withFile(element, preview),
        'chat-files.previewClose': closePreview,
        'chat-files.download': (element: HTMLElement) => withFile(element, download),
        'chat-files.moreMenu': (element: HTMLElement, event: Event) => {
            event.stopPropagation(); const menu = el('chat-files-menu-' + element.dataset.idx); if (!menu) return;
            const wasOpen = !menu.hidden; closeMenus(); if (wasOpen) return;
            menu.hidden = false; element.setAttribute('aria-expanded', 'true');
            const box = element.getBoundingClientRect(); const size = menu.getBoundingClientRect();
            menu.style.top = Math.max(8, Math.min(box.bottom + 4, browser.innerHeight - size.height - 8)) + 'px';
            menu.style.left = Math.max(8, Math.min(box.right - size.width, browser.innerWidth - size.width - 8)) + 'px';
            menu.querySelector<HTMLElement>('button')?.focus();
        },
        'chat-files.menu.copy': (element: HTMLElement) => withFile(element, file => copy(file.absolutePath || file.relativePath)),
        'chat-files.menu.download': (element: HTMLElement) => withFile(element, download),
        'chat-files.menu.conversation': (element: HTMLElement) => withFile(element, async file => { browser.location.hash = 'chat?conversation=' + encodeURIComponent(file.conversationId!); deps.switchPage('chat'); deps.loadConversation(file.conversationId!); }),
        'chat-files.menu.edit': (element: HTMLElement) => withFile(element, edit),
        'chat-files.menu.rename': (element: HTMLElement) => withFile(element, async file => { if (!mutable(file, 'files:write')) return; renaming = file.relativePath; setValue('chat-files-rename-input', file.name); el('chat-files-rename-path-hint')!.textContent = renaming; openAppModal('chat-files-rename-modal'); }),
        'chat-files.menu.delete': (element: HTMLElement) => withFile(element, async file => { if (mutable(file, 'files:delete')) await remove(file.relativePath); }),
        'chat-files.renameClose': () => closeAppModal('chat-files-rename-modal'),
        'chat-files.renameSubmit': () => { void run(async () => { const name = value('chat-files-rename-input').trim(); if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Enter a file name without slashes.'); if (!renaming || !allow('files:write')) return; const response = await deps.service.rename(renaming, name); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-rename-modal'); await load(); }); },
        'chat-files.editClose': () => closeAppModal('chat-files-edit-modal'),
        'chat-files.editSave': () => { void run(async () => { if (!editing || !allow('files:write')) return; const response = await deps.service.save(editing, value('chat-files-edit-textarea')); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-edit-modal'); await load(); }); },
        'chat-files.mkdir': () => { if (!path.startsWith('uploads') || !allow('files:write')) return; setValue('chat-files-mkdir-input', ''); el('chat-files-mkdir-parent-hint')!.textContent = relativeFolder(); openAppModal('chat-files-mkdir-modal'); },
        'chat-files.mkdirClose': () => closeAppModal('chat-files-mkdir-modal'),
        'chat-files.mkdirSubmit': () => { void run(async () => { const name = value('chat-files-mkdir-input').trim(); if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Enter a folder name without slashes.'); if (!path.startsWith('uploads') || !allow('files:write')) return; const response = await deps.service.mkdir(path === 'uploads' ? '' : path.slice('uploads/'.length), name); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-mkdir-modal'); await load(); }); },
        'chat-files.deleteFolder': () => { if (path.startsWith('uploads/')) void run(() => remove(path.slice('uploads/'.length), true)); },
        'chat-files.copyFolderPath': () => { void run(copyFolder); },
        'chat-files.uploadPicker': () => { if (uploadBusy || !allow('files:write')) return; if (!path.startsWith('uploads/') && !value('chat-files-filter-conv')) { uploadTarget(); return; } document.querySelector<HTMLInputElement>('#chat-files-upload-input')?.click(); },
        'chat-files.uploadPick': (element: HTMLElement) => { const input = element as HTMLInputElement; if (input.files?.length) { const selected = Array.from(input.files); input.value = ''; void run(() => upload(selected)); } },
        'chat-files.pickFile': () => el('chat-file-input')?.click(),
        'chat-files.export': () => { if (!project || path || value('chat-files-filter-type') !== 'all') return; void run(async () => { const response = await deps.service.export(filters()); if (!response.ok) throw await responseError(response); saveBlob(await response.blob(), response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)/)?.[1] || 'project-files.zip'); status('Export downloaded.'); }); },
    };
    function initPage() {
        try {
            const size = Number(browser.localStorage.getItem('csai_chat_files_page_size')); if ([10, 20, 50, 100].includes(size)) pageSize = size;
            const grouping = browser.localStorage.getItem('csai_chat_files_group_by'); if (grouping && ['none', 'date', 'conversation', 'project', 'folder'].includes(grouping)) setValue('chat-files-group-by', grouping);
        } catch { /* browser storage is optional */ }
        requestedConversation = new URLSearchParams(browser.location.hash.split('?')[1] || '').get('conversation') || '';
        syncExplorer(); projectChanged(true);
    }
    return {
        initPage,
        getState: () => ({ files: files.map(file => ({ ...file })), folders: [...folders], displayed: displayed.map(file => ({ ...file })), browsePath: path.split('/').filter(Boolean), page, pageSize, total, uploadBusy }),
        activate() {
            if (disposed || unbind) return;
            unbind = bindChatFilesActions(document, actions);
            unsubscribe = deps.onProjectChange?.(() => projectChanged());
            const modal = document.createElement('div'); modal.id = 'chat-files-preview-modal'; modal.className = 'modal fm-preview'; modal.style.display = 'none';
            modal.innerHTML = `<section class="fm-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-files-preview-title"><header><div>${icon('file')}<h2 id="chat-files-preview-title"></h2></div><button type="button" class="btn-icon" data-action="chat-files.previewClose" aria-label="Close file preview">${icon('close')}</button></header><dl class="fm-preview-meta" id="chat-files-preview-meta"></dl><div class="fm-preview-body" id="chat-files-preview-body"></div><footer><span id="chat-files-preview-feedback" role="status"></span><button type="button" class="btn-secondary" id="chat-files-preview-copy">${icon('copy')} Copy path</button><button type="button" class="btn-primary" id="chat-files-preview-download">${icon('download')} Download</button></footer></section>`;
            document.body.appendChild(modal);
            modal.addEventListener('click', event => { if (event.target === modal) closePreview(); }, { signal: lifecycle.signal });
            document.addEventListener('click', event => { if (!(event.target instanceof Element) || !event.target.closest('.fm-row-actions')) closeMenus(); if (!(event.target instanceof Element) || !event.target.closest('.fm-filter-menu')) { const details = document.querySelector<HTMLDetailsElement>('#chat-files-filter-menu'); if (details) details.open = false; } }, { signal: lifecycle.signal });
            document.addEventListener('keydown', event => {
                const activeModal = [modal, el('chat-files-edit-modal'), el('chat-files-rename-modal'), el('chat-files-mkdir-modal')].find(node => node?.getClientRects().length);
                if (event.key === 'Escape') {
                    if (activeModal) { event.preventDefault(); if (activeModal === modal) closePreview(); else closeAppModal(activeModal); }
                    const openMenu = document.querySelector<HTMLElement>('.fm-menu:not([hidden])'); openMenu?.parentElement?.querySelector<HTMLElement>('[data-action="chat-files.moreMenu"]')?.focus(); closeMenus(); const details = document.querySelector<HTMLDetailsElement>('#chat-files-filter-menu'); if (details?.open) { details.open = false; details.querySelector('summary')?.focus(); }
                }
                if (event.key === 'Tab' && activeModal) {
                    const nodes = [...activeModal.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),pre[tabindex],iframe')].filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1);
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                }
                if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target instanceof Element && event.target.closest('.fm-menu')) { event.preventDefault(); const buttons = [...event.target.closest('.fm-menu')!.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(event.target as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
            }, { signal: lifecycle.signal });
            document.addEventListener('languagechange', () => { if (deps.currentPage() === 'chat-files') render(); }, { signal: lifecycle.signal });
            browser.addEventListener('hashchange', () => { if (deps.currentPage() !== 'chat-files') closePreview(); }, { signal: lifecycle.signal });
            browser.addEventListener('resize', closeMenus, { signal: lifecycle.signal });
            document.addEventListener('scroll', closeMenus, { signal: lifecycle.signal, capture: true });
            const wrap = el('chat-files-list-wrap');
            wrap?.addEventListener('dragover', event => { event.preventDefault(); if (allow('files:write') && !uploadBusy) wrap.classList.add('drag-over'); }, { signal: lifecycle.signal });
            wrap?.addEventListener('dragleave', event => { if (!(event.relatedTarget instanceof Node) || !wrap.contains(event.relatedTarget)) wrap.classList.remove('drag-over'); }, { signal: lifecycle.signal });
            wrap?.addEventListener('drop', event => { event.preventDefault(); wrap.classList.remove('drag-over'); if (event.dataTransfer?.files.length) void run(() => upload(event.dataTransfer!.files)); }, { signal: lifecycle.signal });
        },
        dispose() { if (disposed) return; disposed = true; ++generation; ++conversationGeneration; browser.clearTimeout(searchTimer); closePreview(); lifecycle.abort(); unbind?.(); unsubscribe?.(); el('chat-files-preview-modal')?.remove(); },
    };
}
export type ChatFiles = ReturnType<typeof createChatFiles>;
