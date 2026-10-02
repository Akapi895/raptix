import { useState } from 'react'
import type { Project } from '../types'
import {
  FileTextIcon,
  DownloadIcon,
  PlusIcon,
  SearchIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  XIcon,
  CheckIcon,
  EditIcon,
  BotIcon,
  ZapIcon,
  ShieldIcon,
  AlertTriangleIcon,
  ExternalLinkIcon,
  EyeIcon,
  ClockIcon,
  UserIcon,
  UploadIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

interface Report {
  id: string
  title: string
  type: 'Full Technical' | 'Executive Summary' | 'Remediation Playbook' | 'Attestation Certificate'
  status: 'Draft' | 'In Review' | 'Approved' | 'Delivered'
  framework: string
  author: string
  modified: string
  pages: number
  words: number
  fileType: 'PDF' | 'DOCX'
}

const REPORTS: Report[] = [
  { id: 'r1', title: 'Acme Corp External Assessment — Full Technical Report', type: 'Full Technical', status: 'In Review', framework: 'NIST 800-115', author: 'Alex Kim', modified: '2026-09-28', pages: 84, words: 32400, fileType: 'PDF' },
  { id: 'r2', title: 'Acme Corp External Assessment — Executive Summary', type: 'Executive Summary', status: 'Draft', framework: 'OWASP Top 10', author: 'AI Engine', modified: '2026-09-27', pages: 8, words: 3100, fileType: 'DOCX' },
  { id: 'r3', title: 'AD Lateral Movement — Remediation Playbook', type: 'Remediation Playbook', framework: 'MITRE ATT&CK', status: 'Approved', author: 'Sarah Rowe', modified: '2026-09-25', pages: 22, words: 8900, fileType: 'DOCX' },
  { id: 'r4', title: 'Penetration Test Attestation Letter — ISO 27001', type: 'Attestation Certificate', status: 'Delivered', framework: 'ISO 27001', author: 'Alex Kim', modified: '2026-09-20', pages: 3, words: 980, fileType: 'PDF' },
]

const TOC = [
  { id: 0, num: '1', title: 'Executive Summary', sub: ['Scope Overview', 'Crown Jewels Impact', 'Risk Score'] },
  { id: 1, num: '2', title: 'Engagement Methodology', sub: ['Rules of Engagement', 'Testing Window'] },
  { id: 2, num: '3', title: 'Attack Narrative', sub: ['Phase 1: Initial Foothold', 'Phase 2: Lateral Movement', 'Phase 3: Objectives'] },
  { id: 3, num: '4', title: 'Findings Matrix', sub: ['Critical Findings', 'High Findings', 'Risk Summary'] },
  { id: 4, num: '5', title: 'Remediation Roadmap', sub: ['Priority Actions', 'Effort-Impact Matrix'] },
]

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(author: string) {
  if (author === 'Alex Kim') return '#DC2626'
  if (author === 'AI Engine') return '#7C3AED'
  if (author === 'Sarah Rowe') return '#2563EB'
  return '#475569'
}

function getTypeStyle(type: Report['type']) {
  switch (type) {
    case 'Full Technical': return { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD' }
    case 'Executive Summary': return { bg: '#FAF5FF', color: '#7C3AED', border: '#E9D5FF' }
    case 'Remediation Playbook': return { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' }
    case 'Attestation Certificate': return { bg: '#F0FDF4', color: '#15803D', border: '#86EFAC' }
  }
}

function getStatusStyle(status: Report['status']) {
  switch (status) {
    case 'Draft': return { bg: '#F1F5F9', color: '#475569' }
    case 'In Review': return { bg: '#FFFBEB', color: '#D97706' }
    case 'Approved': return { bg: '#F0FDF4', color: '#16A34A' }
    case 'Delivered': return { bg: '#EFF6FF', color: '#2563EB' }
  }
}

export default function Reports({ project }: Props) {
  const [view, setView] = useState<'table' | 'studio'>('table')
  const [activeTab, setActiveTab] = useState<'all' | 'technical' | 'executive' | 'attestation'>('all')
  const [search, setSearch] = useState('')
  const [studioDoc, setStudioDoc] = useState<Report | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState(0)
  const [aiInput, setAiInput] = useState('')
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const filteredReports = REPORTS.filter(r => {
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'technical' && r.type === 'Full Technical') ||
      (activeTab === 'executive' && r.type === 'Executive Summary') ||
      (activeTab === 'attestation' && r.type === 'Attestation Certificate')
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.author.toLowerCase().includes(search.toLowerCase()) ||
      r.framework.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  function sendAiMessage() {
    if (!aiInput.trim()) return
    const userMsg = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setTimeout(() => {
      let response = 'I\'ve analyzed the document and here is my assessment: The section you\'re referring to contains critical security findings that should be prioritized based on CVSS scores and exploitability. Would you like me to elaborate on any specific finding or suggest remediation steps?'
      const lower = userMsg.toLowerCase()
      if (lower.includes('summar') || lower.includes('execut')) {
        response = 'Executive Summary draft: The engagement identified 2 critical, 3 high, 4 medium, and 2 low-severity vulnerabilities. The most critical finding — unauthenticated RCE on AdminLite v2.3.1 — allowed immediate foothold and lateral movement. Immediate remediation of CVE-2024-49113 is recommended.'
      } else if (lower.includes('mitre') || lower.includes('att&ck')) {
        response = 'MITRE ATT&CK cross-reference complete. Identified TTPs: T1190 (Exploit Public-Facing Application), T1557.001 (LLMNR/NBT-NS Poisoning), T1078 (Valid Accounts), T1003.003 (NTDS). All mapped to Initial Access, Credential Access, and Lateral Movement tactics.'
      } else if (lower.includes('formal') || lower.includes('tone')) {
        response = 'Tone formalized. The section has been revised to use professional, passive-voice constructions appropriate for executive and legal audiences. Jargon has been replaced with industry-standard terminology.'
      }
      setAiMessages(prev => [...prev, { role: 'ai', text: response }])
    }, 1000)
  }

  if (view === 'studio' && studioDoc) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F8FAFC' }}>
        {/* Studio Topbar */}
        <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setView('table')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ← Back to Reports
            </button>
            <span style={{ color: '#E2E8F0' }}>|</span>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{studioDoc.title}</span>
            <span style={{ ...getStatusStyle(studioDoc.status), padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
              {studioDoc.status}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#0F172A' }}
              onClick={() => showToast('Document sent for signing…')}
            >
              Sign &amp; Finalize
            </button>
            <button
              onClick={() => showToast('Preparing PDF export…')}
              style={{ background: '#DC2626', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#FFFFFF', fontWeight: 600 }}
            >
              Export PDF
            </button>
            <button
              onClick={() => showToast('Preparing DOCX export…')}
              style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#0F172A' }}
            >
              Export DOCX
            </button>
          </div>
        </div>

        {/* Three-column layout */}
        <div style={{ display: 'flex', flex: 1, height: 'calc(100% - 48px)', overflow: 'hidden' }}>

          {/* LEFT: TOC */}
          <div style={{ width: 240, borderRight: '1px solid #E2E8F0', background: '#FFFFFF', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ padding: '16px 16px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8' }}>
              Table of Contents
            </div>
            {TOC.map(section => (
              <div key={section.id}>
                <button
                  onClick={() => setActiveSection(section.id)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '10px 16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                    borderLeft: activeSection === section.id ? '3px solid #DC2626' : '3px solid transparent',
                    color: activeSection === section.id ? '#DC2626' : '#0F172A',
                    fontSize: 13, fontWeight: activeSection === section.id ? 600 : 400,
                  }}
                >
                  <span style={{ fontSize: 11, color: '#94A3B8', minWidth: 16 }}>{section.num}.</span>
                  {section.title}
                </button>
                {section.sub.map(sub => (
                  <div key={sub} style={{ padding: '3px 16px 3px 36px', fontSize: 11, color: '#94A3B8' }}>
                    {sub}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ padding: '12px 16px' }}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <PlusIcon size={12} /> Add Custom Section
              </button>
            </div>
          </div>

          {/* CENTER: Document Canvas */}
          <div style={{ flex: 1, minWidth: 420, background: '#F8FAFC', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {/* Formatting Toolbar */}
            <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', padding: '8px 16px', display: 'flex', gap: 6, position: 'sticky', top: 0, zIndex: 10 }}>
              {['H1', 'H2', 'Bold', 'Code', 'Table', 'Insert Map'].map(btn => (
                <button
                  key={btn}
                  style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#475569' }}
                >
                  {btn}
                </button>
              ))}
            </div>

            {/* Document */}
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 64px', width: '100%' }}>
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '48px 56px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

                {/* Document Header */}
                <div style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 32, height: 32, background: '#DC2626', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ShieldIcon size={18} color="#FFFFFF" />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#94A3B8', textTransform: 'uppercase' }}>RAPTIX AI RED TEAM</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>{studioDoc.title}</div>
                  <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>{project.name} &nbsp;·&nbsp; September 28, 2026</div>
                  <span style={{ background: '#FFFBEB', border: '1px solid #FCD34D', color: '#B45309', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                    CONFIDENTIAL // TLP:AMBER
                  </span>
                  <hr style={{ marginTop: 20, borderColor: '#E2E8F0' }} />
                </div>

                {/* Section Content */}
                {activeSection === 0 && (
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>1. Executive Summary</h2>
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, marginBottom: 20 }}>
                      This report presents the findings of a comprehensive external penetration test conducted against Acme Corporation's internet-facing infrastructure between September 10–28, 2026.
                    </p>

                    {/* Risk Score Card */}
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Overall Risk Score</div>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>CRITICAL</div>
                      <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>CVSS Max: <strong>9.8</strong></div>
                    </div>

                    {/* Findings Table */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          <th style={{ padding: '10px 14px', textAlign: 'left', color: '#475569', fontWeight: 600, border: '1px solid #E2E8F0' }}>Severity</th>
                          <th style={{ padding: '10px 14px', textAlign: 'left', color: '#475569', fontWeight: 600, border: '1px solid #E2E8F0' }}>Count</th>
                          <th style={{ padding: '10px 14px', textAlign: 'left', color: '#475569', fontWeight: 600, border: '1px solid #E2E8F0' }}>% Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { sev: 'Critical', count: 2, pct: '18%', color: '#DC2626' },
                          { sev: 'High', count: 3, pct: '27%', color: '#D97706' },
                          { sev: 'Medium', count: 4, pct: '36%', color: '#CA8A04' },
                          { sev: 'Low', count: 2, pct: '18%', color: '#16A34A' },
                        ].map(row => (
                          <tr key={row.sev}>
                            <td style={{ padding: '8px 14px', border: '1px solid #E2E8F0', color: row.color, fontWeight: 600 }}>{row.sev}</td>
                            <td style={{ padding: '8px 14px', border: '1px solid #E2E8F0', color: '#0F172A' }}>{row.count}</td>
                            <td style={{ padding: '8px 14px', border: '1px solid #E2E8F0', color: '#475569' }}>{row.pct}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 6, padding: '12px 16px', fontSize: 13, color: '#15803D' }}>
                      <strong>Crown Jewels Impact:</strong> 1 of 5 crown jewel objectives achieved during this engagement.
                    </div>
                  </div>
                )}

                {activeSection === 1 && (
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>2. Engagement Methodology</h2>
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, marginBottom: 16 }}>
                      The engagement followed a black-box external penetration testing methodology aligned to NIST SP 800-115 and PTES (Penetration Testing Execution Standard). All activities were conducted from external IP ranges without prior knowledge of the internal environment.
                    </p>
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '16px 20px', fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
                      <strong style={{ color: '#0F172A' }}>Rules of Engagement:</strong> Active exploitation permitted against in-scope targets. DoS techniques prohibited. HITL approval required for domain controller attacks.<br />
                      <strong style={{ color: '#0F172A', marginTop: 8, display: 'block' }}>Testing Window:</strong> September 10–28, 2026 (weekdays, 08:00–22:00 EST)
                    </div>
                  </div>
                )}

                {activeSection === 2 && (
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>3. Attack Narrative</h2>

                    {/* Phase 1 */}
                    <div style={{ borderLeft: '3px solid #16A34A', paddingLeft: 16, marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#F0FDF4', color: '#16A34A', padding: '2px 8px', borderRadius: 4 }}>COMPLETED</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Phase 1: Initial Foothold</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, margin: 0 }}>
                        Initial foothold established via unauthenticated RCE on AdminLite v2.3.1 (CVE-2024-49113). Reverse shell obtained as <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>www-data</code> on <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>WEB-01 (10.10.1.10)</code>.
                      </p>
                    </div>

                    {/* Phase 2 */}
                    <div style={{ borderLeft: '3px solid #DC2626', paddingLeft: 16, marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#FEF2F2', color: '#DC2626', padding: '2px 8px', borderRadius: 4 }}>IN PROGRESS</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Phase 2: Lateral Movement</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, margin: 0 }}>
                        Lateral movement achieved via SMB relay from <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>WEB-01</code> to <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>DEV-WS-01</code>. Credentials for <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>jdavis</code> (local admin) captured via Responder.
                      </p>
                    </div>

                    {/* Phase 3 */}
                    <div style={{ borderLeft: '3px solid #E2E8F0', paddingLeft: 16, marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#F1F5F9', color: '#94A3B8', padding: '2px 8px', borderRadius: 4 }}>PENDING</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Phase 3: Objectives</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, margin: 0 }}>
                        NTDS.dit dump pending HITL approval on <code style={{ fontFamily: "'JetBrains Mono', monospace", background: '#F1F5F9', padding: '1px 5px', borderRadius: 3 }}>DC-01 (10.10.14.67)</code>.
                      </p>
                    </div>

                    {/* Code block */}
                    <div style={{ background: '#0B0F19', borderRadius: 8, padding: '20px 24px', overflowX: 'auto' }}>
                      <pre style={{ margin: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#E2E8F0', lineHeight: 1.6 }}>{`$ secretsdump.py jdavis:Password123@10.10.14.67
[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)
Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
svc_backup:1103:aad3b435b51404eeaad3b435b51404ee:e4c3b5d8a9f7234e12bc3a5d789ea041:::`}</pre>
                    </div>
                  </div>
                )}

                {activeSection === 3 && (
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>4. Findings Matrix</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          {['ID', 'Severity', 'Title', 'CVSS', 'Asset', 'Status'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#475569', fontWeight: 600, border: '1px solid #E2E8F0', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { id: 'F-001', sev: 'Critical', title: 'Unauthenticated RCE — AdminLite', cvss: '9.8', asset: 'WEB-01', status: 'Open', color: '#DC2626' },
                          { id: 'F-002', sev: 'Critical', title: 'NTLM Relay → Domain Admin', cvss: '9.1', asset: 'CORP-NET', status: 'In Progress', color: '#DC2626' },
                          { id: 'F-003', sev: 'High', title: 'SMB Signing Disabled', cvss: '7.5', asset: 'All Hosts', status: 'Open', color: '#D97706' },
                        ].map(row => (
                          <tr key={row.id}>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#475569' }}>{row.id}</td>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', color: row.color, fontWeight: 700 }}>{row.sev}</td>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', color: '#0F172A' }}>{row.title}</td>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', fontFamily: "'JetBrains Mono', monospace", color: row.color, fontWeight: 700 }}>{row.cvss}</td>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#475569' }}>{row.asset}</td>
                            <td style={{ padding: '8px 12px', border: '1px solid #E2E8F0', color: '#475569' }}>{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeSection === 4 && (
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>5. Remediation Roadmap</h2>
                    <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, marginBottom: 16 }}>
                      The following priority actions are recommended based on exploitability and business impact. Each item includes estimated effort and risk reduction.
                    </p>
                    {[
                      { priority: '1', action: 'Patch AdminLite to v2.4.0 or later (CVE-2024-49113)', effort: 'Low', impact: 'Critical' },
                      { priority: '2', action: 'Enable SMB Signing on all domain-joined hosts via GPO', effort: 'Low', impact: 'High' },
                      { priority: '3', action: 'Segment WEB-01 from internal corporate network', effort: 'Medium', impact: 'Critical' },
                    ].map(item => (
                      <div key={item.priority} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #F1F5F9', alignItems: 'flex-start' }}>
                        <span style={{ minWidth: 24, height: 24, background: '#DC2626', color: '#FFFFFF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{item.priority}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500, marginBottom: 4 }}>{item.action}</div>
                          <div style={{ fontSize: 11, color: '#94A3B8' }}>Effort: <strong style={{ color: '#475569' }}>{item.effort}</strong> &nbsp;·&nbsp; Risk Impact: <strong style={{ color: '#475569' }}>{item.impact}</strong></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* RIGHT: AI Co-pilot */}
          <div style={{ width: 300, borderLeft: '1px solid #E2E8F0', background: '#FFFFFF', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {/* Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BotIcon size={16} color="#DC2626" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>AI Report Co-pilot</span>
            </div>

            {/* Quick Actions */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: '⚡ Summarize for Executives', response: 'Executive Summary draft: The engagement identified 2 critical, 3 high, 4 medium, and 2 low-severity vulnerabilities. Immediate remediation of CVE-2024-49113 is strongly recommended.' },
                { label: '🛡 Cross-reference MITRE ATT&CK', response: 'MITRE ATT&CK mapping complete: T1190, T1557.001, T1078, T1003.003 identified across Initial Access, Credential Access, and Lateral Movement tactics.' },
                { label: '📝 Formalize tone', response: 'Tone revised to professional passive-voice suitable for executive and legal audiences. Technical jargon replaced with industry-standard terminology.' },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => {
                    setAiMessages(prev => [...prev, { role: 'user', text: action.label }, { role: 'ai', text: action.response }])
                  }}
                  style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#0F172A', textAlign: 'left' }}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Chat Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {aiMessages.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>
                  Ask the AI Co-pilot about this document…
                </div>
              ) : (
                aiMessages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '85%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      lineHeight: 1.5,
                      background: msg.role === 'user' ? '#DC2626' : '#F8FAFC',
                      color: msg.role === 'user' ? '#FFFFFF' : '#0F172A',
                      border: msg.role === 'ai' ? '1px solid #E2E8F0' : 'none',
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8 }}>
              <textarea
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage() } }}
                rows={2}
                placeholder="Ask about the report…"
                style={{
                  flex: 1, resize: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 10px',
                  fontSize: 12, color: '#0F172A', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button
                onClick={sendAiMessage}
                style={{ background: '#DC2626', border: 'none', borderRadius: 6, width: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <ChevronRightIcon size={16} color="#FFFFFF" />
              </button>
            </div>

            {/* Sign & Finalize */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0' }}>
              <button
                onClick={() => showToast('Document signed and finalized — SHA-256 hash recorded')}
                style={{ width: '100%', background: '#DC2626', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 13, color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}
              >
                ✍ Sign &amp; Finalize Document
              </button>
            </div>
          </div>

        </div>

        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', top: 24, right: 24, background: '#16A34A', color: '#FFFFFF', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            {toast}
          </div>
        )}
      </div>
    )
  }

  // VIEW 1: DELIVERABLES TABLE
  return (
    <div style={{ padding: 24, background: '#F8FAFC', minHeight: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Reports &amp; Deliverables</div>
          <div style={{ fontSize: 13, color: '#475569' }}>Compile, edit, and deliver assessment reports for {project.name}.</div>
        </div>
        <button
          onClick={() => showToast('AI report compilation started…')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#DC2626', border: 'none', borderRadius: 7, padding: '9px 16px', fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer', flexShrink: 0 }}
        >
          <PlusIcon size={15} color="#FFFFFF" /> Compile Report with AI
        </button>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([
          { key: 'all', label: 'All Deliverables (4)' },
          { key: 'technical', label: 'Technical Reports' },
          { key: 'executive', label: 'Executive Summaries' },
          { key: 'attestation', label: 'Attestation Letters' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '7px 14px',
              borderRadius: 20,
              border: activeTab === tab.key ? 'none' : '1px solid #E2E8F0',
              background: activeTab === tab.key ? '#DC2626' : '#FFFFFF',
              color: activeTab === tab.key ? '#FFFFFF' : '#475569',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
        <SearchIcon size={14} color="#94A3B8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reports…"
          style={{
            width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
            border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 13, color: '#0F172A',
            background: '#FFFFFF', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, overflowX: 'auto' }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 160px 130px 150px 140px 110px 220px',
          minWidth: 1160,
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          padding: '10px 20px',
          gap: 8,
        }}>
          {['DOCUMENT', 'TYPE', 'STATUS', 'FRAMEWORK', 'AUTHOR', 'MODIFIED', 'ACTIONS'].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {filteredReports.map((report, idx) => {
          const typeStyle = getTypeStyle(report.type)
          const statusStyle = getStatusStyle(report.status)
          const avatarColor = getAvatarColor(report.author)
          const initials = report.author === 'AI Engine' ? 'AI' : getInitials(report.author)

          return (
            <div
              key={report.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 160px 130px 150px 140px 110px 220px',
                minWidth: 1160,
                padding: '14px 20px',
                borderBottom: idx < filteredReports.length - 1 ? '1px solid #E2E8F0' : 'none',
                gap: 8,
                alignItems: 'center',
                cursor: 'default',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* DOCUMENT */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                    background: report.fileType === 'PDF' ? '#FEE2E2' : '#EFF6FF',
                    color: report.fileType === 'PDF' ? '#DC2626' : '#2563EB',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {report.fileType}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#0F172A' }}>{report.title}</span>
                </div>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#94A3B8' }}>
                  {report.pages} pages · {report.words.toLocaleString()} words
                </div>
              </div>

              {/* TYPE */}
              <div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                  background: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}`,
                }}>
                  {report.type}
                </span>
              </div>

              {/* STATUS */}
              <div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                  background: statusStyle.bg, color: statusStyle.color,
                }}>
                  {report.status}
                </span>
              </div>

              {/* FRAMEWORK */}
              <div>
                <span style={{
                  fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#475569',
                  background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 4,
                  padding: '2px 7px',
                }}>
                  {report.framework}
                </span>
              </div>

              {/* AUTHOR */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: avatarColor,
                  color: '#FFFFFF', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {initials}
                </div>
                <span style={{ fontSize: 12, color: '#0F172A' }}>{report.author}</span>
              </div>

              {/* MODIFIED */}
              <div style={{ fontSize: 12, color: '#94A3B8' }}>{report.modified}</div>

              {/* ACTIONS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => { setStudioDoc(report); setView('studio') }}
                  style={{
                    background: 'none', border: '1px solid #DC2626', borderRadius: 5,
                    padding: '5px 10px', fontSize: 11, color: '#DC2626', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
                  }}
                >
                  Open Studio
                </button>
                <button
                  onClick={() => showToast('Preparing PDF export…')}
                  style={{
                    background: 'none', border: '1px solid #E2E8F0', borderRadius: 5,
                    padding: '5px 10px', fontSize: 11, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <DownloadIcon size={11} /> PDF
                </button>
                <button
                  onClick={() => showToast('Secure link copied to clipboard')}
                  style={{
                    background: 'none', border: '1px solid #E2E8F0', borderRadius: 5,
                    padding: '5px 8px', fontSize: 11, color: '#475569', cursor: 'pointer',
                  }}
                >
                  <ExternalLinkIcon size={12} />
                </button>
              </div>
            </div>
          )
        })}

        {filteredReports.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No reports match your filter.
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 24, right: 24, background: '#16A34A', color: '#FFFFFF', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
