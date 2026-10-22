import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeclaredFailure } from './declared-failure.mjs';

const entry = {
  categories: ['api-error'],
  apiErrors: [{ method: 'GET', path: '/api/engagements/:id/fleet', statuses: [404] }],
};
const failure = { method: 'GET', url: 'http://localhost/api/engagements/project-a/fleet', status: 404 };

test('accepts only the declared endpoint, method and status of an unavailable dependency', () => {
  assert.equal(isDeclaredFailure(entry, { category: 'api-error', apiFailures: [failure] }), true);
  for (const changed of [
    { ...failure, status: 500 },
    { ...failure, method: 'POST' },
    { ...failure, url: 'http://localhost/api/engagements/project-a/assets/inventory' },
    { ...failure, url: 'http://localhost/api/engagements/project-a/fleet/other' },
  ]) assert.equal(isDeclaredFailure(entry, { category: 'api-error', apiFailures: [changed] }), false);
});

test('a declared fleet outage cannot hide another failing endpoint on the route', () => {
  assert.equal(isDeclaredFailure(entry, { category: 'api-error', apiFailures: [failure, { ...failure, status: 500 }] }), false);
});

test('an api-error category alone and an empty response list are not an exception', () => {
  assert.equal(isDeclaredFailure({ categories: ['api-error'] }, { category: 'api-error', apiFailures: [failure] }), false);
  assert.equal(isDeclaredFailure(entry, { category: 'api-error', apiFailures: [] }), false);
});

test('page crashes are never exempted and fixture gaps retain their own category', () => {
  assert.equal(isDeclaredFailure({ categories: ['page-error'] }, { category: 'page-error' }), false);
  assert.equal(isDeclaredFailure({ categories: ['fixture-missing'] }, { category: 'fixture-missing' }), true);
  assert.equal(isDeclaredFailure({ categories: ['fixture-missing'] }, { category: 'render-boundary' }), false);
});
