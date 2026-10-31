import type { Decoder } from './http';

export interface SseFrame {
  event: string;
  data: string;
  id: string;
  retry?: number;
}

export interface SseOptions {
  signal?: AbortSignal;
  maxEventChars?: number;
}

export async function* readSseFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  { signal, maxEventChars = 8 * 1024 * 1024 }: SseOptions = {},
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let chars = 0;
  let event = 'message';
  let id = '';
  let retry: number | undefined;
  let finished = false;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });

  function line(value: string): SseFrame | undefined {
    if (value === '') {
      const frame = data.length ? { event, data: data.join('\n'), id, retry } : undefined;
      data = [];
      chars = 0;
      event = 'message';
      retry = undefined;
      return frame;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') {
      chars += content.length + (data.length ? 1 : 0);
      if (chars > maxEventChars) throw new Error('SSE event exceeds size limit');
      data.push(content);
    } else if (field === 'event') event = content || 'message';
    else if (field === 'id' && !content.includes('\0')) id = content;
    else if (field === 'retry' && /^\d+$/.test(content)) retry = Number(content);
  }

  try {
    while (!finished) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      finished = done;
      // Legacy fetch consumers retain a final event even without a blank line.
      buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true });
      let start = 0;
      for (let cursor = 0; cursor < buffer.length; cursor++) {
        const char = buffer[cursor];
        if (char !== '\r' && char !== '\n') continue;
        // A CR at a chunk boundary may be the first half of CRLF.
        if (char === '\r' && cursor === buffer.length - 1 && !done) break;
        const frame = line(buffer.slice(start, cursor));
        if (char === '\r' && buffer[cursor + 1] === '\n') cursor++;
        start = cursor + 1;
        if (frame) yield frame;
      }
      buffer = buffer.slice(start);
      if (buffer.length > maxEventChars) throw new Error('SSE line exceeds size limit');
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!finished) await reader.cancel(signal?.reason).catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseSse<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SseOptions & { schema: Decoder<T> },
): AsyncGenerator<T>;
export function parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options?: SseOptions,
): AsyncGenerator<unknown>;
export async function* parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SseOptions & { schema?: Decoder<unknown> } = {},
): AsyncGenerator<unknown> {
  for await (const frame of readSseFrames(reader, options)) {
    if (frame.data.trim() === '[DONE]') return;
    const value: unknown = JSON.parse(frame.data);
    yield options.schema ? options.schema.parse(value) : value;
  }
}
