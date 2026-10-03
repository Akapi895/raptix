import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionStatus = 'running' | 'completed' | 'failed'

interface ThoughtCard {
  type: 'thought'
  id: string
  text: string
  opsecScore?: number
}

interface ActionCard {
  type: 'action'
  id: string
  tool: string
  args: Record<string, string>
  status: ActionStatus
}

interface ObservationCard {
  type: 'observation'
  id: string
  summary: string
  terminalOutput: string
}

interface OperatorCard {
  type: 'operator'
  id: string
  message: string
}

interface HitlCard {
  type: 'hitl'
  id: string
  command: string
  target: string
  opsecRisk: string
}

type TimelineEvent = ThoughtCard | ActionCard | ObservationCard | OperatorCard | HitlCard

type AgentStatus = 'running' | 'hitl' | 'idle'

interface AgentDef {
  id: string
  name: string
  status: AgentStatus
  target: string
}

interface PhaseGroup {
  id: string
  label: string
  agents: AgentDef[]
  grayed?: boolean
}

// ─── Initial timeline data ────────────────────────────────────────────────────

const INITIAL_EVENTS: TimelineEvent[] = [
  {
    type: 'operator',
    id: 'ev-1',
    message: 'Begin network enumeration from established foothold on 10.10.14.22.',
  },
  {
    type: 'thought',
    id: 'ev-2',
    text: 'Initiating subnet scan from foothold to map the network topology. Stealth SYN scan is acceptable given current noise floor.',
    opsecScore: 8.2,
  },
  {
    type: 'action',
    id: 'ev-3',
    tool: 'nmap',
    args: { target: '10.10.14.0/24', flags: '-sS -T3 -p 22,80,443,445,3389' },
    status: 'completed',
  },
  {
    type: 'observation',
    id: 'ev-4',
    summary: '14 live hosts discovered. DC01 at 10.10.14.67 (ports 88, 445, 3389 open).',
    terminalOutput: `Starting Nmap 7.94 ( https://nmap.org ) at 2026-09-29 14:22 UTC
Nmap scan report for 10.10.14.1
Host is up (0.0021s latency).
Nmap scan report for 10.10.14.10
Host is up (0.0019s latency).
Nmap scan report for 10.10.14.15
Host is up (0.0025s latency).
...
Nmap scan report for 10.10.14.67 (DC01.ACME.LOCAL)
Host is up (0.0018s latency).
PORT     STATE SERVICE
88/tcp   open  kerberos-sec
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server

Nmap done: 256 IP addresses (14 hosts up) scanned in 47.32 seconds`,
  },
  {
    type: 'thought',
    id: 'ev-5',
    text: 'DC01 identified with Kerberos and SMB open. Likely Windows Server domain controller. Credential spray via SMB is viable against svc_ accounts.',
    opsecScore: 7.5,
  },
  {
    type: 'action',
    id: 'ev-6',
    tool: 'crackmapexec',
    args: { target: '10.10.14.67', protocol: 'smb', wordlist: 'rockyou-top100.txt' },
    status: 'completed',
  },
  {
    type: 'observation',
    id: 'ev-7',
    summary: 'Valid credential found: CORP\\svc_backup:P@ssword2024! — local admin on DC01.',
    terminalOutput: `SMB         10.10.14.67     445    DC01             [*] Windows Server 2022 Build 20348 x64
SMB         10.10.14.67     445    DC01             [+] CORP\\svc_backup:P@ssword2024! (Pwn3d!)
SMB         10.10.14.67     445    DC01             [+] Enumerating shares...
SHARE           Permissions     Remark
-----           -----------     ------
ADMIN$          READ,WRITE      Remote Admin
C$              READ,WRITE      Default share
IPC$            READ            Remote IPC
SYSVOL          READ            Logon server share
NETLOGON        READ            Logon server share

[*] Completed spray in 12.4s — 1 valid credential`,
  },
  {
    type: 'thought',
    id: 'ev-8',
    text: 'svc_backup has DCSync rights based on ACL enumeration. NTDS dump would yield all domain hashes. Requesting HITL approval before proceeding — elevated detection risk.',
    opsecScore: 4.1,
  },
  {
    type: 'hitl',
    id: 'ev-9',
    command: 'impacket-secretsdump CORP/svc_backup@10.10.14.67',
    target: 'DC01  10.10.14.67',
    opsecRisk: 'HIGH — likely triggers EDR/SIEM alert',
  },
]

