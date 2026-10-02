import { useState } from 'react'
import type { Project } from '../types'
import { SearchIcon, DownloadIcon, TerminalIcon, RefreshIcon, XIcon } from '../components/Icons'

interface Props {
  project: Project
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'critical'
type LogStatus = 'success' | 'warning' | 'error' | 'info'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  status: LogStatus
  agent: string
  phase: string
  tool: string | null
  action: string
  message: string
  detail: string | null
}

const LOGS: LogEntry[] = [
  { id: '1',  timestamp: '2026-09-18 14:32:01', level: 'info',     status: 'success', agent: 'ReconAgent-2',    phase: 'Reconnaissance', tool: 'nmap',          action: 'port_scan_complete',    message: 'Port scan completed: 312 open ports across 47 hosts',                              detail: 'nmap -sV -sC -p- 10.0.0.0/24 completed in 00:17:32\nOutput: /artifacts/nmap_full_20260918.xml\nHosts up: 47/256\nOpen ports: 312 total (TCP: 298, UDP: 14)' },
  { id: '2',  timestamp: '2026-09-18 14:28:14', level: 'critical',  status: 'error',   agent: 'VulnScanner-1',  phase: 'Assessment',     tool: 'nuclei',        action: 'vuln_confirmed',        message: 'CVE-2024-49113 confirmed on admin.acme-staging.io:8080',                           detail: '[CVE-2024-49113] AdminLite 2.3.1 - Unauthenticated RCE via PHP deserialization\nURL: http://admin.acme-staging.io:8080/admin/upload.php\nSeverity: CRITICAL\nCVSS: 9.8\nPoC: /artifacts/cve_2024_49113_poc.txt' },
  { id: '3',  timestamp: '2026-09-18 14:25:33', level: 'warn',      status: 'warning', agent: 'ExploitAgent-1', phase: 'Exploitation',   tool: null,            action: 'hitl_blocked',          message: 'Awaiting HITL approval before executing reverse shell payload',                     detail: 'Action blocked pending human-in-the-loop review.\nProposed tool: exploit_runner\nPayload: CVE-2024-49113 reverse shell\nRisk score: CRITICAL\nRoE boundary: requires explicit approval' },
  { id: '4',  timestamp: '2026-09-18 14:15:47', level: 'info',      status: 'success', agent: 'ReconAgent-2',   phase: 'Reconnaissance', tool: 'masscan',       action: 'host_discovery',        message: 'Initial host discovery: 47 live hosts in 10.0.0.0/24',                             detail: 'masscan -p80,443,8080,22,21 10.0.0.0/24 --rate=1000\nElapsed: 00:03:14\nLive hosts: 47' },
  { id: '5',  timestamp: '2026-09-18 14:10:02', level: 'error',     status: 'error',   agent: 'VulnScanner-1', phase: 'Assessment',     tool: 'nikto',         action: 'connection_timeout',    message: 'Connection timeout to 10.0.0.33:443 — SSL handshake failed',                       detail: 'SSL error: certificate expired (2025-01-01)\nHost 10.0.0.33 marked as unreachable\nRetries: 3/3 failed\nSkipping host, continuing scan' },
  { id: '6',  timestamp: '2026-09-18 13:58:20', level: 'info',      status: 'success', agent: 'ReconAgent-1',  phase: 'Reconnaissance', tool: 'subfinder',     action: 'subdomain_discovery',   message: 'Subdomain discovery: 12 new subdomains found for acme.com',                        detail: 'Discovered subdomains:\nadmin.acme.com\napi.acme.com\nstaging.acme.com\ndev.acme.com\nmail.acme.com\nvpn.acme.com\ncdn.acme.com\nassets.acme.com\nauth.acme.com\ninternal.acme.com\ntest.acme.com\nold.acme.com' },
  { id: '7',  timestamp: '2026-09-18 13:40:11', level: 'info',      status: 'info',    agent: 'Root Agent',    phase: 'Reconnaissance', tool: 'agent-spawner', action: 'agent_spawned',         message: 'Spawned ExploitAgent-1 for CVE-2024-49113 follow-up assessment',                   detail: 'Agent ID: exploit-1\nSkills: exploit-dev, post-exploit\nParent: root-agent\nTask: Verify and document CVE-2024-49113 exploitation path' },
  { id: '8',  timestamp: '2026-09-18 13:22:45', level: 'warn',      status: 'warning', agent: 'VulnScanner-1', phase: 'Assessment',     tool: 'nikto',         action: 'credential_leak',       message: 'Exposed .env file detected at api.acme.com/.env — possible credential leak',       detail: 'HTTP 200 on GET https://api.acme.com/.env\nContains: DB_PASSWORD, API_SECRET, STRIPE_KEY\nSeverity: HIGH\nArtifact saved: /artifacts/env_file_20260918.txt' },
  { id: '9',  timestamp: '2026-09-18 13:10:00', level: 'debug',     status: 'info',    agent: 'ReconAgent-1',  phase: 'Reconnaissance', tool: 'whois',         action: 'whois_lookup',          message: 'WHOIS lookup completed for acme.com',                                              detail: 'Registrar: GoDaddy LLC\nExpires: 2028-03-15\nNS1: ns1.dnsimple.com\nNS2: ns2.dnsimple.com\nRegistrant: Acme Corporation, privacy protected' },
  { id: '10', timestamp: '2026-09-18 12:55:18', level: 'info',      status: 'success', agent: 'Root Agent',    phase: 'Intake',         tool: null,            action: 'engagement_init',       message: 'Engagement initialized: Acme Corp External Assessment',                            detail: 'Scope: acme.com, *.acme-staging.io (47 hosts)\nRoE hash: sha256:ab3f...e7c1\nEngagement ID: eng-2026-acme-ext\nStart: 2026-09-10T09:00:00Z' },
  { id: '11', timestamp: '2026-09-18 12:40:02', level: 'info',      status: 'success', agent: 'ReconAgent-1',  phase: 'Reconnaissance', tool: 'shodan',        action: 'passive_recon',         message: 'Shodan query: 3 exposed services found on acme.com IPs',                          detail: 'acme.com (104.21.44.10): port 8080/http - Apache 2.4.41\n104.21.44.11: port 9200/elasticsearch - no auth\n104.21.44.12: port 6379/redis - no auth\nAll added to target list' },
  { id: '12', timestamp: '2026-09-18 12:28:50', level: 'info',      status: 'success', agent: 'ReconAgent-2',  phase: 'Reconnaissance', tool: 'amass',         action: 'dns_brute',             message: 'DNS brute-force: 8 additional hosts discovered via amass',                        detail: 'New hosts:\n10.0.0.41 - jenkins.acme-internal.io\n10.0.0.42 - gitlab.acme-internal.io\n10.0.0.43 - jira.acme-internal.io\n10.0.0.44 - grafana.acme-internal.io' },
  { id: '13', timestamp: '2026-09-18 12:15:44', level: 'warn',      status: 'warning', agent: 'Root Agent',    phase: 'Assessment',     tool: null,            action: 'scope_warning',         message: 'Host 192.168.99.1 is outside engagement scope — skipping',                        detail: 'Host discovered via pivot: 192.168.99.1\nScope boundary: 10.0.0.0/24, acme.com, *.acme-staging.io\nDecision: skip, log for client notification' },
  { id: '14', timestamp: '2026-09-18 11:55:30', level: 'info',      status: 'success', agent: 'VulnScanner-1', phase: 'Assessment',     tool: 'nuclei',        action: 'template_scan',         message: 'Nuclei scan completed: 4 critical, 7 high, 12 medium templates matched',           detail: 'Scan duration: 00:22:18\nTemplates run: 3,841\nCritical: 4\nHigh: 7\nMedium: 12\nLow: 3\nInfo: 29\nFull report: /artifacts/nuclei_20260918.json' },
  { id: '15', timestamp: '2026-09-18 11:30:00', level: 'info',      status: 'success', agent: 'ReconAgent-1',  phase: 'Reconnaissance', tool: 'httpx',         action: 'web_fingerprint',       message: 'Web technology fingerprinting complete across 47 hosts',                           detail: 'Technologies identified:\nNginx 1.24: 18 hosts\nApache 2.4: 12 hosts\nNode.js/Express: 8 hosts\nAdminLite 2.3.1: 1 host (admin.acme-staging.io:8080)\nWordPress 6.3: 3 hosts' },
  { id: '16', timestamp: '2026-09-18 11:12:17', level: 'error',     status: 'error',   agent: 'ExploitAgent-1', phase: 'Exploitation',  tool: 'sqlmap',        action: 'auth_error',            message: 'SQLmap session token expired — authentication required',                           detail: 'Session token for api.acme.com expired at 11:12:00\nRe-authentication required before continuing\nEndpoint: /api/v2/search (SQLi testing)' },
  { id: '17', timestamp: '2026-09-18 11:00:00', level: 'info',      status: 'info',    agent: 'Root Agent',     phase: 'Assessment',    tool: null,            action: 'phase_transition',      message: 'Phase transition: Reconnaissance → Assessment',                                    detail: 'Reconnaissance phase complete\nAssets discovered: 47 hosts, 12 subdomains\nFindings: 0 critical, 2 high during recon\nInitiating Assessment phase' },
  { id: '18', timestamp: '2026-09-18 10:44:55', level: 'debug',     status: 'info',    agent: 'ReconAgent-2',   phase: 'Reconnaissance', tool: 'ffuf',         action: 'dir_bruteforce',        message: 'Directory brute-force on api.acme.com: 23 endpoints discovered',                  detail: 'ffuf -w /wordlists/common.txt -u https://api.acme.com/FUZZ\nEndpoints: /api/v1, /api/v2, /admin, /.env, /swagger, /health, /metrics...\nInteresting: /.env (HTTP 200, 847 bytes)' },
  { id: '19', timestamp: '2026-09-18 10:30:22', level: 'info',      status: 'success', agent: 'VulnScanner-1',  phase: 'Assessment',    tool: 'testssl',       action: 'tls_scan',              message: 'TLS configuration scanned: BEAST, POODLE not present; HSTS missing on all hosts', detail: 'testssl.sh results:\nNo HSTS header: 47/47 hosts\nTLS 1.0 enabled: 3 hosts\nWeak ciphers: 6 hosts\nSSL cert expiry warnings: 2 hosts\nFull report: /artifacts/tls_20260918.json' },
  { id: '20', timestamp: '2026-09-18 10:00:00', level: 'info',      status: 'success', agent: 'Root Agent',     phase: 'Intake',        tool: null,            action: 'agents_spawned',        message: 'Agent team initialized: ReconAgent-1, ReconAgent-2, VulnScanner-1 deployed',      detail: 'Deployment manifest:\nReconAgent-1: passive recon, OSINT\nReconAgent-2: active scanning\nVulnScanner-1: vulnerability assessment\nAll agents running in sandboxed environment' },
]

