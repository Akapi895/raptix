import type { CSSProperties, ReactNode } from 'react'

export function CapabilityButton({ title, label, style, children }: { title: string; label: string; style?: CSSProperties; children: ReactNode }) {
  return <button type="button" disabled title={title} aria-label={label} style={{ ...style, opacity: 0.5, cursor: 'not-allowed' }}>{children}</button>
}
