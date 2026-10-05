import { describe, expect, it } from 'vitest'

import {
  API_ERROR_CODES,
  APPROVAL_ACTIONS,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TARGET_TYPES,
  RUN_EVENT_KINDS,
  RUN_EVENT_SOURCES,
  RUN_VIEW_STATUSES,
  isApiError,
  isApprovalAction,
  isApprovalDecisionRequest,
  isCapabilitiesDocument,
  isCapability,
  isCreateEngagementRequest,
  isEngagement,
  isEngagementStatus,
  isEngagementTargetType,
  isProjectViewModel,
  isRunEventEnvelope,
  isRunEventKind,
  isRunIdentity,
  isRunSnapshot,
  isRunViewStatus,
  isThreadRunRequest,
} from '../src/index.js'

const ENGAGEMENT_FIXTURE = {
  id: 'cmupmdkw400013togf2geknfy',
  name: 'w00-capture-assessment',
  targetType: 'web_url',
  targetValue: 'http://authorized-test.invalid',
  authorizationConfirmed: true,
  status: 'draft',
  userId: 'local',
  threadId: null,
  workspacePath: '/workspace/w00-capture-assessment',
  createdAt: '2026-10-01T14:18:39.748Z',
  updatedAt: '2026-10-01T14:18:39.748Z',
}

const baseEnvelope = {
  version: 1,
  eventId: 'evt-1',
  engagementId: 'cmupmdkw400013togf2geknfy',
  threadId: 'thread-1',
  runId: 'run-1',
  source: 'runtime',
  kind: 'subagent_tool_call',
  sessionId: 'aaaa1111aaaa',
  toolCallId: 'call-w00-1',
  occurredAt: '2026-10-01T14:22:32.001277+00:00',
  observedAt: '2026-10-01T14:22:33.000Z',
  payload: { tool: 'inspect_fixture' },
}

describe('engagement contracts', () => {
  it('accepts the captured legacy payload shape', () => {
    expect(isEngagement(ENGAGEMENT_FIXTURE)).toBe(true)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, threadId: 'thread-1' })).toBe(true)
  })

  it('rejects invalid or missing IDs (IDs are strings, never array indices)', () => {
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, id: 7 })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, id: '' })).toBe(false)
    const { id: _id, ...noId } = ENGAGEMENT_FIXTURE
    expect(isEngagement(noId)).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, userId: 42 })).toBe(false)
  })

  it('enforces the closed status and target-type unions', () => {
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, status: 'paused' })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, targetType: 'cloud' })).toBe(false)
    expect(ENGAGEMENT_STATUSES).toEqual(['draft', 'planning', 'running', 'completed', 'failed'])
    expect(ENGAGEMENT_TARGET_TYPES).toEqual(['web_url', 'ip_range'])
    expect(isEngagementStatus('running')).toBe(true)
    expect(isEngagementStatus('active')).toBe(false)
    expect(isEngagementTargetType('ip_range')).toBe(true)
    expect(isEngagementTargetType('web-url')).toBe(false)
  })

  it('requires threadId to be a string or explicit null', () => {
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, threadId: undefined })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, threadId: 0 })).toBe(false)
  })

  it('requires ISO-8601 UTC timestamps, rejecting epoch seconds and local offsets', () => {
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, createdAt: 1767225600 })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, createdAt: '1767225600' })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, createdAt: '2026-10-01T14:18:39.748+07:00' })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, createdAt: '2026-13-01T14:18:39.748Z' })).toBe(false)
    expect(isEngagement({ ...ENGAGEMENT_FIXTURE, createdAt: '2026-10-01T14:18:39.748+00:00' })).toBe(true)
  })

  it('rejects creation without explicit authorization confirmation (legacy 400)', () => {
    const request = {
      name: 'w00-capture-assessment',
      targetType: 'web_url',
      targetValue: 'http://authorized-test.invalid',
      authorizationConfirmed: true,
    }
    expect(isCreateEngagementRequest(request)).toBe(true)
    expect(isCreateEngagementRequest({ ...request, authorizationConfirmed: false })).toBe(false)
    expect(isCreateEngagementRequest({ ...request, targetType: 'ip_range' })).toBe(true)
    expect(isCreateEngagementRequest({ ...request, name: '' })).toBe(false)
    const { authorizationConfirmed: _a, ...withoutConfirmation } = request
    expect(isCreateEngagementRequest(withoutConfirmation)).toBe(false)
  })
})

describe('approval decision wire', () => {
  it('accepts requestId + action decisions', () => {
    expect(isApprovalDecisionRequest({ requestId: 'w00-req-0001', action: 'allow' })).toBe(true)
    expect(isApprovalDecisionRequest({ requestId: 'w00-req-0001', action: 'deny' })).toBe(true)
    expect(APPROVAL_ACTIONS).toEqual(['allow', 'deny'])
    expect(isApprovalAction('allow')).toBe(true)
    expect(isApprovalAction('maybe')).toBe(false)
  })

  it('rejects non-string request IDs and unknown actions', () => {
    expect(isApprovalDecisionRequest({ requestId: 1, action: 'allow' })).toBe(false)
    expect(isApprovalDecisionRequest({ action: 'allow' })).toBe(false)
    expect(isApprovalDecisionRequest({ requestId: 'w00-req-0001', action: 'allow_forever' })).toBe(false)
  })
})

