import { expect, it } from 'vitest';
import { SseDecoder, decodeSse } from '../src/sse.js';
it('frames split CRLF/multiline JSON and keeps explicit cursors separate from event identity', () => {
  const parser = new SseDecoder();
  expect(parser.push(': heartbeat\r\n\r\nid: 100-1\r')).toEqual([]);
  expect(parser.push('\nevent: values\r\ndata: {"a":\r\ndata: 1}\r\n\r')).toEqual([]);
  expect(parser.push('\n')).toEqual([{ id: '100-1', event: 'values', data: '{"a":\n1}' }]);
  expect(parser.push('event: control\ndata: {}\n\n')).toEqual([{ event: 'control', data: '{}' }]);
});
it('decodes split UTF8 bytes and does not invent an event at incomplete EOF', async () => {
  const bytes = new TextEncoder().encode('id: 200-1\ndata: "đúng"\n\ndata: unfinished');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const frames = [];
  for await (const frame of decodeSse(body)) frames.push(frame);
  expect(frames).toEqual([{ id: '200-1', event: 'message', data: '"đúng"' }]);
});
it('bounds one frame even if a producer never sends a line terminator', () => {
  expect(() => new SseDecoder(16).push('data: ' + 'x'.repeat(20))).toThrow();
  expect(() => new SseDecoder(16).push('data: 123456789\ndata: 123456789\n')).toThrow();
});
