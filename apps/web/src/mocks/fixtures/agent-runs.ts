import type { RunScenario, RunThread, SubAgent } from '../../features/agent-runs/model'

const ACME_ROOT_AGENT: SubAgent = {
  id: 'root',
  name: 'Root Agent',
  type: 'Orchestrator',
  status: 'running',
  task: 'Coordinating full engagement for Acme Corp. Orchestrating recon, vuln scanning, exploitation, and post-exploit phases.',
  skills: ['orchestrate', 'plan', 'summarize', 'report', 'spawn-agents'],
  tools: ['agent-spawner', 'findings-api', 'asset-store', 'hitl-gateway'],
  recentActions: [
    { label: 'Spawned ExploitAgent — HITL approval pending', ts: '13:55' },
    { label: 'Demo findings summary generated (13 findings)', ts: '14:32' },
    { label: 'VulnScanner triggered on api.acme.com', ts: '14:22' },
    { label: 'Demo inventory projection — 12 sample assets', ts: '14:15' },
  ],
}

const ACME_SUBAGENTS: SubAgent[] = [
  {
    id: 'recon-1',
    name: 'ReconAgent',
    type: 'Reconnaissance',
    status: 'done',
    task: 'Recorded demo reconnaissance for acme.com and *.acme-staging.io. The sample inventory projection contains 12 assets.',
    skills: ['dns-enum', 'subdomain-brute', 'whois', 'port-scan'],
    tools: ['subfinder', 'amass', 'dig', 'nmap', 'masscan'],
    recentActions: [
      { label: 'Demo discovery projection → 12 sample inventory rows', ts: '14:15' },
      { label: 'nmap -sV acme.com → 23 open ports', ts: '14:08' },
      { label: 'amass enum -d acme-staging.io → 41 hosts', ts: '13:58' },
    ],
  },
  {
    id: 'vuln-1',
    name: 'VulnScanner',
    type: 'Vulnerability Scanner',
    status: 'idle',
    task: 'Nuclei + Nikto scan against all discovered HTTP/HTTPS services. Awaiting port scan completion from ReconAgent before initiating final batch.',
    skills: ['vuln-scan', 'cve-lookup', 'web-scan', 'header-analysis'],
    tools: ['nuclei', 'nikto', 'whatweb', 'wapiti'],
    recentActions: [
      { label: 'nuclei -t cves/ acme.com → 3 critical', ts: '14:22' },
      { label: 'nikto -h api.acme.com → 7 findings', ts: '14:10' },
      { label: 'whatweb admin.acme-staging.io → AdminLite 2.3.1', ts: '14:01' },
    ],
  },
  {
    id: 'exploit-1',
    name: 'ExploitAgent',
    type: 'Exploitation',
    status: 'blocked',
    task: 'Exploit CVE-2024-49113 (unauthenticated RCE) on admin.acme-staging.io:8080. Requires HITL approval before executing exploit payload.',
    skills: ['exploit-dev', 'post-exploit', 'pivoting', 'priv-esc'],
    tools: ['metasploit', 'msfvenom', 'nc', 'python3'],
    recentActions: [
      { label: 'CVE-2024-49113 PoC validated locally', ts: '13:55' },
      { label: 'Target fingerprinted: AdminLite 2.3.1', ts: '13:50' },
      { label: 'Payload staged — awaiting approval', ts: '13:55' },
    ],
  },
  {
    id: 'postexploit-1',
    name: 'PostExploitAgent',
    type: 'Post-Exploitation',
    status: 'idle',
    task: 'Lateral movement planning based on discovered credentials. Will pivot through 10.0.1.0/24 once initial foothold is confirmed by ExploitAgent.',
    skills: ['lateral-movement', 'cred-harvest', 'persistence', 'c2-infra'],
    tools: ['mimikatz', 'bloodhound', 'crackmapexec', 'impacket'],
    recentActions: [
      { label: 'Internal range mapped: 10.0.1.0/24, 14 hosts', ts: '13:30' },
      { label: '.env credentials staged for spray attempt', ts: '13:25' },
      { label: 'BloodHound collection queued', ts: '13:20' },
    ],
  },
]