describe('ApiError contract', () => {
  it('accepts the new code+message DTO and the closed code set', () => {
    expect(isApiError({ code: 'conflict', message: 'duplicate approval decision' })).toBe(true)
    expect(isApiError({ code: 'bad_request', message: 'x', details: { field: 'name' } })).toBe(true)
    expect(API_ERROR_CODES).toContain('unavailable')
  })

  it('rejects legacy-raw bodies and unknown codes', () => {
    expect(isApiError({ error: 'Explicit authorization confirmation is required' })).toBe(false)
    expect(isApiError({ code: 'teapot', message: 'x' })).toBe(false)
    expect(isApiError({ code: 'conflict', message: '' })).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})

describe('capability contracts', () => {
  it('accepts supported/available/reason capabilities', () => {
    expect(isCapability({ supported: true, available: true })).toBe(true)
    expect(isCapability({ supported: true, available: false, reason: 'runtime_unavailable' })).toBe(true)
    expect(isCapability({ supported: false, available: false, reason: 'not_verified' })).toBe(true)
  })

  it('rejects available-while-unsupported and malformed flags', () => {
    expect(isCapability({ supported: false, available: true })).toBe(false)
    expect(isCapability({ supported: true })).toBe(false)
    expect(isCapability({ supported: true, available: 'yes' })).toBe(false)
    expect(isCapability({ supported: true, available: false, reason: '' })).toBe(false)
  })

  it('validates the capabilities document', () => {
    expect(
      isCapabilitiesDocument({
        version: 1,
        mode: 'local-single-user',
        capabilities: {
          'projects.read': { supported: true, available: true },
          'runs.create': { supported: true, available: false, reason: 'runtime_unavailable' },
        },
      }),
    ).toBe(true)
    expect(
      isCapabilitiesDocument({ version: 1, mode: 'local-single-user', capabilities: [] }),
    ).toBe(false)
    expect(
      isCapabilitiesDocument({
        version: 0,
        mode: 'local-single-user',
        capabilities: { 'projects.read': { supported: true, available: true } },
      }),
    ).toBe(false)
    expect(
      isCapabilitiesDocument({
        version: 1,
        mode: 'local-single-user',
        capabilities: { 'projects.read': { supported: true } },
      }),
    ).toBe(false)
  })
})

describe('run event envelope', () => {
  it('accepts a live runtime event', () => {
    expect(isRunEventEnvelope(baseEnvelope)).toBe(true)
  })

  it('accepts an unattributed checkpoint event with explicit nulls', () => {
    expect(
      isRunEventEnvelope({
        ...baseEnvelope,
        runId: null,
        source: 'checkpoint',
        toolCallId: null,
        cursor: 'cursor-17',
      }),
    ).toBe(true)
    expect(
      isRunEventEnvelope({ ...baseEnvelope, occurredAt: null, sessionId: undefined }),
    ).toBe(true)
  })

  it('requires runId to be present as a string or explicit null', () => {
    const { runId: _runId, ...missingRunId } = baseEnvelope
    expect(isRunEventEnvelope(missingRunId)).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, runId: 5 })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, runId: '' })).toBe(false)
  })

  it('accepts only known event kinds (no unknown presentation)', () => {
    expect(isRunEventEnvelope({ ...baseEnvelope, kind: 'custom_thing' })).toBe(false)
    for (const kind of RUN_EVENT_KINDS) {
      expect(isRunEventKind(kind)).toBe(true)
    }
    expect(isRunEventKind('message')).toBe(false)
    expect(isRunEventKind('run_started')).toBe(false)
    expect(RUN_EVENT_SOURCES).toEqual(['runtime', 'checkpoint'])
  })

  it('requires version 1, string IDs, UTC timestamps and a payload field', () => {
    expect(isRunEventEnvelope({ ...baseEnvelope, version: 2 })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, eventId: 3 })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, threadId: '' })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, occurredAt: 1767225600 })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, observedAt: '2026-10-01T14:22:33.000+02:00' })).toBe(false)
    const { payload: _payload, ...noPayload } = baseEnvelope
    expect(isRunEventEnvelope(noPayload)).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, cursor: '' })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, sessionId: 9 })).toBe(false)
    expect(isRunEventEnvelope({ ...baseEnvelope, toolCallId: 9 })).toBe(false)
  })
})

