import { useState } from 'react'
import type { Project, Member, MemberRole } from '../types'
import { PlusIcon, MoreIcon, UserIcon, XIcon, CheckIcon, ChevronRightIcon, ShieldIcon, EyeIcon } from '../components/Icons'

interface Props {
  project: Project
}

const ROLE_CONFIG: Record<MemberRole, {
  label: string
  bg: string
  text: string
  border: string
  description: string
  capabilities: string[]
}> = {
  Owner: {
    label: 'Owner',
    bg: '#FEF2F2',
    text: '#DC2626',
    border: '#FECACA',
    description: 'Full control over this engagement.',
    capabilities: ['Manage members & roles', 'Configure agents & guardrails', 'View all credentials', 'Archive or delete project', 'Submit reports'],
  },
  Member: {
    label: 'Member',
    bg: '#DBEAFE',
    text: '#3B82F6',
    border: '#2563EB',
    description: 'Active pentester on this engagement.',
    capabilities: ['Run and configure agents', 'View and add findings', 'Access logs and credentials', 'Export evidence', 'Comment on findings'],
  },
  Viewer: {
    label: 'Viewer',
    bg: '#F1F5F9',
    text: '#475569',
    border: '#E2E8F0',
    description: 'Read-only access for review or oversight.',
    capabilities: ['View findings & reports', 'View project status', 'View assets & evidence', 'Cannot modify data', 'Cannot run agents'],
  },
}

const STATUS_CONFIG = {
  active:   { label: 'Active',   bg: '#DCFCE7', text: '#22C55E', dot: '#22C55E' },
  invited:  { label: 'Invited',  bg: '#FEF3C7', text: '#F59E0B', dot: '#F59E0B' },
  inactive: { label: 'Inactive', bg: '#F1F5F9', text: '#94A3B8', dot: '#94A3B8' },
}

const AVATAR_PALETTE = ['#DBEAFE', '#DCFCE7', '#FEF2F2', '#EDE9FE', '#FEF3C7']