const LEVEL_CONFIG: Record<LogLevel, { bg: string; text: string; label: string }> = {
  critical: { bg: '#FEF2F2', text: '#DC2626', label: 'CRIT' },
  error:    { bg: '#2a1810', text: '#F97316', label: 'ERR' },
  warn:     { bg: '#FEF3C7', text: '#F59E0B', label: 'WARN' },
  info:     { bg: '#F1F5F9', text: '#475569', label: 'INFO' },
  debug:    { bg: '#DCFCE7', text: '#22C55E', label: 'DBG' },
}

const STATUS_DOT: Record<LogStatus, string> = {
  success: '#22C55E',
  warning: '#F59E0B',
  error:   '#DC2626',
  info:    '#94A3B8',
}

const AGENTS = ['All agents', 'Root Agent', 'ReconAgent-1', 'ReconAgent-2', 'VulnScanner-1', 'ExploitAgent-1']
const PHASES = ['All phases', 'Intake', 'Reconnaissance', 'Assessment', 'Exploitation']
const TOOLS  = ['All tools', 'nmap', 'nuclei', 'masscan', 'subfinder', 'nikto', 'httpx', 'amass', 'ffuf', 'shodan', 'sqlmap', 'testssl', 'whois', 'agent-spawner']

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '7px 12px', fontSize: 12, borderRadius: 8, outline: 'none', cursor: 'pointer',
        background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569',
        appearance: 'none',
      }}
    >
      {options.map(o => <option key={o} value={o} style={{ background: '#FFFFFF' }}>{o}</option>)}
    </select>
  )
}