const ACME_THREADS: RunThread[] = [
  {
    id: 'chat-1',
    title: 'Recon & vuln summary',
    preview: 'Critical: CVE-2024-49113 RCE confirmed on admin.acme-staging…',
    timestamp: '14:32',
    messages: [
      {
        id: 'c1-1',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          "This is the root agent demo for **Acme Corp External Assessment**. The sample repository contains **13 findings** and **12 inventory rows**.\n\nRecorded scenario status:\n- **ReconAgent**: Sample inventory available\n- **VulnScanner**: Idle\n- **ExploitAgent**: Waiting for a demo HITL decision\n- **PostExploitAgent**: Idle\n\nNo live execution is connected. What would you like to inspect?",
        timestamp: '14:30',
      },
      {
        id: 'c1-2',
        role: 'user',
        content: 'Give me a summary of the most critical findings so far.',
        timestamp: '14:31',
      },
      {
        id: 'c1-3',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          "Here's a consolidated summary of critical findings:\n\n**CRITICAL**\n- CVE-2024-49113 — Unauthenticated RCE on `admin.acme-staging.io:8080` (AdminLite v2.3.1)\n- Exposed `.env` file with plaintext DB credentials on `api.acme.com`\n\n**HIGH**\n- SQL injection on `login.acme.com/api/auth` (POST body, `username` param)\n- Outdated Apache 2.4.49 with path traversal (CVE-2021-41773)\n- Admin panel externally reachable without authentication\n\n**Recommended:** Approve ExploitAgent to confirm RCE exploitability, then chain with lateral movement simulation.",
        timestamp: '14:32',
        toolCalls: [
          { name: 'findings.query', result: '13 demo findings loaded from the sample repository' },
          { name: 'agent.sync', result: 'VulnScanner, ReconAgent state pulled' },
        ],
      },
    ],
  },
  {
    id: 'chat-2',
    title: 'Exploit chain planning',
    preview: "What's the best lateral movement path after initial RCE?",
    timestamp: '13:10',
    messages: [
      {
        id: 'c2-1',
        role: 'user',
        content: "What's the best lateral movement path after initial RCE?",
        timestamp: '13:05',
      },
      {
        id: 'c2-2',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          "Given the RCE on `admin.acme-staging.io:8080`, the most promising lateral movement path is:\n\n1. **Credential dump** from the exposed `.env` file (`DB_PASS=[REDACTED]`)\n2. **Spray credentials** against internal VPN and SSH endpoints in `10.0.1.0/24`\n3. **Pivot** through staging network — 14 internal hosts mapped by PostExploitAgent\n4. **BloodHound** AD collection if domain credentials crack\n\nI'll need HITL approval before executing steps 2 and 3.",
        timestamp: '13:10',
        toolCalls: [
          { name: 'network.map', result: 'Internal range 10.0.1.0/24 mapped, 14 hosts' },
          { name: 'credentials.metadata', result: 'Demo metadata only — credential values withheld' },
        ],
      },
    ],
  },
  {
    id: 'chat-3',
    title: 'Asset inventory review',
    preview: 'List all externally exposed services on port 443…',
    timestamp: 'Yesterday',
    messages: [
      {
        id: 'c3-1',
        role: 'user',
        content: 'List all externally exposed services on port 443.',
        timestamp: '09:22',
      },
      {
        id: 'c3-2',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          "Recorded **demo service observations**:\n\n- `acme.com` — Nginx 1.21.3\n- `api.acme.com` — Express.js\n- `admin.acme-staging.io` — sample admin service\n- `login.acme.com` — sample login portal\n- `cdn.acme.com` — sample CDN endpoint\n\nThese are mock observations; the inventory view contains 12 sample rows, not a live scan result.",
        timestamp: '09:25',
        toolCalls: [
          { name: 'assets.query', result: '12 sample inventory rows — no live discovery query' },
        ],
      },
      {
        id: 'c3-3',
        role: 'user',
        content: 'Flag admin.acme-staging.io as high priority.',
        timestamp: '09:26',
      },
      {
        id: 'c3-4',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          '`admin.acme-staging.io` flagged as **Priority: Critical**. ExploitAgent has been pre-staged with CVE-2024-49113 payload — approval will trigger immediate execution.',
        timestamp: '09:27',
        toolCalls: [
          { name: 'assets.update', result: 'admin.acme-staging.io → priority=critical' },
          { name: 'agent.notify', result: 'ExploitAgent briefed' },
        ],
      },
    ],
  },
]

const FINTECH_ROOT_AGENT: SubAgent = {
  id: 'root',
  name: 'Root Agent',
  type: 'Orchestrator',
  status: 'running',
  task: 'Coordinating the FinTech API Red Team demo run. Recon of api.fintech-internal.io is in progress; no HITL decisions pending.',
  skills: ['orchestrate', 'plan', 'summarize', 'report', 'spawn-agents'],
  tools: ['agent-spawner', 'findings-api', 'asset-store', 'hitl-gateway'],
  recentActions: [
    { label: 'ReconAgent dispatched — api.fintech-internal.io', ts: '10:12' },
    { label: 'Scope validated against charter (demo)', ts: '10:05' },
  ],
}

