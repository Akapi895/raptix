import { expect, it } from 'vitest';
import { governedFixture, readyChecks } from './t09-governed-fixture.js';

it('revises an approved plan without changing the reviewed version and compares the persisted bodies', async () => {
  const { app, tables } = governedFixture(readyChecks);
  tables.businessPlan!.push({ id: 'approved', engagementId: 'eng', version: 1, status: 'approved', body: { objective: 'Old objective', methods: ['read-only'] }, requestedBy: 'author', decidedBy: 'reviewer', decidedAt: new Date(), expiresAt: new Date(Date.now() + 60000), roeVersion: 1, decisionComment: null, createdAt: new Date() });
  const revision = await app.inject({ method: 'POST', url: '/api/engagements/eng/plans/approved/revisions', payload: { objective: 'New objective', methods: ['read-only', 'verify'] } });
  expect(revision.statusCode).toBe(200);
  expect(revision.json()).toMatchObject({ version: 2, status: 'draft', objective: 'New objective', decidedBy: null, expiresAt: null, roeVersion: null });
  const comparison = await app.inject({ method: 'GET', url: `/api/engagements/eng/plans/${revision.json().id}/compare?baseId=approved` });
  expect(comparison.statusCode).toBe(200);
  expect(comparison.json()).toMatchObject({ base: { objective: 'Old objective', status: 'approved' }, revision: { objective: 'New objective', status: 'draft' }, source: 'db' });
  await app.close();
});

it('refuses null, foreign and planning threads before creating a plan binding', async () => {
  const { app, tables } = governedFixture(readyChecks);
  tables.engagementThread!.push({ threadId: 'foreign', engagementId: 'other', kind: 'execution' }, { threadId: 'planner', engagementId: 'eng', kind: 'planning' });
  tables.businessPlan!.push({ id: 'approved', engagementId: 'eng', version: 1, status: 'approved', expiresAt: new Date(Date.now() + 60000), roeVersion: 1 });
  for (const threadId of [null, 'foreign', 'planner']) {
    const response = await app.inject({ method: 'POST', url: '/api/engagements/eng/bindings', payload: { planId: 'approved', threadId } });
    expect([400, 404]).toContain(response.statusCode);
  }
  expect(tables.operationBinding).toHaveLength(0);
  await app.close();
});