// ─── Agent phase data ─────────────────────────────────────────────────────────

const PHASE_GROUPS: PhaseGroup[] = [
  {
    id: 'phase-1',
    label: 'Phase 1: Initial Foothold',
    agents: [
      { id: 'recon-01', name: 'ReconBot-01', status: 'idle', target: '—' },
      { id: 'port-02', name: 'PortScanner-02', status: 'idle', target: '—' },
      { id: 'web-01', name: 'WebCrawler-01', status: 'idle', target: '—' },
      { id: 'cred-01', name: 'CredHarvest-01', status: 'idle', target: '—' },
    ],
  },
  {
    id: 'phase-2',
    label: 'Phase 2: Network Propagation',
    agents: [
      { id: 'recon-sub-01', name: 'ReconSubAgent-01', status: 'running', target: '10.10.14.0/24' },
      { id: 'smb-01', name: 'SMB-Sprayer-01', status: 'running', target: '10.10.14.67' },
      { id: 'bloodhound-01', name: 'BloodHoundBot-01', status: 'hitl', target: 'DC01' },
      { id: 'ldap-01', name: 'LDAPEnum-01', status: 'idle', target: '10.10.14.67' },
      { id: 'kerb-01', name: 'KerbeRoaster-01', status: 'idle', target: 'ACME.LOCAL' },
      { id: 'adex-02', name: 'ADExplorer-02', status: 'idle', target: 'ACME.LOCAL' },
      { id: 'gpo-01', name: 'GPOHarvester-01', status: 'idle', target: 'ACME.LOCAL' },
      { id: 'trust-01', name: 'TrustMapper-01', status: 'idle', target: 'ACME.LOCAL' },
      { id: 'spn-01', name: 'SPNEnum-01', status: 'idle', target: 'ACME.LOCAL' },
      { id: 'lsa-01', name: 'LSADumper-01', status: 'idle', target: '10.10.14.67' },
      { id: 'ntlm-01', name: 'NTLMRelay-01', status: 'idle', target: '10.10.14.0/24' },
      { id: 'acl-01', name: 'ACLAnalyzer-01', status: 'idle', target: 'DC01' },
    ],
  },
  {
    id: 'phase-3',
    label: 'Phase 3: Action on Objectives',
    agents: [],
    grayed: true,
  },
]

// ─── Small SVG icons ──────────────────────────────────────────────────────────

