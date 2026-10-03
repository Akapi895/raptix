import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Explicit, one-time bootstrap. The key stays in the operator's ignored .env,
// is never printed, and an existing valid key is never rotated implicitly.
const path = resolve(process.argv[2] ?? '.env')
const original = readFileSync(path, 'utf8')
const entries = original.match(/^VAULT_ENCRYPTION_KEY=.*$/gm) ?? []
if (entries.length > 1) throw Error('Duplicate VAULT_ENCRYPTION_KEY entries; resolve them before configuring the vault')
const raw = entries[0]?.slice('VAULT_ENCRYPTION_KEY='.length).trim().replace(/^(['"])(.*)\1$/, '$2') ?? ''
if (raw) {
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32 || key.toString('base64') !== raw) throw Error('Existing VAULT_ENCRYPTION_KEY is invalid; it has not been changed')
  console.log('Existing valid vault key retained; no rotation performed')
} else {
  const entry = `VAULT_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const updated = entries.length ? original.replace(/^VAULT_ENCRYPTION_KEY=.*$/m, entry) : `${original}${original.endsWith('\n') ? '' : newline}${entry}${newline}`
  const temporary = `${path}.vault-init.tmp`
  writeFileSync(temporary, updated, { mode: statSync(path).mode, flag: 'wx' })
  renameSync(temporary, path)
  console.log('Persistent 32-byte vault key configured; value withheld')
}
