import type { CSSProperties } from 'react'
import type {
  KillChainPhase,
  OpplanStatus,
  OpsecLevel,
  ScopePermission,
  ScopeTargetType,
} from './types'

export const MOCK_CHIP: CSSProperties = {
  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
  background: '#F5F3FF', color: '#7C3AED', border: '1px solid #DDD6FE',
  letterSpacing: '0.06em', whiteSpace: 'nowrap',
}

export const disabledStyle: CSSProperties = { opacity: 0.5, cursor: 'not-allowed' }

export const PHASE_LABELS: Record<KillChainPhase, string> = {
  recon: 'Recon',
  'initial-access': 'Initial Access',
  'post-exploit': 'Post-Exploit',
  c2: 'C2',
  exfiltration: 'Exfiltration',
}

export const OPSEC_LABELS: Record<OpsecLevel, string> = {
  loud: 'loud', standard: 'standard', careful: 'careful', quiet: 'quiet', silent: 'silent',
}

export function opsecBadgeStyle(level: OpsecLevel): CSSProperties {
  if (level === 'loud') return { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }
  if (level === 'silent' || level === 'quiet') return { background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }
  return { background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }
}

export function opplanStatusStyle(status: OpplanStatus): CSSProperties {
  switch (status) {
    case 'completed': return { background: '#DCFCE7', color: '#16A34A' }
    case 'in-progress': return { background: '#DBEAFE', color: '#2563EB' }
    case 'blocked': return { background: '#FFFBEB', color: '#D97706' }
    case 'cancelled': return { background: '#F1F5F9', color: '#94A3B8' }
    default: return { background: '#F1F5F9', color: '#475569' }
  }
}

export const PERMISSION_LABELS: Record<ScopePermission, string> = {
  'full-access': 'Full Access',
  'enumerate-only': 'Enumerate Only',
  'phishing-allowed': 'Phishing Allowed',
}

export function permissionBadgeStyle(p: ScopePermission): CSSProperties {
  if (p === 'full-access') return { background: '#DCFCE7', color: '#16A34A', border: '1px solid #BBF7D0' }
  if (p === 'enumerate-only') return { background: '#DBEAFE', color: '#2563EB', border: '1px solid #BFDBFE' }
  return { background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }
}

export const TARGET_TYPE_LABELS: Record<ScopeTargetType, string> = {
  cidr: 'CIDR', web: 'Web', api: 'API', host: 'Host', email: 'Email',
}

export function targetTypeBadgeStyle(t: ScopeTargetType): CSSProperties {
  if (t === 'cidr') return { background: '#DBEAFE', color: '#2563EB' }
  if (t === 'web' || t === 'api') return { background: '#EDE9FE', color: '#7C3AED' }
  if (t === 'host') return { background: '#F1F5F9', color: '#475569' }
  return { background: '#FFFBEB', color: '#D97706' }
}
