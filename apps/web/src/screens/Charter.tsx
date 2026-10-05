import { useState } from 'react'
import type { Project } from '../types'

export default function Charter({ project }: { project: Project }) {
  const [showKillModal, setShowKillModal] = useState(false)
  const [campaignHalted, setCampaignHalted] = useState(false)
  const [showHash, setShowHash] = useState(false)
  const [abortReason, setAbortReason] = useState('')
  const [objectives, setObjectives] = useState([
    { label: 'Establish initial foothold (External → Internal)', done: true },
    { label: 'Achieve Domain Admin / DCSync rights', done: false },
    { label: 'Exfiltrate customer database (simulated)', done: false },
    { label: 'Compromise CEO email account', done: false },
    { label: 'Plant persistence on Domain Controller', done: false },
  ])

  const achievedCount = objectives.filter((o) => o.done).length
  const progress = (achievedCount / objectives.length) * 100

  const handleConfirmAbort = () => {
    if (!abortReason.trim()) return
    setCampaignHalted(true)
    setShowKillModal(false)
    setAbortReason('')
  }

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', padding: '24px', overflowY: 'auto' }}>
      {/* Modal overlay */}
      {showKillModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowKillModal(false) }}
        >
          <div style={{
            background: '#FFFFFF', borderRadius: '12px', padding: '28px', width: '480px',
            maxWidth: 'calc(100vw - 48px)', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 19h20L12 2z" fill="#DC2626" fillOpacity="0.15" stroke="#DC2626" strokeWidth="2" strokeLinejoin="round"/>
                <path d="M12 9v4M12 17h.01" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>Confirm Emergency Abort</h2>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#475569', lineHeight: '1.5' }}>
              This will immediately halt all active agents, close all C2 sessions, and notify White Team.
            </p>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#0F172A', marginBottom: '6px' }}>
              Reason for abort: <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <textarea
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              placeholder="Describe the reason for emergency abort..."
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px',
                color: '#0F172A', resize: 'vertical', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowKillModal(false)}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: '1px solid #E2E8F0',
                  background: '#FFFFFF', color: '#475569', fontSize: '14px', fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAbort}
                disabled={!abortReason.trim()}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: 'none',
                  background: abortReason.trim() ? '#DC2626' : '#F1F5F9',
                  color: abortReason.trim() ? '#FFFFFF' : '#94A3B8',
                  fontSize: '14px', fontWeight: 600,
                  cursor: abortReason.trim() ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s',
                }}
              >
                Confirm Abort
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 700, color: '#0F172A' }}>
            {project.name} — Charter & Rules of Engagement
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: '#DCFCE7', color: '#16A34A', padding: '3px 10px',
              borderRadius: '999px', fontSize: '12px', fontWeight: 600,
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
              IN EFFECT
            </span>
            <span style={{
              background: '#F1F5F9', color: '#475569', padding: '3px 10px',
              borderRadius: '999px', fontSize: '12px', fontWeight: 500,
            }}>
              Expires: 2026-12-31
            </span>
            <span style={{
              background: '#FFFBEB', color: '#D97706', padding: '3px 10px',
              borderRadius: '999px', fontSize: '12px', fontWeight: 600,
              border: '1px solid #FDE68A',
            }}>
              Classification: CONFIDENTIAL
            </span>
          </div>
        </div>
        <span style={{ fontSize: '13px', color: '#94A3B8', paddingTop: '4px' }}>Last updated: 2 hours ago</span>
      </div>

      {/* Emergency Kill Switch */}
      <div style={{
        background: campaignHalted ? '#F8FAFC' : '#FEF2F2',
        border: campaignHalted ? '1px solid #E2E8F0' : '1px solid #EF4444',
        borderLeft: campaignHalted ? '4px solid #94A3B8' : '4px solid #DC2626',
        borderRadius: '10px', padding: '16px', marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: campaignHalted ? '8px' : '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: campaignHalted ? '#94A3B8' : '#DC2626' }}>
            {campaignHalted ? '● CAMPAIGN HALTED' : '⚡ EMERGENCY KILL SWITCH'}
          </span>
          {!campaignHalted && (
            <span style={{
              background: '#DC2626', color: '#FFFFFF', padding: '2px 8px',
              borderRadius: '999px', fontSize: '11px', fontWeight: 700,
            }}>Active</span>
          )}
        </div>
        {!campaignHalted ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '20px', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Emergency Contacts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {[
                  { role: 'White Team Lead', name: 'Marcus Chen', phone: '+1 (555) 0142', email: 'marcus.chen@acme-whiteteam.com' },
                  { role: 'Red Team Lead', name: 'Sarah Voss', phone: '+1 (555) 0187', email: 's.voss@raptix.io' },
                  { role: 'CISO', name: 'David Park', phone: '+1 (555) 0093', email: null },
                ].map((c) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '13px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#475569', fontWeight: 600, minWidth: '110px' }}>{c.role}:</span>
                    <span style={{ color: '#0F172A', fontWeight: 500 }}>{c.name}</span>
                    <span style={{ color: '#94A3B8' }}>—</span>
                    <span style={{ color: '#0F172A', fontFamily: 'monospace', fontSize: '12px' }}>{c.phone}</span>
                    {c.email && (
                      <>
                        <span style={{ color: '#94A3B8' }}>—</span>
                        <a href={`mailto:${c.email}`} style={{ color: '#2563EB', textDecoration: 'none', fontSize: '12px' }}>{c.email}</a>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowKillModal(true)}
              style={{
                background: '#DC2626', color: '#FFFFFF', border: 'none',
                padding: '12px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(220,38,38,0.35)',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              <span>🛑</span> ABORT CAMPAIGN (KILL SWITCH)
            </button>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '14px', color: '#94A3B8' }}>Campaign has been halted. White Team has been notified.</p>
        )}
      </div>

      {/* Two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Card A: Authorized Testing Windows */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>Authorized Testing Windows</span>
              <span style={{
                background: '#DCFCE7', color: '#16A34A', padding: '3px 10px',
                borderRadius: '999px', fontSize: '11px', fontWeight: 700,
              }}>WITHIN AUTHORIZED WINDOW</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: 'Mon–Fri', time: '22:00 — 05:00 UTC', allowed: true, note: 'Authorized' },
                { label: 'Weekends', time: '00:00 — 23:59 UTC', allowed: true, note: 'Authorized' },
                { label: 'Business Hours (09:00–18:00)', time: '❌ No Testing', allowed: false, note: '' },
              ].map((slot) => (
                <div key={slot.label} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 12px', borderRadius: '7px',
                  background: slot.allowed ? '#F0FDF4' : '#FEF2F2',
                  border: slot.allowed ? '1px solid #BBF7D0' : '1px solid #FCA5A5',
                }}>
                  {slot.allowed ? (
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16A34A', flexShrink: 0, display: 'inline-block' }} />
                  ) : (
                    <span style={{ fontSize: '13px' }}>❌</span>
                  )}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A', flex: 1 }}>{slot.label}</span>
                  <span style={{ fontSize: '13px', color: slot.allowed ? '#16A34A' : '#DC2626', fontWeight: 500 }}>{slot.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card B: Prohibited Techniques */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #FCA5A5', background: '#FEF2F2' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#DC2626' }}>Prohibited Techniques</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { name: 'Denial of Service (DoS/DDoS) attacks', reason: 'Risk of service disruption impacting production systems' },
                { name: 'Ransomware deployment or simulation', reason: 'Catastrophic data risk even in simulation mode' },
                { name: 'C-Level / Executive phishing without approval', reason: 'Requires White Team sign-off per campaign addendum' },
                { name: 'Physical facility access', reason: 'Outside engagement scope — requires separate authorization' },
                { name: 'Data exfiltration > 10MB without approval', reason: 'Exceeds agreed data handling limits' },
                { name: 'Third-party/partner systems outside scope', reason: 'No authorization for systems not listed in scope document' },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '10px', alignItems: 'flex-start',
                  padding: '9px 12px', borderRadius: '7px', background: '#FFF7F7',
                  border: '1px solid #FEE2E2',
                }}>
                  <span style={{ fontSize: '15px', flexShrink: 0, lineHeight: '1.3' }}>🚫</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>{item.name}</div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px', lineHeight: '1.4' }}>{item.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Card C: Crown Jewels */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>Crown Jewels / Target Objectives</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {objectives.map((obj, i) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                    padding: '9px 12px', borderRadius: '7px',
                    background: obj.done ? '#F0FDF4' : '#F8FAFC',
                    border: obj.done ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
                  }}>
                    <input
                      type="checkbox"
                      checked={obj.done}
                      onChange={() => {
                        const next = [...objectives]
                        next[i] = { ...next[i], done: !next[i].done }
                        setObjectives(next)
                      }}
                      style={{ width: '15px', height: '15px', accentColor: '#DC2626', flexShrink: 0 }}
                    />
                    <span style={{
                      fontSize: '13px',
                      color: obj.done ? '#16A34A' : '#0F172A',
                      fontWeight: obj.done ? 500 : 400,
                      textDecoration: obj.done ? 'line-through' : 'none',
                    }}>
                      {obj.label}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 600 }}>
                {achievedCount} / {objectives.length} Objectives Achieved
              </div>
              <div style={{ background: '#F1F5F9', borderRadius: '999px', height: '8px', overflow: 'hidden' }}>
                <div style={{
                  background: '#DC2626', width: `${progress}%`, height: '100%',
                  borderRadius: '999px', transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          </div>

          {/* Card D: Legal Authorization */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>Legal Authorization & Documentation</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Doc 1 */}
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <span style={{ fontSize: '18px', lineHeight: '1' }}>📄</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>Signed_ROE_Acme_Corp_2026.pdf</div>
                      <span style={{ fontSize: '12px', color: '#16A34A', fontWeight: 600 }}>✓ Signed</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button style={{
                      padding: '4px 10px', fontSize: '12px', borderRadius: '6px',
                      border: '1px solid #E2E8F0', background: '#FFFFFF',
                      color: '#475569', cursor: 'pointer', fontWeight: 500,
                    }}>Download</button>
                    <button
                      onClick={() => setShowHash(!showHash)}
                      style={{
                        padding: '4px 10px', fontSize: '12px', borderRadius: '6px',
                        border: '1px solid #E2E8F0', background: showHash ? '#EFF6FF' : '#FFFFFF',
                        color: showHash ? '#2563EB' : '#475569', cursor: 'pointer', fontWeight: 500,
                      }}
                    >
                      View Hash
                    </button>
                  </div>
                </div>
                {showHash && (
                  <div style={{
                    marginTop: '10px', padding: '8px 10px', background: '#0F172A',
                    borderRadius: '6px', fontFamily: 'monospace', fontSize: '11px',
                    color: '#94A3B8', wordBreak: 'break-all', lineHeight: '1.6',
                  }}>
                    <span style={{ color: '#64748B', marginRight: '6px' }}>SHA256:</span>
                    <span style={{ color: '#22D3EE' }}>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</span>
                  </div>
                )}
              </div>

              {/* Doc 2 */}
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', lineHeight: '1' }}>📄</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>NDA_Raptix_Acme_2026.pdf</div>
                    <span style={{ fontSize: '12px', color: '#16A34A', fontWeight: 600 }}>✓ Signed</span>
                  </div>
                </div>
              </div>

              {/* Doc 3 */}
              <div style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #FDE68A', background: '#FFFBEB' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px', lineHeight: '1' }}>📄</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>Scope_Addendum_v2.pdf</div>
                    <span style={{ fontSize: '12px', color: '#D97706', fontWeight: 600 }}>⏳ Pending signature</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
