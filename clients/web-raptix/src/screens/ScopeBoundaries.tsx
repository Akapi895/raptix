import { useState } from 'react'
import type { Project } from '../types'

interface Target {
  id: number
  identifier: string
  type: 'CIDR' | 'Web' | 'API' | 'Host' | 'Email'
  environment: string
  permission: 'Full Access' | 'Enumerate Only' | 'Phishing Allowed'
}

const INITIAL_TARGETS: Target[] = [
  { id: 1, identifier: '10.10.0.0/24', type: 'CIDR', environment: 'Internal LAN', permission: 'Full Access' },
  { id: 2, identifier: '192.168.1.0/24', type: 'CIDR', environment: 'Corporate', permission: 'Enumerate Only' },
  { id: 3, identifier: 'acme-corp.com', type: 'Web', environment: 'External', permission: 'Full Access' },
  { id: 4, identifier: 'api.acme-corp.com', type: 'API', environment: 'External', permission: 'Full Access' },
  { id: 5, identifier: 'mail.acme-corp.com', type: 'Web', environment: 'External', permission: 'Phishing Allowed' },
  { id: 6, identifier: '10.10.14.0/24', type: 'CIDR', environment: 'DMZ', permission: 'Full Access' },
  { id: 7, identifier: 'dev.acme-corp.com', type: 'Web', environment: 'Dev/Staging', permission: 'Full Access' },
  { id: 8, identifier: '203.0.113.50', type: 'Host', environment: 'External', permission: 'Full Access' },
  { id: 9, identifier: '203.0.113.51', type: 'Host', environment: 'External', permission: 'Full Access' },
  { id: 10, identifier: '198.51.100.0/28', type: 'CIDR', environment: 'External', permission: 'Enumerate Only' },
  { id: 11, identifier: 'vpn.acme-corp.com', type: 'Web', environment: 'External', permission: 'Enumerate Only' },
  { id: 12, identifier: 'john.doe@acme-corp.com', type: 'Email', environment: 'Corporate', permission: 'Phishing Allowed' },
  { id: 13, identifier: 'sarah.miller@acme-corp.com', type: 'Email', environment: 'Corporate', permission: 'Phishing Allowed' },
  { id: 14, identifier: 'it.helpdesk@acme-corp.com', type: 'Email', environment: 'Corporate', permission: 'Phishing Allowed' },
  { id: 15, identifier: '192.168.2.50', type: 'Host', environment: 'DMZ', permission: 'Enumerate Only' },
]

const BLACKLIST = [
  {
    id: 1,
    identifier: '10.10.5.0/24',
    label: 'Production Payment Systems',
    reason: 'PCI-DSS scope — financial transaction processing',
  },
  {
    id: 2,
    identifier: 'hospital-mgmt.acme-corp.com',
    label: 'Healthcare Portal',
    reason: 'HIPAA-protected patient data — zero tolerance',
  },
  {
    id: 3,
    identifier: '192.168.99.0/24',
    label: 'HR & Payroll Systems',
    reason: 'PII data — legal hold',
  },
]

