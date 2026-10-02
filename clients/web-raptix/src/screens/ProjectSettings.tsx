import { useState } from 'react'
import type { Project, ProjectStatus } from '../types'
import {
  SettingsIcon,
  ShieldIcon,
  AlertTriangleIcon,
  CheckIcon,
  XIcon,
  BotIcon,
  DatabaseIcon,
  BellIcon,
  KeyIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshIcon,
  FileTextIcon,
  UploadIcon,
} from '../components/Icons'

interface Props {
  project: Project
}

type Tab = 'general' | 'ai' | 'integrations' | 'notifications' | 'report-templates' | 'danger'

// ─── shared primitives ────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none focus:border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/15 transition-colors'

const selectCls =
  'w-full appearance-none rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 pr-8 text-sm text-[#0F172A] outline-none focus:border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/15 transition-colors cursor-pointer'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
        {label}
      </label>
      {children}
    </div>
  )
}

function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"
      />
    </div>
  )
}

function SaveButton({ label = 'Save Changes' }: { label?: string }) {
  const [saved, setSaved] = useState(false)
  function handleClick() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
      style={{ background: saved ? '#16A34A' : '#DC2626' }}
    >
      {saved ? <CheckIcon size={14} /> : null}
      {saved ? 'Saved!' : label}
    </button>
  )
}

function SectionCard({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white p-6">
      {title && (
        <h3 className="mb-4 text-sm font-semibold text-[#0F172A]">{title}</h3>
      )}
      {children}
    </div>
  )
}

// ─── Modal overlay ────────────────────────────────────────────────────────────

