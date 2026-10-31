// Files attached to the next message: each is uploaded as soon as it is chosen, shows its own progress, and is sent
// by its server path. The composer waits for uploads that are still running before it sends.

import { fitTextareaHeight } from './draft';

export const MAX_CHAT_FILES = 10;
export const CHAT_FILE_DEFAULT_PROMPT = 'Please analyze the attached file contents.';

export interface ChatAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  serverPath: string | null;
  uploading: boolean;
  uploadPercent: number;
  uploadPromise: Promise<void> | null;
  uploadError: string | null;
}

export type Translate = (key: string, fallback: string, values?: Record<string, unknown>) => string;

/** The chip text: the file name, with its state appended while it uploads or after it failed. */
export function attachmentChipLabel(attachment: ChatAttachment, t: Translate): string {
  if (attachment.uploading) return attachment.fileName + ' · ' + t('chat.attachmentUploading', 'Uploading…');
  if (attachment.uploadError) return attachment.fileName + ' · ' + t('chat.attachmentUploadFailed', 'Failed');
  return attachment.fileName;
}

export interface UploadProgress {
  visible: boolean;
  percent: number;
  detail: string;
}

/** The overall progress of the attachments: an average where a finished file counts as 100%. */
export function attachmentsProgress(attachments: readonly ChatAttachment[], t: Translate): UploadProgress {
  const uploading = attachments.filter(item => item.uploading);
  if (!attachments.length || !uploading.length) return { visible: false, percent: 0, detail: '' };
  const sum = attachments.reduce((total, item) => total + (item.uploading ? (item.uploadPercent || 0) : 100), 0);
  const percent = Math.round(sum / attachments.length);
  const done = attachments.length - uploading.length;
  const detail = t('chat.uploadingAttachmentsDetail', 'Uploading attachments · {{done}}/{{total}} done · {{percent}}% overall' + done + '/' + attachments.length + ' · ' + percent + '%', {
    done,
    total: attachments.length,
    percent,
  });
  return { visible: true, percent, detail };
}

/** The message as the user sees it in the transcript: the text with each attached file name below it. */
export function withAttachmentNames(message: string, attachments: readonly ChatAttachment[]): string {
  if (!attachments.length) return message;
  return message + '\n' + attachments.map(item => '📎 ' + item.fileName).join('\n');
}

export interface AttachmentDependencies {
  doc: Document;
  t: Translate;
  alert(text: string): void;
  /** The conversation the upload belongs to, trimmed; empty for a new chat. */
  conversationId(): string;
  /** Uploads with progress reporting; resolves with the response (the caller checks `ok`). */
  upload(form: FormData, onProgress: (percent: number) => void): Promise<Response>;
  input(): HTMLTextAreaElement | null;
}

export interface AttachmentsController {
  list(): readonly ChatAttachment[];
  add(files: ArrayLike<File>): Promise<void>;
  remove(index: number): void;
  /** Empties the list once the message has been sent. */
  clear(): void;
  renderChips(): void;
  refreshProgress(): void;
  setProgress(visible: boolean, percent?: number, detail?: string): void;
  /** Fills the default request text when the user attaches files but has typed nothing. */
  fillPromptIfEmpty(): void;
  /** Connects the file picker and the drop zone of the composer. */
  bind(): void;
  dispose(): void;
}

