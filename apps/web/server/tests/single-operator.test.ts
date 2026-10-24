import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { configureSingleOperator, isSingleOperator, requireIndependentActor } from '../src/auth/membership-policy.js';
import { loadServerEnv } from '../src/config/env.js';
import { registerCapabilitiesRoutes } from '../src/http/routes/capabilities.routes.js';
import { ProjectApiError } from '../src/services/projects-service.js';

/**
 * ADR-0100: the four-eyes refusal is skipped only when the deployment enables single-operator mode. The mode is off by
 * default, set from RAPTIX_WEB_SINGLE_OPERATOR=1 at startup, and advertised on the capabilities document.
 */
describe('single-operator mode (ADR-0100)', () => {
  afterEach(() => configureSingleOperator(false));

  it('keeps the four-eyes refusal when the mode is off, which is the default', () => {
    expect(isSingleOperator()).toBe(false);
    expect(() => requireIndependentActor('owner-1', 'owner-1', 'The plan decision')).toThrow(ProjectApiError);
  });

  it('lets the submitter decide their own item when the mode is on, and still refuses another actor only when off', () => {
    configureSingleOperator(true);
    expect(isSingleOperator()).toBe(true);
    expect(() => requireIndependentActor('owner-1', 'owner-1', 'The plan decision')).not.toThrow();
    configureSingleOperator(false);
    expect(() => requireIndependentActor('owner-1', 'owner-1', 'The plan decision')).toThrow(/requires an independent actor/);
  });

  it('reads RAPTIX_WEB_SINGLE_OPERATOR as 1 (on), 0 or unset (off), and refuses any other value', () => {
    expect(loadServerEnv({ RAPTIX_WEB_SINGLE_OPERATOR: '1' }).singleOperator).toBe(true);
    expect(loadServerEnv({ RAPTIX_WEB_SINGLE_OPERATOR: '0' }).singleOperator).toBeUndefined();
    expect(loadServerEnv({}).singleOperator).toBeUndefined();
    expect(() => loadServerEnv({ RAPTIX_WEB_SINGLE_OPERATOR: 'yes' })).toThrow(/RAPTIX_WEB_SINGLE_OPERATOR must be "1" or "0"/);
  });

  it('advertises the review rule on the capabilities document, defaulting to the four-eyes rule', async () => {
    const app = Fastify();
    registerCapabilitiesRoutes(app, { independentReview: 'single-operator' });
    const on = await app.inject({ method: 'GET', url: '/api/capabilities' });
    expect(on.json().independentReview).toBe('single-operator');
    await app.close();

    const defaulted = Fastify();
    registerCapabilitiesRoutes(defaulted, {});
    const off = await defaulted.inject({ method: 'GET', url: '/api/capabilities' });
    expect(off.json().independentReview).toBe('required');
    await defaulted.close();
  });
});
