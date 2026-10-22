import { apiFetch } from '../../platform/transport';
import { isMembersView, type MembersView } from '@raptix/web-contracts';
import { owned } from '../../platform/ownership';

export function fetchMembers(engagementId: string): Promise<MembersView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members`, owned(engagementId, isMembersView))
}

export interface InviteMemberInput { username: string; displayName?: string; password: string; role: 'operator' | 'reviewer' | 'viewer' }

export function inviteMember(engagementId: string, input: InviteMemberInput): Promise<{ ok: true; memberId: string }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members`, (v): v is { ok: true; memberId: string } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true && typeof (v as { memberId?: unknown }).memberId === 'string',
  { method: 'POST', body: input })
}

export function updateMemberRole(engagementId: string, memberId: string, role: 'operator' | 'reviewer' | 'viewer'): Promise<{ ok: true; role: string }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members/${encodeURIComponent(memberId)}`, (v): v is { ok: true; role: string } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true && typeof (v as { role?: unknown }).role === 'string',
  { method: 'PATCH', body: { role } })
}

export function removeMember(engagementId: string, memberId: string): Promise<{ ok: true }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members/${encodeURIComponent(memberId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'DELETE' })
}