export function createAttachmentsController(deps: AttachmentDependencies): AttachmentsController {
  const { doc, t } = deps;
  const attachments: ChatAttachment[] = [];
  const lifecycle = new AbortController();
  let bound = false;
  let seq = 0;
  const byId = (id: string) => doc.getElementById(id);

  function setProgress(visible: boolean, percent = 0, detail = ''): void {
    const wrap = byId('chat-attachment-progress');
    const fill = byId('chat-attachment-progress-fill') as HTMLElement | null;
    const label = byId('chat-attachment-progress-label');
    if (!wrap || !fill || !label) return;
    if (!visible) {
      wrap.hidden = true;
      fill.style.width = '0%';
      label.textContent = '';
      return;
    }
    wrap.hidden = false;
    fill.style.width = Math.min(100, Math.max(0, Math.round(percent))) + '%';
    label.textContent = detail || '';
  }

  function refreshProgress(): void {
    const progress = attachmentsProgress(attachments, t);
    setProgress(progress.visible, progress.percent, progress.detail);
  }

  function renderChips(): void {
    const list = byId('chat-file-list');
    if (!list) return;
    list.innerHTML = '';
    attachments.forEach((attachment, index) => {
      const chip = doc.createElement('div');
      chip.className = 'chat-file-chip';
      if (attachment.uploading) chip.classList.add('chat-file-chip--uploading');
      if (attachment.uploadError) chip.classList.add('chat-file-chip--error');
      chip.setAttribute('role', 'listitem');
      const name = doc.createElement('span');
      name.className = 'chat-file-chip-name';
      name.title = attachment.fileName;
      name.textContent = attachmentChipLabel(attachment, t);
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'chat-file-chip-remove';
      remove.title = t('common.remove', 'Remove');
      remove.innerHTML = '×';
      remove.setAttribute('aria-label', 'Remove ' + attachment.fileName);
      remove.addEventListener('click', () => removeAt(index));
      chip.append(name, remove);
      list.appendChild(chip);
    });
  }

  function refreshAll(): void {
    if (lifecycle.signal.aborted) return;
    renderChips();
    refreshProgress();
  }

  function removeAt(index: number): void {
    attachments.splice(index, 1);
    refreshAll();
  }

  function fillPromptIfEmpty(): void {
    const input = deps.input();
    if (!input || !attachments.length) return;
    if (!input.value.trim()) {
      input.value = CHAT_FILE_DEFAULT_PROMPT;
      fitTextareaHeight(input);
    }
  }

  async function uploadOne(entry: ChatAttachment, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    const conversationId = deps.conversationId();
    if (conversationId) form.append('conversationId', conversationId);
    const current = () => attachments.find(item => item.id === entry.id);
    try {
      const response = await deps.upload(form, percent => {
        const item = current();
        if (!item) return;
        item.uploadPercent = percent;
        refreshProgress();
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json().catch(() => ({})) as { absolutePath?: unknown };
      const absolutePath = data.absolutePath ? String(data.absolutePath).trim() : '';
      if (!absolutePath) throw new Error('no absolutePath in response');
      const item = current();
      if (item) Object.assign(item, { serverPath: absolutePath, uploading: false, uploadPercent: 100, uploadError: null });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error);
      const item = current();
      if (item) Object.assign(item, { uploading: false, uploadError: message, serverPath: null });
      deps.alert(t('chat.attachmentUploadAlert', 'Upload failed: {{name}}' + file.name, { name: file.name }) + '\n' + message);
    }
    refreshAll();
  }

  async function addFiles(files: ArrayLike<File>): Promise<void> {
    if (!files || !files.length) return;
    const next = Array.from(files);
    if (attachments.length + next.length > MAX_CHAT_FILES) {
      deps.alert('At most ' + MAX_CHAT_FILES + ' files can be uploaded at once; ' + attachments.length + ' selected.');
      return;
    }
    next.forEach(file => {
      const entry: ChatAttachment = {
        id: ++seq,
        fileName: file.name,
        mimeType: file.type || '',
        serverPath: null,
        uploading: true,
        uploadPercent: 0,
        uploadPromise: null,
        uploadError: null,
      };
      entry.uploadPromise = uploadOne(entry, file);
      attachments.push(entry);
    });
    refreshAll();
    fillPromptIfEmpty();
  }

  return {
    list: () => attachments,
    add: addFiles,
    remove: removeAt,
    clear() {
      attachments.length = 0;
      renderChips();
    },
    renderChips,
    refreshProgress,
    setProgress,
    fillPromptIfEmpty,
    bind() {
      if (bound || lifecycle.signal.aborted) return;
      const picker = byId('chat-file-input') as HTMLInputElement | null;
      const container = byId('chat-input-container') ?? doc.querySelector<HTMLElement>('.chat-input-container');
      if (!picker || !container) return;
      bound = true;
      picker.addEventListener('change', () => {
        const files = picker.files;
        if (files && files.length) void addFiles(files).catch(() => undefined);
        picker.value = '';
      }, { signal: lifecycle.signal });
      container.addEventListener('dragover', event => {
        event.preventDefault();
        event.stopPropagation();
        container.classList.add('drag-over');
      }, { signal: lifecycle.signal });
      container.addEventListener('dragleave', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!container.contains(event.relatedTarget as Node | null)) container.classList.remove('drag-over');
      }, { signal: lifecycle.signal });
      container.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        container.classList.remove('drag-over');
        const files = event.dataTransfer?.files;
        if (files && files.length) void addFiles(files).catch(() => undefined);
      }, { signal: lifecycle.signal });
    },
    dispose() { lifecycle.abort(); attachments.length = 0; },
  };
}
