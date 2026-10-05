import { useState } from 'react'
import type { Project } from '../types'
import {
  PlusIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshIcon,
  KeyIcon,
  ClockIcon,
  UserIcon,
  AlertTriangleIcon,
  SearchIcon,
  XIcon,
  ShieldIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type CredType = 'password' | 'token' | 'session' | 'cookie' | 'api_key' | 'discovered'

interface RotationEvent {
  date: string
  by: string
  note: string
}

interface Credential {
  id: string
  name: string
  type: CredType
  username: string
  secret: string
  linkedAsset: string
  source: string
  lastUpdated: string
  status: 'active' | 'revoked' | 'expired'
  notes: string
  rotationHistory: RotationEvent[]
}

const CREDS: Credential[] = [
  {
    id: 'c1',
    name: 'Admin Panel Login',
    type: 'password',
    username: 'admin@acme.com',
    secret: 'Adm1n_S3cur3_2026!',
    linkedAsset: 'admin.acme-staging.io:8080',
    source: 'Found in .env file',
    lastUpdated: '2026-09-18',
    status: 'active',
    notes: 'Plaintext password discovered in .env at API root. Full admin access to AdminLite panel.',
    rotationHistory: [
      { date: '2026-09-18', by: 'VulnScanner-1', note: 'Discovered during .env exposure assessment' },
    ],
  },
  {
    id: 'c2',
    name: 'API Bearer Token',
    type: 'token',
    username: 'svc-acme-api',
    secret: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdmMtYWNtZSIsInJvbGUiOiJhZG1pbiJ9.abc123',
    linkedAsset: 'api.acme.com',
    source: 'Captured from traffic',
    lastUpdated: '2026-09-15',
    status: 'active',
    notes: 'JWT bearer token with admin role. No expiry set. Captured via traffic interception on HTTP endpoint.',
    rotationHistory: [
      { date: '2026-09-15', by: 'ReconAgent-2', note: 'Captured from unencrypted HTTP request on port 8080' },
    ],
  },
  {
    id: 'c3',
    name: 'Dev Database Password',
    type: 'password',
    username: 'dev_user',
    secret: 'devpass_2024_insecure',
    linkedAsset: 'db.acme-internal.io:5432',
    source: 'Config file leak',
    lastUpdated: '2026-08-01',
    status: 'active',
    notes: 'PostgreSQL development instance credentials. Password has not been rotated since 2024.',
    rotationHistory: [
      { date: '2026-08-01', by: 'ReconAgent-1', note: 'Found in docker-compose.yml in public GitHub repo' },
    ],
  },
  {
    id: 'c4',
    name: 'Admin Session Cookie',
    type: 'cookie',
    username: 'admin',
    secret: 'PHPSESSID=ab3fc7d1e2a9b8c0d4f5e6a7b8c9d0e1f2a3b4c5',
    linkedAsset: 'portal.acme.com',
    source: 'Cookie theft PoC',
    lastUpdated: '2026-09-17',
    status: 'expired',
    notes: 'Session cookie extracted via XSS PoC. Cookie expired after 24 hours as expected.',
    rotationHistory: [
      { date: '2026-09-17', by: 'ExploitAgent-1', note: 'Extracted via stored XSS payload in comment field' },
      { date: '2026-09-18', by: 'System', note: 'Cookie expired (24h TTL)' },
    ],
  },
  {
    id: 'c5',
    name: 'Internal Stripe API Key',
    type: 'api_key',
    username: 'system',
    secret: 'sk_live_4xT9mN2pQ7rS1uV6wX3yZ8aB5cD0eF',
    linkedAsset: 'api.acme.com',
    source: 'Source code (frontend bundle)',
    lastUpdated: '2026-07-30',
    status: 'active',
    notes: 'Live Stripe secret key hardcoded in the minified frontend bundle. Allows full payment API access.',
    rotationHistory: [
      { date: '2026-07-30', by: 'ReconAgent-1', note: 'Extracted from minified JS bundle at /static/js/main.chunk.js' },
    ],
  },
  {
    id: 'c6',
    name: 'VPN User Credential',
    type: 'password',
    username: 'vpn.user@acme.com',
    secret: 'Summer2024!',
    linkedAsset: 'vpn.acme.com',
    source: 'Password reuse (leaked breach DB)',
    lastUpdated: '2026-09-10',
    status: 'revoked',
    notes: 'Password matched entry in HaveIBeenPwned breach database (Collection #1). Revoked after responsible disclosure.',
    rotationHistory: [
      { date: '2026-09-10', by: 'ReconAgent-2', note: 'Found via OSINT — matched breach database entry' },
      { date: '2026-09-12', by: 'Alex Kim', note: 'Reported to client — credential revoked by client team' },
    ],
  },
  {
    id: 'c7',
    name: 'Elasticsearch No-Auth Access',
    type: 'discovered',
    username: '(none)',
    secret: '(unauthenticated)',
    linkedAsset: '104.21.44.11:9200',
    source: 'Shodan discovery',
    lastUpdated: '2026-09-18',
    status: 'active',
    notes: 'Elasticsearch instance running without authentication. Full read/write access to all indices. Contains customer PII.',
    rotationHistory: [
      { date: '2026-09-18', by: 'ReconAgent-1', note: 'Discovered via Shodan, verified unauthenticated read access' },
    ],
  },
  {
    id: 'c8',
    name: 'Jenkins Admin Session',
    type: 'session',
    username: 'admin',
    secret: 'j_session=FA3E2D1C0B9A8765432100ABCDEF1234',
    linkedAsset: 'jenkins.acme-internal.io',
    source: 'Session hijacking via SSRF',
    lastUpdated: '2026-09-19',
    status: 'expired',
    notes: 'Admin session token retrieved via SSRF against internal Jenkins instance. Session expired.',
    rotationHistory: [
      { date: '2026-09-19', by: 'ExploitAgent-1', note: 'Retrieved via SSRF through webhook endpoint' },
      { date: '2026-09-19', by: 'System', note: 'Session expired — Jenkins default 30min TTL' },
    ],
  },
  {
    id: 'c9',
    name: 'SendGrid API Key',
    type: 'api_key',
    username: 'system',
    secret: 'SG.abc123XYZ.VeryLongBase64EncodedKeyHere-abcdefghijklmnop',
    linkedAsset: 'api.acme.com',
    source: '.env file exposure',
    lastUpdated: '2026-09-18',
    status: 'active',
    notes: 'SendGrid API key with full access. Allows sending emails from acme.com verified domain — phishing risk.',
    rotationHistory: [
      { date: '2026-09-18', by: 'VulnScanner-1', note: 'Extracted from .env file at api.acme.com' },
    ],
  },
  {
    id: 'c10',
    name: 'Redis No-Auth Access',
    type: 'discovered',
    username: '(none)',
    secret: '(unauthenticated)',
    linkedAsset: '104.21.44.12:6379',
    source: 'Port scan + Shodan',
    lastUpdated: '2026-09-18',
    status: 'active',
    notes: 'Redis instance exposed publicly without authentication. Contains session tokens and cache data. Potential for RCE via config manipulation.',
    rotationHistory: [
      { date: '2026-09-18', by: 'ReconAgent-2', note: 'Discovered via port scan, confirmed unauthenticated write access' },
    ],
  },
]

const TYPE_CONFIG: Record<CredType, { label: string; bg: string; text: string; icon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> }> = {
  password:   { label: 'Password',   bg: '#DBEAFE', text: '#3B82F6', icon: ShieldIcon },
  token:      { label: 'Token',      bg: '#DCFCE7', text: '#22C55E', icon: KeyIcon },
  session:    { label: 'Session',    bg: '#FEF3C7', text: '#F59E0B', icon: ClockIcon },
  api_key:    { label: 'API Key',    bg: '#EDE9FE', text: '#A855F7', icon: KeyIcon },
  cookie:     { label: 'Cookie',     bg: '#FFF7ED', text: '#EA580C', icon: UserIcon },
  discovered: { label: 'Discovered', bg: '#FEF2F2', text: '#DC2626', icon: AlertTriangleIcon },
}

const STATUS_CONFIG = {
  active:  { label: 'Active',  bg: '#DCFCE7', text: '#22C55E', dot: '#22C55E' },
  revoked: { label: 'Revoked', bg: '#FEF2F2', text: '#DC2626', dot: '#DC2626' },
  expired: { label: 'Expired', bg: '#FEF3C7', text: '#F59E0B', dot: '#F59E0B' },
}

const TYPE_FILTERS: Array<CredType | 'all'> = ['all', 'password', 'token', 'session', 'cookie', 'api_key', 'discovered']

export default function Credentials({ project: _project }: Props) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Credential | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<CredType | 'all'>('all')

  const toggleReveal = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filtered = CREDS.filter(c => {
    if (typeFilter !== 'all' && c.type !== typeFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.linkedAsset.toLowerCase().includes(search.toLowerCase()) && !c.username.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = CREDS.filter(c => c.status === 'active').length

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: 32, position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Credentials</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
            {activeCount} active · {CREDS.length} total · discovered during engagement
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
            borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: '#FEF3C7', border: '1px solid #D97706', color: '#F59E0B',
          }}>
            <AlertTriangleIcon size={13} /> Handle with care
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: '#DC2626', border: 'none', color: '#fff', cursor: 'pointer',
          }}>
            <PlusIcon size={14} /> Add Credential
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <SearchIcon size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search credentials…"
            style={{
              paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
              fontSize: 12, borderRadius: 8, outline: 'none', width: 220,
              background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {TYPE_FILTERS.map(t => {
            const active = typeFilter === t
            const cfg = t !== 'all' ? TYPE_CONFIG[t] : null
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: active ? (cfg ? cfg.bg : '#DC2626') : '#FFFFFF',
                  color: active ? (cfg ? cfg.text : '#fff') : '#94A3B8',
                  border: '1px solid',
                  borderColor: active ? (cfg ? cfg.text + '44' : '#DC2626') : '#E2E8F0',
                  textTransform: 'capitalize',
                }}
              >
                {t === 'all' ? 'All types' : TYPE_CONFIG[t].label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 340px' : '1fr', gap: 16 }}>
        {/* Table */}
        <div style={{ borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 160px 130px 110px 120px 80px',
            gap: 12, padding: '9px 20px',
            background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8',
          }}>
            <span>Name / Username</span>
            <span>Type</span>
            <span>Linked Asset</span>
            <span>Secret</span>
            <span>Status</span>
            <span>Last Updated</span>
            <span>Source</span>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No credentials match your filters
            </div>
          ) : (
            filtered.map((cred, idx) => {
              const tc = TYPE_CONFIG[cred.type]
              const sc = STATUS_CONFIG[cred.status]
              const isRevealed = revealed.has(cred.id)
              const isSelected = selected?.id === cred.id
              const TypeIcon = tc.icon

              return (
                <div
                  key={cred.id}
                  onClick={() => setSelected(isSelected ? null : cred)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 100px 160px 130px 110px 120px 80px',
                    gap: 12, padding: '13px 20px', alignItems: 'center',
                    borderBottom: idx < filtered.length - 1 ? '1px solid #F1F5F9' : 'none',
                    background: isSelected ? '#F1F5F9' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9' }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  {/* Name / username */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{cred.name}</div>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94A3B8', marginTop: 2 }}>{cred.username}</div>
                  </div>

                  {/* Type */}
                  <div>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: tc.bg, color: tc.text,
                    }}>
                      <TypeIcon size={9} />
                      {tc.label}
                    </span>
                  </div>

                  {/* Linked asset */}
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cred.linkedAsset}
                  </div>

                  {/* Secret */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#94A3B8', letterSpacing: 1 }}>
                      {isRevealed ? cred.secret.slice(0, 20) + (cred.secret.length > 20 ? '…' : '') : '●●●●●●●●●●'}
                    </span>
                    <button
                      onClick={(e) => toggleReveal(cred.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0, padding: 2 }}
                    >
                      {isRevealed ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                    </button>
                  </div>

                  {/* Status */}
                  <div>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                      background: sc.bg, color: sc.text,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot }} />
                      {sc.label}
                    </span>
                  </div>

                  {/* Last updated */}
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>{cred.lastUpdated}</div>

                  {/* Source */}
                  <div style={{ fontSize: 11, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cred.source}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail drawer */}
        {selected && (
          <div style={{
            borderRadius: 12, border: '1px solid #E2E8F0', background: '#FFFFFF',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            {/* Drawer header */}
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {(() => {
                    const tc = TYPE_CONFIG[selected.type]
                    const Icon = tc.icon
                    return (
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: tc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={15} style={{ color: tc.text }} />
                      </div>
                    )
                  })()}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{selected.name}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{TYPE_CONFIG[selected.type].label}</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0 }}
              >
                <XIcon size={14} />
              </button>
            </div>

            {/* Details */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9' }}>
              {[
                { label: 'Username', value: selected.username, mono: true },
                { label: 'Linked Asset', value: selected.linkedAsset, mono: true },
                { label: 'Source', value: selected.source },
                { label: 'Last Updated', value: selected.lastUpdated },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 12 }}>
                  <span style={{ color: '#94A3B8' }}>{row.label}</span>
                  <span style={{
                    fontFamily: row.mono ? 'monospace' : 'inherit',
                    fontSize: row.mono ? 11 : 12,
                    fontWeight: 500, color: '#475569',
                    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, textAlign: 'right',
                  }}>{row.value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: '#94A3B8' }}>Status</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                  background: STATUS_CONFIG[selected.status].bg, color: STATUS_CONFIG[selected.status].text,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_CONFIG[selected.status].dot }} />
                  {STATUS_CONFIG[selected.status].label}
                </span>
              </div>
            </div>

            {/* Secret reveal */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Secret Value</div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px',
              }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#475569', wordBreak: 'break-all', flex: 1, paddingRight: 8 }}>
                  {revealed.has(selected.id) ? selected.secret : '●●●●●●●●●●●●●●●●●●●●'}
                </span>
                <button
                  onClick={e => toggleReveal(selected.id, e)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0 }}
                >
                  {revealed.has(selected.id) ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                </button>
              </div>
            </div>

            {/* Notes */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Notes</div>
              <div style={{ background: '#F1F5F9', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                {selected.notes}
              </div>
            </div>

            {/* Rotation history */}
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #F1F5F9', flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Rotation History
              </div>
              {selected.rotationHistory.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#E2E8F0', marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{ev.date} · <span style={{ color: '#DC2626' }}>{ev.by}</span></div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{ev.note}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ padding: '12px 18px', display: 'flex', gap: 8 }}>
              <button style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', cursor: 'pointer',
              }}>
                <RefreshIcon size={13} /> Rotate
              </button>
              <button style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', cursor: 'pointer',
              }}>
                Revoke
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
