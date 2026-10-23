import { expect, it } from 'vitest';
import { isApprovalRequestView, isApprovalsView, isArtifactContentView, isArtifactsView, isAssetSummaryView, isAssetsView, isCampaignJobView, isCampaignView, isCampaignsView, isEngagementSettingsView, isFindingView, isFindingsView, isGraphEdgeView, isGraphNodeView, isGraphView, isMemberView, isMembersView, isPendingInterruptView, isRetainedCaptureView, isRetainedCapturesView, isScopedRunView, isScopedThreadListView, isScopedThreadView, isTimelineEntryView, isTimelineView, isVaultRevealView, isVaultSecretView, isVaultView } from '../src/run-api.js';
const time = '2026-10-02T00:00:00.000Z';
it('preserves raw runtime status and requires acknowledged scoped run identity', () => {
  const run = { engagementId: 'eng', threadId: 'thread', runId: 'run', requestId: 'request', rawStatus: 'pending', createdAt: time, updatedAt: time, source: 'runtime' };
  expect(isScopedRunView(run)).toBe(true);
  expect(isScopedRunView({ ...run, runId: null })).toBe(false);
  expect(isScopedRunView({ ...run, source: 'fixture' })).toBe(false);
  expect(isScopedRunView({ ...run, rawStatus: 'new-upstream-state' })).toBe(true);
});
it('labels bounded root messages without pretending to supply transcript history', () => {
  const thread = { binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: null, messages: [{ role: 'assistant', content: 'Acknowledged' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime' };
  expect(isScopedThreadView(thread)).toBe(true);
  expect(isScopedThreadView({ ...thread, messages: [{ role: 'system', content: 'private' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, messages: [{ role: ['user'], content: 'malformed role' }] })).toBe(false);
});
it('validates optional thread-level transcript history and message ids additively', () => {
  const thread = { binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: 'success', messages: [{ role: 'user', content: 'Question', messageId: 'm1' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcripts: [{ key: 's1::subagent_end@2026-10-02T00:00:01+00:00', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', truncated: false } }], transcriptsTruncated: false };
  expect(isScopedThreadView(thread)).toBe(true);
  expect(isScopedThreadView({ ...thread, messages: [{ role: 'user', content: 'Question', messageId: 42 }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], runId: 'run' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], source: 'runtime' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], payload: { type: 'unknown', agent: 'x' } }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], truncated: false }, { ...thread.transcripts[0] }], transcriptsTruncated: undefined })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: undefined, transcriptsTruncated: undefined })).toBe(true);
});
it('validates retained capture identity, classification and digest before exposing a descriptor', () => {
  const capture = {
    id: 'cap-1', engagementId: 'eng', filename: null, mediaType: 'image/png', sizeBytes: 8,
    digest: 'a'.repeat(64), producer: null, classification: 'unclassified', classificationVersion: 1,
    uploadedBy: 'operator', classifiedBy: null, classificationReason: null, classifiedAt: null,
    createdAt: time, canReadOriginal: false, canClassify: false,
  };
  expect(isRetainedCaptureView(capture)).toBe(true);
  expect(isRetainedCaptureView({ ...capture, digest: 'not-a-digest' })).toBe(false);
  expect(isRetainedCaptureView({ ...capture, classification: 'verified' })).toBe(false);
  expect(isRetainedCapturesView({ engagementId: 'eng', captures: [capture], source: 'db' })).toBe(true);
  expect(isRetainedCapturesView({ engagementId: 'eng', captures: [{ ...capture, engagementId: 'other' }], source: 'db' })).toBe(false);
});
it('validates the owner-scoped thread selector list', () => {
  const list = { engagementId: 'eng', threads: [{ engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }], source: 'runtime' };
  expect(isScopedThreadListView(list)).toBe(true);
  expect(isScopedThreadListView({ ...list, source: 'fixture' })).toBe(false);
  expect(isScopedThreadListView({ ...list, threads: [{ ...list.threads[0], kind: 'unknown' }] })).toBe(false);
  expect(isScopedThreadListView({ ...list, engagementId: '' })).toBe(false);
});
it('validates restored interrupt questions and workspace approvals additively', () => {
  const thread = { binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: 'interrupted', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', pendingQuestion: { questionId: 'q1', question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes', description: 'go' }], multiSelect: false, allowOther: true, source: 'runtime' } };
  expect(isScopedThreadView(thread)).toBe(true);
  expect(isScopedThreadView({ ...thread, pendingQuestion: { ...thread.pendingQuestion, source: 'checkpoint' } })).toBe(false);
  expect(isScopedThreadView({ ...thread, pendingQuestion: { ...thread.pendingQuestion, multiSelect: 'yes' } })).toBe(false);
  expect(isPendingInterruptView(thread.pendingQuestion)).toBe(true);
  expect(isPendingInterruptView({ ...thread.pendingQuestion, questionId: '' })).toBe(false);
  const approval = { engagementId: 'eng', requestId: 'req-1', engagementName: 'slug', agentName: 'soundwave', toolName: 'bash', toolArgsRedacted: { cmd: 'ls' }, matchedRule: { techniqueTag: null, toolPattern: '^bash$', timeoutSeconds: 120, defaultOnTimeout: 'allow' }, reason: 'policy match', createdAtSeconds: 1790925255.367, source: 'workspace' };
  expect(isApprovalRequestView(approval)).toBe(true);
  expect(isApprovalRequestView({ ...approval, createdAtSeconds: 'soon' })).toBe(false);
  expect(isApprovalRequestView({ ...approval, toolArgsRedacted: [] })).toBe(false);
  expect(isApprovalRequestView({ ...approval, matchedRule: { ...approval.matchedRule, techniqueTag: 'T1003' } })).toBe(true);
  expect(isApprovalRequestView({ ...approval, matchedRule: { ...approval.matchedRule, timeoutSeconds: '120' } })).toBe(false);
  expect(isApprovalsView({ engagementId: 'eng', approvals: [approval], source: 'workspace' })).toBe(true);
  expect(isApprovalsView({ engagementId: 'eng', approvals: [approval], source: 'runtime' })).toBe(false);
});
it('validates parsed workspace findings and safe artifact projections additively', () => {
  const finding = { engagementId: 'eng', id: 'FIND-2026-001', title: 'Exposed .env', severity: 'critical', description: 'd', evidence: 'e', attackVector: 'network', affectedAssets: ['api.acme.com/.env'], cvssScore: 9.1, cwe: ['CWE-312'], quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false }, rawSource: '# FIND-2026-001', sizeBytes: 512, source: 'workspace' };
  expect(isFindingView(finding)).toBe(true);
  expect(isFindingView({ ...finding, severity: 'info' })).toBe(false);
  expect(isFindingView({ ...finding, quality: { ...finding.quality, defaultSeverity: 'yes' } })).toBe(false);
  expect(isFindingView({ ...finding, cvssScore: '9.1' })).toBe(false);
  expect(isFindingView({ ...finding, mitre: ['T1003'] })).toBe(true);
  expect(isFindingsView({ engagementId: 'eng', findings: [finding], truncated: false, source: 'workspace' })).toBe(true);
  expect(isFindingsView({ engagementId: 'eng', findings: [finding], truncated: false, source: 'parsed' })).toBe(false);
  const artifacts = { engagementId: 'eng', folders: [{ folder: 'recon', files: [{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 2048 }] }], source: 'workspace' };
  expect(isArtifactsView(artifacts)).toBe(true);
  expect(isArtifactsView({ ...artifacts, folders: [{ ...artifacts.folders[0], files: [{ ...artifacts.folders[0].files[0], sizeBytes: '2048' }] }] })).toBe(false);
  const content = { engagementId: 'eng', path: 'recon/nmap.txt', content: 'open ports', mediaType: 'text', sizeBytes: 10, truncated: false, source: 'workspace' };
  expect(isArtifactContentView(content)).toBe(true);
  expect(isArtifactContentView({ ...content, mediaType: 'binary' })).toBe(false);
});
it('validates engagement-scoped public graph and asset projections additively', () => {
  const node = { id: '4:abc:1', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', password: '[REDACTED]' } };
  expect(isGraphNodeView(node)).toBe(true);
  expect(isGraphNodeView({ ...node, properties: { ...node.properties, nested: { deep: true } } })).toBe(false);
  expect(isGraphNodeView({ ...node, properties: { ...node.properties, services: ['smb', 445] } })).toBe(false);
  const edge = { id: '5:abc:2', source: node.id, target: '4:abc:3', type: 'OPEN_PORT', properties: { port: 443 } };
  expect(isGraphEdgeView(edge)).toBe(true);
  expect(isGraphEdgeView({ ...edge, source: '' })).toBe(false);
  expect(isGraphView({ engagementId: 'eng', nodes: [node], edges: [edge], truncated: false, source: 'graph' })).toBe(true);
  expect(isGraphView({ engagementId: 'eng', nodes: [node], edges: [edge], truncated: false, source: 'raw' })).toBe(false);
  const asset = { id: '4:abc:1', type: 'Host', label: 'dc01.corp', hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows Server 2022', ports: ['445'], services: ['smb'], relatedFindingIds: ['FIND-2026-001'], source: 'graph' };
  expect(isAssetSummaryView(asset)).toBe(true);
  expect(isAssetSummaryView({ ...asset, type: 'vehicle' })).toBe(false);
  expect(isAssetSummaryView({ ...asset, url: 5 })).toBe(false);
  expect(isAssetsView({ engagementId: 'eng', assets: [asset], truncated: false, source: 'graph' })).toBe(true);
  expect(isAssetsView({ engagementId: 'eng', assets: [asset], truncated: false, source: 'derived' })).toBe(false);
});
it('validates merged operations-timeline entries with distinct source labels additively', () => {
  const runEntry = { id: 'run:1', at: '2026-10-02T00:00:00.000Z', source: 'runtime', kind: 'run', label: 'Planning run accepted', runId: 'run-1', status: 'success' };
  expect(isTimelineEntryView(runEntry)).toBe(true);
  expect(isTimelineEntryView({ ...runEntry, source: 'synthetic' })).toBe(false);
  expect(isTimelineEntryView({ ...runEntry, at: 'not-a-date' })).toBe(false);
  expect(isTimelineEntryView({ ...runEntry, agent: 'soundwave' })).toBe(true);
  expect(isTimelineEntryView({ ...runEntry, agent: 5 })).toBe(false);
  const artifact = { id: 'ws:recon/nmap.txt', at: '2026-10-02T00:10:00.000Z', source: 'workspace', kind: 'artifact', label: 'Artifact updated' };
  expect(isTimelineEntryView(artifact)).toBe(true);
  expect(isTimelineView({ engagementId: 'eng', entries: [runEntry, artifact], truncated: false, hasMore: false, untimedCheckpoints: 0, unavailableThreads: 0, source: 'mixed' })).toBe(true);
  expect(isTimelineView({ engagementId: 'eng', entries: [runEntry, artifact], truncated: false, source: 'mixed' })).toBe(false);
  expect(isTimelineView({ engagementId: 'eng', entries: [runEntry], truncated: false, source: 'runtime' })).toBe(false);
});
it('validates engagement settings with the explicit target-change policy additively', () => {
  const settings = { engagementId: 'eng-1', displayName: 'Demo Engagement', name: 'demo-slug', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, lifecycleStatus: 'draft', targetChange: { allowed: true, reason: null }, source: 'db' };
  expect(isEngagementSettingsView(settings)).toBe(true);
  expect(isEngagementSettingsView({ ...settings, source: 'derived' })).toBe(false);
  expect(isEngagementSettingsView({ ...settings, targetChange: { allowed: false, reason: 'Only draft projects can change targets' } })).toBe(true);
  expect(isEngagementSettingsView({ ...settings, targetChange: { allowed: false } })).toBe(false);
  expect(isEngagementSettingsView({ ...settings, displayName: 5 })).toBe(false);
  expect(isEngagementSettingsView({ ...settings, authorizationConfirmed: 'yes' })).toBe(false);
});
it('validates campaign drafts and truthful provider jobs additively', () => {
  const job = { id: 'job-1', campaignId: 'camp-1', kind: 'generate', status: 'unavailable', provider: null, error: 'campaign provider not configured', createdAt: '2026-10-02T00:00:00.000Z' };
  const campaign = { id: 'camp-1', engagementId: 'eng-1', name: 'Phishing Wave 1', vector: 'phishing', status: 'draft', version: 1, spec: { scenario: 'it-security-alert' }, jobs: [job], createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  expect(isCampaignJobView(job)).toBe(true);
  expect(isCampaignView(campaign)).toBe(true);
  expect(isCampaignsView({ engagementId: 'eng-1', campaigns: [campaign], truncated: false })).toBe(true);
  expect(isCampaignJobView({ ...job, kind: 'send' })).toBe(false);
  expect(isCampaignJobView({ ...job, status: '' })).toBe(false);
  expect(isCampaignJobView({ ...job, provider: '' })).toBe(false);
  expect(isCampaignJobView({ ...job, provider: 'sliver' })).toBe(true);
  expect(isCampaignView({ ...campaign, vector: 'sms' })).toBe(false);
  expect(isCampaignView({ ...campaign, version: 0 })).toBe(false);
  expect(isCampaignView({ ...campaign, spec: [] })).toBe(false);
  expect(isCampaignView({ ...campaign, jobs: [{ ...job, id: '' }] })).toBe(false);
  expect(isCampaignsView({ engagementId: 'eng-1', campaigns: [], truncated: 'no' })).toBe(false);
});
it('validates redacted vault metadata and the dedicated reveal response additively', () => {
  const secret = { id: 'sec-1', engagementId: 'eng-1', kind: 'api-key', label: 'Grafana admin', createdBy: 'local', revealCount: 1, lastRevealedAt: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  expect(isVaultSecretView(secret)).toBe(true);
  expect(isVaultView({ engagementId: 'eng-1', secrets: [secret], truncated: false, source: 'db' })).toBe(true);
  expect(isVaultRevealView({ secretId: 'sec-1', engagementId: 'eng-1', plaintext: 'hunter2', revealedAt: '2026-10-02T00:00:00.000Z' })).toBe(true);
  expect(isVaultSecretView({ ...secret, kind: '' })).toBe(false);
  expect(isVaultSecretView({ ...secret, revealCount: -1 })).toBe(false);
  expect(isVaultSecretView({ ...secret, lastRevealedAt: 'yesterday' })).toBe(false);
  expect(isVaultView({ engagementId: 'eng-1', secrets: [], truncated: false, source: 'derived' })).toBe(false);
  expect(isVaultRevealView({ secretId: 'sec-1', engagementId: 'eng-1', plaintext: '', revealedAt: '2026-10-02T00:00:00.000Z' })).toBe(false);
});
it('validates the truthful local single-user members view additively', () => {
  const member = { id: 'local', label: 'Local Operator', role: 'operator', source: 'local' };
  const members = { engagementId: 'eng-1', mode: 'local-single-user', members: [member], inviteSupported: false, canManage: false, reason: 'No authentication strategy yet', source: 'db' };
  expect(isMemberView(member)).toBe(true);
  expect(isMembersView(members)).toBe(true);
  expect(isMemberView({ ...member, source: 'fixture' })).toBe(false);
  expect(isMembersView({ ...members, mode: 'hosted' })).toBe(false);
  expect(isMembersView({ ...members, inviteSupported: true })).toBe(false);
  expect(isMembersView({ ...members, reason: null })).toBe(true);
  expect(isMembersView({ ...members, members: [] })).toBe(true);
  expect(isMembersView({ ...members, source: 'derived' })).toBe(false);
});
