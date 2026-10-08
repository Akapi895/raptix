/** Incremental SSE framing. IDs are explicit wire cursors, never event identities. */
export interface SseFrame { event: string; data: string; id?: string }
export class SseFrameError extends Error {
  public constructor() { super('SSE frame exceeds its bounded framing contract'); this.name = 'SseFrameError'; }
}
export class SseDecoder {
  private buffer = '';
  private lines: string[] = [];
  private event = '';
  private id: string | undefined;
  private size = 0;
  private started = false;
  public constructor(private readonly maxSize = 2 * 1024 * 1024) {}
  public push(text: string): SseFrame[] {
    if (!this.started && text.length) { this.started = true; text = text.replace(/^\uFEFF/, ''); }
    this.buffer += text;
    const frames: SseFrame[] = [];
    for (;;) {
      const match = /[\r\n]/.exec(this.buffer);
      if (!match || match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      const delimiter = this.buffer[match.index] === '\r' && this.buffer[match.index + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(match.index + delimiter);
      if (!line) {
        if (this.lines.length || this.id !== undefined) frames.push({ event: this.event || 'message', data: this.lines.join('\n'), ...(this.id === undefined ? {} : { id: this.id }) });
        this.lines = []; this.event = ''; this.id = undefined; this.size = 0;
        continue;
      }
      this.size += line.length;
      if (this.size > this.maxSize) throw new SseFrameError();
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') this.lines.push(value);
      else if (field === 'event') this.event = value;
      else if (field === 'id' && !value.includes('\0')) this.id = value;
    }
    if (this.buffer.length + this.size > this.maxSize) throw new SseFrameError();
    return frames;
  }
}

export async function* decodeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const decoder = new SseDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { yield* decoder.push(utf8.decode()); return; }
      yield* decoder.push(utf8.decode(chunk.value, { stream: true }));
    }
  } finally { await reader.cancel(); }
}