describe('thread/run identity, request and snapshot', () => {
  it('validates run identity with nullable runId', () => {
    expect(isRunIdentity({ engagementId: 'e1', threadId: 't1', runId: 'r1' })).toBe(true)
    expect(isRunIdentity({ engagementId: 'e1', threadId: 't1', runId: null })).toBe(true)
    expect(isRunIdentity({ engagementId: 'e1', threadId: 't1' })).toBe(false)
    expect(isRunIdentity({ engagementId: 'e1', threadId: 't1', runId: 0 })).toBe(false)
  })

  it('validates thread/run stream requests', () => {
    expect(isThreadRunRequest({ threadId: 't1' })).toBe(true)
    expect(isThreadRunRequest({ threadId: 't1', runId: 'r1', lastEventId: 'cursor-17' })).toBe(true)
    expect(isThreadRunRequest({ threadId: 't1', lastEventId: null })).toBe(true)
    expect(isThreadRunRequest({ threadId: '' })).toBe(false)
    expect(isThreadRunRequest({ threadId: 't1', runId: false })).toBe(false)
    expect(isThreadRunRequest({ threadId: 't1', lastEventId: 17 })).toBe(false)
  })

  it('validates run snapshots with the execution view-state set', () => {
    expect(
      isRunSnapshot({
        engagementId: 'e1',
        threadId: 't1',
        runId: 'r1',
        status: 'running',
        updatedAt: '2026-10-01T14:22:32.001Z',
      }),
    ).toBe(true)
    expect(RUN_VIEW_STATUSES).toEqual([
      'idle',
      'submitting',
      'pending',
      'running',
      'awaiting_approval',
      'interrupted',
      'completed',
      'failed',
      'cancelled',
      'unknown',
    ])
    expect(isRunViewStatus('unknown')).toBe(true)
    expect(isRunViewStatus('awaiting_approval')).toBe(true)
    expect(isRunViewStatus('paused')).toBe(false)
    expect(
      isRunSnapshot({
        engagementId: 'e1',
        threadId: 't1',
        runId: 'r1',
        status: 'awaiting_approval',
        rawStatus: 'running',
        updatedAt: '2026-10-01T14:22:32.001Z',
      }),
    ).toBe(true)
    expect(
      isRunSnapshot({
        engagementId: 'e1',
        threadId: 't1',
        runId: 'r1',
        status: 'completed',
        rawStatus: 17,
        updatedAt: '2026-10-01T14:22:32.001Z',
      }),
    ).toBe(false)
    expect(
      isRunSnapshot({
        engagementId: 'e1',
        threadId: 't1',
        runId: 'r1',
        status: 'completed',
        updatedAt: 'yesterday',
      }),
    ).toBe(false)
  })
})

describe('project view model (public DTO, guide section 5.2)', () => {
  const baseProject = {
    id: 'cmupmdkw400013togf2geknfy',
    workspaceSlug: 'w00-capture-assessment',
    displayName: 'w00-capture-assessment',
    targetType: 'web_url',
    targetValue: 'http://authorized-test.invalid',
    authorizationConfirmed: true,
    metadataState: 'needs_review',
    lifecycleStatus: 'planning',
    findingCount: null,
    assetCount: null,
    activeAgentCount: null,
    createdAt: '2026-10-01T14:18:39.748Z',
    updatedAt: '2026-10-01T14:18:39.748Z',
  }

  it('accepts the public shape with null counts and optional source', () => {
    expect(isProjectViewModel(baseProject)).toBe(true)
    expect(isProjectViewModel({ ...baseProject, source: 'api' })).toBe(true)
    expect(isProjectViewModel({ ...baseProject, source: 'mock', findingCount: 0 })).toBe(true)
    expect(isProjectViewModel({ ...baseProject, assetCount: 3, activeAgentCount: 2 })).toBe(true)
  })

  it('validates counts as number|null (null = no source yet, not 0)', () => {
    expect(isProjectViewModel({ ...baseProject, findingCount: 1.5 })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, findingCount: -1 })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, findingCount: '3' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, assetCount: undefined })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, activeAgentCount: false })).toBe(false)
  })

  it('enforces metadata state, lifecycle status and source unions', () => {
    expect(isProjectViewModel({ ...baseProject, metadataState: 'verified' })).toBe(true)
    expect(isProjectViewModel({ ...baseProject, metadataState: 'stale' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, lifecycleStatus: 'paused' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, source: 'fixture' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, source: 'live' })).toBe(false)
  })

  it('rejects workspacePath/userId leaks and absolute-path slugs', () => {
    expect(isProjectViewModel({ ...baseProject, workspacePath: '/workspace/w00-capture-assessment' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, userId: 'local' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, workspaceSlug: '/workspace/w00-capture-assessment' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, workspaceSlug: 'C:\\workspace\\proj' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, workspaceSlug: '' })).toBe(false)
  })

  it('requires the full public shape', () => {
    const { displayName: _d, ...noDisplayName } = baseProject
    expect(isProjectViewModel(noDisplayName)).toBe(false)
    expect(isProjectViewModel({ ...baseProject, authorizationConfirmed: 'yes' })).toBe(false)
    expect(isProjectViewModel({ ...baseProject, createdAt: 1767225600 })).toBe(false)
    expect(isProjectViewModel(null)).toBe(false)
  })
})
