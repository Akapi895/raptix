import { useState } from 'react'
import type { ChangeEvent, FocusEvent } from 'react'
import type { EngagementTargetType } from '@raptix/web-contracts'
import Dialog from '../../../shared/ui/Dialog'
import { FolderIcon, XIcon } from '../../../components/Icons'
import { BRIEF_MAX_LENGTH, validateCreateProjectDraft } from '../real-project.types'
import type { CreateProjectField, RealNewProjectModalProps } from '../real-project.types'

const TARGET_TYPES: { value: EngagementTargetType; label: string }[] = [
  { value: 'web_url', label: 'Web URL' },
  { value: 'ip_range', label: 'IP Range' },
]
const DARK_INPUT = { backgroundColor: '#161D27', border: '1px solid #273142', color: '#F3F4F6' }

function focusInput(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = '#EE0033'
  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(238,0,51,0.1)'
}

function blurInput(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = '#273142'
  e.currentTarget.style.boxShadow = 'none'
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-[12px] font-medium mt-1.5" style={{ color: '#EE0033' }}>{message}</p>
}

function Label({ htmlFor, text, required, hint }: { htmlFor: string; text: string; required?: boolean; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[12px] font-semibold mb-1.5" style={{ color: '#9CA3AF' }}>
      {text} {required && <span style={{ color: '#EE0033' }}>*</span>}
      {hint && <span className="font-normal" style={{ color: '#6B7280' }}> — {hint}</span>}
    </label>
  )
}

function TextField({ id, label, required, hint, value, onChange, placeholder, mono, error }: {
  id: string
  label: string
  required?: boolean
  hint?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  mono?: boolean
  error?: string
}) {
  return (
    <div>
      <Label htmlFor={id} text={label} required={required} hint={hint} />
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full px-3.5 py-2.5 text-[13px] rounded-2xl outline-none transition-all"
        style={mono ? { ...DARK_INPUT, fontFamily: "'JetBrains Mono', monospace" } : DARK_INPUT}
        onFocus={focusInput}
        onBlur={blurInput}
      />
      <FieldError message={error} />
    </div>
  )
}

/**
 * Real create-project form in the source NewProjectModal dark Dialog look.
 * Required inputs mirror the new-server policy: workspace slug (`name`),
 * optional displayName, targetType/targetValue and an explicit authorization
 * confirmation. Server field errors arrive via the `error` prop.
 */
