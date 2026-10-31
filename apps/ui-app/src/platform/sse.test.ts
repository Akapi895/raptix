import { it, expect, vi } from 'vitest';
import { z } from 'zod';
import { parseSse, readSseFrames } from './sse';

function source(text: string, close = true) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (close) controller.close();
    }, cancel,
  });
  return { stream, cancel };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

it('decodes UTF-8 and CRLF frames split across arbitrary network chunks', async () => {
  const encoded = new TextEncoder().encode(': heartbeat\r\ndata: {"text":"Tiếng Việt \u4e2d\u6587"}\r\n\r\ndata: {"done":true}\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const received = [];
  for await (const event of parseSse(stream.getReader())) received.push(event);
  expect(received).toEqual([{ text: 'Tiếng Việt \u4e2d\u6587' }, { done: true }]);
  expect(stream.locked).toBe(false);
});

it('handles multiline data, comments, bare CR, event reset and persistent IDs', async () => {
  const { stream } = source(': heartbeat\rid: first\revent: progress\rretry: 200\rdata: {"text":\rdata: "hello"}\r\rid: bad\0id\nretry: invalid\ndata: {"done":true}\n\n');
  expect(await collect(readSseFrames(stream.getReader()))).toEqual([
    { event: 'progress', id: 'first', retry: 200, data: '{"text":\n"hello"}' },
    { event: 'message', id: 'first', retry: undefined, data: '{"done":true}' },
  ]);
  const multiline = source('data: {"text":\ndata: "hello"}\n\n');
  expect(await collect(parseSse(multiline.stream.getReader()))).toEqual([{ text: 'hello' }]);
});

it('retains the final unterminated event for legacy fetch streams', async () => {
  const { stream } = source('data: {"last":true}');
  expect(await collect(parseSse(stream.getReader()))).toEqual([{ last: true }]);
  expect(stream.locked).toBe(false);
});

it.each([false, true])('cancels and releases on abort (already aborted: %s)', async (alreadyAborted) => {
  const { stream, cancel } = source(': waiting\n', false);
  const controller = new AbortController();
  const reason = new DOMException('Stopped', 'AbortError');
  if (alreadyAborted) controller.abort(reason);
  const pending = collect(parseSse(stream.getReader(), { signal: controller.signal }));
  // Allow read() to block after the heartbeat before aborting.
  await Promise.resolve();
  if (!alreadyAborted) controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(cancel).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledWith(reason);
  expect(stream.locked).toBe(false);
});

it('cancels upstream when the consumer stops early', async () => {
  const { stream, cancel } = source('data: {"first":true}\n\ndata: {"second":true}\n\n', false);
  for await (const value of parseSse(stream.getReader())) {
    expect(value).toEqual({ first: true });
    break;
  }
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it('stops at DONE without parsing subsequent frames and cancels upstream', async () => {
  const { stream, cancel } = source('data: [DONE]\n\ndata: invalid\n\n', false);
  expect(await collect(parseSse(stream.getReader()))).toEqual([]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it('rejects invalid JSON and invalid decoded DTOs with cleanup', async () => {
  const invalidJson = source('data: invalid\n\n', false);
  await expect(collect(parseSse(invalidJson.stream.getReader()))).rejects.toBeInstanceOf(SyntaxError);
  expect(invalidJson.cancel).toHaveBeenCalledOnce();
  expect(invalidJson.stream.locked).toBe(false);
  const invalidDto = source('data: {"count":"bad"}\n\n', false);
  await expect(collect(parseSse(invalidDto.stream.getReader(), { schema: z.object({ count: z.number() }) }))).rejects.toBeInstanceOf(z.ZodError);
  expect(invalidDto.cancel).toHaveBeenCalledOnce();
  expect(invalidDto.stream.locked).toBe(false);
});

it.each(['data: 123456789', 'data: 1234\ndata: 5678\n\n', 'data:\ndata:\ndata:\ndata:\ndata:\ndata:\ndata:\ndata:\n'])('bounds unfinished lines and accumulated events: %s', async (text) => {
  const { stream, cancel } = source(text, false);
  await expect(collect(readSseFrames(stream.getReader(), { maxEventChars: 6 }))).rejects.toThrow('size limit');
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it('uses the default event for an empty event field and resets an empty ID', async () => {
  const { stream } = source('id: old\nevent:\ndata: first\n\nid:\ndata: second\n\n');
  expect(await collect(readSseFrames(stream.getReader()))).toEqual([
    { event: 'message', data: 'first', id: 'old', retry: undefined },
    { event: 'message', data: 'second', id: '', retry: undefined },
  ]);
});

it('propagates network reader errors and releases the lock', async () => {
  const failure = new Error('Connection reset');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
  await expect(collect(parseSse(stream.getReader()))).rejects.toBe(failure);
  expect(stream.locked).toBe(false);
});
