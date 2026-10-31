/*
 * Raptix UI mock — seed data.
 *
 * Every value here is fictional. Targets use RFC 5737 documentation ranges
 * (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and example.com names, so the
 * demo never points at a real system. Edit this file to change the demo content;
 * bump SEED_VERSION in types.ts to force existing browsers to pick it up.
 */
import type { Seed } from './types';
import { SEED_VERSION } from './types';

  // Full permission catalog, mirrors internal/security/rbac.go PermissionCatalog.
export const PERMISSION_CATALOG = {
    'auth:self': 'Manage own session and password',
    'dashboard:read': 'View dashboard summaries',
    'chat:read': 'View conversations',
    'chat:write': 'Create and update conversations',
    'chat:delete': 'Delete conversations and turns',
    'agent:execute': 'Run AI agents and workflows',
    'agent:local-execute': 'Use local filesystem, shell, and configured command tools from an agent',
    'hitl:read': 'View HITL queues and logs',
    'hitl:write': 'Approve, dismiss, and configure HITL',
    'tasks:read': 'View task queues',
    'tasks:write': 'Create and run task queues',
    'tasks:delete': 'Delete task queues',
    'project:read': 'View projects and project facts',
    'project:write': 'Create and update projects and facts',
    'project:delete': 'Delete projects and facts',
    'vulnerability:read': 'View vulnerabilities',
    'vulnerability:write': 'Create and update vulnerabilities',
    'vulnerability:delete': 'Delete vulnerabilities',
    'asset:read': 'View managed assets and asset summaries',
    'asset:write': 'Create, import, and update assets',
    'asset:delete': 'Delete managed assets',
    'webshell:read': 'View WebShell connections',
    'webshell:write': 'Manage and use WebShell connections',
    'webshell:delete': 'Delete WebShell connections',
    'c2:read': 'View C2 listeners, sessions, tasks, events, and profiles',
    'c2:write': 'Operate C2 listeners, sessions, tasks, payloads, files, and profiles',
    'c2:delete': 'Delete C2 objects',
    'mcp:read': 'View MCP status and external MCP configuration',
    'mcp:execute': 'Invoke the authenticated MCP endpoint',
    'mcp:external:execute': 'Invoke tools exposed by configured external MCP servers',
    'mcp:write': 'Manage external MCP server configuration and lifecycle',
    'knowledge:read': 'View knowledge base and retrieval logs',
    'knowledge:write': 'Create, update, index, and scan knowledge base',
    'knowledge:delete': 'Delete knowledge items and retrieval logs',
    'skills:read': 'View skills and skill stats',
    'skills:write': 'Create and update skills',
    'skills:delete': 'Delete skills and stats',
    'agents:read': 'View markdown agents',
    'agents:write': 'Create and update markdown agents',
    'agents:delete': 'Delete markdown agents',
    'roles:read': 'View AI testing roles',
    'roles:write': 'Create and update AI testing roles',
    'roles:delete': 'Delete AI testing roles',
    'workflow:read': 'View workflow definitions and runs',
    'workflow:execute': 'Validate, dry-run, and resume authorized workflow runs',
    'workflow:write': 'Create and update workflow definitions',
    'workflow:delete': 'Delete workflows',
    'config:read': 'View system configuration',
    'config:write': 'Update and apply system configuration',
    'storage:read': 'View runtime storage usage and reclaimable space',
    'storage:write': 'Run runtime storage cleanup and change its retention policy',
    'terminal:execute': 'Run terminal commands',
    'audit:read': 'View and export audit logs',
    'audit:delete': 'Delete audit logs',
    'rbac:read': 'View users, platform roles, permissions, and assignments',
    'rbac:write': 'Manage users, platform roles, permissions, and assignments',
    'notification:read': 'View notifications',
    'notification:write': 'Mark notifications as read',
    'robot:read': 'View robot binding status',
    'robot:write': 'Manage robot bindings and test robot callbacks',
    'files:read': 'View chat uploads',
    'files:write': 'Upload, edit, and rename chat files',
    'files:delete': 'Delete chat files',
    'attackchain:read': 'View attack chains',
    'attackchain:write': 'Regenerate attack chains',
    'fofa:execute': 'Run FOFA searches and query parsing',
    'openapi:read': 'Read OpenAPI aggregation results',
    'update:read': "View this installation's source version and whether its own repository has anything newer",
    'update:apply': "Pull this installation's own repository, rebuild the platform binary, and optionally stand the process down",
    'monitor:read': 'View execution monitor',
    'monitor:write': 'Cancel monitor executions',
    'monitor:delete': 'Delete monitor executions',
  };