export default function RealNewProjectModal({ onClose, onCreate, pending, error }: RealNewProjectModalProps) {
  const [displayName, setDisplayName] = useState('')
  const [name, setName] = useState('')
  const [targetType, setTargetType] = useState<EngagementTargetType>('web_url')
  const [targetValue, setTargetValue] = useState('')
  const [authConfirmed, setAuthConfirmed] = useState(false)
  const [brief, setBrief] = useState('')
  const [localErrors, setLocalErrors] = useState<Partial<Record<CreateProjectField, string>>>({})

  const clearField = (field: CreateProjectField) =>
    setLocalErrors(previous => ({ ...previous, [field]: undefined }))
  const fieldError = (field: CreateProjectField): string | undefined =>
    error?.field === field ? error.message : localErrors[field]

  const uploadBrief = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      setLocalErrors(previous => ({ ...previous, brief: 'Unsupported file — upload a .md, .markdown or .txt file' }))
      return
    }
    if (file.size > BRIEF_MAX_LENGTH * 2) {
      setLocalErrors(previous => ({ ...previous, brief: 'File is too large for the brief field' }))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBrief(String(reader.result ?? ''))
      clearField('brief')
    }
    reader.readAsText(file)
  }

  const handleSubmit = () => {
    if (pending) return
    const draft = {
      name: name.trim(),
      displayName: displayName.trim(),
      targetType,
      targetValue: targetValue.trim(),
      authorizationConfirmed: authConfirmed,
      brief,
    }
    const failures = validateCreateProjectDraft(draft)
    setLocalErrors(failures)
    if (Object.values(failures).some(Boolean)) return
    onCreate({
      name: draft.name,
      ...(draft.displayName === '' ? {} : { displayName: draft.displayName }),
      targetType,
      targetValue: draft.targetValue,
      authorizationConfirmed: true,
      brief: draft.brief.trim(),
    })
  }

  const formError = error && error.field === undefined ? error.message : null

  return (
    <Dialog onClose={onClose} labelId="real-new-project-title" panelClassName="w-full max-w-md overflow-hidden flex flex-col rounded-3xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#161D27', border: '1px solid #273142' }}>
            <FolderIcon size={16} style={{ color: '#9CA3AF' }} />
          </div>
          <div>
            <h3 id="real-new-project-title" className="text-[16px] font-bold" style={{ color: '#F3F4F6' }}>New Project</h3>
            <p className="text-[12px]" style={{ color: '#9CA3AF' }}>Set up a new pentest engagement</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close new project dialog"
          className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: '#9CA3AF' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#161D27'; e.currentTarget.style.color = '#F3F4F6' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#9CA3AF' }}
        >
          <XIcon size={16} />
        </button>
      </div>

      {/* Fields */}
      <div className="px-6 space-y-4 pb-5">
        <TextField
          id="real-new-project-display-name"
          label="Display Name"
          hint="optional"
          value={displayName}
          onChange={value => { setDisplayName(value); clearField('displayName') }}
          placeholder="e.g. ACME Corp Web Pentest Q4"
          error={fieldError('displayName')}
        />
        <div>
          <TextField
            id="real-new-project-slug"
            label="Workspace Slug"
            required
            hint="used as the workspace name"
            value={name}
            onChange={value => { setName(value); clearField('name') }}
            placeholder="e.g. acme-corp-web-pentest-q4"
            error={fieldError('name')}
          />
          <p className="text-[11px] mt-1.5" style={{ color: '#6B7280' }}>
            3-64 characters: lowercase letters, digits and internal hyphens. Cannot change after creation.
          </p>
        </div>
        <div>
          <span className="block text-[12px] font-semibold mb-1.5" style={{ color: '#9CA3AF' }}>
            Target Type <span style={{ color: '#EE0033' }}>*</span>
          </span>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Target type">
            {TARGET_TYPES.map(type => {
              const selected = targetType === type.value
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => { setTargetType(type.value); clearField('targetType'); clearField('targetValue') }}
                  aria-pressed={selected}
                  className="px-3 py-2 rounded-xl text-[12px] font-medium text-left transition-all"
                  style={selected
                    ? { backgroundColor: '#273142', border: '1px solid #3D4F66', color: '#F3F4F6' }
                    : { backgroundColor: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }}
                  onMouseEnter={e => {
                    if (!selected) { e.currentTarget.style.borderColor = '#3D4F66'; e.currentTarget.style.color = '#F3F4F6' }
                  }}
                  onMouseLeave={e => {
                    if (!selected) { e.currentTarget.style.borderColor = '#273142'; e.currentTarget.style.color = '#9CA3AF' }
                  }}
                >
                  {type.label}
                </button>
              )
            })}
          </div>
          <FieldError message={fieldError('targetType')} />
        </div>
        <TextField
          id="real-new-project-target"
          label="Target"
          required
          hint={targetType === 'web_url' ? 'absolute HTTP(S) URL' : 'IPv4/IPv6 address or CIDR'}
          value={targetValue}
          onChange={value => { setTargetValue(value); clearField('targetValue') }}
          placeholder={targetType === 'web_url' ? 'http://authorized-local-target:3010' : '10.0.0.0/24'}
          mono
          error={fieldError('targetValue')}
        />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="real-new-project-brief" className="block text-[12px] font-semibold" style={{ color: '#9CA3AF' }}>
              Engagement Brief <span style={{ color: '#EE0033' }}>*</span>
              <span className="font-normal" style={{ color: '#6B7280' }}> — scope, constraints, stop conditions</span>
            </label>
            <label
              htmlFor="real-new-project-brief-file"
              className="text-[11px] font-semibold px-2 py-1 rounded-lg cursor-pointer transition-colors"
              style={{ backgroundColor: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#F3F4F6')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
            >
              Upload .md
            </label>
            <input id="real-new-project-brief-file" type="file" accept=".md,.markdown,.txt" onChange={uploadBrief} className="hidden" />
          </div>
          <textarea
            id="real-new-project-brief"
            value={brief}
            onChange={e => { setBrief(e.target.value); clearField('brief') }}
            rows={6}
            placeholder={'Paste the engagement brief, or upload a markdown file.\n\nThe brief becomes the prompt Soundwave uses to draft scope and RoE before any execution chat unlocks.'}
            className="w-full px-3.5 py-2.5 text-[13px] rounded-2xl outline-none transition-all resize-y"
            style={{ ...DARK_INPUT, fontFamily: "'JetBrains Mono', monospace" }}
            onFocus={focusInput}
            onBlur={blurInput}
          />
          <div className="flex items-start justify-between gap-2">
            <FieldError message={fieldError('brief')} />
            <span className="text-[11px] ml-auto shrink-0" style={{ color: '#6B7280' }}>{brief.trim().length} chars</span>
          </div>
        </div>
        <div>
          <label htmlFor="real-new-project-auth" className="flex items-start gap-2.5 text-[12px] cursor-pointer" style={{ color: '#9CA3AF' }}>
            <input
              id="real-new-project-auth"
              type="checkbox"
              checked={authConfirmed}
              onChange={e => { setAuthConfirmed(e.target.checked); clearField('authorizationConfirmed') }}
              className="mt-0.5 w-4 h-4"
              style={{ accentColor: '#EE0033' }}
            />
            <span>I confirm this target is explicitly authorized for security testing <span style={{ color: '#EE0033' }}>*</span></span>
          </label>
          <FieldError message={fieldError('authorizationConfirmed')} />
        </div>
        {formError && (
          <p role="alert" className="text-[12px] font-medium" style={{ color: '#EE0033' }}>{formError}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 flex items-center gap-3">
        <button
          onClick={onClose}
          disabled={pending}
          className="flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'transparent', border: '1px solid #273142', color: '#9CA3AF' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#161D27')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={pending}
          aria-busy={pending}
          className="flex-1 py-2.5 text-white text-[13px] font-semibold rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: '#EE0033', boxShadow: '0 2px 8px rgba(238,0,51,0.35)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#CC002B')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#EE0033')}
        >
          <FolderIcon size={13} />
          {pending ? 'Creating…' : 'Create Project'}
        </button>
      </div>
    </Dialog>
  )
}
