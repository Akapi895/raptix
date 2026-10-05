import { useState, useEffect } from 'react'
import type { Project } from '../types'

export default function VectorCampaigns({ project }: { project: Project }) {
  const [selectedVector, setSelectedVector] = useState<'phishing' | 'web' | 'mobile'>('phishing')
  const [campaignGenerated, setCampaignGenerated] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sophistication, setSophistication] = useState<'basic' | 'advanced' | 'nation-state'>('advanced')
  const [employeeCount, setEmployeeCount] = useState(2400)
  const [lureTypes, setLureTypes] = useState<Set<string>>(new Set(['email-attachment', 'credential-harvest']))
  const [domainSpoofing, setDomainSpoofing] = useState(true)
  const [trackingPixels, setTrackingPixels] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [toastCounter, setToastCounter] = useState(0)
  const [scenario, setScenario] = useState('it-security-alert')

  void project

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500)
      return () => clearTimeout(t)
    }
  }, [toast])

  useEffect(() => {
    if (!generating) return
    const t = setTimeout(() => {
      setGenerating(false)
      setCampaignGenerated(true)
    }, 1200)
    return () => clearTimeout(t)
  }, [generating])

  function handleGenerate() {
    if (generating) return
    setGenerating(true)
  }

  function handleEditDraft() {
    const next = toastCounter + 1
    setToastCounter(next)
    setToast('Demo only: draft editing is not available in this preview')
  }

  function handleDeploy() {
    const next = toastCounter + 1
    setToastCounter(next)
    setToast('Demo only: campaign wave simulated locally, no delivery backend')
  }

  function toggleLure(key: string) {
    setLureTypes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handlePushToC2(index: number) {
    const next = toastCounter + 1
    setToastCounter(next)
    setToast(`Session SID-00${index + 1} pushed to C2 & Sessions`)
  }

  const credentials = [
    { email: 'john.doe@acme-corp.com', domain: 'acme-corp.com', type: 'NTLM Hash', time: '08:14', status: 'Verified' },
    { email: 'sarah.miller@acme-corp.com', domain: 'acme-corp.com', type: 'Cleartext', time: '08:22', status: 'Verified' },
    { email: 'it.admin@acme-corp.com', domain: 'acme-corp.com', type: 'Kerberos TGT', time: '09:01', status: 'Unverified' },
    { email: 'p.nguyen@acme-corp.com', domain: 'acme-corp.com', type: 'NTLM Hash', time: '09:47', status: 'Verified' },
    { email: 'finance@acme-corp.com', domain: 'acme-corp.com', type: 'Cleartext', time: '17:33', status: 'Expired' },
  ]

  const funnelStages = [
    { label: 'Targets', count: 247, pct: 100, topW: 100, botW: 88 },
    { label: 'Emails Opened', count: 89, pct: 36, topW: 88, botW: 70 },
    { label: 'Links Clicked', count: 34, pct: 14, topW: 70, botW: 52 },
    { label: 'Payload Executed', count: 12, pct: 5, topW: 52, botW: 36 },
    { label: 'Creds Harvested', count: 12, pct: 5, topW: 36, botW: 28 },
  ]

  function statusBadge(s: string) {
    if (s === 'Verified') return { bg: '#DCFCE7', color: '#16A34A' }
    if (s === 'Unverified') return { bg: '#FEF3C7', color: '#D97706' }
    return { bg: '#F1F5F9', color: '#64748B' }
  }

  const vectors = [
    {
      key: 'phishing' as const,
      title: 'Social / Phishing',
      stats: ['3 Campaigns Active', '247 Targets', 'Foothold Rate: 16.0%'],
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polyline points="2,4 12,13 22,4" />
        </svg>
      ),
    },
    {
      key: 'web' as const,
      title: 'Web & API Exploit',
      stats: ['14 Endpoints Mapped', '3 Critical CVEs', '1 Campaign Active'],
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      key: 'mobile' as const,
      title: 'Mobile App Lab',
      stats: ['2 APKs Analyzed', '5 API Keys Leaked', '0 Active Sessions'],
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3" />
        </svg>
      ),
    },
  ]

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100%', padding: '24px', boxSizing: 'border-box', position: 'relative' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
          background: '#16A34A', color: '#fff', padding: '12px 20px',
          borderRadius: '8px', fontSize: '14px', fontWeight: 500,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          {toast}
        </div>
      )}

      {/* Vector Hub Selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        {vectors.map(v => {
          const active = selectedVector === v.key
          return (
            <button
              key={v.key}
              onClick={() => setSelectedVector(v.key)}
              style={{
                background: active ? '#FEF2F2' : '#FFFFFF',
                border: active ? '1px solid #DC2626' : '1px solid #E2E8F0',
                borderLeft: active ? '3px solid #DC2626' : '3px solid transparent',
                borderRadius: '8px', padding: '16px', textAlign: 'left', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ color: active ? '#DC2626' : '#475569' }}>{v.icon}</span>
                <span style={{ fontWeight: 600, fontSize: '15px', color: active ? '#DC2626' : '#0F172A' }}>{v.title}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {v.stats.map(s => (
                  <span key={s} style={{ fontSize: '12px', color: '#475569' }}>{s}</span>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '55% 45%', gap: '20px', alignItems: 'start' }}>

        {/* LEFT: AI Campaign Architect */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>AI Campaign Architect</h2>

          {/* Section A: Target Configuration */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Target Configuration</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '6px' }}>Target Domain</label>
              <input
                defaultValue="acme-corp.com"
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: '6px',
                  fontFamily: '"JetBrains Mono", "Fira Mono", monospace', fontSize: '13px', color: '#0F172A',
                  background: '#F8FAFC', boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '6px' }}>
                <span>Employee Count</span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', color: '#DC2626' }}>{employeeCount.toLocaleString()} employees</span>
              </label>
              <input
                type="range" min={100} max={5000} value={employeeCount}
                onChange={e => setEmployeeCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#DC2626' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '8px' }}>Sophistication Level</label>
              <div style={{ display: 'flex', gap: '20px' }}>
                {(['basic', 'advanced', 'nation-state'] as const).map(s => (
                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: sophistication === s ? '#DC2626' : '#475569', fontWeight: sophistication === s ? 600 : 400 }}>
                    <input
                      type="radio" name="sophistication" value={s} checked={sophistication === s}
                      onChange={() => setSophistication(s)}
                      style={{ accentColor: '#DC2626' }}
                    />
                    {s === 'nation-state' ? 'Nation-State' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '6px' }}>Scenario</label>
              <select
                value={scenario}
                onChange={e => setScenario(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: '6px',
                  fontSize: '13px', color: '#0F172A', background: '#F8FAFC', outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="it-security-alert">IT Security Alert</option>
                <option value="payroll-update">Payroll Update</option>
                <option value="executive-bec">Executive Request (BEC)</option>
                <option value="mfa-bypass">MFA Bypass</option>
              </select>
            </div>
          </div>

          {/* Section B: Payload & Delivery */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Payload & Delivery</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '8px' }}>Lure Type</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {[
                  { key: 'email-attachment', label: 'Email Attachment' },
                  { key: 'credential-harvest', label: 'Credential Harvest Page' },
                  { key: 'mfa-phishing', label: 'MFA Phishing' },
                  { key: 'qr-code', label: 'QR Code' },
                ].map(l => {
                  const active = lureTypes.has(l.key)
                  return (
                    <button
                      key={l.key}
                      onClick={() => toggleLure(l.key)}
                      style={{
                        padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500,
                        border: active ? '1px solid #DC2626' : '1px solid #E2E8F0',
                        background: active ? '#FEF2F2' : '#F8FAFC',
                        color: active ? '#DC2626' : '#475569', cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >
                      {active ? '✓ ' : ''}{l.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A' }}>Domain Spoofing</label>
                <button
                  onClick={() => setDomainSpoofing(p => !p)}
                  style={{
                    width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer',
                    background: domainSpoofing ? '#DC2626' : '#CBD5E1', position: 'relative', transition: 'background 0.2s', padding: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: '3px', left: domainSpoofing ? '21px' : '3px',
                    width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block',
                  }} />
                </button>
              </div>
              {domainSpoofing && (
                <input
                  defaultValue="acme-corp-security.com"
                  style={{
                    width: '100%', padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: '6px',
                    fontFamily: '"JetBrains Mono", monospace', fontSize: '12px', color: '#0F172A',
                    background: '#F8FAFC', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A' }}>Tracking Pixels</label>
              <button
                onClick={() => setTrackingPixels(p => !p)}
                style={{
                  width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer',
                  background: trackingPixels ? '#DC2626' : '#CBD5E1', position: 'relative', transition: 'background 0.2s', padding: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: '3px', left: trackingPixels ? '21px' : '3px',
                  width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              width: '100%', padding: '12px', background: generating ? '#94A3B8' : '#DC2626',
              border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 600, fontSize: '14px',
              cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '8px', transition: 'background 0.15s',
            }}
          >
            {generating ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'vc-spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Generate Campaign Wave
              </>
            )}
          </button>

          {/* Section C: Campaign Preview */}
          {campaignGenerated && (
            <div style={{
              background: '#FFFFFF', border: '2px dashed #DC2626', borderRadius: '8px', padding: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>Campaign Preview</h3>
                <span style={{ background: '#DCFCE7', color: '#16A34A', fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '12px' }}>AI Generated</span>
              </div>

              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '14px', marginBottom: '14px' }}>
                <div style={{ marginBottom: '6px', fontSize: '12px' }}>
                  <span style={{ color: '#94A3B8' }}>From: </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: '#0F172A' }}>security-ops@acme-corp-security.com</span>
                </div>
                <div style={{ marginBottom: '10px', fontSize: '12px' }}>
                  <span style={{ color: '#94A3B8' }}>Subject: </span>
                  <span style={{ color: '#0F172A', fontWeight: 500 }}>⚠️ Action Required: Verify Your Identity to Maintain Access</span>
                </div>
                <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.65', borderTop: '1px solid #E2E8F0', paddingTop: '10px' }}>
                  Dear Team Member,<br />
                  Our security systems have detected unusual sign-in activity on your account. To prevent unauthorized access and maintain your access privileges, you must verify your identity within the next 24 hours.<br />
                  Failure to verify will result in temporary account suspension per our security policy.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleEditDraft} style={{
                  flex: 1, padding: '8px', background: '#F1F5F9', border: '1px solid #E2E8F0',
                  borderRadius: '6px', fontSize: '13px', fontWeight: 500, color: '#475569', cursor: 'pointer',
                }}>
                  Edit Draft
                </button>
                <button onClick={handleDeploy} style={{
                  flex: 2, padding: '8px', background: '#DC2626', border: 'none',
                  borderRadius: '6px', fontSize: '13px', fontWeight: 600, color: '#fff', cursor: 'pointer',
                }}>
                  Deploy Campaign Wave
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Live Infiltration Radar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>Live Infiltration Radar</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', background: '#16A34A',
                display: 'inline-block', animation: 'vc-pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#16A34A' }}>LIVE</span>
            </div>
          </div>

          {/* Funnel */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px' }}>
            <svg viewBox="0 0 300 220" width="100%" style={{ display: 'block' }}>
              {funnelStages.map((stage, i) => {
                const stageH = 36
                const gap = 3
                const y = i * (stageH + gap)
                const totalW = 260
                const topOff = ((100 - stage.topW) / 2) * (totalW / 100)
                const botOff = ((100 - stage.botW) / 2) * (totalW / 100)
                const topLeft = topOff
                const topRight = totalW - topOff
                const botLeft = botOff
                const botRight = totalW - botOff
                const opacity = 1 - i * 0.14

                return (
                  <g key={stage.label}>
                    <polygon
                      points={`${topLeft},${y} ${topRight},${y} ${botRight},${y + stageH} ${botLeft},${y + stageH}`}
                      fill={`rgba(220,38,38,${opacity})`}
                    />
                    <text
                      x={topLeft + (topRight - topLeft) / 2}
                      y={y + stageH / 2 + 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize="11"
                      fontWeight="600"
                      fontFamily="system-ui, sans-serif"
                    >
                      {stage.label}
                    </text>
                    <text
                      x={totalW + 8}
                      y={y + stageH / 2 + 5}
                      fill="#0F172A"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="system-ui, sans-serif"
                    >
                      {stage.count}
                    </text>
                    <text
                      x={totalW + 34}
                      y={y + stageH / 2 + 5}
                      fill="#94A3B8"
                      fontSize="10"
                      fontFamily="system-ui, sans-serif"
                    >
                      ({stage.pct}%)
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Harvested Credentials table */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}>
              <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>Harvested Credentials</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {['Target Email', 'Type', 'Time', 'Status', ''].map((h, hi) => (
                      <th key={hi} style={{ padding: '7px 10px', textAlign: 'left', color: '#94A3B8', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((c, i) => {
                    const badge = statusBadge(c.status)
                    return (
                      <tr key={i} style={{ borderBottom: i < credentials.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        <td style={{ padding: '8px 10px', fontFamily: '"JetBrains Mono", monospace', color: '#0F172A', fontSize: '11px' }}>{c.email}</td>
                        <td style={{ padding: '8px 10px', fontFamily: '"JetBrains Mono", monospace', color: '#475569', fontSize: '11px', whiteSpace: 'nowrap' }}>{c.type}</td>
                        <td style={{ padding: '8px 10px', color: '#94A3B8', whiteSpace: 'nowrap', fontSize: '12px' }}>{c.time}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: badge.bg, color: badge.color, fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', whiteSpace: 'nowrap' }}>{c.status}</span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <button
                            onClick={() => handlePushToC2(i)}
                            style={{
                              padding: '4px 9px', border: '1px solid #DC2626', borderRadius: '5px',
                              background: 'transparent', color: '#DC2626', fontSize: '11px', fontWeight: 600,
                              cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Push to C2
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Terminal hit log */}
          <div style={{
            background: '#0B0F19', borderRadius: '8px', padding: '16px',
            fontFamily: '"JetBrains Mono", "Fira Mono", monospace', fontSize: '12px',
            lineHeight: '1.8', border: '1px solid #1E293B',
          }}>
            <div style={{ color: '#475569', fontSize: '11px', marginBottom: '8px', letterSpacing: '0.05em' }}>{'// HIT LOG'}</div>
            <div style={{ color: '#4ADE80' }}>[08:14:03] HIT: john.doe@acme-corp.com → NTLM captured</div>
            <div style={{ color: '#4ADE80' }}>[08:22:17] HIT: sarah.miller@acme-corp.com → Cleartext</div>
            <div style={{ color: '#4ADE80' }}>[09:01:44] HIT: it.admin@acme-corp.com → Kerberos TGT</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vc-spin { to { transform: rotate(360deg); } }
        @keyframes vc-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.35); }
        }
      `}</style>
    </div>
  )
}
