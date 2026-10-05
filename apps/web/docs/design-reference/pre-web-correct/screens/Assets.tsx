import { useState } from 'react'
import type { Project } from '../types'
import {
  DatabaseIcon,
  AlertTriangleIcon,
  SearchIcon,
  PlusIcon,
  DownloadIcon,
  XIcon,
  ChevronRightIcon,
  FilterIcon,
  TagIcon,
  ClockIcon,
  EyeIcon,
  UserIcon,
  GlobeIcon,
  LayersIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type AssetType = 'Host' | 'User' | 'Service' | 'Domain'
type AssetStatus = 'Active' | 'Discovered' | 'Offline'

interface Asset {
  id: string
  name: string
  type: AssetType
  status: AssetStatus
  inScope: boolean
  source: string
  relationships: number
  findings: number
  lastUpdated: string
  description: string
  os?: string
  ports?: string[]
  tags?: string[]
  linkedFindings?: { id: string; title: string; severity: string }[]
  recentActivity?: string[]
}

const MOCK_ASSETS: Asset[] = [
  {
    id: '1',
    name: '10.0.1.45',
    type: 'Host',
    status: 'Active',
    inScope: true,
    source: 'nmap-agent',
    relationships: 8,
    findings: 3,
    lastUpdated: '2 min ago',
    description: 'Primary web server hosting the admin panel. Running Apache 2.4.49.',
    os: 'Ubuntu 22.04',
    ports: ['22/SSH', '80/HTTP', '443/HTTPS', '8080/HTTP-alt'],
    tags: ['web-server', 'admin', 'critical'],
    linkedFindings: [
      { id: 'f1', title: 'Unauthenticated RCE via PHP Deserialization', severity: 'critical' },
      { id: 'f2', title: 'Path Traversal via Apache 2.4.49', severity: 'high' },
      { id: 'f3', title: 'SSH Key Reuse Detected', severity: 'medium' },
    ],
    recentActivity: ['Port scan completed', 'RCE confirmed', 'Credentials extracted'],
  },
  {
    id: '2',
    name: 'admin.acme-staging.io',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 5,
    findings: 2,
    lastUpdated: '5 min ago',
    description: 'Staging admin panel exposed publicly. No IP allowlisting.',
    tags: ['admin', 'staging', 'exposed'],
    linkedFindings: [
      { id: 'f1', title: 'Unauthenticated Admin Panel Access', severity: 'high' },
      { id: 'f5', title: 'Exposed .env File with Credentials', severity: 'critical' },
    ],
    recentActivity: ['Subdomain enumerated', 'Admin panel accessed', 'Credentials found in .env'],
  },
  {
    id: '3',
    name: 'api.acme.com',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 12,
    findings: 4,
    lastUpdated: '8 min ago',
    description: 'Main API gateway. Handles auth, user data, payment processing.',
    tags: ['api', 'auth', 'payments'],
    linkedFindings: [
      { id: 'f3', title: 'SQL Injection on Login Endpoint', severity: 'high' },
      { id: 'f6', title: 'JWT Algorithm Confusion Attack', severity: 'high' },
    ],
    recentActivity: ['SQL injection confirmed', 'JWT bypass tested', '.env file discovered'],
  },
  {
    id: '4',
    name: 'j.smith',
    type: 'User',
    status: 'Active',
    inScope: true,
    source: 'ldap-enum-agent',
    relationships: 4,
    findings: 1,
    lastUpdated: '12 min ago',
    description: 'Domain admin account. Password found in exposed .env file.',
    tags: ['admin', 'compromised', 'domain-admin'],
    linkedFindings: [
      { id: 'f7', title: 'Plaintext Credentials in .env File', severity: 'critical' },
    ],
    recentActivity: ['Account enumerated via LDAP', 'Password extracted from .env'],
  },
  {
    id: '5',
    name: 'SSH (22/tcp)',
    type: 'Service',
    status: 'Active',
    inScope: true,
    source: 'nmap-agent',
    relationships: 3,
    findings: 1,
    lastUpdated: '15 min ago',
    description: 'OpenSSH 7.4p1 running on primary web server. Weak cipher suites enabled.',
    tags: ['ssh', 'weak-ciphers'],
    linkedFindings: [
      { id: 'f8', title: 'Weak SSH Cipher Suites Enabled', severity: 'medium' },
    ],
    recentActivity: ['Service fingerprinted', 'Cipher audit completed'],
  },
  {
    id: '6',
    name: '10.0.1.22',
    type: 'Host',
    status: 'Active',
    inScope: true,
    source: 'nmap-agent',
    relationships: 6,
    findings: 0,
    lastUpdated: '18 min ago',
    description: 'Database server. PostgreSQL 14 accessible only from internal network.',
    os: 'CentOS 7',
    ports: ['5432/PostgreSQL', '22/SSH'],
    tags: ['database', 'internal'],
    linkedFindings: [],
    recentActivity: ['Port scan completed', 'DB version fingerprinted'],
  },
  {
    id: '7',
    name: 'vpn.acme.com',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 2,
    findings: 1,
    lastUpdated: '22 min ago',
    description: 'VPN endpoint using FortiGate. Outdated firmware with known CVEs.',
    tags: ['vpn', 'fortgate', 'outdated'],
    linkedFindings: [
      { id: 'f9', title: 'FortiGate SSL-VPN Auth Bypass (CVE-2022-42475)', severity: 'critical' },
    ],
    recentActivity: ['VPN service identified', 'CVE-2022-42475 tested'],
  },
  {
    id: '8',
    name: 'svc_backup',
    type: 'User',
    status: 'Active',
    inScope: true,
    source: 'ldap-enum-agent',
    relationships: 3,
    findings: 2,
    lastUpdated: '30 min ago',
    description: 'Service account with excessive domain privileges. Password never rotated.',
    tags: ['service-account', 'privilege', 'never-rotated'],
    linkedFindings: [
      { id: 'f10', title: 'Service Account with Domain Admin Rights', severity: 'high' },
      { id: 'f11', title: 'Password Never Changed (900+ days)', severity: 'medium' },
    ],
    recentActivity: ['Account enumerated via LDAP', 'Privilege level assessed'],
  },
  {
    id: '9',
    name: 'HTTP/8080 (alt)',
    type: 'Service',
    status: 'Discovered',
    inScope: true,
    source: 'nmap-agent',
    relationships: 2,
    findings: 1,
    lastUpdated: '35 min ago',
    description: 'Tomcat manager interface accessible on non-standard port. Default credentials present.',
    tags: ['tomcat', 'default-creds', 'manager'],
    linkedFindings: [
      { id: 'f12', title: 'Tomcat Manager Default Credentials', severity: 'critical' },
    ],
    recentActivity: ['Service discovered on port 8080', 'Tomcat manager accessed'],
  },
  {
    id: '10',
    name: '192.168.10.5',
    type: 'Host',
    status: 'Offline',
    inScope: false,
    source: 'masscan-agent',
    relationships: 1,
    findings: 0,
    lastUpdated: '1 hour ago',
    description: 'Internal host. Responded to ICMP during initial scan. Currently unreachable.',
    os: 'Unknown',
    ports: [],
    tags: ['out-of-scope', 'internal'],
    linkedFindings: [],
    recentActivity: ['Host discovered via ICMP sweep', 'No longer responding'],
  },
  {
    id: '11',
    name: 'mail.acme.com',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 2,
    findings: 0,
    lastUpdated: '1 hour ago',
    description: 'Mail server. Exchange 2019 with SPF and DKIM configured.',
    tags: ['mail', 'exchange'],
    linkedFindings: [],
    recentActivity: ['MX record enumerated', 'SMTP banner grabbed'],
  },
  {
    id: '12',
    name: 'a.williams',
    type: 'User',
    status: 'Discovered',
    inScope: true,
    source: 'osint-agent',
    relationships: 1,
    findings: 0,
    lastUpdated: '1.5 hours ago',
    description: 'HR Manager. Email confirmed via LinkedIn OSINT. Potential spear phishing target.',
    tags: ['hr', 'osint', 'phishing-target'],
    linkedFindings: [],
    recentActivity: ['Account discovered via OSINT', 'Email confirmed'],
  },
  {
    id: '13',
    name: 'MySQL (3306/tcp)',
    type: 'Service',
    status: 'Discovered',
    inScope: false,
    source: 'nmap-agent',
    relationships: 1,
    findings: 0,
    lastUpdated: '2 hours ago',
    description: 'MySQL 5.7 service detected on out-of-scope host. Not assessed.',
    tags: ['mysql', 'out-of-scope'],
    linkedFindings: [],
    recentActivity: ['Service fingerprinted (no further action — out of scope)'],
  },
  {
    id: '14',
    name: 'cdn.acme.com',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 3,
    findings: 0,
    lastUpdated: '2 hours ago',
    description: 'CloudFront CDN distribution. HTTPS enforced, no significant findings.',
    tags: ['cdn', 'cloudfront', 'low-risk'],
    linkedFindings: [],
    recentActivity: ['Subdomain enumerated', 'CDN provider identified'],
  },
  {
    id: '15',
    name: 'dev.acme.com',
    type: 'Domain',
    status: 'Active',
    inScope: true,
    source: 'subfinder-agent',
    relationships: 4,
    findings: 2,
    lastUpdated: '2.5 hours ago',
    description: 'Development environment exposed to internet. Swagger UI accessible.',
    tags: ['dev', 'swagger', 'exposed'],
    linkedFindings: [
      { id: 'f13', title: 'Swagger UI Exposed in Production', severity: 'medium' },
      { id: 'f14', title: 'Development Environment Publicly Accessible', severity: 'high' },
    ],
    recentActivity: ['Dev environment discovered', 'Swagger UI accessed', 'Internal APIs mapped'],
  },
]

const typeConfig: Record<AssetType, { label: string; bg: string; text: string; dot: string }> = {
  Host:    { label: 'Host',    bg: 'rgba(59,130,246,0.15)',  text: '#2563EB', dot: '#3B82F6' },
  User:    { label: 'User',    bg: 'rgba(139,92,246,0.15)', text: '#7C3AED', dot: '#8B5CF6' },
  Service: { label: 'Service', bg: 'rgba(20,184,166,0.15)', text: '#0D9488', dot: '#14B8A6' },
  Domain:  { label: 'Domain',  bg: 'rgba(245,158,11,0.15)', text: '#D97706', dot: '#F59E0B' },
}

const statusConfig: Record<AssetStatus, { dot: string; text: string }> = {
  Active:     { dot: '#22C55E', text: '#16A34A' },
  Discovered: { dot: '#3B82F6', text: '#2563EB' },
  Offline:    { dot: '#94A3B8', text: '#94A3B8' },
}

const sevColors: Record<string, string> = {
  critical: '#DC2626',
  high: '#F97316',
  medium: '#F59E0B',
  low: '#3B82F6',
  info: '#94A3B8',
}

const TYPE_FILTERS: (AssetType | 'All')[] = ['All', 'Host', 'User', 'Service', 'Domain']

function TypeIcon({ type, size = 14 }: { type: AssetType; size?: number }) {
  if (type === 'Host') return <DatabaseIcon size={size} />
  if (type === 'User') return <UserIcon size={size} />
  if (type === 'Service') return <LayersIcon size={size} />
  return <GlobeIcon size={size} />
}

export default function Assets({ project }: Props) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetType | 'All'>('All')
  const [drawer, setDrawer] = useState<Asset | null>(null)

  const filtered = MOCK_ASSETS.filter(a => {
    if (typeFilter !== 'All' && a.type !== typeFilter) return false
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.source.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts: Record<AssetType, number> = {
    Host: MOCK_ASSETS.filter(a => a.type === 'Host').length,
    User: MOCK_ASSETS.filter(a => a.type === 'User').length,
    Service: MOCK_ASSETS.filter(a => a.type === 'Service').length,
    Domain: MOCK_ASSETS.filter(a => a.type === 'Domain').length,
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F8FAFC' }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold" style={{ color: '#0F172A' }}>Assets</h1>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: '#DC2626' }}
          >
            {MOCK_ASSETS.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg outline-none w-48 transition-all"
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                color: '#0F172A',
              }}
            />
          </div>
          {/* Type filters */}
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className="px-2.5 py-1 rounded text-xs font-medium transition-all"
                style={typeFilter === f
                  ? { backgroundColor: '#E2E8F0', color: '#0F172A' }
                  : { color: '#475569' }
                }
              >
                {f}
                {f !== 'All' && (
                  <span className="ml-1 text-[10px]" style={{ color: '#94A3B8' }}>
                    {counts[f as AssetType]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <FilterIcon size={12} /> Filter
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <DownloadIcon size={12} /> Export
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ backgroundColor: '#DC2626', color: '#fff' }}
          >
            <PlusIcon size={12} /> Add Asset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {/* Column headers */}
        <div
          className="sticky top-0 grid text-[10px] font-semibold uppercase tracking-wider px-6 py-2.5"
          style={{
            gridTemplateColumns: '2fr 90px 110px 100px 140px 90px 70px 120px',
            backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            color: '#94A3B8',
          }}
        >
          <span>Name</span>
          <span>Type</span>
          <span>Status</span>
          <span>Scope</span>
          <span>Source</span>
          <span>Relationships</span>
          <span>Findings</span>
          <span>Last Updated</span>
        </div>

        {/* Rows */}
        {filtered.map((asset, idx) => (
          <button
            key={asset.id}
            onClick={() => setDrawer(asset)}
            className="w-full grid px-6 py-3 text-left transition-colors group"
            style={{
              gridTemplateColumns: '2fr 90px 110px 100px 140px 90px 70px 120px',
              backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
              borderBottom: '1px solid #F1F5F9',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F1F5F9' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}
          >
            {/* Name */}
            <div className="flex items-center gap-2 pr-4 min-w-0">
              <span style={{ color: typeConfig[asset.type].dot }}>
                <TypeIcon type={asset.type} size={14} />
              </span>
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: '#0F172A' }}
              >
                {asset.name}
              </span>
            </div>

            {/* Type badge */}
            <div className="flex items-center">
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: typeConfig[asset.type].bg, color: typeConfig[asset.type].text }}
              >
                {asset.type}
              </span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: statusConfig[asset.status].dot }}
              />
              <span className="text-xs" style={{ color: statusConfig[asset.status].text }}>
                {asset.status}
              </span>
            </div>

            {/* Scope */}
            <div className="flex items-center">
              {asset.inScope ? (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#16A34A' }}
                >
                  In-Scope
                </span>
              ) : (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(75,85,99,0.2)', color: '#94A3B8' }}
                >
                  Out-of-Scope
                </span>
              )}
            </div>

            {/* Source */}
            <div className="flex items-center">
              <span className="font-mono text-[11px] truncate" style={{ color: '#475569' }}>
                {asset.source}
              </span>
            </div>

            {/* Relationships */}
            <div className="flex items-center">
              <span className="text-xs font-medium" style={{ color: '#475569' }}>
                {asset.relationships}
              </span>
            </div>

            {/* Findings */}
            <div className="flex items-center">
              {asset.findings > 0 ? (
                <span
                  className="flex items-center gap-1 text-xs font-bold"
                  style={{ color: '#DC2626' }}
                >
                  <AlertTriangleIcon size={11} />
                  {asset.findings}
                </span>
              ) : (
                <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
              )}
            </div>

            {/* Last Updated */}
            <div className="flex items-center gap-1">
              <ClockIcon size={11} style={{ color: '#94A3B8' }} />
              <span className="text-[11px]" style={{ color: '#475569' }}>{asset.lastUpdated}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Drawer */}
      {drawer && (
        <AssetDrawer asset={drawer} onClose={() => setDrawer(null)} />
      )}
    </div>
  )
}