const FINTECH_SUBAGENTS: SubAgent[] = [
  {
    id: 'recon-ft-1',
    name: 'ReconAgent',
    type: 'Reconnaissance',
    status: 'running',
    task: 'Endpoint enumeration and TLS/header review for api.fintech-internal.io and the admin panel host. Demo scenario — no live traffic.',
    skills: ['dns-enum', 'subdomain-brute', 'port-scan'],
    tools: ['subfinder', 'nmap', 'dig'],
    recentActions: [
      { label: 'nmap -sV api.fintech-internal.io → 6 open ports', ts: '10:14' },
      { label: 'subfinder -d fintech-internal.io → 9 hosts', ts: '10:09' },
    ],
  },
  {
    id: 'apiscan-ft-1',
    name: 'ApiScanner',
    type: 'API Security',
    status: 'idle',
    task: 'OpenAPI-driven probe of the payments API. Queued until ReconAgent finishes endpoint enumeration.',
    skills: ['api-fuzz', 'authz-test', 'schema-diff'],
    tools: ['ffuf', 'burp', 'graphql-cop'],
    recentActions: [
      { label: 'OpenAPI spec cached for diffing', ts: '10:02' },
    ],
  },
]

const FINTECH_THREADS: RunThread[] = [
  {
    id: 'chat-ft-1',
    title: 'API recon kickoff',
    preview: 'Begin enumeration of api.fintech-internal.io…',
    timestamp: '10:12',
    messages: [
      {
        id: 'cf1-1',
        role: 'user',
        content: 'Begin enumeration of api.fintech-internal.io. Stay inside charter scope.',
        timestamp: '10:10',
      },
      {
        id: 'cf1-2',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          "Understood. Demo scenario for **FinTech API Red Team**:\n\n- **ReconAgent** is enumerating `api.fintech-internal.io` (in scope per charter)\n- **ApiScanner** stays idle until endpoint enumeration completes\n\nNo exploitation will run without HITL approval. Demo data only — no live traffic is generated.",
        timestamp: '10:12',
        toolCalls: [
          { name: 'scope.validate', result: 'api.fintech-internal.io in charter scope' },
        ],
      },
    ],
  },
]

const DORMANT_ROOT_AGENT: SubAgent = {
  id: 'root',
  name: 'Root Agent',
  type: 'Orchestrator',
  status: 'idle',
  task: 'No agent run is active for this project in the demo data. Press Run in the control bar to start a simulated root-agent session.',
  skills: ['orchestrate', 'plan', 'summarize', 'report'],
  tools: ['agent-spawner', 'findings-api', 'asset-store'],
  recentActions: [],
}

const DORMANT_THREADS: RunThread[] = [
  {
    id: 'chat-dormant-1',
    title: 'Session notes',
    preview: 'Demo mode — no active agent run for this project…',
    timestamp: '—',
    messages: [
      {
        id: 'cd1-1',
        role: 'agent',
        agentName: 'Root Agent',
        content:
          'Demo data only — **no agent run is active** for this project.\n\nPress **Run** in the control bar to start a simulated root-agent session, or send a message to brief the root agent. Fixtures live in `src/mocks/fixtures/agent-runs.ts`; nothing here touches a live runtime.',
        timestamp: '—',
      },
    ],
  },
]

export const DEMO_RUN_SCENARIOS: Record<string, RunScenario> = {
  '1': {
    displayName: 'Acme Corp External Assessment',
    runState: 'running',
    greeting: 'Ready for your instructions on **Acme Corp External Assessment**. All active agents are standing by.',
    rootAgent: ACME_ROOT_AGENT,
    subAgents: ACME_SUBAGENTS,
    threads: ACME_THREADS,
  },
  '2': {
    displayName: 'FinTech API Red Team',
    runState: 'running',
    greeting: 'Ready for your instructions on **FinTech API Red Team**. All active agents are standing by.',
    rootAgent: FINTECH_ROOT_AGENT,
    subAgents: FINTECH_SUBAGENTS,
    threads: FINTECH_THREADS,
  },
}

const DORMANT_SCENARIO: RunScenario = {
  displayName: 'this engagement',
  runState: 'stopped',
  greeting: 'No agent run is active for this project yet. Press **Run** to start a simulated demo session with the root agent.',
  rootAgent: DORMANT_ROOT_AGENT,
  subAgents: [],
  threads: DORMANT_THREADS,
}

export function getRunScenario(projectId: string): RunScenario {
  return DEMO_RUN_SCENARIOS[projectId] ?? DORMANT_SCENARIO
}
