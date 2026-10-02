import { useState } from 'react'
import Dialog from '../shared/ui/Dialog'
import { XIcon, FolderIcon } from './Icons'

interface Props {
  onClose: () => void
  onCreate: (name: string, scopeType: string, client: string) => void
}

const SCOPE_TYPES = [
  'Web Application',
  'Network Infrastructure',
  'Mobile Application',
  'API',
  'Cloud Infrastructure',
  'Red Team Exercise',
]

export default function NewProjectModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [scopeType, setScopeType] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) { setError('Project name is required'); return }
    if (!client.trim()) { setError('Client name is required'); return }
    if (!scopeType) { setError('Please select a scope type'); return }
    setError('')
    onCreate(name.trim(), scopeType, client.trim())
  }

  return (
    <Dialog
      onClose={onClose}
      labelId="new-project-title"
      panelClassName="w-full max-w-md overflow-hidden flex flex-col rounded-3xl"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: '#161D27', border: '1px solid #273142' }}
            >
              <FolderIcon size={16} style={{ color: '#9CA3AF' }} />
            </div>
            <div>
              <h3 id="new-project-title" className="text-[16px] font-bold" style={{ color: '#F3F4F6' }}>New Project</h3>
              <p className="text-[12px]" style={{ color: '#9CA3AF' }}>Set up a new pentest engagement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close new project dialog"
            className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors"
            style={{ color: '#9CA3AF' }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#161D27'
              e.currentTarget.style.color = '#F3F4F6'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#9CA3AF'
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="px-6 space-y-4 pb-5">
          <div>
            <label htmlFor="new-project-name" className="block text-[12px] font-semibold mb-1.5" style={{ color: '#9CA3AF' }}>
              Project Name <span style={{ color: '#EE0033' }}>*</span>
            </label>
            <input
              id="new-project-name"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. ACME Corp Web Pentest Q4"
              className="w-full px-3.5 py-2.5 text-[13px] rounded-2xl outline-none transition-all"
              style={{
                backgroundColor: '#161D27',
                border: '1px solid #273142',
                color: '#F3F4F6',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = '#EE0033'
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(238,0,51,0.1)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = '#273142'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div>
            <label htmlFor="new-project-client" className="block text-[12px] font-semibold mb-1.5" style={{ color: '#9CA3AF' }}>
              Client <span style={{ color: '#EE0033' }}>*</span>
            </label>
            <input
              id="new-project-client"
              value={client}
              onChange={e => { setClient(e.target.value); setError('') }}
              placeholder="e.g. ACME Corporation"
              className="w-full px-3.5 py-2.5 text-[13px] rounded-2xl outline-none transition-all"
              style={{
                backgroundColor: '#161D27',
                border: '1px solid #273142',
                color: '#F3F4F6',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = '#EE0033'
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(238,0,51,0.1)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = '#273142'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: '#9CA3AF' }}>
              Scope Type <span style={{ color: '#EE0033' }}>*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SCOPE_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => { setScopeType(type); setError('') }}
                  aria-pressed={scopeType === type}
                  className="px-3 py-2 rounded-xl text-[12px] font-medium text-left transition-all"
                  style={
                    scopeType === type
                      ? { backgroundColor: '#273142', border: '1px solid #3D4F66', color: '#F3F4F6' }
                      : { backgroundColor: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }
                  }
                  onMouseEnter={e => {
                    if (scopeType !== type) {
                      e.currentTarget.style.borderColor = '#3D4F66'
                      e.currentTarget.style.color = '#F3F4F6'
                    }
                  }}
                  onMouseLeave={e => {
                    if (scopeType !== type) {
                      e.currentTarget.style.borderColor = '#273142'
                      e.currentTarget.style.color = '#9CA3AF'
                    }
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[12px] font-medium" style={{ color: '#EE0033' }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid #273142',
              color: '#9CA3AF',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#161D27')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 text-white text-[13px] font-semibold rounded-2xl transition-all flex items-center justify-center gap-2"
            style={{ backgroundColor: '#EE0033', boxShadow: '0 2px 8px rgba(238,0,51,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#CC002B')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#EE0033')}
          >
            <FolderIcon size={13} />
            Create Project
          </button>
        </div>
    </Dialog>
  )
}