function AssetDrawer({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const tc = typeConfig[asset.type]
  const sc = statusConfig[asset.status]

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className="fixed right-0 top-[56px] bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          width: 360,
          backgroundColor: '#FFFFFF',
          borderLeft: '1px solid #E2E8F0',
        }}
      >
        {/* Drawer header */}
        <div
          className="flex items-start justify-between px-5 py-4 border-b"
          style={{ borderColor: '#E2E8F0' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: tc.bg, color: tc.text }}
              >
                {asset.type}
              </span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: sc.text }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sc.dot }} />
                {asset.status}
              </span>
              {asset.inScope ? (
                <span className="text-[10px]" style={{ color: '#16A34A' }}>In-Scope</span>
              ) : (
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Out-of-Scope</span>
              )}
            </div>
            <div
              className="font-mono text-sm font-bold break-all"
              style={{ color: '#0F172A' }}
            >
              {asset.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 p-1 rounded transition-colors"
            style={{ color: '#94A3B8' }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Description */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>
              Description
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
              {asset.description}
            </p>
          </div>

          {/* Details */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Details
            </div>
            <div className="space-y-2">
              <DrawerRow label="Source" value={asset.source} mono />
              <DrawerRow label="Relationships" value={String(asset.relationships)} />
              <DrawerRow label="Last Updated" value={asset.lastUpdated} />
              {asset.os && <DrawerRow label="OS" value={asset.os} />}
            </div>
          </div>

          {/* Ports */}
          {asset.ports && asset.ports.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Open Ports
              </div>
              <div className="flex flex-wrap gap-1.5">
                {asset.ports.map(p => (
                  <span
                    key={p}
                    className="font-mono text-[10px] px-2 py-0.5 rounded"
                    style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {asset.tags && asset.tags.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {asset.tags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                    style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
                  >
                    <TagIcon size={9} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Linked Findings */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: '#94A3B8' }}>
              Linked Findings
              {asset.linkedFindings && asset.linkedFindings.length > 0 && (
                <span
                  className="px-1.5 py-0 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: '#DC2626' }}
                >
                  {asset.linkedFindings.length}
                </span>
              )}
            </div>
            {asset.linkedFindings && asset.linkedFindings.length > 0 ? (
              <div className="space-y-1.5">
                {asset.linkedFindings.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{ backgroundColor: '#F1F5F9', border: '1px solid #F1F5F9' }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: sevColors[f.severity] || '#94A3B8' }}
                    />
                    <span className="text-[11px] flex-1 truncate" style={{ color: '#0F172A' }}>{f.title}</span>
                    <ChevronRightIcon size={12} style={{ color: '#94A3B8' }} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: '#94A3B8' }}>No linked findings</p>
            )}
          </div>

          {/* Relationship graph (text list) */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Relationships
            </div>
            <div
              className="rounded-lg p-3 text-[11px] leading-relaxed font-mono"
              style={{ backgroundColor: '#F1F5F9', border: '1px solid #F1F5F9', color: '#475569' }}
            >
              {asset.type === 'Host' && (
                <>
                  <div className="mb-1" style={{ color: '#2563EB' }}>[Host] {asset.name}</div>
                  <div className="pl-3 space-y-0.5">
                    <div>├── runs → Apache 2.4.49</div>
                    <div>├── serves → {asset.name === '10.0.1.45' ? 'admin panel' : 'web app'}</div>
                    <div>└── linked to {asset.relationships - 2} finding(s)</div>
                  </div>
                </>
              )}
              {asset.type === 'Domain' && (
                <>
                  <div className="mb-1" style={{ color: '#D97706' }}>[Domain] {asset.name}</div>
                  <div className="pl-3 space-y-0.5">
                    <div>├── resolves → 10.0.1.45</div>
                    <div>├── parent → acme.com</div>
                    <div>└── linked to {asset.findings} finding(s)</div>
                  </div>
                </>
              )}
              {asset.type === 'User' && (
                <>
                  <div className="mb-1" style={{ color: '#7C3AED' }}>[User] {asset.name}</div>
                  <div className="pl-3 space-y-0.5">
                    <div>├── member-of → Domain Admins</div>
                    <div>├── creds-in → .env file</div>
                    <div>└── linked to {asset.findings} finding(s)</div>
                  </div>
                </>
              )}
              {asset.type === 'Service' && (
                <>
                  <div className="mb-1" style={{ color: '#0D9488' }}>[Service] {asset.name}</div>
                  <div className="pl-3 space-y-0.5">
                    <div>├── runs-on → 10.0.1.45</div>
                    <div>└── linked to {asset.findings} finding(s)</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          {asset.recentActivity && asset.recentActivity.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Recent Activity
              </div>
              <div className="space-y-2">
                {asset.recentActivity.map((act, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div
                      className="w-1 h-1 rounded-full mt-1.5 shrink-0"
                      style={{ backgroundColor: '#E2E8F0' }}
                    />
                    <span className="text-[11px]" style={{ color: '#475569' }}>{act}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div
          className="px-5 py-3 border-t flex gap-2"
          style={{ borderColor: '#E2E8F0' }}
        >
          <button
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ backgroundColor: '#DC2626', color: '#fff' }}
          >
            <EyeIcon size={12} /> View Details
          </button>
          <button
            className="px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <DownloadIcon size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

function DrawerRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: '#94A3B8' }}>{label}</span>
      <span
        className={`text-[11px] font-medium ${mono ? 'font-mono' : ''}`}
        style={{ color: '#475569' }}
      >
        {value}
      </span>
    </div>
  )
}
