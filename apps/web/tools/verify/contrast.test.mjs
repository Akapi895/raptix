import assert from 'node:assert/strict';
import test from 'node:test';
import { contrast } from './contrast.mjs';

test('CSS shorthand white against black retains the WCAG 21:1 contrast', () => {
  assert.equal(contrast('#fff', '#000'), 21);
  assert.equal(contrast('#FFFFFF', '#000000'), 21);
});

test('minified shorthand white does not falsely fail the deployed blue primary fill', () => {
  assert.ok(contrast('#fff', '#2563eb') > 5.16 && contrast('#fff', '#2563eb') < 5.18);
  assert.equal(contrast('#fff', '#2563eb'), contrast('#ffffff', '#2563eb'));
});

test('the old light-red danger fill still fails normal white text contrast', () => {
  assert.equal(contrast('#FFFFFF', '#F87171'), 2.766);
});

test('unsupported color syntax is rejected rather than reported as a passing ratio', () => {
  assert.throws(() => contrast('rgb(255,255,255)', '#000000'), TypeError);
});
