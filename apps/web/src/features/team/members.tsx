/**
 * Project membership (plan P09, Team slice), shared by the mock and the real
 * project detail. It lists the owner and the members, changes a member's role
 * and removes a member through TeamService. The invite form follows the source:
 * the mock adds one of its users from a modal, the real backend creates an
 * account from a username and password. A source that does not support invites
 * says why in place of the control.
 */
import { useState, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import { useSessionStore } from '../../state/session'
import { Banner, Button, Card, CardHeader, Empty, Field, IconButton, Input, Locked, Modal, Person, Select, Skeleton } from '../../ui'
import { useTeamRead, useTeamWrites } from './query'

const PERMISSIONS: Readonly<Record<string, string>> = {
  owner: 'Full control of the engagement',
  manager: 'Manage scope, approve, run operations',
  operator: 'View, execute, draft findings',
  reviewer: 'View, approve, confirm findings',
  analyst: 'View, draft findings',
  viewer: 'View only',
}

export function TeamMembers({ engagementId }: { engagementId: string }): ReactElement {
  const read = useTeamRead()
  const writes = useTeamWrites()
  const confirm = useSessionStore((s) => s.confirm)
  const [open, setOpen] = useState(false)
  const [candidate, setCandidate] = useState('')
  const [role, setRole] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (read.isPending) return <Card><CardHeader title="Members" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  if (read.isError || !read.data) return <Empty title="Members are unavailable">{read.error instanceof Error ? read.error.message : 'The membership read failed.'}</Empty>
  const view = read.data
  const canManage = view.canManage
  const why = view.manageReason ?? ''
  const assignable = view.assignableRoles
  const fail = (err: unknown, fallback: string) => { setNotice(null); setError(err instanceof Error ? err.message : fallback) }
  const invite = view.invite
  // The least-privileged role the source offers is the default for a new member.
  const defaultRole = assignable.includes('viewer') ? 'viewer' : assignable[0] || 'viewer'

  const submitInvite = async () => {
    try {
      if (invite.candidates.length > 0) {
        await writes.invite({ username: candidate, displayName: candidate, role: role || defaultRole, password: '' })
        setOpen(false)
        setCandidate('')
        setNotice(`${candidate} was added to the project.`)
      } else {
        await writes.invite({ username, displayName: displayName || username, role: role || defaultRole, password })
        setUsername('')
        setDisplayName('')
        setPassword('')
        setNotice('Member invited with a persistent identity.')
      }
      setError(null)
    } catch (err) {
      fail(err, 'The invite was refused.')
    }
  }

  return (
    <div className="space-y-4" aria-label={`Members of ${engagementId}`}>
      {error && <Banner tone="bad" title="Membership change refused">{error}</Banner>}
      {notice && <p role="status" className="text-sm text-ok">{notice}</p>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Members ({view.members.length})</h3>
          <div className="flex items-center gap-2">
            {!canManage && <Locked reason={why} />}
            {invite.supported && invite.candidates.length > 0 && (
              <Button disabled={!canManage} title={canManage ? undefined : why} onClick={() => setOpen(true)}>Add Member</Button>
            )}
          </div>
        </div>
        {!invite.supported && invite.reason && <p role="note" className="mb-3 text-xs text-muted">{invite.reason}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Member</th>
                <th className="pb-2">Project role</th>
                <th className="pb-2 max-md:hidden">Permissions</th>
                <th className="pb-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {view.members.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="py-2.5 pr-3">{m.owner ? <Person name={m.label} /> : <span className="font-medium">{m.label}</span>}</td>
                  <td className="py-2.5 pr-3">
                    {m.owner ? (
                      <span className="text-xs text-muted">Project owner</span>
                    ) : canManage ? (
                      <Select aria-label={`Role of ${m.label}`} className="w-52" value={m.role} onChange={(e) => {
                        void writes.changeRole(m.id, e.target.value).then(() => { setError(null); setNotice(`${m.label}'s role changed.`) }, (err) => fail(err, 'The role change was refused.'))
                      }}>
                        {assignable.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    ) : (
                      <span className="text-xs text-muted">{m.role}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-muted max-md:hidden">{PERMISSIONS[m.role] ?? m.role}</td>
                  <td className="py-2.5 text-right">
                    {!m.owner && (
                      <IconButton icon={Trash2} label={`Remove ${m.label}`} disabled={!canManage} title={canManage ? `Remove ${m.label}` : why} onClick={() => confirm({
                        title: `Remove ${m.label} from the project?`,
                        body: 'The member loses access to the project immediately.',
                        confirmLabel: 'Remove member',
                        danger: true,
                        onConfirm: () => { void writes.remove(m.id).then(() => { setError(null); setNotice(`${m.label} was removed.`) }, (err) => fail(err, 'The removal was refused.')) },
                      })} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view.members.length <= 1 && <Empty title="No other members">Add operators, reviewers or viewers to grant access.</Empty>}
      </Card>

      {invite.supported && invite.candidates.length === 0 && (
        <Card>
          <CardHeader title="Invite a member" sub="Owner only. The invited person signs in with the username and initial password." />
          <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submitInvite() }}>
            <Field label="Username"><Input aria-label="Username" required value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canManage} /></Field>
            <Field label="Display name"><Input aria-label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canManage} /></Field>
            <Field label="Initial password"><Input aria-label="Initial password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canManage} /></Field>
            <Field label="Role"><Select aria-label="Invited role" value={role || defaultRole} onChange={(e) => setRole(e.target.value)} disabled={!canManage}>{assignable.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
            <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!canManage}>Invite member</Button></div>
          </form>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add Member" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!candidate} title={candidate ? undefined : 'Select a user'} onClick={() => void submitInvite()}>Add to project</Button></>}>
        <div className="space-y-4">
          <Field label="User" required>
            <Select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
              <option value="">Select a user…</option>
              {invite.candidates.map((n) => <option key={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Role">
            <Select value={role || defaultRole} onChange={(e) => setRole(e.target.value)}>
              {assignable.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  )
}
