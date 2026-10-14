/**
 * Real team panel (integration ticket 07). Reads the persisted membership
 * view from the API and performs owner-only invite/remove/role mutations.
 * In local single-user deployments the server reports inviteSupported=false
 * with its explicit reason; the panel never fakes a hierarchy.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { fetchMembers, inviteMember, removeMember, updateMemberRole, type InviteMemberInput } from '../api'
import { Button, Card, CardHeader, Empty, Input, Select, Skeleton } from '../../ui'

const ROLES = ['operator', 'reviewer', 'viewer'] as const

export function RealTeamPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const members = useQuery({
    queryKey: ['real', 'members', engagementId],
    queryFn: () => fetchMembers(engagementId),
  })
  const [form, setForm] = useState<InviteMemberInput>({ username: '', password: '', role: 'viewer', displayName: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'members', engagementId] })
  }

  const invite = useMutation({
    mutationFn: () => inviteMember(engagementId, { ...form, displayName: form.displayName || form.username }),
    onSuccess: () => {
      setForm({ username: '', password: '', role: 'viewer', displayName: '' })
      setError(null)
      setNotice('Member invited with a persistent identity.')
      invalidate()
    },
    onError: (err) => {
      setNotice(null)
      setError(err instanceof Error ? err.message : 'The invite was refused.')
    },
  })
  const remove = useMutation({
    mutationFn: (memberId: string) => removeMember(engagementId, memberId),
    onSuccess: () => {
      setError(null)
      setNotice('Membership removed. The account itself is retained.')
      invalidate()
    },
    onError: (err) => {
      setNotice(null)
      setError(err instanceof Error ? err.message : 'The removal was refused.')
    },
  })
  const reRole = useMutation({
    mutationFn: (input: { memberId: string; role: (typeof ROLES)[number] }) => updateMemberRole(engagementId, input.memberId, input.role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The role change was refused.'),
  })

  if (members.isPending) {
    return <Card><CardHeader title="Team" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (members.isError || !members.data) {
    return <Empty icon={UserPlus} title="Team data is unavailable" action={<Button onClick={() => void members.refetch()}>Retry</Button>}>
      {members.error instanceof Error ? members.error.message : 'The members read failed.'}
    </Empty>
  }
  const view = members.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Team" sub="Persisted memberships, server-enforced roles" />
        <div className="p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Member</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Source</th>
                <th className="pb-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {view.members.map((m) => (
                <tr key={`${m.id}`} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-fg">{m.label}</span>
                    <span className="ml-2 font-mono text-xs text-muted">{m.id}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {view.inviteSupported && m.role !== 'owner' ? (
                      <Select value={m.role} aria-label={`Role for ${m.label}`} onChange={(e) => reRole.mutate({ memberId: m.id, role: e.target.value as (typeof ROLES)[number] })}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    ) : (
                      <span className="text-fg">{m.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted">{m.source}</td>
                  <td className="py-2 text-right">
                    {view.inviteSupported && m.role !== 'owner' ? (
                      <Button variant="ghost" icon={Trash2} aria-label={`Remove ${m.label}`} onClick={() => remove.mutate(m.id)} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {view.inviteSupported ? (
        <Card>
          <CardHeader title="Invite a member" sub="Creates a persistent account and an engagement membership" />
          <form
            className="grid gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              invite.mutate()
            }}
          >
            <label className="text-sm text-muted" htmlFor="invite-username">Username</label>
            <Input id="invite-username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <label className="text-sm text-muted" htmlFor="invite-display">Display name</label>
            <Input id="invite-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <label className="text-sm text-muted" htmlFor="invite-password">Initial password</label>
            <Input id="invite-password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label className="text-sm text-muted" htmlFor="invite-role">Role</label>
            <Select id="invite-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as InviteMemberInput['role'] })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" icon={UserPlus} disabled={invite.isPending}>
                {invite.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                Invite member
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-muted" role="note">{view.reason ?? 'Invite actions are unavailable in this deployment.'}</p>
      )}

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}
    </div>
  )
}
