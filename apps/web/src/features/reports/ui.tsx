import type { ReactNode } from 'react'
import { AlertTriangleIcon } from '../../components/Icons'
export { CapabilityButton } from '../../shared/ui/CapabilityButton'

export function CapabilityNotice({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
        padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400E', lineHeight: 1.55,
        ...style,
      }}
    >
      <AlertTriangleIcon size={14} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}