export default function Logs({ project: _project }: Props) {
  const [agentFilter, setAgentFilter] = useState('All agents')
  const [phaseFilter, setPhaseFilter] = useState('All phases')
  const [toolFilter, setToolFilter]   = useState('All tools')
  const [statusFilter, setStatusFilter] = useState<LogStatus | 'all'>('all')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LogEntry | null>(LOGS[0])
  const [selectedItem, setSelectedItem] = useState<LogEntry | null>(null)
  const [view, setView] = useState<'table' | 'terminal'>('table')
  const [autoScroll, setAutoScroll] = useState(true)

  const filtered = LOGS.filter(l => {
    if (agentFilter !== 'All agents' && l.agent !== agentFilter) return false
    if (phaseFilter !== 'All phases' && l.phase !== phaseFilter) return false
    if (toolFilter !== 'All tools' && l.tool !== toolFilter) return false
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.agent.toLowerCase().includes(search.toLowerCase()) && !(l.tool?.toLowerCase().includes(search.toLowerCase()))) return false
    return true
  })

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Logs & Tool Output</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
            {filtered.length} entries · {LOGS.filter(l => l.level === 'critical' || l.level === 'error').length} errors
            <span style={{ color: '#22C55E', marginLeft: 8 }}>● Live</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* View toggle */}
          <div style={{ display: 'flex', gap: 2, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: 3 }}>
            {(['table', 'terminal'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                  background: view === v ? '#F1F5F9' : 'transparent',
                  color: view === v ? '#0F172A' : '#94A3B8',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {v === 'terminal' ? <TerminalIcon size={13} /> : v}
              </button>
            ))}
          </div>
          {/* Auto-scroll */}
          <button
            onClick={() => setAutoScroll(p => !p)}
            style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              background: autoScroll ? '#DCFCE7' : '#FFFFFF',
              border: autoScroll ? '1px solid #16A34A' : '1px solid #E2E8F0',
              color: autoScroll ? '#22C55E' : '#94A3B8',
            }}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button style={{
            padding: '7px 9px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #E2E8F0', cursor: 'pointer', color: '#94A3B8', display: 'flex',
          }}>
            <RefreshIcon size={14} />
          </button>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8,
            fontSize: 12, fontWeight: 500, background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569', cursor: 'pointer',
          }}>
            <DownloadIcon size={13} /> Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <SearchIcon size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search logs…"
            style={{
              paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
              fontSize: 12, borderRadius: 8, outline: 'none', width: 200,
              background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A',
            }}
          />
        </div>
        <Select value={agentFilter} onChange={setAgentFilter} options={AGENTS} />
        <Select value={phaseFilter} onChange={setPhaseFilter} options={PHASES} />
        <Select value={toolFilter} onChange={setToolFilter} options={TOOLS} />

        {/* Level pills */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {(['all', 'critical', 'error', 'warn', 'info', 'debug'] as const).map(l => {
            const active = levelFilter === l
            const cfg = l !== 'all' ? LEVEL_CONFIG[l] : null
            return (
              <button
                key={l}
                onClick={() => setLevelFilter(l)}
                style={{
                  padding: '4px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', textTransform: 'uppercase',
                  background: active ? (cfg ? cfg.bg : '#DC2626') : '#FFFFFF',
                  color: active ? (cfg ? cfg.text : '#fff') : '#94A3B8',
                  border: '1px solid',
                  borderColor: active ? (cfg ? cfg.text + '44' : '#DC2626') : '#E2E8F0',
                }}
              >
                {l === 'all' ? 'All' : LEVEL_CONFIG[l].label}
              </button>
            )
          })}
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'success', 'warning', 'error', 'info'] as const).map(s => {
            const active = statusFilter === s
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '4px 9px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', textTransform: 'capitalize',
                  background: active ? '#F1F5F9' : '#FFFFFF',
                  color: active ? (s !== 'all' ? STATUS_DOT[s] : '#0F172A') : '#94A3B8',
                  border: '1px solid #E2E8F0',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {s !== 'all' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[s], display: 'inline-block' }} />}
                {s === 'all' ? 'All status' : s}
              </button>
            )
          })}
        </div>
      </div>

      {view === 'terminal' ? (
        <TerminalView logs={filtered} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
          {/* Log table */}
          <div style={{ borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '140px 60px 140px 100px 1fr 80px',
              gap: 12, padding: '9px 16px',
              background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8',
            }}>
              <span>Timestamp</span>
              <span>Level</span>
              <span>Agent</span>
              <span>Tool / MCP</span>
              <span>Action</span>
              <span>Status</span>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No log entries match your filters</div>
              ) : (
                filtered.map((log, idx) => {
                  const lc = LEVEL_CONFIG[log.level]
                  const isSelected = selected?.id === log.id
                  return (
                    <button
                      key={log.id}
                      onClick={() => { setSelected(isSelected ? null : log); setSelectedItem(log) }}
                      style={{
                        width: '100%', display: 'grid', gridTemplateColumns: '140px 60px 140px 100px 1fr 80px',
                        gap: 12, padding: '11px 16px', textAlign: 'left',
                        borderBottom: idx < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                        background: isSelected ? '#F1F5F9' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9' }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94A3B8' }}>
                        {log.timestamp.split(' ')[1]}
                      </span>
                      <span>
                        <span style={{
                          padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                          background: lc.bg, color: lc.text,
                        }}>
                          {lc.label}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.agent}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.tool ?? '—'}
                      </span>
                      <span style={{ fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.message}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[log.status], flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: STATUS_DOT[log.status], fontWeight: 600, textTransform: 'capitalize' }}>
                          {log.status}
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Detail panel */}
          <div style={{ borderRadius: 12, border: '1px solid #E2E8F0', background: '#FFFFFF', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {selected ? (
              <>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                        background: LEVEL_CONFIG[selected.level].bg, color: LEVEL_CONFIG[selected.level].text,
                      }}>
                        {LEVEL_CONFIG[selected.level].label}
                      </span>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[selected.status], flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: STATUS_DOT[selected.status], fontWeight: 600, textTransform: 'capitalize' }}>
                        {selected.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', margin: 0, lineHeight: 1.5 }}>
                      {selected.message}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0 }}
                  >
                    <XIcon size={14} />
                  </button>
                </div>

                <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9' }}>
                  {[
                    { label: 'Timestamp', value: selected.timestamp },
                    { label: 'Agent', value: selected.agent, red: true },
                    { label: 'Phase', value: selected.phase },
                    { label: 'Tool', value: selected.tool ?? '—', mono: true },
                    { label: 'Action', value: selected.action, mono: true },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
                      <span style={{ color: '#94A3B8' }}>{row.label}</span>
                      <span style={{
                        fontFamily: row.mono ? 'monospace' : 'inherit',
                        fontSize: row.mono ? 11 : 12,
                        fontWeight: 500,
                        color: row.red ? '#DC2626' : '#475569',
                      }}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>

                {selected.detail && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      Full Output
                    </div>
                    <pre style={{
                      background: '#0B0F19', borderRadius: 8, padding: '12px 14px',
                      fontFamily: 'monospace', fontSize: 11, color: '#9CA3AF',
                      whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0,
                      border: '1px solid #1E2736', overflowX: 'auto',
                    }}>
                      {selected.detail}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
                Select a log entry to view details
              </div>
            )}
          </div>
        </div>
      )}
      {selectedItem && (
        <LogModal log={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  )
}

function LogModal({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  const lc = LEVEL_CONFIG[log.level]
  const statusDot = STATUS_DOT[log.status]
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative', width: '100%', maxWidth: 672, margin: '0 16px',
          backgroundColor: '#FFFFFF', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                background: lc.bg, color: lc.text,
              }}>
                {lc.label}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#94A3B8' }}>{log.timestamp}</span>
            </div>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.4 }}>
              {log.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, borderRadius: 6 }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
          {/* Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px', marginBottom: 20 }}>
            {[
              { label: 'Agent Name', value: log.agent, red: true },
              { label: 'Action Taken', value: log.action, mono: true },
              { label: 'Target', value: log.tool ?? log.phase },
              { label: 'Phase', value: log.phase },
            ].map(row => (
              <div key={row.label}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 3 }}>
                  {row.label}
                </div>
                <div style={{
                  fontSize: 12, fontWeight: 500,
                  fontFamily: row.mono ? 'monospace' : 'inherit',
                  color: row.red ? '#DC2626' : '#475569',
                }}>
                  {row.value}
                </div>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 3 }}>
                Status
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: statusDot }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block' }} />
                {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
              </span>
            </div>
          </div>

          {/* Message */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 6 }}>
              Message
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: 0 }}>{log.message}</p>
          </div>

          {/* Full output */}
          {log.detail && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 6 }}>
                Full Output
              </div>
              <pre style={{
                background: '#0B0F19', borderRadius: 8, padding: '14px 16px',
                fontFamily: 'monospace', fontSize: 11, color: '#9CA3AF',
                whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0,
                border: '1px solid #1E2736', overflowX: 'auto',
              }}>
                {log.detail}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function TerminalView({ logs }: { logs: LogEntry[] }) {
  const levelColors: Record<LogLevel, string> = {
    critical: '#DC2626',
    error:    '#F97316',
    warn:     '#F59E0B',
    info:     '#475569',
    debug:    '#22C55E',
  }
  return (
    <div style={{
      background: '#0B0F19', borderRadius: 12, padding: '16px 20px',
      fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8,
      overflowY: 'auto', maxHeight: 'calc(100vh - 260px)',
      border: '1px solid #1E2736',
    }}>
      <div style={{ color: '#22C55E', marginBottom: 12, fontSize: 11 }}>
        raptix@pentest-session ~ % tail -f /var/log/raptix/engagement.log
      </div>
      {logs.map(log => (
        <div key={log.id} style={{ display: 'flex', gap: 10, marginBottom: 2, padding: '1px 4px', borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
        >
          <span style={{ color: '#4B5563', flexShrink: 0 }}>{log.timestamp.split(' ')[1]}</span>
          <span style={{ flexShrink: 0, width: 48, fontWeight: 700, color: levelColors[log.level] }}>
            [{LEVEL_CONFIG[log.level].label}]
          </span>
          <span style={{ color: '#DC2626', flexShrink: 0 }}>{log.agent}</span>
          {log.tool && <span style={{ color: '#3B82F6', flexShrink: 0 }}>[{log.tool}]</span>}
          <span style={{ color: '#9CA3AF' }}>{log.message}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#22C55E' }}>
        <span>▸</span>
        <span style={{ animation: 'pulse 1s infinite' }}>_</span>
      </div>
    </div>
  )
}
