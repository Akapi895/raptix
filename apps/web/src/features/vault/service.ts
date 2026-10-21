/**
 * Mock credentials-vault service (ADR-0067). Mirrors the real engagement
 * vault's semantics (integration ticket 16): the list view carries redacted
 * metadata only, reveal is an explicit audited action whose value lives only
 * in the requesting session, and every store/reveal/revoke appends an audit
 * record. Demo plaintext is seeded data; the real integration keeps
 * plaintext server-side and never in any list.
 */
import { can, ROLE_LABEL } from '../../domain/policy'
import { stamp } from '../../domain/demo-clock'
import type { Project, VaultSecret } from '../../domain/entities'
import type { DbAuthority } from '../../domain/database'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** List-safe metadata projection; never carries the demo plaintext. */
export type VaultSecretMeta = Omit<VaultSecret, 'demoPlaintext'>

const toMeta = (s: VaultSecret): VaultSecretMeta => ({ id: s.id, projectId: s.projectId, kind: s.kind, label: s.label, revealCount: s.revealCount, lastRevealedAt: s.lastRevealedAt, createdAt: s.createdAt, createdBy: s.createdBy })

const role = (ctx: RequestContext) => ROLE_LABEL[ctx.actor.role]

const findProject = (authority: DbAuthority, ctx: RequestContext): Project | undefined =>
  authority.snapshot().projects.find((x) => x.id === ctx.projectId)

export function listVaultSecrets(authority: DbAuthority, ctx: RequestContext): ServiceResult<VaultSecretMeta[]> {
  const p = findProject(authority, ctx)
  if (!p) return { ok: false, failure: { kind: 'not-found', message: 'Project not found.' } }
  return { ok: true, data: authority.snapshot().vaultSecrets.filter((s) => s.projectId === p.id).map(toMeta) }
}

/** Explicit reveal: returns the seeded demo value once, bumps the audited reveal count. */
export function revealVaultSecret(authority: DbAuthority, ctx: RequestContext, secretId: string): ServiceResult<{ secretId: string; plaintext: string }> {
  const p = findProject(authority, ctx)
  if (!p) return { ok: false, failure: { kind: 'not-found', message: 'Project not found.' } }
  if (!can(ctx.actor, 'viewSensitive', p)) return { ok: false, failure: { kind: 'forbidden', message: `The ${role(ctx)} role cannot reveal vault secrets.` } }
  const secret = authority.snapshot().vaultSecrets.find((s) => s.id === secretId && s.projectId === p.id)
  if (!secret) return { ok: false, failure: { kind: 'not-found', message: 'Secret not found in this project.' } }
  authority.commit(ctx.corr, (db) => {
    const row = db.vaultSecrets.find((s) => s.id === secretId)!
    row.revealCount += 1
    row.lastRevealedAt = stamp()
    db.audit.unshift({ id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Revealed vault secret', obj: secretId, projectId: p.id, result: 'Success', reason: 'Explicit in-session reveal' })
  })
  return { ok: true, data: { secretId, plaintext: secret.demoPlaintext } }
}

export function createVaultSecret(authority: DbAuthority, ctx: RequestContext, input: { kind: string; label: string; plaintext: string }): ServiceResult<VaultSecretMeta> {
  const p = findProject(authority, ctx)
  if (!p) return { ok: false, failure: { kind: 'not-found', message: 'Project not found.' } }
  if (!can(ctx.actor, 'editScope', p)) return { ok: false, failure: { kind: 'forbidden', message: `The ${role(ctx)} role cannot store vault secrets.` } }
  const kind = input.kind.trim()
  const label = input.label.trim()
  if (!kind || !label || !input.plaintext) return { ok: false, failure: { kind: 'validation', message: 'Kind, label and a secret value are required.' } }
  const id = `VS-${p.id.slice(-3)}-${String(authority.snapshot().vaultSecrets.length + 1).padStart(2, '0')}-${Date.now().toString(36).slice(-4)}`
  authority.commit(ctx.corr, (db) => {
    db.vaultSecrets.push({ id, projectId: p.id, kind, label, demoPlaintext: input.plaintext, revealCount: 0, createdAt: stamp(), createdBy: ctx.actor.id })
    db.audit.unshift({ id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Stored vault secret', obj: id, projectId: p.id, result: 'Success', reason: `Kind ${kind}` })
  })
  const stored = authority.snapshot().vaultSecrets.find((s) => s.id === id)!
  return { ok: true, data: toMeta(stored) }
}

export function revokeVaultSecret(authority: DbAuthority, ctx: RequestContext, secretId: string): ServiceResult<{ ok: true }> {
  const p = findProject(authority, ctx)
  if (!p) return { ok: false, failure: { kind: 'not-found', message: 'Project not found.' } }
  if (!can(ctx.actor, 'editScope', p)) return { ok: false, failure: { kind: 'forbidden', message: `The ${role(ctx)} role cannot revoke vault secrets.` } }
  const secret = authority.snapshot().vaultSecrets.find((s) => s.id === secretId && s.projectId === p.id)
  if (!secret) return { ok: false, failure: { kind: 'not-found', message: 'Secret not found in this project.' } }
  authority.commit(ctx.corr, (db) => {
    db.vaultSecrets = db.vaultSecrets.filter((s) => s.id !== secretId)
    db.audit.unshift({ id: 'AU-' + ++db.counters.audit, at: stamp(), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Revoked vault secret', obj: secretId, projectId: p.id, result: 'Success', reason: 'Encrypted material deleted (demo)' })
  })
  return { ok: true, data: { ok: true } }
}

/** Vault port (plan P09, Vault slice): list, reveal, store and revoke for one engagement. */
export interface VaultRead {
  secrets: VaultSecretMeta[]
  truncated: boolean
  /** Whether this actor may reveal a value or revoke a secret; the reason is shown where the control would be. */
  canReveal: boolean
  revealReason: string | null
  canManage: boolean
  manageReason: string | null
}

export interface VaultRevealed { secretId: string; plaintext: string; revealedAt: string | null }

export interface VaultService {
  list(ctx: RequestContext): Promise<ServiceResult<VaultRead>>
  reveal(ctx: RequestContext, secretId: string): Promise<ServiceResult<VaultRevealed>>
  store(ctx: RequestContext, input: { kind: string; label: string; plaintext: string }): Promise<ServiceResult<VaultSecretMeta>>
  revoke(ctx: RequestContext, secretId: string): Promise<ServiceResult<{ ok: true }>>
}

