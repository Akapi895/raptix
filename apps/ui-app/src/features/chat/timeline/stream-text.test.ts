import { describe, expect, it, vi } from 'vitest';
import { createStreamPlainText, mergeStreamBuffer, normalizeStreamingDelta, processSseDataLines, type StreamFrames } from './stream-text';

/** A frame queue the test runs by hand, so that the paint happens exactly when the test says. */
function manualFrames() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const frames: StreamFrames = {
    request(callback) {
      const id = next++;
      queued.set(id, callback);
      return id;
    },
    cancel(id) {
      queued.delete(id);
    },
  };
  return {
    frames,
    run() {
      const callbacks = [...queued.values()];
      queued.clear();
      callbacks.forEach(callback => callback());
    },
    size: () => queued.size,
  };
}

/** The part of an element the paint uses: its text node, its class list, and whether it is on the page. */
function fakeElement() {
  let node: { nodeType: number; nodeValue: string; appendData(data: string): void } | null = null;
  const classes = new Set<string>();
  const element = {
    isConnected: true,
    classList: { add: (name: string) => classes.add(name), contains: (name: string) => classes.has(name) },
    get childNodes() { return node ? [node] : []; },
    get firstChild() { return node; },
    get textContent() { return node?.nodeValue ?? ''; },
    set textContent(value: string) {
      node = {
        nodeType: 3,
        nodeValue: value,
        appendData(data: string) { this.nodeValue += data; },
      };
    },
  };
  return element as unknown as HTMLElement & { firstChild: { nodeValue: string } | null };
}

describe('streamed answer text', () => {
  it('joins a delta to the text, and keeps the new part', () => {
    expect(normalizeStreamingDelta('', 'Hel')).toEqual(['Hel', 'Hel']);
    expect(normalizeStreamingDelta('Hel', 'Hello')).toEqual(['Hello', 'lo']);
    expect(normalizeStreamingDelta('Hello', 'Hello')).toEqual(['Hello', '']);
    expect(normalizeStreamingDelta('Hel', 'lo')).toEqual(['Hello', 'lo']);
    expect(normalizeStreamingDelta('Hel', '')).toEqual(['Hel', '']);
  });

  it('takes the text the server sent as the whole, when it sent one', () => {
    expect(mergeStreamBuffer('Hel', 'lo', { accumulated: 'Hello world' })).toBe('Hello world');
    expect(mergeStreamBuffer('Hel', 'lo', null)).toBe('Hello');
  });

  it('paints a scheduled text once per frame, and the newest text wins', () => {
    const manual = manualFrames();
    const painter = createStreamPlainText(manual.frames);
    const el = fakeElement();

    painter.schedule(el, 'a');
    painter.schedule(el, 'ab');
    expect(el.textContent).toBe('');
    expect(manual.size()).toBe(1);

    manual.run();
    expect(el.textContent).toBe('ab');
    expect(el.classList.contains('timeline-stream-plain')).toBe(true);
  });

  it('appends the new part of a growing text instead of rebuilding it', () => {
    const manual = manualFrames();
    const painter = createStreamPlainText(manual.frames);
    const el = fakeElement();
    painter.schedule(el, 'abc');
    manual.run();
    const textNode = el.firstChild;

    painter.schedule(el, 'abcdef');
    manual.run();

    expect(el.textContent).toBe('abcdef');
    expect(el.firstChild).toBe(textNode);
  });

  it('flushes a pending text at once, and forgets it on reset', () => {
    const manual = manualFrames();
    const painter = createStreamPlainText(manual.frames);
    const el = fakeElement();
    painter.schedule(el, 'pending');
    painter.flush(el);
    expect(el.textContent).toBe('pending');
    expect(manual.size()).toBe(0);

    painter.schedule(el, 'later');
    painter.reset(el);
    painter.flushAll();
    expect(el.textContent).toBe('pending');
  });

  it('shows a plain text at once, with no frame', () => {
    const manual = manualFrames();
    const painter = createStreamPlainText(manual.frames);
    const el = fakeElement();
    painter.setPlain(el, 42);
    expect(el.textContent).toBe('42');
    expect(manual.size()).toBe(0);
  });
});

describe('SSE lines', () => {
  it('passes each data line on as an event, and reports a line that is not JSON', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events: unknown[] = [];
    await processSseDataLines(['data: {"type":"a"}', 'event: x', 'data: {bad', 'data: {"type":"b"}'], event => events.push(event));
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('gives the page a frame between batches of lines', async () => {
    const frames = vi.fn(async () => {});
    const lines = Array.from({ length: 5 }, (_, i) => `data: {"n":${i}}`);
    await processSseDataLines(lines, () => {}, { yieldEvery: 2 }, frames);
    expect(frames).toHaveBeenCalledTimes(2);
  });
});
