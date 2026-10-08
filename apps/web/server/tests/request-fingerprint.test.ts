import { expect, it } from 'vitest';
import { requestFingerprint } from '../src/security/request-fingerprint.js';

it('fingerprints JSON intent independently of key order but preserves exact string/array content', () => {
  expect(requestFingerprint({ a: 1, b: ['x'] })).toBe(requestFingerprint({ b: ['x'], a: 1 }));
  expect(requestFingerprint({ message: 'x' })).not.toBe(requestFingerprint({ message: 'x ' }));
  expect(requestFingerprint(['a', 'b'])).not.toBe(requestFingerprint(['b', 'a']));
});
it('refuses unsupported JSON values and bounded oversized/deep payloads', () => {
  for (const value of [undefined, NaN, Infinity, new Date(), { x: undefined }, 'x'.repeat(65537)]) expect(() => requestFingerprint(value)).toThrow();
  let nested: unknown = null;
  for (let i = 0; i < 22; i++) nested = [nested];
  expect(() => requestFingerprint(nested)).toThrow();
  const sparse: unknown[] = [];
  sparse.length = 1;
  expect(() => requestFingerprint(sparse)).toThrow();
});
