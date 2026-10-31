import { record } from '../chat/stream';
import { fileQuery, type ChatFile, type FileFilters, type UploadTarget } from './model';

export type Request = (url: string, init?: RequestInit) => Promise<Response>;
export type Upload = (url: string, form: FormData, options: { onProgress(progress: { percent: number }): void }) => Promise<Response>;
export interface FilesPayload {
    files: ChatFile[]; folders: string[]; total?: unknown; page?: unknown; pageSize?: unknown;
    error?: string; content?: unknown; absolutePath?: string; ok?: unknown;
}
export interface FilesResponse extends Omit<Response, 'json'> { json(): Promise<FilesPayload> }
async function decode(response: Response): Promise<FilesResponse> {
    // Retain response text/blob/error semantics, but never leak Response.json's untyped value.
    return {
        get ok() { return response.ok; }, get status() { return response.status; },
        get headers() { return response.headers; }, get body() { return response.body; },
        get bodyUsed() { return response.bodyUsed; }, get redirected() { return response.redirected; },
        get statusText() { return response.statusText; }, get type() { return response.type; }, get url() { return response.url; },
        clone: () => response.clone(), arrayBuffer: () => response.arrayBuffer(), blob: () => response.blob(),
        bytes: () => response.bytes(), formData: () => response.formData(), text: () => response.text(),
        async json() {
            const data = record(await response.json());
            return {
                files: Array.isArray(data.files) ? data.files.filter((file): file is ChatFile => {
                    const value = record(file); return typeof value.relativePath === 'string' && typeof value.name === 'string';
                }) : [],
                folders: Array.isArray(data.folders) ? data.folders.filter((path): path is string => typeof path === 'string') : [],
                total: data.total, page: data.page, pageSize: data.pageSize,
                error: typeof data.error === 'string' ? data.error : undefined,
                content: data.content, absolutePath: typeof data.absolutePath === 'string' ? data.absolutePath : undefined, ok: data.ok,
            };
        },
    };
}
export function createChatFilesService(request: Request, upload?: Upload) {
    const get = (url: string, init?: RequestInit) => request(url, init).then(decode);
    const json = (url: string, method: string, body: unknown) => get(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return {
        async conversations(project: string, offset = 0) {
            const response = await request('/api/conversations?' + new URLSearchParams({ project_id: project, limit: '200', offset: String(offset) }));
            if (!response.ok) throw new Error(response.status === 403 ? 'You do not have permission to view these conversations.' : 'Could not load conversations. Refresh to retry.');
            const raw: unknown = await response.json();
            const data = record(raw);
            const items: unknown[] = Array.isArray(raw) ? raw : Array.isArray(data.conversations) ? data.conversations : [];
            return { items: items.flatMap(item => { const value = record(item); return typeof value.id === 'string' ? [{ id: value.id, title: typeof value.title === 'string' ? value.title : value.id }] : []; }), total: Number(data.total) || items.length };
        },
        list(filters: FileFilters, page: number, size: number | 'all') { return get('/api/chat-uploads?' + fileQuery(filters, page, size)); },
        export(filters: FileFilters) { const query = fileQuery(filters).toString(); return get('/api/chat-uploads/export' + (query ? '?' + query : '')); },
        remove: (path: string) => json('/api/chat-uploads', 'DELETE', { path }),
        directory: (path: string) => get('/api/chat-uploads/path?kind=directory&path=' + encodeURIComponent(path)),
        download: (path: string, signal?: AbortSignal) => get('/api/chat-uploads/download?path=' + encodeURIComponent(path), { signal }),
        content: (path: string) => get('/api/chat-uploads/content?path=' + encodeURIComponent(path)),
        save: (path: string, content: string) => json('/api/chat-uploads/content', 'PUT', { path, content }),
        rename: (path: string, newName: string) => json('/api/chat-uploads/rename', 'PUT', { path, newName }),
        mkdir: (parent: string, name: string) => json('/api/chat-uploads/mkdir', 'POST', { parent, name }),
        async upload(file: File, target: UploadTarget, progress: (percent: number) => void) {
            const form = new FormData(); form.append('file', file);
            if (target.relativeDir) form.append('relativeDir', target.relativeDir);
            else if (target.conversationId) form.append('conversationId', target.conversationId);
            const response = upload ? await upload('/api/chat-uploads', form, { onProgress: value => progress(value.percent) })
                : await request('/api/chat-uploads', { method: 'POST', body: form });
            return decode(response);
        },
    };
}
export type ChatFilesService = ReturnType<typeof createChatFilesService>;
