import type { HitlDecision, SubAgent } from './model'
import { STATUS_STYLES } from './model'
import {
  BotIcon, AlertTriangleIcon, ZapIcon, TerminalIcon, CheckIcon, XIcon,
} from '../../components/Icons'

interface Props {
  agent: SubAgent
  decision: HitlDecision | undefined
  onDecide: (decision: HitlDecision) => void
}

export default function AgentDetailPanel({ agent, decision, onDecide }: Props) {
  const ss = STATUS_STYLES[agent.status]
  const hitlDone = decision !== undefined
  const hitlChoice = decision ?? null

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Header */}
      <div
        className="px-4 pt-4 pb-3 shrink-0"
        style={{ borderBottom: '1px solid #E2E8F0' }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
          >
            <BotIcon size={15} style={{ color: '#475569' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[13px] font-bold truncate"
                style={{ color: '#0F172A' }}
              >
                {agent.name}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: ss.badgeBg, color: ss.badgeText }}
              >
                {ss.label}
              </span>
            </div>
            <span className="text-[10px]" style={{ color: '#94A3B8' }}>
              {agent.type}
            </span>
          </div>
        </div>
      </div>

      {/* Current task */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #E2E8F0' }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: '#94A3B8' }}
        >
          Current Task
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: '#475569' }}>
          {agent.task}
        </p>
      </div>

      {/* HITL approval card — blocked agents only */}
      {agent.status === 'blocked' && (
        <div
          className="mx-4 my-3 p-3 rounded-lg shrink-0"
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangleIcon size={12} style={{ color: '#DC2626' }} />
            <span
              className="text-[11px] font-semibold"
              style={{ color: '#DC2626' }}
            >
              Awaiting HITL Approval
            </span>
          </div>
          <p
            className="text-[10px] leading-relaxed mb-3"
            style={{ color: '#475569' }}
          >
            This agent is holding before executing a potentially destructive action. Review and approve or reject to continue.
          </p>
          {hitlDone ? (
            <div
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold"
              style={{
                backgroundColor:
                  hitlChoice === 'approved'
                    ? '#DCFCE7'
                    : '#FEF2F2',
                color: hitlChoice === 'approved' ? '#16A34A' : '#DC2626',
              }}
            >
              <CheckIcon size={11} />
              {hitlChoice === 'approved'
                ? 'Approved — agent proceeding'
                : 'Rejected — agent halted'}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => onDecide('approved')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                style={{
                  backgroundColor: '#DCFCE7',
                  color: '#16A34A',
                  border: '1px solid #DCFCE7',
                }}
              >
                <CheckIcon size={11} />
                Approve
              </button>
              <button
                onClick={() => onDecide('rejected')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                style={{
                  backgroundColor: '#FEF2F2',
                  color: '#DC2626',
                  border: '1px solid #FECACA',
                }}
              >
                <XIcon size={11} />
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {/* Skills */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #E2E8F0' }}
      >
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: '#94A3B8' }}
        >
          <ZapIcon size={10} />
          Skills
        </div>
        <div className="flex flex-wrap gap-1">
          {agent.skills.map(s => (
            <span
              key={s}
              className="px-2 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: '#DBEAFE',
                color: '#2563EB',
                border: '1px solid #DBEAFE',
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* MCP / Tools */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #E2E8F0' }}
      >
        <div
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: '#94A3B8' }}
        >
          <TerminalIcon size={10} />
          MCP / Tools
        </div>
        <div className="flex flex-wrap gap-1">
          {agent.tools.map(t => (
            <span
              key={t}
              className="font-mono px-2 py-0.5 rounded text-[10px]"
              style={{
                backgroundColor: '#F1F5F9',
                color: '#475569',
                border: '1px solid #E2E8F0',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Recent actions */}
      <div className="px-4 py-3 flex-1">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: '#94A3B8' }}
        >
          Recent Actions
        </div>
        {agent.recentActions.length === 0 ? (
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>
            No recorded actions for this demo scenario.
          </p>
        ) : (
          <div className="space-y-1.5">
            {agent.recentActions.map((action, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-2.5 py-2 rounded-lg"
                style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
              >
                <TerminalIcon
                  size={10}
                  className="mt-0.5 shrink-0"
                  style={{ color: '#94A3B8' }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="font-mono text-[10px] leading-snug"
                    style={{ color: '#475569', wordBreak: 'break-all' }}
                  >
                    {action.label}
                  </p>
                  <span className="text-[10px]" style={{ color: '#94A3B8' }}>
                    {action.ts}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