function permissionBadge(p: string) {
  if (p === 'Full Access') return { bg: '#DCFCE7', color: '#16A34A', border: '#BBF7D0' }
  if (p === 'Enumerate Only') return { bg: '#DBEAFE', color: '#2563EB', border: '#BFDBFE' }
  return { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' }
}

function typeBadge(t: string) {
  if (t === 'CIDR') return { bg: '#DBEAFE', color: '#2563EB' }
  if (t === 'Web' || t === 'API') return { bg: '#EDE9FE', color: '#7C3AED' }
  if (t === 'Host') return { bg: '#F1F5F9', color: '#475569' }
  return { bg: '#FFFBEB', color: '#D97706' }
}

export default function ScopeBoundaries({ project: _project }: { project: Project }) {
  const [activeTab, setActiveTab] = useState<'in-scope' | 'blacklist'>('in-scope')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [pasteInput, setPasteInput] = useState('')
  const [targets, setTargets] = useState<Target[]>(INITIAL_TARGETS)

  const allSelected = targets.length > 0 && selectedRows.size === targets.length
  const someSelected = selectedRows.size > 0 && !allSelected

  const toggleRow = (id: number) => {
    const next = new Set(selectedRows)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedRows(next)
  }

  const toggleAll = () => {
    if (allSelected) setSelectedRows(new Set())
    else setSelectedRows(new Set(targets.map((t) => t.id)))
  }

  const handleAddTarget = () => {
    const val = pasteInput.trim()
    if (!val) return
    const newId = Math.max(0, ...targets.map((t) => t.id)) + 1
    setTargets([...targets, {
      id: newId,
      identifier: val,
      type: val.includes('@') ? 'Email' : val.includes('/') ? 'CIDR' : val.match(/^\d/) ? 'Host' : 'Web',
      environment: 'External',
      permission: 'Full Access',
    }])
    setPasteInput('')
  }

  const handleRemove = (id: number) => {
    setTargets(targets.filter((t) => t.id !== id))
    const next = new Set(selectedRows)
    next.delete(id)
    setSelectedRows(next)
  }

  const handleRemoveSelected = () => {
    setTargets(targets.filter((t) => !selectedRows.has(t.id)))
    setSelectedRows(new Set())
  }

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: '24px', overflowY: 'auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: '#0F172A' }}>
          Scope & Boundaries
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
          Define authorized targets, restrictions, and blacklisted systems for this engagement.
        </p>
      </div>

      {/* Stat chips */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px',
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total In-Scope</span>
            <span style={{ fontSize: '26px', fontWeight: 700, color: '#16A34A', lineHeight: '1.2' }}>{targets.length}</span>
          </div>
          <div style={{ width: '36px', height: '36px', background: '#DCFCE7', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <div style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px',
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Blacklisted Ranges</span>
            <span style={{ fontSize: '26px', fontWeight: 700, color: '#DC2626', lineHeight: '1.2' }}>3</span>
          </div>
          <div style={{ width: '36px', height: '36px', background: '#FEF2F2', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#DC2626" strokeWidth="2"/>
              <path d="M6.34 6.34l11.32 11.32" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
        <div style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px',
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Personas</span>
            <span style={{ fontSize: '26px', fontWeight: 700, color: '#2563EB', lineHeight: '1.2' }}>12</span>
          </div>
          <div style={{ width: '36px', height: '36px', background: '#DBEAFE', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="#2563EB" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="9" cy="7" r="4" stroke="#2563EB" strokeWidth="2"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="#2563EB" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Tab switcher + action bar */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: '8px', padding: '3px', gap: '2px' }}>
            {(['in-scope', 'blacklist'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '7px 16px', borderRadius: '6px', border: 'none',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  background: activeTab === tab ? '#FFFFFF' : 'transparent',
                  color: activeTab === tab ? (tab === 'blacklist' ? '#DC2626' : '#0F172A') : '#475569',
                  boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {tab === 'in-scope' ? 'In-Scope Targets' : 'Strict Blacklist'}
              </button>
            ))}
          </div>

          {/* Action bar */}
          {activeTab === 'in-scope' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddTarget() }}
                placeholder="Paste IP, CIDR, or URL..."
                style={{
                  padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0',
                  background: '#F8FAFC', fontSize: '13px', color: '#0F172A',
                  fontFamily: 'monospace', outline: 'none', width: '240px',
                }}
              />
              <button
                onClick={handleAddTarget}
                style={{
                  padding: '8px 16px', borderRadius: '8px', border: 'none',
                  background: '#DC2626', color: '#FFFFFF', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                Add Target
              </button>
              <button
                style={{
                  padding: '8px 14px', borderRadius: '8px', border: '1px solid #E2E8F0',
                  background: '#FFFFFF', color: '#475569', fontSize: '13px',
                  fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Import CSV / Nmap
              </button>
            </div>
          )}
        </div>
      </div>

      {/* In-Scope Targets Table */}
      {activeTab === 'in-scope' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '40px' }} />
              <col style={{ width: '230px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '150px' }} />
              <col style={{ width: '100px' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    style={{ width: '14px', height: '14px', accentColor: '#DC2626', cursor: 'pointer' }}
                  />
                </th>
                {['Target Identifier', 'Type', 'Environment', 'AI Permissions', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => {
                const selected = selectedRows.has(t.id)
                const pb = permissionBadge(t.permission)
                const tb = typeBadge(t.type)
                return (
                  <tr key={t.id} style={{
                    borderBottom: i < targets.length - 1 ? '1px solid #F1F5F9' : 'none',
                    background: selected ? '#EFF6FF' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                    <td style={{ padding: '10px 12px' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRow(t.id)}
                        style={{ width: '14px', height: '14px', accentColor: '#DC2626', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '13px', color: '#0F172A', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.identifier}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        background: tb.bg, color: tb.color,
                        padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                      }}>{t.type}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '13px', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.environment}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        background: pb.bg, color: pb.color,
                        border: `1px solid ${pb.border}`,
                        padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}>{t.permission}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={{
                          padding: '3px 8px', fontSize: '12px', borderRadius: '5px',
                          border: '1px solid #E2E8F0', background: '#FFFFFF',
                          color: '#475569', cursor: 'pointer', fontWeight: 500,
                        }}>Edit</button>
                        <button
                          onClick={() => handleRemove(t.id)}
                          style={{
                            padding: '3px 8px', fontSize: '12px', borderRadius: '5px',
                            border: '1px solid #FEE2E2', background: '#FEF2F2',
                            color: '#DC2626', cursor: 'pointer', fontWeight: 500,
                          }}
                        >Remove</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Multi-select action bar */}
          {selectedRows.size > 0 && (
            <div style={{
              borderTop: '1px solid #E2E8F0', padding: '12px 16px',
              background: '#EFF6FF', display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span style={{ fontSize: '13px', color: '#2563EB', fontWeight: 600 }}>
                {selectedRows.size} target{selectedRows.size !== 1 ? 's' : ''} selected
              </span>
              <span style={{ color: '#94A3B8' }}>—</span>
              <button style={{
                padding: '6px 14px', fontSize: '13px', borderRadius: '7px',
                border: '1px solid #BFDBFE', background: '#FFFFFF',
                color: '#2563EB', cursor: 'pointer', fontWeight: 600,
              }}>
                Change Permissions
              </button>
              <button
                onClick={handleRemoveSelected}
                style={{
                  padding: '6px 14px', fontSize: '13px', borderRadius: '7px',
                  border: '1px solid #FCA5A5', background: '#FEF2F2',
                  color: '#DC2626', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Remove from Scope
              </button>
            </div>
          )}
        </div>
      )}

      {/* Strict Blacklist tab */}
      {activeTab === 'blacklist' && (
        <div>
          {/* Warning banner */}
          <div style={{
            background: '#FEF2F2', border: '1px solid #EF4444', borderRadius: '10px',
            padding: '12px 16px', marginBottom: '16px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M12 2L2 19h20L12 2z" fill="#FEE2E2" stroke="#DC2626" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M12 9v4M12 17h.01" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: '13px', color: '#DC2626', fontWeight: 600 }}>
              These systems are strictly off-limits. Any interaction will trigger immediate campaign abort.
            </span>
          </div>

          {/* Blacklist table */}
          <div style={{ background: '#FFFFFF', border: '1px solid #EF4444', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FEF2F2', borderBottom: '1px solid #FCA5A5' }}>
                  {['Identifier', 'System / Label', 'Reason', 'Status'].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BLACKLIST.map((item, i) => (
                  <tr key={item.id} style={{
                    background: i % 2 === 0 ? '#FFF7F7' : '#FFFFFF',
                    borderBottom: i < BLACKLIST.length - 1 ? '1px solid #FEE2E2' : 'none',
                  }}>
                    <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '13px', color: '#0F172A', fontWeight: 600 }}>
                      {item.identifier}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#0F172A', fontWeight: 600 }}>
                      {item.label}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#475569', maxWidth: '300px' }}>
                      {item.reason}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        background: '#DC2626', color: '#FFFFFF',
                        padding: '3px 10px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 700,
                        letterSpacing: '0.03em',
                      }}>BLACKLISTED</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
