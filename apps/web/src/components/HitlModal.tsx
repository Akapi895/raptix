import { useState } from 'react'
import Dialog from '../shared/ui/Dialog'
import { AlertTriangleIcon, XIcon, CheckIcon, InfoIcon, ShieldIcon } from './Icons'

interface HitlModalProps {
  onClose: () => void
  onDecide?: (action: 'allow' | 'deny') => void
  request?: { id: string; agentName: string; task: string; tools: string[] }
}

export default function HitlModal({ onClose, onDecide, request }: HitlModalProps) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  if (decision) {
    return (
      <Dialog
        onClose={onClose}
        labelId="hitl-result-title"
        panelClassName="w-full max-w-md p-8 text-center rounded-2xl"
      >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              backgroundColor: decision === 'approve' ? 'rgba(34,197,94,0.12)' : 'rgba(238,0,51,0.12)',
            }}
          >
            {decision === 'approve'
              ? <CheckIcon size={28} style={{ color: '#22C55E' }} />
              : <XIcon size={28} style={{ color: '#EE0033' }} />
            }
          </div>
          <h3 id="hitl-result-title" className="text-[18px] font-bold mb-2" style={{ color: '#F3F4F6' }}>
            {decision === 'approve' ? 'Action Approved' : 'Action Rejected'}
          </h3>
          <p className="text-[13px] mb-6" style={{ color: '#9CA3AF' }}>
            {decision === 'approve'
              ? 'The agent will proceed with the exploit attempt.'
              : 'The agent has been instructed to halt and await further instructions.'}
          </p>
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-white text-[13px] font-medium rounded-lg transition-colors"
            style={{ backgroundColor: '#273142' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#3D4F66')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#273142')}
          >
            Close
          </button>
      </Dialog>
    )
  }

  return (
    <Dialog
      onClose={onClose}
      labelId="hitl-title"
      panelClassName="w-full max-w-lg overflow-hidden rounded-2xl"
    >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-start justify-between"
          style={{ backgroundColor: '#EE0033' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
              <AlertTriangleIcon size={18} className="text-white" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.65)' }}>
                Human-in-the-Loop
              </div>
              <div id="hitl-title" className="text-[16px] font-bold text-white">High-Risk Action Requires Approval</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close approval dialog"
            className="transition-colors"
            style={{ color: 'rgba(255,255,255,0.65)' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Risk badges */}
          <div className="flex items-center gap-2 mb-5">
            <span
              className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full"
              style={{
                backgroundColor: 'rgba(238,0,51,0.15)',
                color: '#EE0033',
                border: '1px solid rgba(238,0,51,0.3)',
              }}
            >
              CRITICAL RISK
            </span>
            <span
              className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full"
              style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}
            >
              Phase: Exploitation
            </span>
            <span
              className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full"
              style={{ backgroundColor: '#1E2736', color: '#9CA3AF' }}
            >
              {request?.agentName ?? 'ExploitAgent-1'}
            </span>
          </div>

          {/* Action description */}
          <div className="mb-4">
            <div className="text-[13px] font-semibold mb-1" style={{ color: '#F3F4F6' }}>Proposed Action</div>
            <div
              className="rounded-xl p-4 font-mono text-[12px] leading-relaxed"
              style={{ backgroundColor: '#161D27', border: '1px solid #273142', color: '#9CA3AF' }}
            >
              <span style={{ color: '#EE0033', fontWeight: 600 }}>exploit/</span>CVE-2024-49113 against{' '}
              <span style={{ color: '#3B82F6' }}>192.168.10.45:8080</span>
              {' '}(admin panel){'\n'}
              <span style={{ color: '#4B5563' }}>→ Reverse shell payload, memory resident, no-disk</span>
            </div>
          </div>

          {/* Agent rationale */}
          <div className="mb-4 space-y-2">
            <div className="text-[13px] font-semibold" style={{ color: '#F3F4F6' }}>Agent Rationale</div>
            <p className="text-[13px] leading-relaxed" style={{ color: '#9CA3AF' }}>
              During recon phase, the subdomain{' '}
              <code
                className="px-1 py-0.5 rounded text-[11px]"
                style={{ color: '#EE0033', backgroundColor: 'rgba(238,0,51,0.1)' }}
              >
                admin.acme-staging.io
              </code>{' '}
              was found running an unpatched version of AdminLite v2.3.1. CVE-2024-49113 allows unauthenticated RCE via a deserialization flaw. Exploiting this will establish persistence and allow lateral movement.
            </p>
          </div>

          {/* Expandable detail toggle */}
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="flex items-center gap-1.5 text-[12px] mb-4 transition-colors"
            style={{ color: '#4B5563' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#9CA3AF')}
            onMouseLeave={e => (e.currentTarget.style.color = '#4B5563')}
          >
            <InfoIcon size={13} />
            {showDetail ? 'Hide' : 'Show'} technical detail
          </button>

          {showDetail && (
            <div
              className="mb-4 rounded-xl p-4 text-[11px] font-mono leading-relaxed overflow-x-auto"
              style={{ backgroundColor: '#0B0F14', border: '1px solid #1E2736', color: '#9CA3AF' }}
            >
              <div style={{ color: '#4B5563' }}># Tool call: exploit_runner</div>
              <div><span style={{ color: '#F59E0B' }}>target</span>: 192.168.10.45:8080</div>
              <div><span style={{ color: '#F59E0B' }}>cve</span>: CVE-2024-49113</div>
              <div><span style={{ color: '#F59E0B' }}>payload</span>: reverse_shell_memdrop</div>
              <div><span style={{ color: '#F59E0B' }}>lhost</span>: 10.0.0.77</div>
              <div><span style={{ color: '#F59E0B' }}>lport</span>: 4444</div>
              <div><span style={{ color: '#F59E0B' }}>persistence</span>: false</div>
            </div>
          )}

          {/* Warning notice */}
          <div
            className="flex gap-2.5 p-3 rounded-lg mb-6"
            style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <ShieldIcon size={14} className="mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
            <p className="text-[12px]" style={{ color: '#D97706' }}>
              This action will execute active exploit code against target infrastructure. It is irreversible and will generate forensic artifacts. Ensure you are within scope and have written authorization.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => { onDecide?.('deny'); setDecision('reject') }}
              className="flex-1 py-2.5 px-4 rounded-lg text-[13px] font-medium transition-colors"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #273142',
                color: '#9CA3AF',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#161D27')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Reject
            </button>
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="flex-1 py-2.5 px-4 rounded-lg text-[13px] font-medium transition-colors"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #273142',
                color: '#9CA3AF',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#161D27')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Ask for Detail
            </button>
            <button
              onClick={() => { onDecide?.('allow'); setDecision('approve') }}
              className="flex-1 py-2.5 px-4 text-white text-[13px] font-semibold rounded-lg transition-colors"
              style={{ backgroundColor: '#EE0033' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#CC002B')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#EE0033')}
            >
              Approve
            </button>
          </div>
        </div>
    </Dialog>
  )
}