function Modal({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[480px] rounded-xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ─── TAB 1: GENERAL ──────────────────────────────────────────────────────────

const STATUS_OPTIONS: {
  value: ProjectStatus
  label: string
  color: string
  bg: string
  border: string
}[] = [
  { value: 'active', label: 'Active', color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' },
  { value: 'paused', label: 'Paused', color: '#B45309', bg: '#FFFBEB', border: '#FCD34D' },
  { value: 'completed', label: 'Completed', color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' },
  { value: 'planning', label: 'Archived', color: '#475569', bg: '#F8FAFC', border: '#CBD5E1' },
]

function TabGeneral({ project }: { project: Project }) {
  const [projectName, setProjectName] = useState(project.name)
  const [clientName, setClientName] = useState(project.client)
  const [description, setDescription] = useState('')
  const [industry, setIndustry] = useState('fintech')
  const [status, setStatus] = useState<ProjectStatus>(project.status)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">General Settings</h2>
        <p className="mt-0.5 text-sm text-[#475569]">
          Core project metadata and campaign configuration.
        </p>
      </div>

      <SectionCard>
        <div className="flex flex-col gap-5">
          <Field label="Project Name">
            <input
              className={inputCls}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </Field>

          <Field label="Client Name">
            <input
              className={inputCls}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </Field>

          <Field label="Campaign Description">
            <textarea
              className={inputCls + ' resize-none'}
              rows={3}
              placeholder="Describe the engagement scope, objectives, and any relevant context for this red team campaign…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label="Industry Vertical">
            <SelectWrapper>
              <select
                className={selectCls}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                <option value="fintech">FinTech / Banking</option>
                <option value="ecommerce">E-Commerce</option>
                <option value="healthcare">Healthcare</option>
                <option value="saas">SaaS</option>
                <option value="government">Government</option>
                <option value="retail">Retail</option>
              </select>
            </SelectWrapper>
          </Field>

          <Field label="Project Status">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const active = status === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all"
                    style={
                      active
                        ? { background: opt.bg, color: opt.color, border: `1.5px solid ${opt.border}` }
                        : { background: '#F8FAFC', color: '#94A3B8', border: '1.5px solid #E2E8F0' }
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Field>
        </div>
      </SectionCard>

      <div>
        <SaveButton />
      </div>
    </div>
  )
}

// ─── TAB 2: AI & MODEL CONFIG ─────────────────────────────────────────────────

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  leftLabel,
  rightLabel,
  format,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  leftLabel?: string
  rightLabel?: string
  format?: (v: number) => string
}) {
  return (
    <Field label={label}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[#E2E8F0] accent-[#DC2626]"
          />
          <span className="w-14 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-center text-xs font-mono font-semibold text-[#0F172A]">
            {format ? format(value) : value}
          </span>
        </div>
        {(leftLabel || rightLabel) && (
          <div className="flex justify-between text-[10px] text-[#94A3B8]">
            <span>{leftLabel}</span>
            <span>{rightLabel}</span>
          </div>
        )}
      </div>
    </Field>
  )
}

function TabAI() {
  const [provider, setProvider] = useState('gpt4o')
  const [maxIter, setMaxIter] = useState(20)
  const [temp, setTemp] = useState(0.3)
  const [costCap, setCostCap] = useState(500)
  const [throttle, setThrottle] = useState(5)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">AI & Model Configuration</h2>
        <p className="mt-0.5 text-sm text-[#475569]">
          Configure the AI reasoning engine and campaign guardrails.
        </p>
      </div>

      <SectionCard>
        <div className="flex flex-col gap-5">
          <Field label="Primary LLM Provider">
            <SelectWrapper>
              <select
                className={selectCls}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="gpt4o">OpenAI GPT-4o</option>
                <option value="claude">Claude Sonnet 4.5</option>
                <option value="custom">Custom Private vLLM / Ollama</option>
              </select>
            </SelectWrapper>
          </Field>

          <SliderField
            label="ReAct Max Iterations"
            min={5}
            max={50}
            step={1}
            value={maxIter}
            onChange={setMaxIter}
            leftLabel="5 iterations"
            rightLabel="50 iterations"
          />

          <SliderField
            label="AI Creativity / Temperature"
            min={0.1}
            max={0.7}
            step={0.05}
            value={temp}
            onChange={setTemp}
            leftLabel="Strict & Deterministic"
            rightLabel="Explorative"
            format={(v) => v.toFixed(2)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Campaign Cost Cap">
              <div className="flex">
                <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-[#E2E8F0] bg-[#F8FAFC] px-3 text-sm text-[#475569]">
                  $
                </span>
                <input
                  type="number"
                  className="h-9 flex-1 rounded-none border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none focus:border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/15 transition-colors"
                  value={costCap}
                  onChange={(e) => setCostCap(Number(e.target.value))}
                />
                <span className="flex h-9 items-center rounded-r-lg border border-l-0 border-[#E2E8F0] bg-[#F8FAFC] px-3 text-sm text-[#475569]">
                  USD
                </span>
              </div>
            </Field>

            <Field label="Auto-Throttle Rate">
              <div className="flex">
                <input
                  type="number"
                  className="h-9 flex-1 rounded-l-lg border border-r-0 border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none focus:border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/15 transition-colors"
                  value={throttle}
                  onChange={(e) => setThrottle(Number(e.target.value))}
                />
                <span className="flex h-9 items-center rounded-r-lg border border-l-0 border-[#E2E8F0] bg-[#F8FAFC] px-3 text-sm text-[#475569]">
                  req/s
                </span>
              </div>
            </Field>
          </div>
        </div>
      </SectionCard>

      <div>
        <SaveButton />
      </div>
    </div>
  )
}

// ─── TAB 3: INTEGRATIONS ─────────────────────────────────────────────────────

type ConnStatus = 'idle' | 'testing' | 'ok'

function ApiKeyRow({
  service,
  color,
  fields,
}: {
  service: string
  color: string
  fields: { key: string; placeholder: string }[]
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(fields.map((f) => [f.key, false])),
  )
  const [status, setStatus] = useState<ConnStatus>('idle')

  function handleTest() {
    setStatus('testing')
    setTimeout(() => setStatus('ok'), 1500)
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-[#E2E8F0]">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ background: color }}
        >
          {service[0]}
        </span>
        <span className="text-sm font-semibold text-[#0F172A]">{service}</span>
        {status === 'ok' && (
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-[#16A34A]">
            <CheckIcon size={12} /> Connected
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {fields.map((f) => (
          <div key={f.key} className="relative">
            <input
              type={visible[f.key] ? 'text' : 'password'}
              className={inputCls + ' pr-9'}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            />
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
              onClick={() =>
                setVisible((prev) => ({ ...prev, [f.key]: !prev[f.key] }))
              }
            >
              {visible[f.key] ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
            </button>
          </div>
        ))}
      </div>

      <div>
        <button
          onClick={handleTest}
          disabled={status === 'testing'}
          className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:border-[#94A3B8] transition-colors disabled:opacity-60"
        >
          {status === 'testing' ? (
            <>
              <RefreshIcon size={12} className="animate-spin" /> Testing…
            </>
          ) : (
            'Test Connection'
          )}
        </button>
      </div>
    </div>
  )
}

function TabIntegrations() {
  const [issueTracker, setIssueTracker] = useState('jira')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState({
    newFinding: true,
    statusChange: false,
    reportGenerated: true,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">Integrations & Recon APIs</h2>
        <p className="mt-0.5 text-sm text-[#475569]">
          Connect external intelligence sources and issue tracking systems.
        </p>
      </div>

      <SectionCard title="External Intelligence APIs">
        <ApiKeyRow service="Shodan" color="#E34C26" fields={[{ key: 'SHODAN_API_KEY', placeholder: 'SHODAN_API_KEY' }]} />
        <ApiKeyRow service="Censys" color="#1A73E8" fields={[{ key: 'CENSYS_API_ID', placeholder: 'CENSYS_API_ID' }, { key: 'CENSYS_API_SECRET', placeholder: 'CENSYS_API_SECRET' }]} />
        <ApiKeyRow service="VirusTotal" color="#394EFF" fields={[{ key: 'VT_API_KEY', placeholder: 'VT_API_KEY' }]} />
        <ApiKeyRow service="Hunter.io" color="#F97316" fields={[{ key: 'HUNTER_API_KEY', placeholder: 'HUNTER_API_KEY' }]} />
      </SectionCard>

      <SectionCard title="Issue Tracking & Webhooks">
        <div className="flex flex-col gap-5">
          <Field label="Destination">
            <SelectWrapper>
              <select
                className={selectCls}
                value={issueTracker}
                onChange={(e) => setIssueTracker(e.target.value)}
              >
                <option value="jira">Jira</option>
                <option value="github">GitHub Issues</option>
                <option value="defectdojo">DefectDojo</option>
              </select>
            </SelectWrapper>
          </Field>

          <Field label="Webhook URL">
            <input
              className={inputCls}
              placeholder="https://hooks.example.com/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            />
          </Field>

          <Field label="Events to Push">
            <div className="flex flex-col gap-2">
              {(
                [
                  ['newFinding', 'New Finding'],
                  ['statusChange', 'Status Change'],
                  ['reportGenerated', 'Report Generated'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded accent-[#DC2626]"
                    checked={webhookEvents[key]}
                    onChange={(e) =>
                      setWebhookEvents((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                  />
                  <span className="text-sm text-[#0F172A]">{label}</span>
                </label>
              ))}
            </div>
          </Field>

          <div>
            <SaveButton label="Save Webhook" />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── TAB 4: NOTIFICATIONS ────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: enabled ? '#DC2626' : '#E2E8F0' }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
        style={{ left: '2px', transform: enabled ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  )
}

function TabNotifications() {
  const [channels, setChannels] = useState({
    slack: { url: '', enabled: true },
    teams: { url: '', enabled: false },
    telegram: { url: '', enabled: false },
  })

  const [events, setEvents] = useState({
    foothold: true,
    hitl: true,
    critical: true,
    beacon: true,
    crownjewel: true,
  })

  const CHANNEL_LIST = [
    { key: 'slack' as const, label: 'Slack', emoji: '💬', placeholder: 'https://hooks.slack.com/services/...' },
    { key: 'teams' as const, label: 'Microsoft Teams', emoji: '🟦', placeholder: 'https://outlook.office.com/webhook/...' },
    { key: 'telegram' as const, label: 'Telegram', emoji: '✈️', placeholder: 'https://api.telegram.org/bot.../sendMessage' },
  ]

  const EVENT_LIST = [
    { key: 'foothold' as const, name: 'Initial Foothold', desc: 'First C2 session established' },
    { key: 'hitl' as const, name: 'HITL Pending', desc: 'Dangerous action awaiting human approval' },
    { key: 'critical' as const, name: 'Critical Finding', desc: 'Vulnerability rated CVSS ≥ 9.0 discovered' },
    { key: 'beacon' as const, name: 'C2 Beacon Lost', desc: 'Beacon lost on a critical host' },
    { key: 'crownjewel' as const, name: 'Crown Jewel Achieved', desc: 'Objective milestone reached' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">Notifications & Webhooks</h2>
        <p className="mt-0.5 text-sm text-[#475569]">
          Configure real-time alert delivery channels and event triggers.
        </p>
      </div>

      <SectionCard title="Alert Channels">
        <div className="flex flex-col gap-4">
          {CHANNEL_LIST.map((ch) => (
            <div key={ch.key} className="flex items-center gap-3">
              <span className="text-xl leading-none">{ch.emoji}</span>
              <span className="w-36 shrink-0 text-sm font-semibold text-[#0F172A]">{ch.label}</span>
              <input
                className={inputCls + ' flex-1'}
                placeholder={ch.placeholder}
                value={channels[ch.key].url}
                onChange={(e) =>
                  setChannels((prev) => ({
                    ...prev,
                    [ch.key]: { ...prev[ch.key], url: e.target.value },
                  }))
                }
              />
              <Toggle
                enabled={channels[ch.key].enabled}
                onChange={(v) =>
                  setChannels((prev) => ({
                    ...prev,
                    [ch.key]: { ...prev[ch.key], enabled: v },
                  }))
                }
              />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Event Triggers">
        <div className="flex flex-col gap-1">
          {EVENT_LIST.map((ev) => (
            <label
              key={ev.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-[#F8FAFC] transition-colors"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded accent-[#DC2626]"
                checked={events[ev.key]}
                onChange={(e) =>
                  setEvents((prev) => ({ ...prev, [ev.key]: e.target.checked }))
                }
              />
              <div>
                <p className="text-sm font-semibold text-[#0F172A]">{ev.name}</p>
                <p className="text-xs text-[#475569]">{ev.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </SectionCard>

      <div>
        <SaveButton label="Save Notification Settings" />
      </div>
    </div>
  )
}

// ─── TAB 5: REPORT TEMPLATES ─────────────────────────────────────────────────

function TabReportTemplates() {
  const [templates, setTemplates] = useState<{ id: string; name: string; size: string; type: string; uploaded: string }[]>([
    { id: 't1', name: 'Technical_Report_Template_v3.docx', size: '2.4 MB', type: 'DOCX', uploaded: '2026-09-15' },
    { id: 't2', name: 'Executive_Summary_Template.pdf', size: '1.1 MB', type: 'PDF', uploaded: '2026-09-10' },
    { id: 't3', name: 'Attestation_Letter_ISO27001.docx', size: '0.8 MB', type: 'DOCX', uploaded: '2026-09-08' },
  ])
  const [dragging, setDragging] = useState(false)
  const [instructions, setInstructions] = useState(`## Report Generation Instructions\n\n**Style Guidelines:**\n- Use formal, passive voice throughout\n- All findings must reference CVE/CWE IDs where applicable\n- Executive Summary: maximum 2 pages, no technical jargon\n- Severity ratings must follow CVSS v3.1 scoring\n\n**Structure Requirements:**\n1. Cover page with client logo placeholder and TLP classification\n2. Table of Contents (auto-generated)\n3. Executive Summary (non-technical)\n4. Technical Findings Matrix (ordered by CVSS score)\n5. Remediation Roadmap with effort/impact matrix\n6. Appendices: PoC Evidence, Tool Output Logs\n\n**Tone & Branding:**\n- Use Raptix AI Red Team letterhead\n- Include engagement reference number on every page\n- Classify all documents as CONFIDENTIAL // TLP:AMBER`)
  const [saved, setSaved] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const newTemplates = files.map(f => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
      type: f.name.split('.').pop()?.toUpperCase() ?? 'FILE',
      uploaded: new Date().toISOString().split('T')[0],
    }))
    setTemplates(prev => [...prev, ...newTemplates])
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const newTemplates = files.map(f => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
      type: f.name.split('.').pop()?.toUpperCase() ?? 'FILE',
      uploaded: new Date().toISOString().split('T')[0],
    }))
    setTemplates(prev => [...prev, ...newTemplates])
  }

  function removeTemplate(id: string) {
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  function handleSaveInstructions() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">Report Templates</h2>
        <p className="text-sm text-[#475569] mt-1">Upload reference documents and writing instructions for AI-assisted report generation.</p>
      </div>

      {/* Upload zone */}
      <SectionCard title="Template Library">
        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 transition-colors cursor-pointer mb-5"
          style={{
            borderColor: dragging ? '#DC2626' : '#E2E8F0',
            background: dragging ? '#FEF2F2' : '#F8FAFC',
          }}
          onClick={() => document.getElementById('template-file-input')?.click()}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#FEE2E2' }}>
            <UploadIcon size={18} style={{ color: '#DC2626' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-[#0F172A]">Drop report templates here</p>
            <p className="text-xs text-[#94A3B8] mt-0.5">Supports PDF, DOCX, XLSX — max 20 MB per file</p>
          </div>
          <input
            id="template-file-input"
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.doc"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* Templates list */}
        {templates.length > 0 && (
          <div className="flex flex-col gap-2">
            {templates.map(t => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3">
                <div
                  className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                  style={{
                    background: t.type === 'PDF' ? '#FEE2E2' : '#EFF6FF',
                    color: t.type === 'PDF' ? '#DC2626' : '#2563EB',
                  }}
                >
                  {t.type}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0F172A] truncate">{t.name}</p>
                  <p className="text-xs text-[#94A3B8]">{t.size} · Uploaded {t.uploaded}</p>
                </div>
                <button
                  onClick={() => removeTemplate(t.id)}
                  className="p-1.5 rounded hover:bg-[#FEF2F2] transition-colors"
                  style={{ color: '#94A3B8' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#DC2626')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Instructions editor */}
      <SectionCard title="AI Report Writing Instructions">
        <p className="text-xs text-[#475569] mb-3">
          Define style guidelines, structure requirements, and tone for AI-generated reports. These instructions are injected into every AI report generation prompt.
        </p>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          rows={14}
          className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F172A] outline-none focus:border-[#DC2626] transition-colors resize-y"
          style={{ fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.7 }}
          placeholder="Enter formatting rules, style guide, section structure..."
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-[#94A3B8]">{instructions.length} characters · Used in every AI report generation prompt</p>
          <button
            onClick={handleSaveInstructions}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ background: saved ? '#16A34A' : '#DC2626' }}
          >
            {saved && <CheckIcon size={14} />}
            {saved ? 'Saved!' : 'Save Instructions'}
          </button>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── TAB 6: DANGER ZONE ──────────────────────────────────────────────────────

function TabDanger({ project }: { project: Project }) {
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [confirmDestruct, setConfirmDestruct] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#0F172A]">Danger Zone</h2>
        <p className="mt-0.5 text-sm text-[#475569]">
          Irreversible destructive operations for this project.
        </p>
      </div>

      <div
        style={{
          border: '1.5px solid #EF4444',
          background: '#FEF2F2',
          borderRadius: 12,
          padding: 24,
        }}
      >
        <p className="mb-5 text-sm font-bold" style={{ color: '#EF4444' }}>
          ⚠ Danger Zone — These actions are destructive and irreversible.
        </p>

        {/* Action 1 */}
        <div className="flex items-start justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">
              Purge Execution Logs & Shell Output
            </p>
            <p className="mt-0.5 text-xs text-[#475569]">
              Permanently deletes all technical command logs and terminal output. Findings and reports are preserved.
            </p>
          </div>
          <button
            onClick={() => setConfirmPurge(true)}
            className="shrink-0 rounded-lg border border-[#EF4444] px-3 py-1.5 text-xs font-semibold text-[#EF4444] hover:bg-[#FEE2E2] transition-colors"
          >
            Purge Logs
          </button>
        </div>

        <hr style={{ borderColor: '#FECACA' }} />

        {/* Action 2 */}
        <div className="flex items-start justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">
              Self-Destruct All C2 Implants
            </p>
            <p className="mt-0.5 text-xs text-[#475569]">
              Sends kill command to all active beacons. Deletes payload files from all compromised hosts.
            </p>
          </div>
          <button
            onClick={() => setConfirmDestruct(true)}
            className="shrink-0 rounded-lg border border-[#EF4444] px-3 py-1.5 text-xs font-semibold text-[#EF4444] hover:bg-[#FEE2E2] transition-colors"
          >
            Initiate Self-Destruct
          </button>
        </div>

        <hr style={{ borderColor: '#FECACA' }} />

        {/* Action 3 */}
        <div className="flex items-start justify-between gap-4 pt-4">
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">
              Delete Project Permanently
            </p>
            <p className="mt-0.5 text-xs text-[#475569]">
              Destroys all data, findings, logs, reports, and configurations. This cannot be undone.
            </p>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
            style={{ background: '#EF4444' }}
          >
            Delete Project
          </button>
        </div>
      </div>

      {/* Modal: Purge Logs */}
      {confirmPurge && (
        <Modal onClose={() => setConfirmPurge(false)}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2]">
                <TrashIcon size={18} className="text-[#EF4444]" />
              </span>
              <div>
                <p className="font-semibold text-[#0F172A]">Purge Execution Logs</p>
                <p className="text-xs text-[#475569]">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-[#475569]">
              Are you sure you want to permanently delete all command logs and terminal output for this project?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmPurge(false)}
                className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setConfirmPurge(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90"
                style={{ background: '#EF4444' }}
              >
                Confirm Purge
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Self-Destruct */}
      {confirmDestruct && (
        <Modal onClose={() => setConfirmDestruct(false)}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2]">
                <AlertTriangleIcon size={18} className="text-[#EF4444]" />
              </span>
              <div>
                <p className="font-semibold text-[#0F172A]">Self-Destruct All C2 Implants</p>
                <p className="text-xs text-[#475569]">This action cannot be undone.</p>
              </div>
            </div>
            <div
              className="rounded-lg p-3 text-sm font-medium"
              style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
            >
              ⚠ <strong>3 live sessions</strong> will be terminated and all payload files will be deleted from compromised hosts.
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDestruct(false)}
                className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setConfirmDestruct(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90"
                style={{ background: '#EF4444' }}
              >
                Initiate Self-Destruct
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Delete Project */}
      {confirmDelete && (
        <Modal onClose={() => { setConfirmDelete(false); setDeleteInput('') }}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2]">
                <TrashIcon size={18} className="text-[#EF4444]" />
              </span>
              <div>
                <p className="font-semibold text-[#0F172A]">Delete Project Permanently</p>
                <p className="text-xs text-[#475569]">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-[#475569]">
              This will destroy all data, findings, logs, reports, and configurations. Type{' '}
              <span
                className="font-semibold text-[#0F172A]"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {project.name}
              </span>{' '}
              to confirm.
            </p>
            <input
              className={inputCls}
              placeholder="Type project name to confirm"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
                className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={deleteInput !== project.name}
                onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                style={{
                  background: deleteInput === project.name ? '#EF4444' : '#94A3B8',
                  cursor: deleteInput === project.name ? 'pointer' : 'not-allowed',
                }}
              >
                Delete Project
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────

type NavItem = { id: Tab; label: string; Icon: React.FC<{ size?: number; className?: string }> }

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', Icon: SettingsIcon },
  { id: 'ai', label: 'AI & Models', Icon: BotIcon },
  { id: 'integrations', label: 'Integrations', Icon: DatabaseIcon },
  { id: 'notifications', label: 'Notifications', Icon: BellIcon },
  { id: 'report-templates', label: 'Report Templates', Icon: FileTextIcon },
  { id: 'danger', label: 'Danger Zone', Icon: AlertTriangleIcon },
]

export default function ProjectSettings({ project }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6" style={{ background: '#F8FAFC' }}>
      {/* Page header */}
      <div className="mb-5 flex items-center gap-3">
        <SettingsIcon size={18} className="text-[#475569]" />
        <div>
          <h1 className="text-lg font-bold text-[#0F172A]">Project Settings</h1>
          <p className="text-xs text-[#94A3B8]">{project.name}</p>
        </div>
      </div>

      {/* Card shell: sidebar + content */}
      <div className="flex flex-1 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        {/* Sidebar nav */}
        <nav
          className="flex flex-col gap-0.5 border-r border-[#E2E8F0] p-3"
          style={{ width: 200, flexShrink: 0 }}
        >
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTab === id
            const isDanger = id === 'danger'
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
                style={
                  active
                    ? { background: isDanger ? '#FEF2F2' : '#FEF2F2', color: isDanger ? '#EF4444' : '#DC2626' }
                    : { color: isDanger ? '#EF4444' : '#475569' }
                }
              >
                <Icon
                  size={15}
                  className={
                    active
                      ? isDanger ? 'text-[#EF4444]' : 'text-[#DC2626]'
                      : isDanger ? 'text-[#EF4444]' : 'text-[#94A3B8]'
                  }
                />
                {label}
              </button>
            )
          })}
        </nav>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && <TabGeneral project={project} />}
          {activeTab === 'ai' && <TabAI />}
          {activeTab === 'integrations' && <TabIntegrations />}
          {activeTab === 'notifications' && <TabNotifications />}
          {activeTab === 'report-templates' && <TabReportTemplates />}
          {activeTab === 'danger' && <TabDanger project={project} />}
        </div>
      </div>
    </div>
  )
}
