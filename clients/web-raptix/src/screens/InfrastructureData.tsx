import { useState } from 'react'
import type { Project, Screen } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopoNode {
  id: string
  label: string
  ip?: string
  os?: string
  type: 'Web' | 'API' | 'Host' | 'Firewall' | 'DC'
  status: 'Discovered' | 'Compromised' | 'Objective'
  zone: 'external' | 'dmz' | 'internal'
  privilege?: string
  creds?: { user: string; value: string; type: string }[]
  cx: number
  cy: number
}

interface AssetRow {
  id: number
  name: string
  type: 'Host' | 'Web' | 'API' | 'Identity' | 'Mobile APK'
  ip: string
  ports: string
  critCount: number
  critLabel: string
  agentStatus: 'C2 Active' | 'Compromised' | 'Discovered' | 'Harvested' | 'Analyzed' | 'Stale'
}

interface CredRow {
  id: number
  identity: string
  type: 'NTLM Hash' | 'Cleartext' | 'Kerberos TGT' | 'API Token'
  asset: string
  secret: string
  status: 'Active' | 'Stale' | 'Expired'
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const TOPO_NODES: TopoNode[] = [
  {
    id: 'acme-web',
    label: 'acme-corp.com',
    type: 'Web',
    status: 'Discovered',
    zone: 'external',
    cx: 80,
    cy: 140,
  },
  {
    id: 'acme-api',
    label: 'api.acme-corp.com',
    type: 'API',
    status: 'Discovered',
    zone: 'external',
    cx: 80,
    cy: 290,
  },
  {
    id: 'web-01',
    label: 'WEB-01',
    ip: '192.168.2.50',
    os: 'Ubuntu 20.04 LTS',
    type: 'Host',
    status: 'Compromised',
    zone: 'dmz',
    privilege: 'www-data → root (via SUID exploit)',
    creds: [
      { user: 'www-data', value: '$6$salt$hash...', type: 'UNIX hash' },
      { user: 'admin', value: 'WebAdmin#2024!', type: 'cleartext found in config' },
    ],
    cx: 310,
    cy: 140,
  },
  {
    id: 'fw-01',
    label: 'FW-01',
    type: 'Firewall',
    status: 'Discovered',
    zone: 'dmz',
    cx: 310,
    cy: 290,
  },
  {
    id: 'dev-ws-01',
    label: 'DEV-WS-01',
    ip: '10.10.1.15',
    os: 'Windows 10 Pro',
    type: 'Host',
    status: 'Compromised',
    zone: 'internal',
    privilege: 'john.doe → SYSTEM (via token impersonation)',
    creds: [
      { user: 'john.doe', value: 'P@ssw0rd2023!', type: 'cleartext' },
      { user: 'CORP\\svc_backup', value: 'aad3b435b51404eeaad3...', type: 'NTLM hash' },
    ],
    cx: 570,
    cy: 110,
  },
  {
    id: 'file-srv',
    label: 'FILE-SRV',
    ip: '10.10.14.102',
    os: 'Windows Server 2016',
    type: 'Host',
    status: 'Discovered',
    zone: 'internal',
    cx: 570,
    cy: 255,
  },
  {
    id: 'dc-01',
    label: 'DC-01',
    ip: '10.10.14.67',
    os: 'Windows Server 2019',
    type: 'DC',
    status: 'Objective',
    zone: 'internal',
    cx: 570,
    cy: 400,
  },
]

const ASSETS: AssetRow[] = [
  { id: 1, name: 'DC-01', type: 'Host', ip: '10.10.14.67', ports: '88, 445, 3389', critCount: 2, critLabel: '2 Critical', agentStatus: 'C2 Active' },
  { id: 2, name: 'WEB-01', type: 'Host', ip: '192.168.2.50', ports: '22, 80, 443', critCount: 1, critLabel: '1 High', agentStatus: 'C2 Active' },
  { id: 3, name: 'DEV-WS-01', type: 'Host', ip: '10.10.1.15', ports: '22, 3389', critCount: 3, critLabel: '3 Critical', agentStatus: 'C2 Active' },
  { id: 4, name: 'FILE-SRV', type: 'Host', ip: '10.10.14.102', ports: '445, 139', critCount: 1, critLabel: '1 Medium', agentStatus: 'Discovered' },
  { id: 5, name: 'acme-corp.com', type: 'Web', ip: '—', ports: '80, 443', critCount: 2, critLabel: '2 High', agentStatus: 'Discovered' },
  { id: 6, name: 'api.acme-corp.com', type: 'API', ip: '—', ports: '443', critCount: 1, critLabel: '1 Critical', agentStatus: 'Discovered' },
  { id: 7, name: 'admin.acme-corp.com', type: 'Web', ip: '—', ports: '443', critCount: 3, critLabel: '3 Medium', agentStatus: 'Discovered' },
  { id: 8, name: 'CORP\\john.doe', type: 'Identity', ip: '—', ports: '—', critCount: 1, critLabel: '1 High', agentStatus: 'Harvested' },
  { id: 9, name: 'CORP\\svc_backup', type: 'Identity', ip: '—', ports: '—', critCount: 2, critLabel: '2 Critical', agentStatus: 'Compromised' },
  { id: 10, name: 'CORP\\Administrator', type: 'Identity', ip: '—', ports: '—', critCount: 3, critLabel: '3 Critical', agentStatus: 'Compromised' },
  { id: 11, name: 'com.acme.mobile', type: 'Mobile APK', ip: '—', ports: '—', critCount: 5, critLabel: '5 API Keys', agentStatus: 'Analyzed' },
  { id: 12, name: 'LEGACY-WIN7', type: 'Host', ip: '10.10.0.45', ports: '135, 445, 3389', critCount: 2, critLabel: '2 Critical', agentStatus: 'Stale' },
]

const CREDS: CredRow[] = [
  { id: 1, identity: 'CORP\\svc_backup', type: 'NTLM Hash', asset: 'DC-01', secret: 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c', status: 'Active' },
  { id: 2, identity: 'CORP\\Administrator', type: 'NTLM Hash', asset: 'DC-01', secret: 'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0', status: 'Active' },
  { id: 3, identity: 'john.doe@acme.com', type: 'Cleartext', asset: 'WEB-01', secret: 'P@ssw0rd2023!', status: 'Active' },
  { id: 4, identity: 'sarah.miller', type: 'Cleartext', asset: 'DEV-WS-01', secret: 'Summer2024#Miller', status: 'Active' },
  { id: 5, identity: 'svc_sql', type: 'Kerberos TGT', asset: 'DC-01', secret: 'doIFuj...AAA== [TGT blob 1.2kB]', status: 'Active' },
  { id: 6, identity: 'it.admin@acme.com', type: 'Cleartext', asset: 'MAIL-SRV', secret: 'ITAdmin!@#2022', status: 'Stale' },
  { id: 7, identity: 'CORP\\krbtgt', type: 'NTLM Hash', asset: 'DC-01', secret: 'aad3b435b51404eeaad3b435b51404ee:f4f5bfe99792406a9f9960a5c09d6bc7', status: 'Active' },
  { id: 8, identity: 'api_prod_key_01', type: 'API Token', asset: 'api.acme-corp.com', secret: 'sk-prod-xK9mL2nP4qR7sT0uV3wY6zA8bC1dE5fG', status: 'Active' },
  { id: 9, identity: 'finance@acme.com', type: 'Cleartext', asset: 'MAIL-SRV', secret: 'Finance$ecure99', status: 'Expired' },
  { id: 10, identity: 'CORP\\jane.smith', type: 'NTLM Hash', asset: 'WORKSTATION-115', secret: 'aad3b435b51404eeaad3b435b51404ee:2b576acbe6bcfda7294d6bd18041b8fe', status: 'Active' },
  { id: 11, identity: 'wp_admin', type: 'Cleartext', asset: 'admin.acme-corp.com', secret: 'WordPresS!Admin#88', status: 'Active' },
  { id: 12, identity: 'aws_access_key', type: 'API Token', asset: 'api.acme-corp.com', secret: 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', status: 'Active' },
]

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function IconGlobe({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  )
}

function IconCode({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function IconServer({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}

function IconShield({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function IconMonitor({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function IconDatabase({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function IconCrown({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
      <path d="M5 20h14" />
    </svg>
  )
}

function IconEye({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEyeOff({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function IconCopy({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconChevronDown({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function IconX({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconPlay({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

// ─── Helper badge components ──────────────────────────────────────────────────

function NodeIcon({ node }: { node: TopoNode }) {
  const color = node.status === 'Discovered' ? '#475569' : '#DC2626'
  if (node.type === 'Web') return <IconGlobe size={16} color={color} />
  if (node.type === 'API') return <IconCode size={16} color={color} />
  if (node.type === 'Firewall') return <IconShield size={16} color={color} />
  if (node.type === 'DC') return <IconCrown size={16} color={color} />
  if (node.id === 'file-srv') return <IconDatabase size={16} color={color} />
  if (node.id === 'dev-ws-01') return <IconMonitor size={16} color={color} />
  return <IconServer size={16} color={color} />
}

function FindingsBadge({ label }: { label: string }) {
  if (label.includes('Critical'))
    return <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{label}</span>
  if (label.includes('High'))
    return <span style={{ background: '#FEF3C7', color: '#D97706', border: '1px solid #FCD34D', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{label}</span>
  if (label.includes('Medium'))
    return <span style={{ background: '#DBEAFE', color: '#2563EB', border: '1px solid #93C5FD', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{label}</span>
  return <span style={{ background: '#EDE9FE', color: '#7C3AED', border: '1px solid #C4B5FD', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{label}</span>
}

function AgentBadge({ status }: { status: AssetRow['agentStatus'] }) {
  const map: Record<AssetRow['agentStatus'], { bg: string; color: string; border: string }> = {
    'C2 Active':   { bg: '#DCFCE7', color: '#16A34A', border: '#86EFAC' },
    'Compromised': { bg: '#FEF2F2', color: '#DC2626', border: '#FCA5A5' },
    'Discovered':  { bg: '#DBEAFE', color: '#2563EB', border: '#93C5FD' },
    'Harvested':   { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' },
    'Analyzed':    { bg: '#EDE9FE', color: '#7C3AED', border: '#C4B5FD' },
    'Stale':       { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' },
  }
  const s = map[status]
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{status}</span>
}

function CredTypeBadge({ type }: { type: CredRow['type'] }) {
  const map: Record<CredRow['type'], { bg: string; color: string }> = {
    'NTLM Hash':    { bg: '#FEF2F2', color: '#DC2626' },
    'Cleartext':    { bg: '#FEF3C7', color: '#D97706' },
    'Kerberos TGT': { bg: '#EDE9FE', color: '#7C3AED' },
    'API Token':    { bg: '#DBEAFE', color: '#2563EB' },
  }
  const s = map[type]
  return <span style={{ background: s.bg, color: s.color, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{type}</span>
}

function CredStatusBadge({ status }: { status: CredRow['status'] }) {
  if (status === 'Active')
    return <span style={{ background: '#DCFCE7', color: '#16A34A', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>Active</span>
  if (status === 'Stale')
    return <span style={{ background: '#FEF3C7', color: '#D97706', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>Stale</span>
  return <span style={{ background: '#F1F5F9', color: '#64748B', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>Expired</span>
}

// ─── Asset Inspect Modal ──────────────────────────────────────────────────────

function AssetTypeModalBadge({ type }: { type: AssetRow['type'] }) {
  const map: Record<AssetRow['type'], { bg: string; color: string }> = {
    'Host':       { bg: '#DBEAFE', color: '#2563EB' },
    'Web':        { bg: '#DCFCE7', color: '#16A34A' },
    'API':        { bg: '#EDE9FE', color: '#7C3AED' },
    'Identity':   { bg: '#FEF3C7', color: '#D97706' },
    'Mobile APK': { bg: '#FEF2F2', color: '#DC2626' },
  }
  const s = map[type] ?? { bg: '#F1F5F9', color: '#64748B' }
  return <span style={{ background: s.bg, color: s.color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{type}</span>
}

const ASSET_EXTRA: Record<number, {
  os: string
  mac: string
  lastSeen: string
  openPorts: { port: string; protocol: string; service: string; state: string }[]
  vulns: string[]
  tags: { label: string; color: string; bg: string }[]
}> = {
  1: {
    os: 'Windows Server 2019', mac: '00:1A:2B:3C:4D:5E', lastSeen: '2 min ago',
    openPorts: [
      { port: '88',   protocol: 'TCP', service: 'Kerberos', state: 'Open' },
      { port: '445',  protocol: 'TCP', service: 'SMB',      state: 'Open' },
      { port: '3389', protocol: 'TCP', service: 'RDP',      state: 'Open' },
    ],
    vulns: ['MS17-010 EternalBlue (Critical)', 'CVE-2020-1472 Zerologon (Critical)'],
    tags: [{ label: 'Domain Controller', color: '#DC2626', bg: '#FEF2F2' }, { label: 'Crown Jewel', color: '#D97706', bg: '#FEF3C7' }],
  },
  2: {
    os: 'Ubuntu 20.04 LTS', mac: '00:2C:3D:4E:5F:6A', lastSeen: '5 min ago',
    openPorts: [
      { port: '22',  protocol: 'TCP', service: 'SSH',   state: 'Open' },
      { port: '80',  protocol: 'TCP', service: 'HTTP',  state: 'Open' },
      { port: '443', protocol: 'TCP', service: 'HTTPS', state: 'Open' },
    ],
    vulns: ['CVE-2021-41773 Path Traversal (High)'],
    tags: [{ label: 'DMZ', color: '#D97706', bg: '#FEF3C7' }, { label: 'Web Server', color: '#2563EB', bg: '#DBEAFE' }],
  },
  3: {
    os: 'Windows 10 Pro', mac: '00:3E:4F:5A:6B:7C', lastSeen: '1 min ago',
    openPorts: [
      { port: '22',   protocol: 'TCP', service: 'SSH', state: 'Open' },
      { port: '3389', protocol: 'TCP', service: 'RDP', state: 'Open' },
    ],
    vulns: ['CVE-2022-26134 OGNL Injection (Critical)', 'CVE-2021-34527 PrintNightmare (Critical)', 'CVE-2020-0796 SMBGhost (Critical)'],
    tags: [{ label: 'Dev Workstation', color: '#7C3AED', bg: '#EDE9FE' }, { label: 'Pivoted', color: '#DC2626', bg: '#FEF2F2' }],
  },
  4: {
    os: 'Windows Server 2016', mac: '00:4F:5A:6B:7C:8D', lastSeen: '18 min ago',
    openPorts: [
      { port: '445', protocol: 'TCP', service: 'SMB',    state: 'Open' },
      { port: '139', protocol: 'TCP', service: 'NetBIOS', state: 'Open' },
    ],
    vulns: ['CVE-2017-0143 MS17-010 (Medium)'],
    tags: [{ label: 'File Server', color: '#2563EB', bg: '#DBEAFE' }],
  },
  12: {
    os: 'Windows 7 SP1', mac: '00:5A:6B:7C:8D:9E', lastSeen: '4 days ago',
    openPorts: [
      { port: '135',  protocol: 'TCP', service: 'RPC', state: 'Open' },
      { port: '445',  protocol: 'TCP', service: 'SMB', state: 'Open' },
      { port: '3389', protocol: 'TCP', service: 'RDP', state: 'Open' },
    ],
    vulns: ['MS17-010 EternalBlue (Critical)', 'CVE-2019-0708 BlueKeep (Critical)'],
    tags: [{ label: 'Legacy', color: '#D97706', bg: '#FEF3C7' }, { label: 'EOL', color: '#DC2626', bg: '#FEF2F2' }],
  },
}

function getAssetExtra(id: number): (typeof ASSET_EXTRA)[number] {
  return ASSET_EXTRA[id] ?? {
    os: '—', mac: '—', lastSeen: 'Unknown',
    openPorts: [{ port: '443', protocol: 'TCP', service: 'HTTPS', state: 'Open' }],
    vulns: ['CVE-2023-0001 Unpatched Dependency (Medium)'],
    tags: [{ label: 'Discovered', color: '#2563EB', bg: '#DBEAFE' }],
  }
}

function AssetInspectModal({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const extra = getAssetExtra(asset.id)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#FFFFFF', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', padding: 24, maxWidth: 672, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: '0 16px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{asset.name}</span>
            <AssetTypeModalBadge type={asset.type} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, flexShrink: 0 }}>
            <IconX size={16} />
          </button>
        </div>

        {/* System Info */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 10 }}>SYSTEM INFO</div>
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
            {[
              { label: 'OS',          value: extra.os },
              { label: 'IP Address',  value: asset.ip },
              { label: 'MAC Address', value: extra.mac },
              { label: 'Last Seen',   value: extra.lastSeen },
            ].map(row => (
              <div key={row.label}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 3 }}>{row.label.toUpperCase()}</div>
                <div style={{ fontSize: 12, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{row.value}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 5 }}>AGENT STATUS</div>
              <AgentBadge status={asset.agentStatus} />
            </div>
          </div>
        </div>

        {/* Open Ports */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 10 }}>OPEN PORTS</div>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  {['Port', 'Protocol', 'Service', 'State'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em' }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extra.openPorts.map((p, i) => (
                  <tr key={i} style={{ borderBottom: i < extra.openPorts.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#0F172A' }}>{p.port}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: '#475569' }}>{p.protocol}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: '#475569' }}>{p.service}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ background: '#DCFCE7', color: '#16A34A', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{p.state}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Vulnerabilities */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em' }}>VULNERABILITIES</div>
            <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{extra.vulns.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {extra.vulns.map((v, i) => (
              <div key={i} style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626', fontWeight: 600 }}>{v}</div>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 10 }}>TAGS</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {extra.tags.map((t, i) => (
              <span key={i} style={{ background: t.bg, color: t.color, borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>{t.label}</span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #E2E8F0', paddingTop: 16 }}>
          <button style={{ background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flex: 1 }}>
            Push to Attack Queue
          </button>
          <button style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Export Asset
          </button>
          <button onClick={onClose} style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 7, padding: '8px 12px', lineHeight: 1, cursor: 'pointer' }}>
            <IconX size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Credential Detail Modal ───────────────────────────────────────────────────

const CRED_EXTRA: Record<number, { targetHost: string; lastUsed: string; rotated: string; source: string }> = {
  1:  { targetHost: 'DC-01 (10.10.14.67)',          lastUsed: '12 min ago',  rotated: '2024-01-15', source: 'DCSync via Mimikatz' },
  2:  { targetHost: 'DC-01 (10.10.14.67)',          lastUsed: '8 min ago',   rotated: '2024-01-15', source: 'DCSync via Mimikatz' },
  3:  { targetHost: 'WEB-01 (192.168.2.50)',        lastUsed: '1 hour ago',  rotated: '2024-03-22', source: 'Config file /var/www/.env' },
  4:  { targetHost: 'DEV-WS-01 (10.10.1.15)',       lastUsed: '30 min ago',  rotated: '2024-06-01', source: 'Memory dump (LSASS)' },
  5:  { targetHost: 'DC-01 (10.10.14.67)',          lastUsed: '2 min ago',   rotated: '2024-01-10', source: 'Kerberoasting (Rubeus)' },
  6:  { targetHost: 'MAIL-SRV',                    lastUsed: '3 days ago',  rotated: '2022-11-01', source: 'Phishing lure' },
  7:  { targetHost: 'DC-01 (10.10.14.67)',          lastUsed: '15 min ago',  rotated: '2024-01-15', source: 'Golden Ticket forge (DCSync)' },
  8:  { targetHost: 'api.acme-corp.com',            lastUsed: '1 hour ago',  rotated: '2024-09-01', source: 'GitHub repo leak (public)' },
  9:  { targetHost: 'MAIL-SRV',                    lastUsed: '14 days ago', rotated: '2023-09-15', source: 'Credential spray' },
  10: { targetHost: 'WORKSTATION-115',              lastUsed: '2 hours ago', rotated: '2024-02-28', source: 'Pass-the-Hash pivot' },
  11: { targetHost: 'admin.acme-corp.com',          lastUsed: '45 min ago',  rotated: '2023-12-01', source: 'WordPress brute-force' },
  12: { targetHost: 'api.acme-corp.com',            lastUsed: '20 min ago',  rotated: '2024-07-15', source: 'S3 bucket misconfiguration' },
}

function CredTypeModalBadge({ type }: { type: CredRow['type'] }) {
  const map: Record<CredRow['type'], { bg: string; color: string; label: string }> = {
    'NTLM Hash':    { bg: '#FEF2F2', color: '#DC2626', label: 'NTLM Hash' },
    'Cleartext':    { bg: '#FEF3C7', color: '#D97706', label: 'Password' },
    'Kerberos TGT': { bg: '#EDE9FE', color: '#7C3AED', label: 'Kerberos TGT' },
    'API Token':    { bg: '#DBEAFE', color: '#2563EB', label: 'API Token' },
  }
  const s = map[type]
  return <span style={{ background: s.bg, color: s.color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{s.label}</span>
}

function CredDetailModal({ cred, onClose, navigate }: { cred: CredRow; onClose: () => void; navigate: (s: Screen) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const extra = CRED_EXTRA[cred.id] ?? { targetHost: cred.asset, lastUsed: '—', rotated: '—', source: '—' }

  const copy = () => {
    navigator.clipboard.writeText(cred.secret).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#FFFFFF', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', padding: 24, maxWidth: 672, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: '0 16px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{cred.identity}</span>
            <CredTypeModalBadge type={cred.type} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4, flexShrink: 0 }}>
            <IconX size={16} />
          </button>
        </div>

        {/* Fields grid */}
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 20 }}>
          {[
            { label: 'Target Host',   value: extra.targetHost },
            { label: 'Username',      value: cred.identity },
            { label: 'Last Used',     value: extra.lastUsed },
            { label: 'Last Rotated',  value: extra.rotated },
            { label: 'Source',        value: extra.source },
            { label: 'Status',        value: cred.status },
          ].map(row => (
            <div key={row.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 3 }}>{row.label.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{row.value}</div>
            </div>
          ))}
        </div>

        {/* Secret section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 10 }}>CREDENTIAL VALUE</div>
          <div style={{ background: '#0F172A', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: revealed ? '#86EFAC' : '#64748B', flex: 1, wordBreak: 'break-all', lineHeight: 1.6 }}>
              {revealed ? cred.secret : '••••••••••••••••••••••••'}
            </span>
            <button
              onClick={() => setRevealed(r => !r)}
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5, padding: '6px 8px', cursor: 'pointer', color: '#94A3B8', flexShrink: 0, lineHeight: 1 }}
              title={revealed ? 'Hide' : 'Reveal'}
            >
              {revealed ? <IconEyeOff size={14} color="#94A3B8" /> : <IconEye size={14} color="#94A3B8" />}
            </button>
            <button
              onClick={copy}
              style={{ background: copied ? 'rgba(22,163,74,0.2)' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5, padding: '6px 8px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
              title="Copy"
            >
              <IconCopy size={14} color={copied ? '#86EFAC' : '#94A3B8'} />
            </button>
          </div>
        </div>

        {/* Pivot Actions + footer */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #E2E8F0', paddingTop: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => { navigate('c2-sessions'); onClose() }}
            style={{ background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Push to C2
          </button>
          <button style={{ background: '#FFFFFF', color: '#16A34A', border: '1px solid #86EFAC', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Test Validity
          </button>
          <button style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Export
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 7, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB 1 ─ Infrastructure & Data (topology map) ─────────────────────────────

function EnvironmentMap({ navigate }: { navigate: (s: Screen) => void }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('web-01')
  const [showCompromisedOnly, setShowCompromisedOnly] = useState(false)
  const [viewMode, setViewMode] = useState<'topology' | 'list'>('topology')
  const [zone, setZone] = useState('All Zones')

  const selectedNode = TOPO_NODES.find(n => n.id === selectedNodeId) ?? null
  const visibleNodes = showCompromisedOnly
    ? TOPO_NODES.filter(n => n.status !== 'Discovered')
    : TOPO_NODES

  const drawerOpen = selectedNode !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Filter bar */}
      <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <select
          value={zone}
          onChange={e => setZone(e.target.value)}
          style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', fontSize: 13, color: '#0F172A', background: '#FFFFFF', cursor: 'pointer' }}
        >
          {['All Zones', 'DMZ', 'Internal LAN', 'External'].map(z => <option key={z}>{z}</option>)}
        </select>

        <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden' }}>
          {(['topology', 'list'] as const).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '5px 14px',
                fontSize: 13,
                fontWeight: viewMode === m ? 700 : 400,
                background: viewMode === m ? '#0F172A' : '#FFFFFF',
                color: viewMode === m ? '#FFFFFF' : '#475569',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {m === 'topology' ? 'Topology View' : 'List View'}
            </button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showCompromisedOnly}
            onChange={e => setShowCompromisedOnly(e.target.checked)}
            style={{ accentColor: '#DC2626', width: 14, height: 14 }}
          />
          Show Compromised Only
        </label>
      </div>

      {/* Canvas + drawer */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Topology / list canvas */}
        <div style={{ flex: 1, background: '#F8FAFC', overflow: 'auto' }}>
          {viewMode === 'topology' ? (
            <svg viewBox="0 0 760 500" style={{ width: '100%', minWidth: 700, height: 520 }} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#DC2626" />
                </marker>
              </defs>

              {/* Zone backgrounds */}
              <rect x="12" y="12" width="196" height="476" rx="8" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="6 3" />
              <rect x="222" y="12" width="196" height="476" rx="8" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="1.5" strokeDasharray="6 3" />
              <rect x="432" y="12" width="316" height="476" rx="8" fill="#FFF5F5" stroke="#FCA5A5" strokeWidth="1.5" strokeDasharray="6 3" />

              {/* Zone labels */}
              <text x="110" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill="#64748B" letterSpacing="0.09em">EXTERNAL SURFACE</text>
              <text x="320" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill="#B45309" letterSpacing="0.09em">PERIMETER / DMZ</text>
              <text x="590" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill="#DC2626" letterSpacing="0.09em">INTERNAL CORE LAN</text>

              {/* Base connections */}
              <line x1="170" y1="140" x2="232" y2="140" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="4 2" />
              <line x1="170" y1="290" x2="232" y2="200" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="4 2" />
              <line x1="310" y1="178" x2="310" y2="262" stroke="#CBD5E1" strokeWidth="1.5" />
              <line x1="404" y1="290" x2="494" y2="255" stroke="#CBD5E1" strokeWidth="1.5" />

              {/* Pivot route: WEB-01 → DEV-WS-01 */}
              <path d="M 388 130 C 430 90 490 90 494 110" fill="none" stroke="#DC2626" strokeWidth="2" strokeDasharray="7 3" markerEnd="url(#arrowRed)" />
              <text x="434" y="84" fontSize="9.5" fill="#DC2626" fontWeight="700">C2 Tunnel</text>

              {/* Pivot route: DEV-WS-01 → DC-01 */}
              <path d="M 570 148 L 570 372" fill="none" stroke="#DC2626" strokeWidth="2" strokeDasharray="7 3" markerEnd="url(#arrowRed)" />
              <text x="578" y="270" fontSize="9.5" fill="#DC2626" fontWeight="700">Pivot → Target</text>

              {/* Nodes */}
              {visibleNodes.map(node => {
                const isSelected = selectedNodeId === node.id
                const isCompromised = node.status === 'Compromised'
                const isObjective = node.status === 'Objective'
                const nodeBg = isCompromised || isObjective ? '#FEF2F2' : '#FFFFFF'
                const nodeBorder = isCompromised ? '#EF4444' : isObjective ? '#DC2626' : '#E2E8F0'

                return (
                  <g key={node.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedNodeId(node.id)}>
                    {/* Selection ring */}
                    {isSelected && (
                      <rect x={node.cx - 60} y={node.cy - 44} width="120" height="88" rx="10" fill="none" stroke="#2563EB" strokeWidth="2" opacity="0.55" />
                    )}
                    {/* Objective double border */}
                    {isObjective && (
                      <rect x={node.cx - 57} y={node.cy - 41} width="114" height="82" rx="9" fill="none" stroke="#DC2626" strokeWidth="1" opacity="0.4" />
                    )}
                    <rect
                      x={node.cx - 54}
                      y={node.cy - 38}
                      width="108"
                      height="76"
                      rx="8"
                      fill={nodeBg}
                      stroke={nodeBorder}
                      strokeWidth={isObjective ? 2 : 1.5}
                      style={{ filter: isSelected ? 'drop-shadow(0 2px 8px rgba(37,99,235,0.25))' : 'drop-shadow(0 1px 3px rgba(0,0,0,0.08))' }}
                    />

                    {/* Active dot for compromised/objective */}
                    {(isCompromised || isObjective) && (
                      <circle cx={node.cx + 48} cy={node.cy - 32} r="5" fill="#16A34A" stroke="#FFFFFF" strokeWidth="1.5" />
                    )}

                    {/* Type pill */}
                    <rect x={node.cx - 28} y={node.cy - 36} width="56" height="15" rx="4" fill={isCompromised || isObjective ? '#FEE2E2' : '#F1F5F9'} />
                    <text x={node.cx} y={node.cy - 25} textAnchor="middle" fontSize="8.5" fill={isCompromised || isObjective ? '#DC2626' : '#64748B'} fontWeight="700">
                      {node.type === 'DC' ? 'Domain Ctrl' : node.type === 'Firewall' ? 'Firewall' : node.type}
                    </text>

                    {/* Label */}
                    <text x={node.cx} y={node.cy + 5} textAnchor="middle" fontSize="12" fill="#0F172A" fontWeight="700">{node.label}</text>

                    {/* IP */}
                    {node.ip && (
                      <text x={node.cx} y={node.cy + 20} textAnchor="middle" fontSize="9" fill="#94A3B8" fontFamily="'JetBrains Mono', monospace">{node.ip}</text>
                    )}

                    {/* Status */}
                    <text x={node.cx} y={node.cy + 35} textAnchor="middle" fontSize="8.5" fill={isCompromised || isObjective ? '#DC2626' : '#16A34A'} fontWeight="700">
                      ● {node.status}
                    </text>

                    {/* Crown Jewel label */}
                    {isObjective && (
                      <text x={node.cx} y={node.cy + 49} textAnchor="middle" fontSize="8" fill="#DC2626" fontWeight="800" letterSpacing="0.07em">CROWN JEWEL</text>
                    )}
                  </g>
                )
              })}
            </svg>
          ) : (
            /* List view */
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleNodes.map(node => (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  style={{
                    background: '#FFFFFF',
                    border: selectedNodeId === node.id ? '1px solid #2563EB' : '1px solid #E2E8F0',
                    borderRadius: 8,
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                  }}
                >
                  <NodeIcon node={node} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', flex: 1, fontFamily: "'JetBrains Mono', monospace" }}>{node.label}</span>
                  {node.ip && <span style={{ fontSize: 12, color: '#64748B', fontFamily: "'JetBrains Mono', monospace" }}>{node.ip}</span>}
                  <span style={{ fontSize: 11, fontWeight: 600, color: node.status === 'Discovered' ? '#16A34A' : '#DC2626', background: node.status === 'Discovered' ? '#DCFCE7' : '#FEF2F2', borderRadius: 4, padding: '2px 7px' }}>{node.status}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px' }}>{node.zone}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Host quick-inspector drawer */}
        {drawerOpen && selectedNode && (
          <div style={{ width: 285, background: '#FFFFFF', borderLeft: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
            {/* Drawer header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Host Inspector</span>
              <button onClick={() => setSelectedNodeId('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2, lineHeight: 1 }}>
                <IconX size={14} />
              </button>
            </div>

            <div style={{ padding: 16, flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Title + status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <NodeIcon node={selectedNode} />
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>{selectedNode.label}</span>
                {selectedNode.status === 'Compromised' && (
                  <span style={{ marginLeft: 'auto', background: '#FEF2F2', color: '#DC2626', border: '1px solid #EF4444', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Compromised</span>
                )}
                {selectedNode.status === 'Objective' && (
                  <span style={{ marginLeft: 'auto', background: '#FEF2F2', color: '#DC2626', border: '1px solid #EF4444', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Objective</span>
                )}
                {selectedNode.status === 'Discovered' && (
                  <span style={{ marginLeft: 'auto', background: '#DBEAFE', color: '#2563EB', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Discovered</span>
                )}
              </div>

              {/* Meta rows */}
              {[
                { label: 'IP ADDRESS', value: selectedNode.ip, mono: true },
                { label: 'OS', value: selectedNode.os, mono: false },
                { label: 'ZONE', value: selectedNode.zone === 'dmz' ? 'DMZ / Perimeter' : selectedNode.zone === 'internal' ? 'Internal Core LAN' : 'External Surface', mono: false },
                { label: 'TYPE', value: selectedNode.type, mono: false },
              ]
                .filter(r => r.value)
                .map(row => (
                  <div key={row.label}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 3 }}>{row.label}</div>
                    <div style={{ fontSize: 12, color: '#0F172A', fontFamily: row.mono ? "'JetBrains Mono', monospace" : undefined }}>{row.value}</div>
                  </div>
                ))}

              {/* Privilege */}
              {selectedNode.privilege && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 3 }}>CURRENT PRIVILEGE</div>
                  <div style={{ fontSize: 11, color: '#DC2626', fontFamily: "'JetBrains Mono', monospace", background: '#FEF2F2', borderRadius: 5, padding: '5px 8px', lineHeight: 1.5 }}>{selectedNode.privilege}</div>
                </div>
              )}

              {/* Harvested creds */}
              {selectedNode.creds && selectedNode.creds.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.09em', marginBottom: 6 }}>HARVESTED CREDENTIALS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedNode.creds.map((c, i) => (
                      <div key={i} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '7px 10px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace" }}>{c.user}</div>
                        <div style={{ fontSize: 10, color: '#64748B', fontFamily: "'JetBrains Mono', monospace", marginTop: 2, wordBreak: 'break-all' }}>{c.value}</div>
                        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2, fontStyle: 'italic' }}>{c.type}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* C2 button */}
            {(selectedNode.status === 'Compromised' || selectedNode.status === 'Objective') && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}>
                <button
                  onClick={() => navigate('c2-sessions')}
                  style={{
                    width: '100%',
                    background: '#DC2626',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 7,
                    padding: '9px 0',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                  }}
                >
                  <IconPlay size={12} color="#FFFFFF" />
                  Open C2 Terminal
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── TAB 2 ─ Assets & Inventory ───────────────────────────────────────────────

function AssetsInventory({ onUpdateScope }: { onUpdateScope: () => void }) {
  const [assetFilter, setAssetFilter] = useState<'all' | 'hosts' | 'web' | 'identities' | 'mobile'>('all')
  const [assetSearch, setAssetSearch] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<Set<number>>(new Set())
  const [inspectAsset, setInspectAsset] = useState<AssetRow | null>(null)

  const filterTabs: { key: typeof assetFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'hosts', label: 'Hosts' },
    { key: 'web', label: 'Web & API' },
    { key: 'identities', label: 'Identities' },
    { key: 'mobile', label: 'Mobile' },
  ]

  const filtered = ASSETS.filter(a => {
    if (assetFilter === 'hosts' && a.type !== 'Host') return false
    if (assetFilter === 'web' && a.type !== 'Web' && a.type !== 'API') return false
    if (assetFilter === 'identities' && a.type !== 'Identity') return false
    if (assetFilter === 'mobile' && a.type !== 'Mobile APK') return false
    if (assetSearch && !a.name.toLowerCase().includes(assetSearch.toLowerCase())) return false
    return true
  })

  const allSelected = filtered.length > 0 && filtered.every(a => selectedAssets.has(a.id))

  const toggleAll = () => {
    if (allSelected) setSelectedAssets(new Set())
    else setSelectedAssets(new Set(filtered.map(a => a.id)))
  }

  const toggleAsset = (id: number) => {
    setSelectedAssets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const metrics = [
    { label: 'Total Assets', value: 134 },
    { label: 'Hosts', value: 47 },
    { label: 'Web Endpoints', value: 68 },
    { label: 'Identities', value: 14 },
    { label: 'Mobile APKs', value: 5 },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
      {/* Metric counters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 20px', minWidth: 110 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{m.value}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs + action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 7, padding: 3 }}>
          {filterTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setAssetFilter(t.key)}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: assetFilter === t.key ? 700 : 500,
                background: assetFilter === t.key ? '#FFFFFF' : 'transparent',
                color: assetFilter === t.key ? '#0F172A' : '#64748B',
                border: assetFilter === t.key ? '1px solid #E2E8F0' : '1px solid transparent',
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={assetSearch}
              onChange={e => setAssetSearch(e.target.value)}
              placeholder="Search assets…"
              style={{ border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 10px 6px 32px', fontSize: 13, color: '#0F172A', outline: 'none', width: 210 }}
            />
          </div>
          <select style={{ border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: '#475569', background: '#FFFFFF', cursor: 'pointer' }}>
            <option>Subnet</option>
            <option>10.10.x.x</option>
            <option>192.168.x.x</option>
          </select>
          <button style={{ background: '#0F172A', color: '#FFFFFF', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <th style={{ padding: '10px 14px', width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: '#DC2626', width: 14, height: 14 }} />
                </th>
                {['Asset Name', 'Type', 'IP / Address', 'Open Ports', 'Findings', 'Agent Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: selectedAssets.has(a.id) ? '#EFF6FF' : '#FFFFFF' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="checkbox" checked={selectedAssets.has(a.id)} onChange={() => toggleAsset(a.id)} style={{ accentColor: '#DC2626', width: 14, height: 14 }} />
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{a.name}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{a.type}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', fontFamily: "'JetBrains Mono', monospace" }}>{a.ip}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{a.ports}</td>
                  <td style={{ padding: '10px 14px' }}><FindingsBadge label={a.critLabel} /></td>
                  <td style={{ padding: '10px 14px' }}><AgentBadge status={a.agentStatus} /></td>
                  <td style={{ padding: '10px 14px' }}>
                    <button onClick={() => setInspectAsset(a)} style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#475569', background: '#FFFFFF', cursor: 'pointer' }}>
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>

      {/* Multi-select bottom dock — sticky */}
      {selectedAssets.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#FFFFFF', borderTop: '1px solid #E2E8F0',
          padding: '11px 20px',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 10, whiteSpace: 'nowrap',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: 13, color: '#475569' }}>
            <strong style={{ color: '#0F172A' }}>{selectedAssets.size}</strong> assets selected
          </span>
          <div style={{ width: 1, height: 20, background: '#E2E8F0' }} />
          <button style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 12px', fontSize: 13, fontWeight: 600, color: '#475569', background: '#FFFFFF', cursor: 'pointer' }}>Tag Selected</button>
          <button onClick={onUpdateScope} style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 12px', fontSize: 13, fontWeight: 600, color: '#475569', background: '#FFFFFF', cursor: 'pointer' }}>Update Scope</button>
          <button onClick={() => setSelectedAssets(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}>
            <IconX size={13} />
          </button>
        </div>
      )}

      {/* Asset inspect modal */}
      {inspectAsset && <AssetInspectModal asset={inspectAsset} onClose={() => setInspectAsset(null)} />}
    </div>
  )
}

// ─── TAB 3 ─ Credentials Vault ────────────────────────────────────────────────

function CredentialsVault({ navigate }: { navigate: (s: Screen) => void }) {
  const [credFilter, setCredFilter] = useState('All')
  const [revealedRows, setRevealedRows] = useState<Set<number>>(new Set())
  const [selectedCreds, setSelectedCreds] = useState<Set<number>>(new Set())
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [selectedCred, setSelectedCred] = useState<CredRow | null>(null)

  const filterPills = ['All', 'Cleartext', 'NTLM Hash', 'Kerberos Ticket', 'API Token']

  const filtered = CREDS.filter(c => {
    if (credFilter === 'All') return true
    if (credFilter === 'Kerberos Ticket') return c.type === 'Kerberos TGT'
    return c.type === credFilter
  })

  const allSelected = filtered.length > 0 && filtered.every(c => selectedCreds.has(c.id))

  const toggleAll = () => {
    if (allSelected) setSelectedCreds(new Set())
    else setSelectedCreds(new Set(filtered.map(c => c.id)))
  }

  const toggleCred = (id: number) => {
    setSelectedCreds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleReveal = (id: number) => {
    setRevealedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }} onClick={() => setOpenDropdown(null)}>
      {/* Header counters */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Credentials Captured', value: 18, color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' },
          { label: 'Active Sessions', value: 7, color: '#16A34A', bg: '#DCFCE7', border: '#86EFAC' },
          { label: 'Domain Admin Hashes', value: 3, color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
        ].map(m => (
          <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 8, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontSize: 12, color: m.color, fontWeight: 600, maxWidth: 120 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filterPills.map(p => (
          <button
            key={p}
            onClick={() => setCredFilter(p)}
            style={{
              padding: '5px 14px', fontSize: 12,
              fontWeight: credFilter === p ? 700 : 500,
              background: credFilter === p ? '#0F172A' : '#FFFFFF',
              color: credFilter === p ? '#FFFFFF' : '#475569',
              border: '1px solid #E2E8F0', borderRadius: 20, cursor: 'pointer',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <th style={{ padding: '10px 14px', width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: '#DC2626', width: 14, height: 14 }} />
                </th>
                {['Identity / Username', 'Type', 'Linked Asset', 'Secret Value', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const revealed = revealedRows.has(c.id)
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCred(c)}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: selectedCreds.has(c.id) ? '#EFF6FF' : '#FFFFFF', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedCreds.has(c.id)} onChange={() => toggleCred(c.id)} style={{ accentColor: '#DC2626', width: 14, height: 14 }} />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{c.identity}</td>
                    <td style={{ padding: '10px 14px' }}><CredTypeBadge type={c.type} /></td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{c.asset}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          fontSize: 12,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: revealed ? '#0F172A' : '#94A3B8',
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}>
                          {revealed ? c.secret : '••••••••••••'}
                        </span>
                        <button onClick={() => toggleReveal(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0 2px', lineHeight: 1, flexShrink: 0 }} title={revealed ? 'Hide' : 'Reveal'}>
                          {revealed ? <IconEyeOff size={13} color="#94A3B8" /> : <IconEye size={13} color="#94A3B8" />}
                        </button>
                        <button onClick={() => copyToClipboard(c.secret)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0 2px', lineHeight: 1, flexShrink: 0 }} title="Copy">
                          <IconCopy size={13} color="#94A3B8" />
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}><CredStatusBadge status={c.status} /></td>
                    <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
                        <button
                          onClick={() => navigate('c2-sessions')}
                          style={{ background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Push to C2
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setOpenDropdown(openDropdown === c.id ? null : c.id) }}
                          style={{ border: '1px solid #E2E8F0', borderRadius: 5, padding: '4px 7px', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#475569' }}
                        >
                          <IconChevronDown size={12} />
                        </button>
                        {openDropdown === c.id && (
                          <div
                            onClick={e => e.stopPropagation()}
                            style={{
                              position: 'absolute', right: 0, top: '100%', marginTop: 4,
                              background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.11)', zIndex: 300, minWidth: 185, overflow: 'hidden',
                            }}
                          >
                            {['Run Credential Spray', 'Add to Dictionary', 'Export to Hashcat'].map(action => (
                              <button
                                key={action}
                                onClick={() => setOpenDropdown(null)}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, color: '#0F172A', background: 'none', border: 'none', cursor: 'pointer' }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                {action}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>

      {/* Multi-select action dock — sticky */}
      {selectedCreds.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#FFFFFF', borderTop: '1px solid #E2E8F0',
          padding: '11px 20px',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 10, whiteSpace: 'nowrap',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: 13, color: '#475569' }}>
            <strong style={{ color: '#0F172A' }}>{selectedCreds.size}</strong> credentials selected
          </span>
          <div style={{ width: 1, height: 20, background: '#E2E8F0' }} />
          <button
            onClick={() => navigate('vector-campaigns')}
            style={{ background: '#DC2626', color: '#FFFFFF', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Run Credential Spraying
          </button>
          <button style={{ border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: '#475569', background: '#FFFFFF', cursor: 'pointer' }}>
            Export for Hashcat
          </button>
          <button onClick={() => setSelectedCreds(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
            <IconX size={13} />
          </button>
        </div>
      )}

      {/* Credential detail modal */}
      {selectedCred && <CredDetailModal cred={selectedCred} onClose={() => setSelectedCred(null)} navigate={navigate} />}
    </div>
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function InfrastructureData({
  project: _project,
  screen: currentScreen,
  navigate,
}: {
  project: Project
  screen: Screen
  navigate: (s: Screen) => void
}) {
  const tabs: { screen: Screen; label: string }[] = [
    { screen: 'infrastructure', label: 'Infrastructure & Data' },
    { screen: 'assets', label: 'Assets & Inventory' },
    { screen: 'credentials', label: 'Credentials Vault' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F8FAFC', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {currentScreen === 'infrastructure' && <EnvironmentMap navigate={navigate} />}
        {currentScreen === 'assets' && <AssetsInventory onUpdateScope={() => navigate('scope-boundaries')} />}
        {currentScreen === 'credentials' && <CredentialsVault navigate={navigate} />}
      </div>
    </div>
  )
}