function BrainIcon({ size = 14, color = '#7C3AED' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

function WrenchIcon({ size = 14, color = '#D97706' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function UserIcon({ size = 14, color = '#2563EB' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function ShieldIcon({ size = 14, color = '#DC2626' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function ChevronDownIcon({ size = 12, color = '#94A3B8' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChevronRightIcon({ size = 12, color = '#94A3B8' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function SearchIcon({ size = 14, color = '#94A3B8' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function SendIcon({ size = 14, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function PauseIcon({ size = 13, color = '#475569' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon({ size = 13, color = '#16A34A' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

// ─── Pulse animations (injected once via a style tag) ─────────────────────────

const PULSE_CSS = `
@keyframes raptix-pulse-red {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes raptix-pulse-green {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes raptix-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.raptix-pulse-red { animation: raptix-pulse-red 1.2s ease-in-out infinite; }
.raptix-pulse-green { animation: raptix-pulse-green 1.4s ease-in-out infinite; }
.raptix-spin { animation: raptix-spin 0.9s linear infinite; }
`

// ─── Tiny pulsing dot ─────────────────────────────────────────────────────────

function PulsingDot({ color, cls }: { color: string; cls: string }) {
  return (
    <span
      className={cls}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

// ─── Spinning dot (running action) ────────────────────────────────────────────

function SpinningDot() {
  return (
    <span
      className="raptix-spin"
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        border: '2px solid #DBEAFE',
        borderTopColor: '#2563EB',
        flexShrink: 0,
      }}
    />
  )
}

// ─── Status indicator for action cards ────────────────────────────────────────

function ActionStatusIcon({ status }: { status: ActionStatus }) {
  if (status === 'running') return <SpinningDot />
  if (status === 'completed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: '#DCFCE7' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: '#FEF2F2' }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  )
}

// ─── OPSEC score badge ────────────────────────────────────────────────────────

function OpsecBadge({ score }: { score: number }) {
  const isHigh = score < 5
  const isMed = score < 7
  const bg = isHigh ? '#FEF2F2' : isMed ? '#FEF3C7' : '#DCFCE7'
  const color = isHigh ? '#DC2626' : isMed ? '#D97706' : '#16A34A'
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: bg, color, letterSpacing: 0.2 }}>
      OPSEC {score}/10
    </span>
  )
}

// ─── Timeline connector dot ────────────────────────────────────────────────────

function ConnectorDot({ color }: { color: string }) {
  return (
    <div style={{ position: 'absolute', left: -5, top: 18, width: 10, height: 10, borderRadius: '50%', background: color, border: '2px solid #FFFFFF', zIndex: 1 }} />
  )
}

// ─── THOUGHT card ─────────────────────────────────────────────────────────────

function ThoughtCardEl({ ev }: { ev: ThoughtCard }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#7C3AED" />
      <div style={{ background: '#EDE9FE', borderLeft: '3px solid #7C3AED', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrainIcon size={14} color="#7C3AED" />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#7C3AED', background: '#DDD6FE', padding: '2px 7px', borderRadius: 4 }}>THOUGHT</span>
          {ev.opsecScore !== undefined && <OpsecBadge score={ev.opsecScore} />}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#475569', fontStyle: 'italic', lineHeight: 1.55 }}>{ev.text}</p>
      </div>
    </div>
  )
}

// ─── ACTION card ──────────────────────────────────────────────────────────────

function ActionCardEl({ ev }: { ev: ActionCard }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#D97706" />
      <div style={{ background: '#FFFBEB', borderLeft: '3px solid #D97706', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WrenchIcon size={14} color="#D97706" />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#D97706', background: '#FEF3C7', padding: '2px 7px', borderRadius: 4 }}>ACTION</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#92400E', background: '#FDE68A', padding: '2px 8px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            Tool: {ev.tool}
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <ActionStatusIcon status={ev.status} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(ev.args).map(([k, v]) => (
            <span key={k} style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 4, padding: '2px 7px', color: '#475569' }}>
              <span style={{ color: '#94A3B8' }}>{k}=</span>
              <span style={{ color: '#0F172A' }}>{v}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── OBSERVATION card ─────────────────────────────────────────────────────────

function ObservationCardEl({ ev, expanded, onToggle }: { ev: ObservationCard; expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#CBD5E1" />
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderLeft: '3px solid #CBD5E1', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#64748B', background: '#F1F5F9', padding: '2px 7px', borderRadius: 4 }}>OBSERVATION</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#0F172A', lineHeight: 1.55 }}>{ev.summary}</p>
        <button
          onClick={onToggle}
          style={{ alignSelf: 'flex-start', fontSize: 11, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <span style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
          {expanded ? 'Hide Terminal Output' : 'View Terminal Output'}
        </button>
        {expanded && (
          <pre style={{
            margin: 0,
            background: '#0B0F19',
            color: '#E2E8F0',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            lineHeight: 1.6,
            padding: '12px 14px',
            borderRadius: 6,
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}>
            {ev.terminalOutput}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── OPERATOR card ────────────────────────────────────────────────────────────

function OperatorCardEl({ ev }: { ev: OperatorCard }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#2563EB" />
      <div style={{ background: '#EFF6FF', borderLeft: '3px solid #2563EB', borderRadius: '0 8px 8px 0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserIcon size={14} color="#2563EB" />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#2563EB', background: '#DBEAFE', padding: '2px 7px', borderRadius: 4 }}>OPERATOR</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#0F172A', lineHeight: 1.55 }}>{ev.message}</p>
      </div>
    </div>
  )
}

// ─── HITL GATE card ───────────────────────────────────────────────────────────

function HitlCardEl({
  ev,
  hitlState,
  onApprove,
  onReject,
}: {
  ev: HitlCard
  hitlState: boolean | null
  onApprove: () => void
  onReject: () => void
}) {
  if (hitlState === true) {
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#16A34A" />
        <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderLeft: '3px solid #16A34A', borderRadius: '0 8px 8px 0', padding: '12px 14px' }}>
          <span style={{ fontSize: 13, color: '#15803D', fontWeight: 600 }}>✓ Approved — Execution resumed</span>
        </div>
      </div>
    )
  }

  if (hitlState === false) {
    return (
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <ConnectorDot color="#94A3B8" />
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderLeft: '3px solid #94A3B8', borderRadius: '0 8px 8px 0', padding: '12px 14px' }}>
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 600 }}>✗ Rejected by Operator</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <ConnectorDot color="#EF4444" />
      <div style={{
        background: '#FEF2F2',
        border: '1px solid #EF4444',
        borderLeft: '4px solid #EF4444',
        borderRadius: '0 8px 8px 0',
        padding: '14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PulsingDot color="#EF4444" cls="raptix-pulse-red" />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: '#DC2626' }}>HITL APPROVAL REQUIRED</span>
          <ShieldIcon size={14} color="#DC2626" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Command</span>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#0F172A', background: '#FEE2E2', padding: '3px 6px', borderRadius: 4 }}>{ev.command}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Target</span>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#0F172A', background: '#FEE2E2', padding: '3px 6px', borderRadius: 4 }}>{ev.target}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>OPSEC Risk</span>
            <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600, background: '#FEE2E2', padding: '3px 6px', borderRadius: 4 }}>{ev.opsecRisk}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            onClick={onApprove}
            style={{
              background: '#DC2626',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            Approve
            <kbd style={{ fontSize: 10, background: 'rgba(255,255,255,0.2)', padding: '1px 4px', borderRadius: 3, fontFamily: 'sans-serif' }}>↵</kbd>
          </button>
          <button
            onClick={onReject}
            style={{
              background: '#FFFFFF',
              color: '#475569',
              border: '1px solid #CBD5E1',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            Reject
            <kbd style={{ fontSize: 10, background: '#F1F5F9', padding: '1px 4px', borderRadius: 3, fontFamily: 'sans-serif' }}>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Agent status badge ───────────────────────────────────────────────────────

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  if (status === 'running') {
    return (
      <span style={{ fontSize: 10, fontWeight: 600, color: '#16A34A', background: '#DCFCE7', padding: '2px 7px', borderRadius: 10 }}>RUNNING</span>
    )
  }
  if (status === 'hitl') {
    return (
      <span style={{ fontSize: 10, fontWeight: 600, color: '#DC2626', background: '#FEF2F2', padding: '2px 7px', borderRadius: 10 }}>HITL</span>
    )
  }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', background: '#F1F5F9', padding: '2px 7px', borderRadius: 10 }}>IDLE</span>
  )
}

// ─── Agent row ────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  selected,
  onClick,
}: {
  agent: AgentDef
  selected: boolean
  onClick: () => void
}) {
  const dotColor = agent.status === 'running' ? '#16A34A' : agent.status === 'hitl' ? '#DC2626' : '#CBD5E1'
  const dotCls = agent.status === 'running' ? 'raptix-pulse-green' : agent.status === 'hitl' ? 'raptix-pulse-red' : ''

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        background: selected ? '#FEF2F2' : 'transparent',
        borderLeft: selected ? '3px solid #DC2626' : '3px solid transparent',
        border: 'none',
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: '1px solid #F1F5F9',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <PulsingDot color={dotColor} cls={dotCls} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
        <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#94A3B8', marginTop: 1 }}>{agent.target}</div>
      </div>
      <AgentStatusBadge status={agent.status} />
    </button>
  )
}

// ─── Phase group ──────────────────────────────────────────────────────────────

function PhaseGroupSection({
  group,
  expanded,
  selectedAgentId,
  search,
  statusFilter,
  onToggle,
  onSelectAgent,
}: {
  group: PhaseGroup
  expanded: boolean
  selectedAgentId: string
  search: string
  statusFilter: string
  onToggle: () => void
  onSelectAgent: (id: string) => void
}) {
  const filtered = group.agents.filter((a) => {
    const matchesSearch =
      search === '' ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.target.toLowerCase().includes(search.toLowerCase())
    const matchesFilter =
      statusFilter === 'all' ||
      (statusFilter === 'active' && a.status === 'running') ||
      (statusFilter === 'hitl' && a.status === 'hitl') ||
      (statusFilter === 'idle' && a.status === 'idle')
    return matchesSearch && matchesFilter
  })

  const hasResults = filtered.length > 0

  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 14px',
          background: '#F8FAFC',
          border: 'none',
          borderBottom: '1px solid #E2E8F0',
          cursor: group.grayed ? 'default' : 'pointer',
          textAlign: 'left',
          opacity: group.grayed ? 0.45 : 1,
        }}
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 0.3, flex: 1 }}>{group.label}</span>
        <span style={{ fontSize: 10, color: '#94A3B8', background: '#E2E8F0', padding: '1px 6px', borderRadius: 8 }}>
          {group.agents.length}
        </span>
      </button>
      {expanded && hasResults && (
        <div>
          {filtered.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              selected={selectedAgentId === agent.id}
              onClick={() => onSelectAgent(agent.id)}
            />
          ))}
        </div>
      )}
      {expanded && !hasResults && group.agents.length > 0 && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>No agents match filter</div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OperatorConsole() {
  const [events, setEvents] = useState<TimelineEvent[]>(INITIAL_EVENTS)
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set())
  const [hitlState, setHitlState] = useState<boolean | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('bloodhound-01')
  const [agentSearch, setAgentSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'hitl' | 'idle'>('all')
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['phase-2']))
  const [commandInput, setCommandInput] = useState('')
  const [paused, setPaused] = useState(false)

  const timelineEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const styleInjected = useRef(false)
  useEffect(() => {
    if (styleInjected.current) return
    styleInjected.current = true
    const el = document.createElement('style')
    el.textContent = PULSE_CSS
    document.head.appendChild(el)
  }, [])

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const selectedAgent = PHASE_GROUPS.flatMap((g) => g.agents).find((a) => a.id === selectedAgentId)

  const handleToggleOutput = useCallback((id: string) => {
    setExpandedOutputs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleApprove = useCallback(() => {
    setHitlState(true)
    setEvents((prev) => [
      ...prev,
      {
        type: 'action',
        id: `ev-post-hitl-${Date.now()}`,
        tool: 'impacket-secretsdump',
        args: { user: 'CORP/svc_backup', target: '10.10.14.67', method: 'drsuapi' },
        status: 'running',
      } satisfies ActionCard,
    ])
  }, [])

  const handleReject = useCallback(() => {
    setHitlState(false)
  }, [])

  const handleSendCommand = useCallback(() => {
    const msg = commandInput.trim()
    if (!msg) return
    setEvents((prev) => [
      ...prev,
      {
        type: 'operator',
        id: `ev-op-${Date.now()}`,
        message: msg,
      } satisfies OperatorCard,
    ])
    setCommandInput('')
  }, [commandInput])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSendCommand()
    },
    [handleSendCommand],
  )

  const totalAgents = PHASE_GROUPS.flatMap((g) => g.agents).length
  const runningAgents = PHASE_GROUPS.flatMap((g) => g.agents).filter((a) => a.status === 'running').length
  const hitlAgents = PHASE_GROUPS.flatMap((g) => g.agents).filter((a) => a.status === 'hitl').length
  const idleAgents = PHASE_GROUPS.flatMap((g) => g.agents).filter((a) => a.status === 'idle').length

  const filterCounts = {
    all: totalAgents,
    active: runningAgents,
    hitl: hitlAgents,
    idle: idleAgents,
  }

  const filterLabels: { key: 'all' | 'active' | 'hitl' | 'idle'; label: string }[] = [
    { key: 'all', label: `All (${filterCounts.all})` },
    { key: 'active', label: `Active (${filterCounts.active})` },
    { key: 'hitl', label: `HITL (${filterCounts.hitl})` },
    { key: 'idle', label: `Idle (${filterCounts.idle})` },
  ]

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        background: '#F8FAFC',
        overflow: 'hidden',
      }}
    >
      {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
      <div
        style={{
          width: '65%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #E2E8F0',
          background: '#F8FAFC',
          minWidth: 360,
        }}
      >
        {/* Timeline header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Execution Timeline</span>
          <span
            className="raptix-pulse-green"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              fontWeight: 700,
              color: '#16A34A',
              background: '#DCFCE7',
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
            LIVE
          </span>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>{events.length} events</span>
          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => setPaused((p) => !p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: paused ? '#16A34A' : '#475569',
                background: paused ? '#DCFCE7' : '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                padding: '5px 12px',
                cursor: 'pointer',
              }}
            >
              {paused ? <PlayIcon size={13} color="#16A34A" /> : <PauseIcon size={13} color="#475569" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

        {/* Timeline scroll area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px 24px 18px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          {/* Vertical connector line + cards */}
          <div style={{ position: 'relative' }}>
            {/* Continuous vertical line */}
            <div
              style={{
                position: 'absolute',
                left: 14,
                top: 0,
                bottom: 0,
                width: 1,
                background: '#E2E8F0',
                zIndex: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {events.map((ev) => {
                switch (ev.type) {
                  case 'thought':
                    return <ThoughtCardEl key={ev.id} ev={ev} />
                  case 'action':
                    return <ActionCardEl key={ev.id} ev={ev} />
                  case 'observation':
                    return (
                      <ObservationCardEl
                        key={ev.id}
                        ev={ev}
                        expanded={expandedOutputs.has(ev.id)}
                        onToggle={() => handleToggleOutput(ev.id)}
                      />
                    )
                  case 'operator':
                    return <OperatorCardEl key={ev.id} ev={ev} />
                  case 'hitl':
                    return (
                      <HitlCardEl
                        key={ev.id}
                        ev={ev}
                        hitlState={hitlState}
                        onApprove={handleApprove}
                        onReject={handleReject}
                      />
                    )
                  default:
                    return null
                }
              })}
              <div ref={timelineEndRef} />
            </div>
          </div>
        </div>

        {/* Command bar */}
        <div
          style={{
            flexShrink: 0,
            background: '#FFFFFF',
            borderTop: '1px solid #E2E8F0',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontFamily: 'JetBrains Mono, monospace',
              color: '#DC2626',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            [{selectedAgent?.name ?? 'No Agent'}] &gt;
          </span>
          <input
            ref={inputRef}
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter directive or type / for commands..."
            style={{
              flex: 1,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 13,
              color: '#0F172A',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 6,
              padding: '7px 12px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSendCommand}
            style={{
              background: '#DC2626',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <SendIcon size={13} />
            Send
          </button>
        </div>
      </div>

      {/* ── RIGHT COLUMN ────────────────────────────────────────────────────── */}
      <div
        style={{
          width: '35%',
          display: 'flex',
          flexDirection: 'column',
          background: '#FFFFFF',
          minWidth: 280,
        }}
      >
        {/* Inspector header */}
        <div
          style={{
            flexShrink: 0,
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            padding: '10px 14px 0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Agent Inspector</span>
            <span style={{ fontSize: 11, color: '#0F172A', background: '#F1F5F9', border: '1px solid #E2E8F0', padding: '2px 8px', borderRadius: 10 }}>
              Total: {totalAgents}
            </span>
            <span style={{ fontSize: 11, color: '#16A34A', background: '#DCFCE7', padding: '2px 8px', borderRadius: 10 }}>
              {runningAgents} Running
            </span>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <SearchIcon size={13} />
            </span>
            <input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agents or target IP..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                paddingLeft: 28,
                paddingRight: 10,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 12,
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                color: '#0F172A',
                outline: 'none',
              }}
            />
          </div>

          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 6, paddingBottom: 10, flexWrap: 'wrap' }}>
            {filterLabels.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === key ? '#DC2626' : '#F1F5F9',
                  color: statusFilter === key ? '#FFFFFF' : '#475569',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Agent tree */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {PHASE_GROUPS.map((group) => (
            <PhaseGroupSection
              key={group.id}
              group={group}
              expanded={expandedPhases.has(group.id)}
              selectedAgentId={selectedAgentId}
              search={agentSearch}
              statusFilter={statusFilter}
              onToggle={() => {
                if (group.grayed) return
                setExpandedPhases((prev) => {
                  const next = new Set(prev)
                  if (next.has(group.id)) next.delete(group.id)
                  else next.add(group.id)
                  return next
                })
              }}
              onSelectAgent={setSelectedAgentId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