export default function Members({ project }: Props) {
  const [members, setMembers] = useState<Member[]>(project.members ?? [])
  const [showAdd, setShowAdd] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [roleMenuOpen, setRoleMenuOpen] = useState<string | null>(null)

  const myRole: MemberRole = 'Owner'
  const canManage = myRole === 'Owner'

  const removeMember = (id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id))
    setMenuOpen(null)
  }

  const changeRole = (id: string, role: MemberRole) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, role } : m))
    setRoleMenuOpen(null)
    setMenuOpen(null)
  }

  return (
    <div
      style={{ background: '#F8FAFC', minHeight: '100vh', padding: 32 }}
      onClick={() => { setMenuOpen(null); setRoleMenuOpen(null) }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Project Members</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
            {members.filter(m => m.status === 'active').length} active · {members.length} total · roles scoped to this project
          </p>
        </div>
        {canManage && (
          <button
            onClick={e => { e.stopPropagation(); setShowAdd(true) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: '#DC2626', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            <PlusIcon size={14} /> Add Member
          </button>
        )}
      </div>

      {/* Role legend cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {(Object.entries(ROLE_CONFIG) as [MemberRole, typeof ROLE_CONFIG[MemberRole]][]).map(([role, cfg]) => {
          const IconComp = role === 'Owner' ? ShieldIcon : role === 'Member' ? UserIcon : EyeIcon
          return (
            <div key={role} style={{
              borderRadius: 12, border: '1px solid #E2E8F0', background: '#FFFFFF',
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7, background: cfg.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconComp size={13} style={{ color: cfg.text }} />
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
                }}>
                  {cfg.label}
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 8px 0' }}>{cfg.description}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {cfg.capabilities.map((cap, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11, color: '#475569' }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: cfg.text, flexShrink: 0 }} />
                    {cap}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Members table */}
      <div style={{ borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 160px 130px 160px 48px',
          gap: 16, padding: '9px 20px',
          background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94A3B8',
        }}>
          <span>User</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last Activity</span>
          <span />
        </div>

        {members.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No members yet. Add team members to collaborate on this engagement.
          </div>
        ) : (
          members.map((member, i) => {
            const rc = ROLE_CONFIG[member.role]
            const sc = STATUS_CONFIG[member.status]
            const avatarColor = AVATAR_PALETTE[i % AVATAR_PALETTE.length]
            const isMe = member.initials === 'AK'

            return (
              <div
                key={member.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 160px 130px 160px 48px',
                  gap: 16, padding: '14px 20px', alignItems: 'center',
                  borderBottom: i < members.length - 1 ? '1px solid #F1F5F9' : 'none',
                  background: 'transparent', transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                onClick={e => e.stopPropagation()}
              >
                {/* User */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: avatarColor, border: `1px solid ${rc.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: rc.text,
                  }}>
                    {member.initials}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{member.name}</span>
                      {isMe && (
                        <span style={{
                          padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                          background: '#F1F5F9', color: '#94A3B8',
                        }}>
                          You
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>{member.email}</span>
                  </div>
                </div>

                {/* Role */}
                <div>
                  <span style={{
                    display: 'inline-flex', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
                  }}>
                    {member.role}
                  </span>
                </div>

                {/* Status */}
                <div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: sc.bg, color: sc.text,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot }} />
                    {sc.label}
                  </span>
                </div>

                {/* Last activity */}
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{member.lastActivity}</div>

                {/* Actions */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  {canManage && !isMe && (
                    <button
                      onClick={e => { e.stopPropagation(); removeMember(member.id) }}
                      title="Remove member"
                      style={{
                        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 6, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', color: '#94A3B8',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2'; (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#FECACA' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent' }}
                    >
                      <XIcon size={13} />
                    </button>
                  )}
                  {canManage && !isMe && (
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(prev => prev === member.id ? null : member.id); setRoleMenuOpen(null) }}
                      style={{
                        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: '#94A3B8',
                      }}
                    >
                      <MoreIcon size={15} />
                    </button>
                  )}

                  {menuOpen === member.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: 32, zIndex: 20,
                      background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '4px', width: 200,
                    }}
                      onClick={e => e.stopPropagation()}
                    >
                      {/* Change role */}
                      <button
                        onClick={() => setRoleMenuOpen(prev => prev === member.id ? null : member.id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', fontSize: 12, color: '#475569',
                          background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 7,
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                      >
                        <span>Change Role</span>
                        <ChevronRightIcon size={12} style={{ color: '#94A3B8' }} />
                      </button>

                      {roleMenuOpen === member.id && (
                        <div style={{ margin: '2px 4px', background: '#F8FAFC', borderRadius: 7, border: '1px solid #F1F5F9', overflow: 'hidden' }}>
                          {(Object.keys(ROLE_CONFIG) as MemberRole[]).map(role => (
                            <button
                              key={role}
                              onClick={() => changeRole(member.id, role)}
                              style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '8px 12px', fontSize: 12,
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: member.role === role ? ROLE_CONFIG[role].text : '#475569',
                              }}
                              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'}
                              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                            >
                              <span style={{ fontWeight: member.role === role ? 600 : 400 }}>{ROLE_CONFIG[role].label}</span>
                              {member.role === role && <CheckIcon size={12} style={{ color: '#DC2626' }} />}
                            </button>
                          ))}
                        </div>
                      )}

                      <div style={{ height: 1, background: '#F1F5F9', margin: '4px 0' }} />

                      <button
                        onClick={() => removeMember(member.id)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12,
                          color: '#DC2626', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 7,
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2'}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                      >
                        Remove from Project
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add Member Modal */}
      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onAdd={(name, email, role) => {
            const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
            setMembers(prev => [...prev, {
              id: Date.now().toString(),
              name, initials, email, role,
              status: 'invited',
              lastActivity: '—',
            }])
            setShowAdd(false)
          }}
        />
      )}
    </div>
  )
}

function AddMemberModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (name: string, email: string, role: MemberRole) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('Member')
  const [roleOpen, setRoleOpen] = useState(false)

  const rc = ROLE_CONFIG[role]
  const valid = name.trim().length > 0 && email.includes('@')

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8, outline: 'none',
    background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#0F172A',
    boxSizing: 'border-box' as const,
  }

  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div
        style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16,
          width: '100%', maxWidth: 440, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid #F1F5F9',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: 0 }}>Add Member</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <XIcon size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Full Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter full name…"
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div>
            <label style={labelStyle}>Email Address</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              type="email"
              style={inputStyle}
            />
          </div>

          {/* Role selector */}
          <div style={{ position: 'relative' }}>
            <label style={labelStyle}>Role</label>
            <button
              onClick={() => setRoleOpen(p => !p)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 8, fontSize: 13,
                background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#0F172A', cursor: 'pointer',
              }}
            >
              <span style={{
                display: 'inline-flex', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
              }}>
                {rc.label}
              </span>
              <ChevronRightIcon size={13} style={{ color: '#94A3B8', transform: roleOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>

            {roleOpen && (
              <div style={{
                position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
                background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 10,
                zIndex: 10, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {(Object.entries(ROLE_CONFIG) as [MemberRole, typeof ROLE_CONFIG[MemberRole]][]).map(([r, cfg]) => (
                  <button
                    key={r}
                    onClick={() => { setRole(r); setRoleOpen(false) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '12px 16px',
                      background: role === r ? '#F1F5F9' : 'transparent',
                      border: 'none', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (role !== r) (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9' }}
                    onMouseLeave={e => { if (role !== r) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{
                        display: 'inline-flex', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
                      }}>
                        {cfg.label}
                      </span>
                      {role === r && <CheckIcon size={13} style={{ color: '#DC2626' }} />}
                    </div>
                    <p style={{ fontSize: 11, color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>{cfg.description}</p>
                  </button>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>{rc.description}</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: 10, padding: '14px 24px',
          borderTop: '1px solid #F1F5F9',
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => valid && onAdd(name.trim(), email.trim(), role)}
            disabled={!valid}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: valid ? '#DC2626' : '#F1F5F9',
              border: 'none',
              color: valid ? '#fff' : '#94A3B8',
              cursor: valid ? 'pointer' : 'not-allowed',
            }}
          >
            Send Invite
          </button>
        </div>
      </div>
    </div>
  )
}
