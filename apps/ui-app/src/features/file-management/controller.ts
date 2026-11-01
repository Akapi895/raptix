import { openAppModal, closeAppModal } from '../../ui/modal';
import { formatMarkdownToHtml } from '../../ui/markdown';
import type { Translate } from '../chat/types';
import type { ChatFilesService } from './service';
import { bindChatFilesActions } from './view';
import { buildFolders, bytes, fileComparator, fileSource, filesByParent, isMarkdownFile, previewKind, storageRoots, treePath, validPath, type ChatFile, type Folder, type SortKey, type UploadTarget } from './model';
import { esc, folderLabel, icon, sourceLabel, treeMarkup, type TreeFileNode, type TreeFolderNode, type TreeNode } from './manager-view';

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

const FILE_PAGE_STEP = 200;
const GROUP_PAGE_STEP = 200;

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
    let project = '';
    let generation = 0, conversationGeneration = 0, previewGeneration = 0, disposed = false, uploadBusy = false, loading = false;
    let previewUrl = '', editing = '', renaming = '', mkdirParent = '', uploadHereTarget = '';
    let previewMode: 'rendered' | 'raw' = 'rendered', previewMarkdownRaw = '';
    let previewRequest: AbortController | undefined;
    let unbind: (() => void) | undefined, unsubscribe: (() => void) | undefined;
    let searchTimer: number | undefined;
    let requestedConversation = '';
    let activeKey: string | null = null;
    let groupFileLimit = GROUP_PAGE_STEP;
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
        document.querySelectorAll('[data-action="chat-files.moreMenu"], [data-action="chat-files.folderMenu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
    function allRows(): HTMLElement[] {
        const root = el('chat-files-tree-root');
        return root ? [...root.querySelectorAll<HTMLElement>('.fm-row[tabindex]')] : [];
    }
    function rowKey(row: HTMLElement): string {
        return row.classList.contains('fm-row-folder') ? 'folder:' + (row.dataset.path || '') : 'file:' + (row.dataset.rel || '');
    }
    function syncRovingTabindex() {
        const rows = allRows(); if (!rows.length) return;
        const target = (activeKey ? rows.find(row => rowKey(row) === activeKey) : undefined) || rows[0];
        rows.forEach(row => { row.tabIndex = row === target ? 0 : -1; });
    }
    function reRenderAndFocus() { render(); const target = allRows().find(row => rowKey(row) === activeKey); target?.focus(); }
    /** Maps a tree path (e.g. "uploads/uploads/<conversation>") to the real `<projectId>/<sandbox-relative>`
     *  path the API expects. Every bucket strips to the sandbox-relative part except the synthetic 'uploads'
     *  bucket root itself, which has no sandbox-relative equivalent of its own -- it IS the real uploads/ dir. */
    function relativeFolderFor(folderPath: string): string {
        if (folderPath === 'uploads') return `${project}/uploads`;
        const storage = storageRoots.find(item => folderPath.startsWith(item.key + '/'));
        const rel = storage ? folderPath.slice(storage.key.length + 1) : folderPath;
        return rel ? `${project}/${rel}` : project;
    }
    function fileSecondary(file: ChatFile, flat: boolean): string {
        if (flat) return treePath(file).split('/').slice(0, -1).join(' / ');
        return file.conversationTitle || (file.conversationId && !file.conversationId.startsWith('_') ? file.conversationId : '');
    }
    function buildFolderNode(folder: Folder, depth: number, byParent: Map<string, ChatFile[]>, matches: (file: ChatFile) => boolean, comparator: (a: ChatFile, b: ChatFile) => number, filtering: boolean, alwaysShow = false): TreeFolderNode | null {
        const subfolders = [...folder.children.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const childNodes: TreeFolderNode[] = [];
        let visibleCount = 0;
        for (const sub of subfolders) {
            const built = buildFolderNode(sub, depth + 1, byParent, matches, comparator, filtering);
            if (built) { childNodes.push(built); visibleCount += built.visibleCount; }
        }
        const directFiles = (byParent.get(folder.path) || []).filter(matches).sort(comparator);
        visibleCount += directFiles.length;
        if (visibleCount === 0 && filtering && !alwaysShow) return null;
        const open = expanded.has(folder.path);
        const limit = open ? (folderLimits.get(folder.path) || FILE_PAGE_STEP) : 0;
        const shownFiles = open ? directFiles.slice(0, limit) : [];
        const fileNodes: TreeFileNode[] = shownFiles.map(file => ({ kind: 'file', file, idx: displayed.push(file) - 1, depth: depth + 1, secondary: fileSecondary(file, false) }));
        return {
            kind: 'folder', path: folder.path, name: folderLabel(folder.path, files), depth, open, visibleCount,
            tag: depth === 0 && folder.path !== 'uploads' ? 'Read-only' : undefined,
            children: open ? [...childNodes, ...fileNodes] : [],
            moreFiles: open && directFiles.length > limit ? directFiles.length - limit : undefined,
        };
    }
    function emptyStateMarkup(filtering: boolean): string {
        return `<div class="fm-empty">${icon('folder')}<h3>${filtering ? 'No matching files' : 'No project files yet'}</h3><p>${filtering ? 'Try another search or clear your filters.' : 'Upload files to a conversation, or generate files in the workspace.'}</p>${filtering ? '<button type="button" class="btn-secondary" data-action="chat-files.clear">Clear filters</button>' : ''}</div>`;
    }
    function render() {
        if (loading) return;
        const wrap = el('chat-files-list-wrap'); if (!wrap) return;
        closeMenus();
        const query = value('chat-files-filter-name').trim().toLocaleLowerCase();
        const source = value('chat-files-filter-source') || 'all';
        const type = value('chat-files-filter-type') || 'all';
        const group = value('chat-files-group-by');
        const sort = (['name-asc', 'name-desc', 'size-asc', 'size-desc', 'modified-asc', 'modified-desc'].includes(value('chat-files-sort')) ? value('chat-files-sort') : 'modified-desc') as SortKey;
        const comparator = fileComparator(sort);
        const matches = (file: ChatFile) => (source === 'all' || fileSource(file) === source) && (type === 'all' || previewKind(file.name) === type) &&
            (!query || [file.name, file.relativePath, file.conversationTitle].some(text => text?.toLocaleLowerCase().includes(query)));
        displayed = [];
        wrap.setAttribute('aria-busy', 'false');
        const filtering = query !== '' || source !== 'all' || type !== 'all';
        let nodes: TreeNode[];
        if (group !== 'none') {
            const matched = files.filter(matches).sort(comparator);
            const shown = matched.slice(0, groupFileLimit);
            const groups = new Map<string, ChatFile[]>();
            shown.forEach(file => {
                const key = group === 'date' ? file.date || 'No date' : group === 'project' ? file.projectName || file.projectId || 'No project' : file.conversationTitle || file.conversationId || 'No conversation';
                (groups.get(key) ?? groups.set(key, []).get(key)!).push(file);
            });
            nodes = [...groups].map(([key, entries]) => ({
                kind: 'folder', path: 'group:' + key, name: key, depth: 0, open: true, visibleCount: entries.length, virtual: true,
                children: entries.map(file => ({ kind: 'file', file, idx: displayed.push(file) - 1, depth: 1, secondary: fileSecondary(file, false) } satisfies TreeFileNode)),
            } satisfies TreeFolderNode));
            wrap.innerHTML = shown.length ? treeMarkup(nodes, allow) + (matched.length > shown.length ? `<button type="button" class="btn-secondary fm-show-more" data-action="chat-files.showMoreFlat">Show ${Math.min(GROUP_PAGE_STEP, matched.length - shown.length)} more</button>` : '') : emptyStateMarkup(filtering);
        } else if (query) {
            const matched = files.filter(matches).sort(comparator);
            nodes = matched.map(file => ({ kind: 'file', file, idx: displayed.push(file) - 1, depth: 0, secondary: fileSecondary(file, true) }));
            wrap.innerHTML = nodes.length ? treeMarkup(nodes, allow) : emptyStateMarkup(true);
        } else {
            const byParent = filesByParent(files);
            const order = ['uploads', 'workspace', 'tool_outputs', 'conversation_artifacts'];
            nodes = order.map(key => root.children.get(key))
                .filter((folder): folder is Folder => !!folder)
                .map(folder => buildFolderNode(folder, 0, byParent, matches, comparator, filtering, folder.path === 'uploads' || folder.path === 'workspace'))
                .filter((node): node is TreeFolderNode => node !== null);
            wrap.innerHTML = nodes.length ? treeMarkup(nodes, allow) : emptyStateMarkup(filtering);
        }
        syncRovingTabindex();
        const count = el('chat-files-filter-count'); if (count) { const n = Number(source !== 'all') + Number(type !== 'all') + Number(group !== 'none'); count.textContent = n ? String(n) : ''; }
        const upload = document.querySelector<HTMLButtonElement>('#chat-files-header-upload-btn');
        if (upload) { upload.disabled = uploadBusy || !allow('files:write'); upload.title = 'Upload to the selected conversation, or use "Upload here" inside an uploads folder.'; }
        const exportButton = document.querySelector<HTMLButtonElement>('#chat-files-export-btn');
        if (exportButton) { exportButton.disabled = type !== 'all'; exportButton.title = type !== 'all' ? 'Clear the file type filter to export results.' : 'Export files matching the current project, conversation, source and search.'; }
        const matchedAll = files.filter(matches);
        const summary = el('chat-files-summary');
        if (summary) summary.textContent = `${matchedAll.length} files in this project · ${bytes(matchedAll.reduce((sum, file) => sum + (file.size || 0), 0))}`;
    }
    async function responseError(response: Response | { status: number; text(): Promise<string> }): Promise<Error> {
        if (response.status === 403) return new Error('You do not have permission to access this location. Choose another folder or contact your administrator.');
        if (response.status === 404) return new Error('This file or folder is no longer available. Refresh the file list.');
        if (response.status === 413) return new Error('This file is too large to edit here. Download it to edit locally.');
        let text = await response.text(); try { const data = JSON.parse(text); text = data.error || text; } catch { /* plain error */ }
        return new Error(text || 'The operation failed. Please try again.');
    }
    async function run(task: () => Promise<void>) { try { await task(); } catch (error) { if (!disposed) status(error instanceof Error ? error.message : 'The operation failed. Please try again.'); } }
    // Raptix's /api/chat-uploads returns one directory level at a time (ADR-0102: files live in a
    // project's own sandbox tree, not a flat global bucket) -- walk every discovered folder so the
    // tree shows everything under /workspace, not just its root. Bounded: a sandbox tree is a handful
    // of folders a few levels deep in practice, but a runaway/circular listing must still terminate.
    const CRAWL_LIMIT = 500;
    async function crawlFolders(projectId: string, rootFolders: string[]): Promise<{ files: ChatFile[]; folders: string[] }> {
        const files: ChatFile[] = [];
        const folderPaths: string[] = [];
        const queue = [...rootFolders];
        let visited = 0;
        while (queue.length && visited < CRAWL_LIMIT) {
            const relPath = queue.shift()!;
            if (!validPath(relPath)) continue;
            folderPaths.push(relPath);
            visited++;
            const response = await deps.service.directory(`${projectId}/${relPath}`).catch(() => null);
            if (!response?.ok) continue;
            const data = await response.json().catch(() => null);
            if (!data) continue;
            for (const file of data.files) if (validPath(file.relativePath)) files.push(file);
            for (const folder of data.folders) if (validPath(folder)) queue.push(`${relPath}/${folder}`);
        }
        return { files, folders: folderPaths };
    }
    async function load() {
        const wrap = el('chat-files-list-wrap'); if (!wrap || disposed) return;
        const token = ++generation;
        const context = filters();
        loading = true;
        closePreview(); closeMenus(); displayed = []; files = []; folders = []; root = buildFolders([], []);
        groupFileLimit = GROUP_PAGE_STEP;
        status('');
        wrap.setAttribute('aria-busy', 'true'); wrap.innerHTML = '<div class="fm-empty" role="status">Loading project files…</div>';
        if (!context.project) { loading = false; wrap.setAttribute('aria-busy', 'false'); wrap.innerHTML = '<div class="fm-empty"><h3>Select a project</h3><p>Choose a project in the header to browse its files.</p></div>'; status(''); return; }
        try {
            const response = await deps.service.list({ ...context, source: 'all', search: '' }, 1, 'all');
            if (!response.ok) throw await responseError(response);
            const data = await response.json();
            const rootFolders = data.folders.filter(validPath);
            const nested = await crawlFolders(context.project, rootFolders);
            if (disposed || token !== generation) return;
            loading = false;
            files = [...data.files, ...nested.files].filter(file => validPath(file.relativePath) && (!file.projectId || file.projectId === context.project));
            folders = nested.folders;
            root = buildFolders(files, folders);
            render();
        } catch (error) {
            if (disposed || token !== generation) return;
            loading = false;
            wrap.setAttribute('aria-busy', 'false');
            wrap.innerHTML = `<div class="fm-empty" role="alert"><h3>Files unavailable</h3><p>${esc(error instanceof Error ? error.message : 'Could not load files.')}</p><button type="button" class="btn-secondary" data-action="chat-files.load">Try again</button></div>`;
            status('');
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
            else if (selected) void load();
            if (requestedConversation) {
                const requested = requestedConversation; requestedConversation = '';
                if (items.some(item => item.id === requested)) { select.value = requested; void load(); }
                else status('This conversation is not available in the selected project. Showing project files.');
            }
        } catch (error) { if (context !== project || disposed || token !== conversationGeneration) return; select.innerHTML = selected ? `<option value="${esc(selected)}">Selected conversation (unavailable)</option>` : '<option value="">Conversations unavailable</option>'; status(error instanceof Error ? error.message : 'Could not load conversations.'); }
        select.disabled = false;
    }
    function projectChanged(force = false) {
        const next = deps.activeProjectId?.() || '';
        if (!force && project === next) return;
        if (!force) requestedConversation = '';
        project = next; expanded.clear(); folderLimits.clear(); activeKey = null; uploadHereTarget = ''; closePreview();
        for (const kind of ['edit', 'rename', 'mkdir']) closeAppModal(`chat-files-${kind}-modal`);
        editing = ''; renaming = ''; mkdirParent = '';
        setValue('chat-files-filter-conv', '');
        if (deps.currentPage() === 'file-management') { void loadConversations(); void load(); }
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
    async function copyFolderPath(folderPath: string) {
        const response = await deps.service.directory(relativeFolderFor(folderPath)); if (!response.ok) throw await responseError(response);
        const data = await response.json(); if (!data.absolutePath) throw new Error('Folder path unavailable.');
        await copy(data.absolutePath);
    }
    function closePreview() {
        ++previewGeneration; previewRequest?.abort(); previewRequest = undefined; closeAppModal('chat-files-preview-modal');
        if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewMode = 'rendered'; previewMarkdownRaw = '';
        const body = el('chat-files-preview-body'); if (body) body.replaceChildren();
        const modes = el('chat-files-preview-modes'); if (modes) modes.hidden = true;
    }
    function renderPreviewBody() {
        const body = el('chat-files-preview-body'); if (!body) return;
        if (previewMode === 'raw') {
            body.replaceChildren();
            const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Raw Markdown source'); pre.textContent = previewMarkdownRaw || 'This file is empty.';
            body.appendChild(pre);
            return;
        }
        body.innerHTML = previewMarkdownRaw ? formatMarkdownToHtml(previewMarkdownRaw) : '<p class="fm-preview-fallback">This file is empty.</p>';
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
                if (isMarkdownFile(file.name)) {
                    previewMarkdownRaw = text; previewMode = 'rendered';
                    const modes = el('chat-files-preview-modes');
                    if (modes) { modes.hidden = false; modes.querySelectorAll<HTMLElement>('.fm-mode-btn').forEach(button => { const active = button.dataset.mode === 'rendered'; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }); }
                    renderPreviewBody();
                } else {
                    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'File contents'); pre.textContent = text || 'This file is empty.'; body.appendChild(pre);
                }
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
        if (uploadHereTarget) { const target = { relativeDir: relativeFolderFor(uploadHereTarget) }; uploadHereTarget = ''; return target; }
        const conversationId = value('chat-files-filter-conv');
        if (!conversationId) { status('Choose a conversation before uploading, or use "Upload here" inside an uploads folder.'); field('chat-files-filter-conv')?.focus(); return; }
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
            if (context === project) { await load(); status('Upload complete. Your files are ready.'); }
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
    function clearFilters() { setValue('chat-files-filter-name', ''); setValue('chat-files-filter-source', 'all'); setValue('chat-files-filter-type', 'all'); setValue('chat-files-group-by', 'none'); groupFileLimit = GROUP_PAGE_STEP; render(); }
    const selectedFile = (element: HTMLElement) => displayed[Number(element.dataset.idx)];
    const withFile = (element: HTMLElement, action: (file: ChatFile) => Promise<void>) => { const file = selectedFile(element); closeMenus(); if (file) void run(() => action(file)); };
    const actions = {
        'chat-files.load': () => { void loadConversations(); void load(); },
        'chat-files.reset': () => { try { browser.localStorage.setItem('csai_chat_files_group_by', value('chat-files-group-by')); } catch { /* storage may be unavailable */ } groupFileLimit = GROUP_PAGE_STEP; render(); },
        'chat-files.clear': clearFilters,
        'chat-files.filterName': () => { browser.clearTimeout(searchTimer); searchTimer = browser.setTimeout(() => render(), 150); },
        'chat-files.conversation': () => void load(),
        'chat-files.expand': (element: HTMLElement) => { const path = element.dataset.path || ''; if (expanded.has(path)) expanded.delete(path); else expanded.add(path); activeKey = 'folder:' + path; reRenderAndFocus(); },
        'chat-files.moreFiles': (element: HTMLElement) => { const path = element.dataset.path || ''; folderLimits.set(path, (folderLimits.get(path) || FILE_PAGE_STEP) + FILE_PAGE_STEP); render(); },
        'chat-files.showMoreFlat': () => { groupFileLimit += GROUP_PAGE_STEP; render(); },
        'chat-files.preview': (element: HTMLElement) => withFile(element, preview),
        'chat-files.previewClose': closePreview,
        'chat-files.previewMode': (element: HTMLElement) => {
            const mode = element.dataset.mode === 'raw' ? 'raw' : 'rendered'; if (mode === previewMode) return;
            previewMode = mode; renderPreviewBody();
            document.querySelectorAll<HTMLElement>('#chat-files-preview-modes .fm-mode-btn').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
        },
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
        'chat-files.folderMenu': (element: HTMLElement, event: Event) => {
            event.stopPropagation(); const menu = el('chat-files-fmenu-' + (element.dataset.path || '')); if (!menu) return;
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
        'chat-files.menu.copyFolder': (element: HTMLElement) => { const path = element.dataset.path || ''; closeMenus(); void run(() => copyFolderPath(path)); },
        'chat-files.menu.mkdir': (element: HTMLElement) => {
            const path = element.dataset.path || ''; closeMenus();
            if (!path.startsWith('uploads') || !allow('files:write')) return;
            mkdirParent = path; setValue('chat-files-mkdir-input', ''); el('chat-files-mkdir-parent-hint')!.textContent = relativeFolderFor(path); openAppModal('chat-files-mkdir-modal');
        },
        'chat-files.menu.uploadHere': (element: HTMLElement) => {
            const path = element.dataset.path || ''; closeMenus();
            if (uploadBusy || !allow('files:write')) return;
            uploadHereTarget = path; document.querySelector<HTMLInputElement>('#chat-files-upload-input')?.click();
        },
        'chat-files.menu.deleteFolder': (element: HTMLElement) => { const path = element.dataset.path || ''; closeMenus(); if (path.startsWith('uploads/')) void run(() => remove(relativeFolderFor(path), true)); },
        'chat-files.renameClose': () => closeAppModal('chat-files-rename-modal'),
        'chat-files.renameSubmit': () => { void run(async () => { const name = value('chat-files-rename-input').trim(); if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Enter a file name without slashes.'); if (!renaming || !allow('files:write')) return; const response = await deps.service.rename(renaming, name); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-rename-modal'); await load(); }); },
        'chat-files.editClose': () => closeAppModal('chat-files-edit-modal'),
        'chat-files.editSave': () => { void run(async () => { if (!editing || !allow('files:write')) return; const response = await deps.service.save(editing, value('chat-files-edit-textarea')); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-edit-modal'); await load(); }); },
        'chat-files.mkdirClose': () => closeAppModal('chat-files-mkdir-modal'),
        'chat-files.mkdirSubmit': () => { void run(async () => { const name = value('chat-files-mkdir-input').trim(); if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Enter a folder name without slashes.'); if (!mkdirParent.startsWith('uploads') || !allow('files:write')) return; const response = await deps.service.mkdir(relativeFolderFor(mkdirParent), name); if (!response.ok) throw await responseError(response); closeAppModal('chat-files-mkdir-modal'); expanded.add(mkdirParent); await load(); }); },
        'chat-files.uploadPicker': () => { if (uploadBusy || !allow('files:write')) return; if (!value('chat-files-filter-conv')) { uploadTarget(); return; } document.querySelector<HTMLInputElement>('#chat-files-upload-input')?.click(); },
        'chat-files.uploadPick': (element: HTMLElement) => { const input = element as HTMLInputElement; if (input.files?.length) { const selected = Array.from(input.files); input.value = ''; void run(() => upload(selected)); } },
        'chat-files.pickFile': () => el('chat-file-input')?.click(),
        'chat-files.export': () => { if (!project || value('chat-files-filter-type') !== 'all') return; void run(async () => { const response = await deps.service.export(filters()); if (!response.ok) throw await responseError(response); saveBlob(await response.blob(), response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)/)?.[1] || 'project-files.zip'); status('Export downloaded.'); }); },
    };
    function initPage() {
        try {
            const grouping = browser.localStorage.getItem('csai_chat_files_group_by'); if (grouping && ['none', 'date', 'conversation', 'project'].includes(grouping)) setValue('chat-files-group-by', grouping);
        } catch { /* browser storage is optional */ }
        requestedConversation = new URLSearchParams(browser.location.hash.split('?')[1] || '').get('conversation') || '';
        projectChanged(true);
    }
    return {
        initPage,
        getState: () => ({ files: files.map(file => ({ ...file })), folders: [...folders], displayed: displayed.map(file => ({ ...file })), uploadBusy }),
        activate() {
            if (disposed || unbind) return;
            unbind = bindChatFilesActions(document, actions);
            unsubscribe = deps.onProjectChange?.(() => projectChanged());
            const modal = document.createElement('div'); modal.id = 'chat-files-preview-modal'; modal.className = 'modal fm-preview'; modal.style.display = 'none';
            modal.innerHTML = `<section class="fm-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-files-preview-title"><header><div>${icon('file')}<h2 id="chat-files-preview-title"></h2></div><div class="fm-preview-modes" id="chat-files-preview-modes" role="group" aria-label="View mode" hidden><button type="button" class="fm-mode-btn is-active" data-action="chat-files.previewMode" data-mode="rendered" aria-pressed="true">Rendered</button><button type="button" class="fm-mode-btn" data-action="chat-files.previewMode" data-mode="raw" aria-pressed="false">Raw</button></div><button type="button" class="btn-icon" data-action="chat-files.previewClose" aria-label="Close file preview">${icon('close')}</button></header><dl class="fm-preview-meta" id="chat-files-preview-meta"></dl><div class="fm-preview-body" id="chat-files-preview-body"></div><footer><span id="chat-files-preview-feedback" role="status"></span><button type="button" class="btn-secondary" id="chat-files-preview-copy">${icon('copy')} Copy path</button><button type="button" class="btn-primary" id="chat-files-preview-download">${icon('download')} Download</button></footer></section>`;
            document.body.appendChild(modal);
            modal.addEventListener('click', event => { if (event.target === modal) closePreview(); }, { signal: lifecycle.signal });
            document.addEventListener('click', event => { if (!(event.target instanceof Element) || !event.target.closest('.fm-row-actions')) closeMenus(); if (!(event.target instanceof Element) || !event.target.closest('.fm-filter-menu')) { const details = document.querySelector<HTMLDetailsElement>('#chat-files-filter-menu'); if (details) details.open = false; } }, { signal: lifecycle.signal });
            document.addEventListener('keydown', event => {
                const activeModal = [modal, el('chat-files-edit-modal'), el('chat-files-rename-modal'), el('chat-files-mkdir-modal')].find(node => node?.getClientRects().length);
                if (event.key === 'Escape') {
                    if (activeModal) { event.preventDefault(); if (activeModal === modal) closePreview(); else closeAppModal(activeModal); }
                    const openMenu = document.querySelector<HTMLElement>('.fm-menu:not([hidden])'); openMenu?.parentElement?.querySelector<HTMLElement>('[data-action="chat-files.moreMenu"], [data-action="chat-files.folderMenu"]')?.focus(); closeMenus(); const details = document.querySelector<HTMLDetailsElement>('#chat-files-filter-menu'); if (details?.open) { details.open = false; details.querySelector('summary')?.focus(); }
                }
                if (event.key === 'Tab' && activeModal) {
                    const nodes = [...activeModal.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),pre[tabindex],iframe')].filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1);
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                }
                if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target instanceof Element && event.target.closest('.fm-menu')) { event.preventDefault(); const buttons = [...event.target.closest('.fm-menu')!.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(event.target as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
                const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.fm-row') : null;
                const treeRoot = el('chat-files-tree-root');
                if (!row || !treeRoot || !treeRoot.contains(row)) return;
                const rows = allRows(); const index = rows.indexOf(row);
                const move = (next: HTMLElement | undefined) => { if (!next) return; event.preventDefault(); rows.forEach(candidate => { candidate.tabIndex = -1; }); next.tabIndex = 0; next.focus(); activeKey = rowKey(next); };
                if (event.key === 'ArrowDown') move(rows[index + 1]);
                else if (event.key === 'ArrowUp') move(rows[index - 1]);
                else if (event.key === 'Home') move(rows[0]);
                else if (event.key === 'End') move(rows.at(-1));
                else if (event.key === 'ArrowRight' && row.classList.contains('fm-row-folder')) {
                    const path = row.dataset.path || '';
                    if (!expanded.has(path)) { event.preventDefault(); expanded.add(path); activeKey = 'folder:' + path; reRenderAndFocus(); } else move(rows[index + 1]);
                } else if (event.key === 'ArrowLeft') {
                    if (row.classList.contains('fm-row-folder') && expanded.has(row.dataset.path || '')) { event.preventDefault(); expanded.delete(row.dataset.path || ''); activeKey = rowKey(row); reRenderAndFocus(); }
                    else { const parentRow = row.closest('li')?.parentElement?.closest<HTMLElement>('li[role="treeitem"]')?.querySelector<HTMLElement>('.fm-row'); move(parentRow || undefined); }
                } else if (event.key === 'Enter' || event.key === ' ') {
                    if (row.classList.contains('fm-row-folder')) { event.preventDefault(); const path = row.dataset.path || ''; if (expanded.has(path)) expanded.delete(path); else expanded.add(path); activeKey = rowKey(row); reRenderAndFocus(); }
                    else { event.preventDefault(); row.querySelector<HTMLButtonElement>('.fm-file-open')?.click(); }
                }
            }, { signal: lifecycle.signal });
            document.addEventListener('languagechange', () => { if (deps.currentPage() === 'file-management') render(); }, { signal: lifecycle.signal });
            browser.addEventListener('hashchange', () => { if (deps.currentPage() !== 'file-management') closePreview(); }, { signal: lifecycle.signal });
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