export const SEED_VERSION_NOTE = 'Fictional demo data. RFC 5737 addresses and example.com only.';

export function seed(): Seed {
    const now = Date.now();
    const iso = function (minsAgo: number) { return new Date(now - minsAgo * 60000).toISOString(); };
    const allPerms = Object.keys(PERMISSION_CATALOG);
    const readPerms = allPerms.filter(function (p) { return /:read$|^auth:self$/.test(p); });

    const roles = [
      { id: 'role-admin', name: 'Administrator', description: 'Full platform access', scope: 'all', is_system: true, permissions: allPerms, created_at: iso(60 * 24 * 40), updated_at: iso(60 * 24 * 40) },
      { id: 'role-operator', name: 'Operator', description: 'Runs scans and manages findings, cannot change platform settings', scope: 'assigned', is_system: false, permissions: allPerms.filter(function (p) { return !/^(config|rbac|storage|update|audit):(write|delete|apply)$/.test(p) && p !== 'rbac:write'; }), created_at: iso(60 * 24 * 20), updated_at: iso(60 * 24 * 3) },
      { id: 'role-analyst', name: 'Analyst', description: 'Read-only access to findings and reports', scope: 'own', is_system: false, permissions: readPerms, created_at: iso(60 * 24 * 15), updated_at: iso(60 * 24 * 15) },
    ];

    const users = [
      { id: 'user-admin', username: 'admin', display_name: 'Administrator', enabled: true, roles: ['role-admin'], created_at: iso(60 * 24 * 60), last_login_at: iso(4) },
      { id: 'user-alice', username: 'alice', display_name: 'Alice Nguyen', enabled: true, roles: ['role-operator'], created_at: iso(60 * 24 * 30), last_login_at: iso(90) },
      { id: 'user-bob', username: 'bob', display_name: 'Bob Tran', enabled: true, roles: ['role-analyst'], created_at: iso(60 * 24 * 12), last_login_at: iso(60 * 26) },
      { id: 'user-carol', username: 'carol', display_name: 'Carol Pham', enabled: false, roles: ['role-analyst'], created_at: iso(60 * 24 * 90), last_login_at: null },
    ];

    const projects = [
      { id: 'proj-lab-web', name: 'Lab Web Perimeter', description: 'External web surface of the demo lab (fictional).', scope_json: '{"targets":["198.51.100.0/24","app.example.com"]}', status: 'active', pinned: true, created_at: iso(60 * 24 * 14), updated_at: iso(35) },
      { id: 'proj-internal-api', name: 'Internal API Review', description: 'Authenticated review of the internal REST API (fictional).', scope_json: '{"targets":["api.example.com"]}', status: 'active', pinned: false, created_at: iso(60 * 24 * 6), updated_at: iso(60 * 5) },
      { id: 'proj-archive-2025', name: 'Archive 2025 Q3', description: 'Closed engagement kept for reference.', scope_json: '{}', status: 'archived', pinned: false, created_at: iso(60 * 24 * 120), updated_at: iso(60 * 24 * 60) },
    ];

    const conversations = [
      { id: 'conv-recon-01', title: 'Recon of 198.51.100.0/24', projectId: 'proj-lab-web', roleName: 'Recon Analyst', agentMode: 'eino_single', pinned: true, createdAt: iso(180), updatedAt: iso(12) },
      { id: 'conv-webapp-02', title: 'Web app review: app.example.com', projectId: 'proj-lab-web', roleName: 'Web Tester', agentMode: 'deep', pinned: false, createdAt: iso(60 * 6), updatedAt: iso(60 * 2) },
      { id: 'conv-api-03', title: 'API auth logic review', projectId: 'proj-internal-api', roleName: '', agentMode: 'eino_single', pinned: false, createdAt: iso(60 * 30), updatedAt: iso(60 * 28) },
      { id: 'conv-notes-04', title: 'Quick notes (no project)', projectId: '', roleName: '', agentMode: 'eino_single', pinned: false, createdAt: iso(60 * 50), updatedAt: iso(60 * 49) },
    ];

    const messages = [
      { id: 'msg-1', conversationId: 'conv-recon-01', role: 'user', content: 'Enumerate the open web services on 198.51.100.0/24 and summarize the findings.', reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: iso(180), updatedAt: iso(180) },
      { id: 'msg-2', conversationId: 'conv-recon-01', role: 'assistant', content: 'Scan finished. Three hosts answered on HTTP/HTTPS:\n\n- **198.51.100.10** — `nginx 1.24`, login page at `/admin`\n- **198.51.100.22** — `Apache 2.4`, legacy `/old-cms/` path\n- **198.51.100.31** — `Node.js` API on port 3000\n\nThe `/admin` login has no rate limiting observed. Next step: validate the findings in the web-app review task.', reasoningContent: '', mcpExecutionIds: ['mcp-exec-001'], processDetails: [], createdAt: iso(179), updatedAt: iso(179) },
      { id: 'msg-3', conversationId: 'conv-webapp-02', role: 'user', content: 'Review app.example.com for common misconfigurations. Keep it passive.', reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: iso(60 * 6), updatedAt: iso(60 * 6) },
      { id: 'msg-4', conversationId: 'conv-webapp-02', role: 'assistant', content: 'Passive review done. Found missing `Content-Security-Policy` and `X-Frame-Options` headers, and a verbose `Server` banner. Logged as low-severity findings.', reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: iso(60 * 6 - 1), updatedAt: iso(60 * 6 - 1) },
      { id: 'msg-5', conversationId: 'conv-api-03', role: 'user', content: 'Check the token refresh flow in the internal API for logic flaws.', reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: iso(60 * 30), updatedAt: iso(60 * 30) },
      { id: 'msg-6', conversationId: 'conv-api-03', role: 'assistant', content: 'The refresh endpoint accepts a previously-rotated token for 60 seconds. Recorded as a medium-severity finding with reproduction steps.', reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: iso(60 * 30 - 1), updatedAt: iso(60 * 30 - 1) },
    ];

    const vulnerabilities = [
      { id: 'vuln-001', conversation_id: 'conv-api-03', project_id: 'proj-internal-api', conversation_tag: 'API auth', task_tag: '', task_id: '', task_queue_id: '', title: 'Rotated refresh token still accepted', description: 'The refresh endpoint accepts a token after it has been rotated, for a 60-second grace window.', severity: 'medium', status: 'open', type: 'Authentication', target: 'api.example.com', preconditions: 'Holds a valid refresh token', reproduction_steps: '1. Obtain refresh token R1.\n2. Refresh to obtain R2 (R1 is rotated).\n3. Submit R1 again within 60 seconds: a new access token is issued.', evidence: 'HTTP 200 with access_token for rotated R1 (lab capture, redacted).', impact: 'Stolen refresh tokens remain usable briefly after rotation.', recommendation: 'Revoke the whole token family on reuse; shorten the grace window to zero.', retest_notes: '', retest_log: '', created_at: iso(60 * 29), updated_at: iso(60 * 28) },
      { id: 'vuln-002', conversation_id: 'conv-webapp-02', project_id: 'proj-lab-web', conversation_tag: 'Web review', task_tag: '', task_id: '', task_queue_id: '', title: 'Missing Content-Security-Policy header', description: 'Responses from app.example.com carry no CSP header.', severity: 'low', status: 'open', type: 'Misconfiguration', target: 'app.example.com', preconditions: '', reproduction_steps: 'curl -sI https://app.example.com and inspect headers.', evidence: 'No Content-Security-Policy in response headers.', impact: 'Reduced defense in depth against XSS.', recommendation: 'Add a restrictive CSP.', retest_notes: '', retest_log: '', created_at: iso(60 * 5), updated_at: iso(60 * 5) },
      { id: 'vuln-003', conversation_id: 'conv-recon-01', project_id: 'proj-lab-web', conversation_tag: 'Recon', task_tag: '', task_id: '', task_queue_id: '', title: 'Admin login without rate limiting', description: 'The /admin login accepted 200 consecutive wrong passwords without a lockout or delay.', severity: 'high', status: 'confirmed', type: 'Authentication', target: '198.51.100.10', preconditions: '', reproduction_steps: 'Send 200 POSTs to /admin/login with wrong passwords.', evidence: 'All 200 attempts returned 401 with no throttling.', impact: 'Credential brute force is practical.', recommendation: 'Add progressive lockout and CAPTCHA after repeated failures.', retest_notes: 'Retest pending.', retest_log: '', created_at: iso(170), updated_at: iso(60) },
      { id: 'vuln-004', conversation_id: 'conv-recon-01', project_id: 'proj-lab-web', conversation_tag: 'Recon', task_tag: '', task_id: '', task_queue_id: '', title: 'Legacy CMS path exposes version banner', description: '/old-cms/ reveals the CMS version in the generator meta tag.', severity: 'info', status: 'fixed', type: 'Information disclosure', target: '198.51.100.22', preconditions: '', reproduction_steps: 'GET /old-cms/ and read the generator meta tag.', evidence: 'meta name="generator" content="LabCMS 2.3.1"', impact: 'Helps attackers choose matching exploits.', recommendation: 'Remove the generator tag.', retest_notes: 'Tag removed in lab build 42.', retest_log: '', created_at: iso(60 * 24 * 3), updated_at: iso(60 * 24) },
      { id: 'vuln-005', conversation_id: 'conv-api-03', project_id: 'proj-internal-api', conversation_tag: 'API auth', task_tag: '', task_id: '', task_queue_id: '', title: 'Verbose stack trace on invalid JSON', description: 'Malformed JSON bodies return a server stack trace with file paths.', severity: 'low', status: 'open', type: 'Information disclosure', target: 'api.example.com', preconditions: '', reproduction_steps: 'POST invalid JSON to /v1/items.', evidence: 'Response includes internal file paths.', impact: 'Leaks internal layout.', recommendation: 'Return a generic error body in production.', retest_notes: '', retest_log: '', created_at: iso(60 * 27), updated_at: iso(60 * 27) },
      { id: 'vuln-006', conversation_id: 'conv-webapp-02', project_id: 'proj-lab-web', conversation_tag: 'Web review', task_tag: '', task_id: '', task_queue_id: '', title: 'Outdated Node.js runtime on API host', description: 'The API host reports an end-of-life Node.js major version.', severity: 'medium', status: 'false_positive', type: 'Outdated component', target: '198.51.100.31', preconditions: '', reproduction_steps: 'Read the X-Powered-By header.', evidence: 'Banner present, but the host is a sandboxed build pinned to a supported patch.', impact: '', recommendation: 'Track runtime versions in the asset inventory.', retest_notes: 'Verified supported build; closed as false positive.', retest_log: '', created_at: iso(60 * 4), updated_at: iso(60 * 3) },
    ];

    const assets = [
      { id: 'asset-001', project_id: 'proj-lab-web', project_name: 'Lab Web Perimeter', host: 'app.example.com', ip: '198.51.100.10', port: 443, domain: 'app.example.com', protocol: 'https', title: 'Lab Portal', server: 'nginx/1.24', country: 'Lab', province: '', city: '', responsible_person: 'Alice Nguyen', department: 'Security', business_system: 'Lab Portal', environment: 'lab', criticality: 'high', source: 'scan', source_query: 'recon-01', status: 'active', tags: ['web', 'auth'], first_seen_at: iso(4000), last_seen_at: iso(20), created_at: iso(4000), updated_at: iso(20), last_scan_at: iso(60), vulnerability_count: 2, risk_level: 'high', risk_score: 78 },
      { id: 'asset-002', project_id: 'proj-lab-web', project_name: 'Lab Web Perimeter', host: '198.51.100.22', ip: '198.51.100.22', port: 80, domain: '', protocol: 'http', title: 'Legacy CMS', server: 'Apache/2.4', country: 'Lab', province: '', city: '', responsible_person: 'Bob Tran', department: 'IT', business_system: 'Legacy CMS', environment: 'lab', criticality: 'medium', source: 'scan', source_query: 'recon-01', status: 'active', tags: ['legacy'], first_seen_at: iso(4000), last_seen_at: iso(60), created_at: iso(4000), updated_at: iso(60), last_scan_at: iso(180), vulnerability_count: 1, risk_level: 'low', risk_score: 22 },
      { id: 'asset-003', project_id: 'proj-lab-web', project_name: 'Lab Web Perimeter', host: '198.51.100.31', ip: '198.51.100.31', port: 3000, domain: '', protocol: 'http', title: 'Node API', server: 'Express', country: 'Lab', province: '', city: '', responsible_person: '', department: 'Platform', business_system: 'Sample API', environment: 'lab', criticality: 'medium', source: 'import', source_query: '', status: 'active', tags: ['api'], first_seen_at: iso(2000), last_seen_at: iso(300), created_at: iso(2000), updated_at: iso(300), last_scan_at: null, vulnerability_count: 1, risk_level: 'low', risk_score: 15 },
      { id: 'asset-004', project_id: 'proj-internal-api', project_name: 'Internal API Review', host: 'api.example.com', ip: '203.0.113.40', port: 443, domain: 'api.example.com', protocol: 'https', title: 'Internal REST API', server: 'envoy', country: 'Lab', province: '', city: '', responsible_person: 'Alice Nguyen', department: 'Platform', business_system: 'Internal API', environment: 'staging', criticality: 'critical', source: 'manual', source_query: '', status: 'active', tags: ['api', 'auth'], first_seen_at: iso(3000), last_seen_at: iso(40), created_at: iso(3000), updated_at: iso(40), last_scan_at: iso(60 * 5), vulnerability_count: 2, risk_level: 'medium', risk_score: 55 },
      { id: 'asset-005', project_id: '', project_name: '', host: '192.0.2.77', ip: '192.0.2.77', port: 22, domain: '', protocol: 'ssh', title: '', server: 'OpenSSH_9.6', country: 'Lab', province: '', city: '', responsible_person: '', department: '', business_system: '', environment: 'lab', criticality: 'low', source: 'scan', source_query: '', status: 'inactive', tags: [], first_seen_at: iso(9000), last_seen_at: iso(60 * 24 * 9), created_at: iso(9000), updated_at: iso(60 * 24 * 9), last_scan_at: null, vulnerability_count: 0, risk_level: 'info', risk_score: 0 },
    ];

    // Shape follows internal/handler/batch_task_manager.go (camelCase).
    const batchQueues = [
      { id: 'queue-001', title: 'Weekly recon batch', role: 'Recon Analyst', hitlPolicy: '', agentMode: 'eino_single', scheduleMode: 'manual', cronExpr: '', scheduleEnabled: false, projectId: 'proj-lab-web', concurrency: 1, status: 'completed', createdAt: iso(60 * 24 * 2), startedAt: iso(60 * 24 * 2 - 30), completedAt: iso(60 * 24 * 2 - 20), currentIndex: 2,
        tasks: [
          { id: 'task-001', message: 'Enumerate 198.51.100.10 HTTP services', status: 'completed', conversationId: 'conv-recon-01', startedAt: iso(60 * 24 * 2 - 30), completedAt: iso(60 * 24 * 2 - 25), error: '', result: 'Found nginx on 443 and /admin login.' },
          { id: 'task-002', message: 'Enumerate 198.51.100.22 legacy paths', status: 'completed', conversationId: 'conv-recon-01', startedAt: iso(60 * 24 * 2 - 24), completedAt: iso(60 * 24 * 2 - 20), error: '', result: '/old-cms/ present.' },
        ] },
      { id: 'queue-002', title: 'Nightly API regression', role: '', hitlPolicy: 'manual', agentMode: 'deep', scheduleMode: 'cron', cronExpr: '0 2 * * *', scheduleEnabled: true, projectId: 'proj-internal-api', concurrency: 1, status: 'running', createdAt: iso(90), startedAt: iso(3), completedAt: null, currentIndex: 0,
        tasks: [
          { id: 'task-003', message: 'Token refresh rotation check', status: 'running', conversationId: 'conv-api-03', startedAt: iso(3), completedAt: null, error: '', result: '' },
          { id: 'task-004', message: 'Malformed JSON error handling', status: 'pending', conversationId: '', startedAt: null, completedAt: null, error: '', result: '' },
        ] },
    ];

    const skills = [
      { name: 'sqli-basics', description: 'Detect and validate SQL injection on parameters in a lab target.', category: 'web', enabled: true, version: '1.2.0', files: ['SKILL.md', 'payloads.md'], tags: ['web', 'sql'], updated_at: iso(60 * 24 * 4) },
      { name: 'recon-passive', description: 'Passive DNS, TLS and banner review without active probing.', category: 'recon', enabled: true, version: '2.0.1', files: ['SKILL.md'], tags: ['recon'], updated_at: iso(60 * 24 * 10) },
      { name: 'report-writer', description: 'Turn confirmed findings into a structured Markdown report.', category: 'reporting', enabled: true, version: '1.0.4', files: ['SKILL.md', 'template.md'], tags: ['report'], updated_at: iso(60 * 24 * 1) },
      { name: 'legacy-cms-check', description: 'Checks the lab legacy CMS for known version banners.', category: 'web', enabled: false, version: '0.3.0', files: ['SKILL.md'], tags: ['legacy'], updated_at: iso(60 * 24 * 30) },
    ];

    const externalMCP = [
      { name: 'lab-nmap', transport: 'stdio', command: 'nmap-mcp', args: ['--lab'], url: '', enabled: true, status: 'connected', tools_count: 4, last_error: '' },
      { name: 'lab-notes', transport: 'http', command: '', args: [], url: 'http://127.0.0.1:9100/mcp', enabled: true, status: 'stopped', tools_count: 0, last_error: 'Connection refused (demo)' },
    ];

    const notifications = [
      { id: 'notif-1', title: 'Batch queue finished', body: 'Weekly recon batch completed with 2 tasks.', read: false, created_at: iso(60 * 24 * 2 - 20) },
      { id: 'notif-2', title: 'New high-severity finding', body: 'Admin login without rate limiting (198.51.100.10).', read: false, created_at: iso(170) },
      { id: 'notif-3', title: 'Knowledge index rebuilt', body: '5 items indexed.', read: true, created_at: iso(60 * 24) },
    ];

    const auditLogs = [
      { id: 'audit-1', createdAt: iso(4), level: 'info', category: 'auth', action: 'login', result: 'success', actor: 'admin', clientIp: '127.0.0.1', message: 'Administrator signed in' },
      { id: 'audit-2', createdAt: iso(30), level: 'info', category: 'conversation', action: 'create', result: 'success', actor: 'alice', clientIp: '127.0.0.1', message: 'Created conversation "Recon of 198.51.100.0/24"' },
      { id: 'audit-3', createdAt: iso(60), level: 'warn', category: 'tool', action: 'blocked', result: 'blocked', actor: 'system', clientIp: '', message: 'Tool guard blocked a destructive shell command' },
      { id: 'audit-4', createdAt: iso(200), level: 'info', category: 'rbac', action: 'role_update', result: 'success', actor: 'admin', clientIp: '127.0.0.1', message: 'Updated role Operator' },
      { id: 'audit-5', createdAt: iso(60 * 24), level: 'error', category: 'agent', action: 'run', result: 'failed', actor: 'alice', clientIp: '127.0.0.1', message: 'Model request timed out (demo)' },
    ];

    const executions = [
      { id: 'exec-001', toolName: 'nmap_scan', status: 'success', conversationId: 'conv-recon-01', startedAt: iso(180), durationMs: 14250, input: '{"target":"198.51.100.0/24","ports":"80,443,3000"}', output: 'Host 198.51.100.10 open 80,443\nHost 198.51.100.22 open 80\nHost 198.51.100.31 open 3000' },
      { id: 'exec-002', toolName: 'http_probe', status: 'success', conversationId: 'conv-webapp-02', startedAt: iso(60 * 6), durationMs: 820, input: '{"url":"https://app.example.com"}', output: 'HTTP/1.1 200 OK' },
      { id: 'exec-003', toolName: 'token_replay', status: 'failed', conversationId: 'conv-api-03', startedAt: iso(60 * 30), durationMs: 3010, input: '{"endpoint":"/v1/auth/refresh"}', output: 'timeout after 3000 ms (demo)' },
      { id: 'exec-004', toolName: 'search_knowledge', status: 'success', conversationId: 'conv-api-03', startedAt: iso(60 * 30 - 2), durationMs: 95, input: '{"query":"refresh token rotation"}', output: '2 matches' },
    ];

    // Project fact board entries (fictional). fact_key is the stable key used by edges.
    const facts = [
      { id: 'fact-1', project_id: 'proj-lab-web', fact_key: 'host.198.51.100.10', category: 'host', summary: 'nginx 1.24 on 443, /admin login reachable', body: 'Observed during recon. HTTP 200 on /admin with a login form. No lockout after repeated failures (see finding vuln-003).', confidence: 'high', pinned: true, deprecated: false, incoming_links: 1, related_vulnerability_id: 'vuln-003', source_conversation_id: 'conv-recon-01', updated_at: iso(170) },
      { id: 'fact-2', project_id: 'proj-lab-web', fact_key: 'host.198.51.100.22', category: 'host', summary: 'Apache 2.4 serving a legacy CMS under /old-cms/', body: 'Generator meta tag disclosed the CMS version. Fixed in lab build 42.', confidence: 'high', pinned: false, deprecated: false, incoming_links: 1, related_vulnerability_id: 'vuln-004', source_conversation_id: 'conv-recon-01', updated_at: iso(60 * 24) },
      { id: 'fact-3', project_id: 'proj-lab-web', fact_key: 'header.app.example.com', category: 'config', summary: 'Missing Content-Security-Policy and X-Frame-Options', body: 'Checked with a single passive request. Both headers absent in the response.', confidence: 'medium', pinned: false, deprecated: false, incoming_links: 0, related_vulnerability_id: 'vuln-002', source_conversation_id: 'conv-webapp-02', updated_at: iso(60 * 5) },
      { id: 'fact-4', project_id: 'proj-lab-web', fact_key: 'stack.198.51.100.31', category: 'stack', summary: 'Node.js API on port 3000 (Express)', body: '', confidence: 'low', pinned: false, deprecated: false, incoming_links: 0, related_vulnerability_id: '', source_conversation_id: 'conv-recon-01', updated_at: iso(60 * 20) },
      { id: 'fact-5', project_id: 'proj-lab-web', fact_key: 'old.header-banner', category: 'config', summary: 'Earlier note about the banner, superseded', body: 'Superseded by fact host.198.51.100.22.', confidence: 'low', pinned: false, deprecated: true, incoming_links: 0, related_vulnerability_id: '', source_conversation_id: '', updated_at: iso(60 * 40) },
      { id: 'fact-6', project_id: 'proj-internal-api', fact_key: 'auth.refresh.rotation', category: 'auth', summary: 'Rotated refresh tokens accepted for 60 seconds', body: 'Reproduced with two sequential refreshes. See vuln-001 for steps.', confidence: 'high', pinned: true, deprecated: false, incoming_links: 1, related_vulnerability_id: 'vuln-001', source_conversation_id: 'conv-api-03', updated_at: iso(60 * 27) },
      { id: 'fact-7', project_id: 'proj-internal-api', fact_key: 'error.json.stacktrace', category: 'config', summary: 'Stack traces returned for malformed JSON', body: 'Response includes internal file paths. See vuln-005.', confidence: 'medium', pinned: false, deprecated: false, incoming_links: 0, related_vulnerability_id: 'vuln-005', source_conversation_id: 'conv-api-03', updated_at: iso(60 * 26) },
    ];
    const factEdges = [
      { id: 'edge-1', project_id: 'proj-lab-web', source: 'host.198.51.100.10', target: 'header.app.example.com', source_fact_key: 'host.198.51.100.10', target_fact_key: 'header.app.example.com', type: 'related', edge_type: 'related', confidence: 'medium' },
      { id: 'edge-2', project_id: 'proj-internal-api', source: 'auth.refresh.rotation', target: 'error.json.stacktrace', source_fact_key: 'auth.refresh.rotation', target_fact_key: 'error.json.stacktrace', type: 'co-observed', edge_type: 'co-observed', confidence: 'medium' },
    ];

    const knowledgeCategories = [
      { name: 'web-vulns', count: 3 },
      { name: 'auth', count: 2 },
      { name: 'reporting', count: 1 },
    ];
    const knowledgeItems = [
      { id: 'kb-1', category: 'web-vulns', title: 'SQL injection testing checklist', content: 'Check numeric and string parameters, error-based and boolean-based probes, and report the minimal reproduction.', indexed: true, updated_at: iso(60 * 24 * 5) },
      { id: 'kb-2', category: 'web-vulns', title: 'Missing security headers', content: 'CSP, HSTS, X-Frame-Options and Referrer-Policy: what each protects and how to verify.', indexed: true, updated_at: iso(60 * 24 * 9) },
      { id: 'kb-3', category: 'auth', title: 'Refresh token rotation', content: 'A rotated refresh token must be rejected immediately; reuse should revoke the token family.', indexed: true, updated_at: iso(60 * 24 * 2) },
      { id: 'kb-4', category: 'auth', title: 'Login throttling', content: 'Progressive delay, lockout, and CAPTCHA thresholds for credential endpoints.', indexed: false, updated_at: iso(60 * 24 * 1) },
      { id: 'kb-5', category: 'reporting', title: 'Finding write-up template', content: 'Title, severity, affected asset, steps, evidence, impact, recommendation.', indexed: true, updated_at: iso(60 * 24 * 6) },
    ];

    const roles_ai = [
      { name: 'Recon Analyst', description: 'Enumerates services and summarizes exposure.', enabled: true, skills: ['recon-passive'], tools: ['nmap_scan', 'http_probe'], prompt: 'You are a passive reconnaissance analyst. Stay within the authorized scope.', is_builtin: true, updated_at: iso(60 * 24 * 7) },
      { name: 'Web Tester', description: 'Reviews web applications for common misconfigurations.', enabled: true, skills: ['sqli-basics', 'report-writer'], tools: ['http_probe'], prompt: 'You review web applications. Prefer passive checks unless told otherwise.', is_builtin: true, updated_at: iso(60 * 24 * 7) },
      { name: 'Report Writer', description: 'Drafts findings reports.', enabled: false, skills: ['report-writer'], tools: [], prompt: 'Write concise, evidence-backed findings.', is_builtin: false, updated_at: iso(60 * 24 * 20) },
    ];

    // No pending approvals in the seed: every pending item must belong to a live run.
    // Send a prompt containing "token" in chat to create one.
    const hitlLogs = [
      { id: 'hl-1', interruptId: 'hitl-old-1', tool: 'http_probe', decision: 'approve', reviewer: 'human', decidedAt: iso(60 * 26), reason: 'Single passive request to lab host' },
      { id: 'hl-2', interruptId: 'hitl-old-2', tool: 'token_replay', decision: 'reject', reviewer: 'human', decidedAt: iso(60 * 30), reason: 'Repeated auth requests were not in scope' },
    ];

    // Graph rules follow validateWorkflowGraph in web/static/js/workflows.js:
    // tool nodes need config.tool_name, an output node is terminal, every node is connected.
    const workflows: Seed['workflows'] = [
      { id: 'wf-1', name: 'Recon then validate', description: 'Run passive recon, then validate open services.', version: 3, enabled: true, validation_error: '',
        graph_json: {
          nodes: [
            { id: 'start', label: 'Start', type: 'start', config: {}, position: { x: 120, y: 120 } },
            { id: 'recon', label: 'Port scan', type: 'tool', config: { tool_name: 'nmap_scan', arguments: { ports: '80,443,3000' } }, position: { x: 120, y: 260 } },
            { id: 'probe', label: 'HTTP probe', type: 'tool', config: { tool_name: 'http_probe' }, position: { x: 120, y: 400 } },
            { id: 'review', label: 'Approve findings', type: 'approval', config: { prompt: 'Confirm the services before validation', reviewer: 'human' }, position: { x: 120, y: 540 } },
            { id: 'report', label: 'Summary', type: 'output', config: { output_key: 'summary' }, position: { x: 120, y: 680 } },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'recon' },
            { id: 'e2', source: 'recon', target: 'probe' },
            { id: 'e3', source: 'probe', target: 'review' },
            { id: 'e4', source: 'review', target: 'report' },
          ],
        }, updated_at: iso(60 * 24 * 3) },
      { id: 'wf-2', name: 'API regression set', description: 'Replay saved API checks nightly.', version: 1, enabled: false, validation_error: '',
        graph_json: {
          nodes: [
            { id: 'start', label: 'Start', type: 'start', config: {}, position: { x: 120, y: 200 } },
            { id: 'replay', label: 'Token replay', type: 'tool', config: { tool_name: 'token_replay' }, position: { x: 340, y: 200 } },
            { id: 'report', label: 'Summary', type: 'output', config: { output_key: 'summary' }, position: { x: 560, y: 200 } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'replay' }, { id: 'e2', source: 'replay', target: 'report' }],
        }, updated_at: iso(60 * 24 * 1) },
    ];
    const c2Listeners = [
      { id: 'lst-1', name: 'lab-https', type: 'https_beacon', remark: 'Lab listener (demo, not bound to a network)', bindHost: '127.0.0.1', bindPort: 8443, configJson: '{}', profileId: 'prof-1', running: false, status: 'stopped', profile: 'default', projectId: '', createdAt: iso(60 * 24 * 3), created_at: iso(60 * 24 * 3) },
    ];
    const webshells = [
      { id: 'ws-1', name: 'Lab shell (demo)', url: 'https://lab.example.com/upload/shell.php', type: 'php', password_set: true, status: 'offline', created_at: iso(60 * 24 * 5) },
    ];

    return {
      __version: SEED_VERSION,
      auth: { username: 'admin', password: 'admin', token: 'mock-session-token' },
      users: users,
      roles: roles,
      projects: projects,
      facts: facts,
      factEdges: factEdges,
      conversations: conversations,
      messages: messages,
      vulnerabilities: vulnerabilities,
      assets: assets,
      batchQueues: batchQueues,
      skills: skills,
      externalMCP: externalMCP,
      notifications: notifications,
      auditLogs: auditLogs,
      executions: executions,
      knowledgeCategories: knowledgeCategories,
      knowledgeItems: knowledgeItems,
      aiRoles: roles_ai,
      hitlPending: [],
      hitlLogs: hitlLogs,
      workflows: workflows,
      c2Listeners: c2Listeners,
      webshells: webshells,
      config: null,
    };
}
