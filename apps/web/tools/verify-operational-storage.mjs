// Explicit backup/restore and three-way workspace checks against the deployed Web plane.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const api = process.env.M1_API_CONTAINER ?? 'raptix-web-raptix-api'
const runtime = process.env.M1_RUNTIME_CONTAINER ?? 'raptix-web-raptix-web-runtime-1'
const sandbox = process.env.M1_SANDBOX_CONTAINER ?? 'raptix-web-raptix-web-sandbox-1'
const directory = resolve('tests/local/artifacts/operational-m1', `${process.argv[2]?.replace(/^--/, '')}-${randomUUID().slice(0, 8)}`)
const run = (args, options = {}) => {
  try { return execFileSync('docker', args, { timeout: 60000, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }) }
  catch (error) { throw Error(`Docker ${args[0]} verification failed (${error.code ?? error.status ?? 'unknown'}); captured output withheld`) }
}
const text = args => run(args, { encoding: 'utf8' }).trim()
const environment = Object.fromEntries(JSON.parse(text(['inspect', api]))[0].Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)] }))
const command = process.argv[2]
mkdirSync(directory, { recursive: true })
const evidence = { command, at: new Date().toISOString(), checks: [] }
const check = (name, passed) => { evidence.checks.push({ name, passed }); assert.ok(passed, name) }

try {
  if (command === '--backup-restore') {
    const source = new URL(environment.DATABASE_URL).pathname.slice(1)
    assert.match(source, /^[a-zA-Z0-9_]+$/)
    // Vault-key proof chain: encrypt a probe with the live key in the API
    // container, capture it in the dump, then decrypt it from the restored
    // database using only the backed-up key file.
    const probePlaintext = `m1-restore-probe-${randomUUID()}`
    const probeId = `m1probe${randomUUID().replaceAll('-', '').slice(0, 16)}`
    if (environment.VAULT_ENCRYPTION_KEY) {
      const probe = JSON.parse(text(['exec', api, 'node', '-e',
        "const {createCipheriv,randomBytes}=require('node:crypto');const key=Buffer.from(process.env.VAULT_ENCRYPTION_KEY,'base64');const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);const ct=Buffer.concat([c.update(process.argv[1],'utf8'),c.final()]);process.stdout.write(JSON.stringify({ct:ct.toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64')}))",
        probePlaintext]))
      const engagement = text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', source, '-tAc', 'SELECT "id" FROM "Engagement" ORDER BY "createdAt" LIMIT 1'])
      assert.match(engagement, /^[a-z0-9]+$/i)
      text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', source, '-v', 'ON_ERROR_STOP=1', '-c',
        `INSERT INTO "VaultSecret" ("id","engagementId","kind","label","ciphertext","iv","authTag","createdBy","updatedAt") VALUES ('${probeId}','${engagement}','api-key','m1-restore-probe','${probe.ct}','${probe.iv}','${probe.tag}','m1-storage-probe',now())`])
      evidence.vaultProbeId = probeId
    }
    const dump = run(['exec', 'raptix-postgres', 'pg_dump', '-U', 'raptix', '-Fc', source])
    writeFileSync(resolve(directory, 'database.dump'), dump, { mode: 0o600 })
    evidence.databaseDigest = createHash('sha256').update(dump).digest('hex')
    const excludedCaches = ['node_modules', '.git', '.venv', '.cache']
    // Scope the workspace snapshot to the dedicated Web runtime volume
    // (WORKSPACE_PATH/<slug>); the parent directory also bind-mounts the
    // CLI stack's workspace, which may be written to while we read it.
    const slug = environment.RAPTIX_RUNTIME_WORKSPACE_SLUG
    assert.match(slug ?? '', /^[a-z0-9][a-z0-9-]+$/)
    const workspace = run(['exec', api, 'tar', '-czf', '-', ...excludedCaches.map(name => `--exclude=${name}`), '-C', `${environment.WORKSPACE_PATH}/${slug}`, '.'], { timeout: 180000 })
    evidence.excludedWorkspaceCaches = excludedCaches
    writeFileSync(resolve(directory, 'workspace.tar.gz'), workspace, { mode: 0o600 })
    if (environment.VAULT_ENCRYPTION_KEY) writeFileSync(resolve(directory, 'vault-key.b64'), environment.VAULT_ENCRYPTION_KEY, { mode: 0o600 })
    const restored = `raptix_m1_restore_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${restored}`])
    try {
      run(['exec', '-i', 'raptix-postgres', 'pg_restore', '-U', 'raptix', '--exit-on-error', '-d', restored], { input: dump })
      const migrations = database => text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', database, '-tAc', 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'])
      check('Restored database retains the completed migration ledger', migrations(restored) === migrations(source))
      if (environment.VAULT_ENCRYPTION_KEY) {
        const row = text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', restored, '-tAc', `SELECT "ciphertext"||'|'||"iv"||'|'||"authTag" FROM "VaultSecret" WHERE "id"='${probeId}'`])
        assert.ok(row.includes('|'), 'Vault probe row must exist in the restored database')
        const [ct, iv, tag] = row.split('|')
        const key = Buffer.from(readFileSync(resolve(directory, 'vault-key.b64'), 'utf8').trim(), 'base64')
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
        decipher.setAuthTag(Buffer.from(tag, 'base64'))
        const plaintext = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
        check('Backed-up vault key decrypts ciphertext restored from the database dump', plaintext === probePlaintext)
      }
      check('Database and workspace backup bytes captured', dump.length > 0 && workspace.length > 0)
      const workspaceManifest = `cd "\${1:-.}" && find . \\( -name node_modules -o -name .git -o -name .venv -o -name .cache \\) -prune -o -type f -printf '%P %s\\n' | sort | sha256sum | cut -d' ' -f1`
      const liveManifest = text(['exec', '-w', `${environment.WORKSPACE_PATH}/${slug}`, api, 'sh', '-c', workspaceManifest, '_'])
      // Mount the captured archive instead of streaming 260MB+ through stdin,
      // which is unreliable for `docker run -i` on Windows clients.
      const backupMount = `${directory.replaceAll('\\', '/')}:/backup:ro`
      const restoredManifest = text(['run', '--rm', '-v', backupMount, 'node:22-slim', 'sh', '-c', 'mkdir -p /ws && tar -xzf /backup/workspace.tar.gz -C /ws && sh -c "$1" _ /ws', '_', workspaceManifest], { timeout: 180000 })
      check('Restored workspace archive reproduces the live workspace manifest', restoredManifest === liveManifest)
      evidence.restoredWorkspaceDigest = restoredManifest
    } finally {
      text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE ${restored}`])
      text(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', source, '-v', 'ON_ERROR_STOP=1', '-c', `DELETE FROM "VaultSecret" WHERE "id"='${probeId}'`])
    }    evidence.restoredDatabase = restored
    evidence.vaultKeyBackedUp = !!environment.VAULT_ENCRYPTION_KEY
  } else if (command === '--roundtrip') {
    const slug = environment.RAPTIX_RUNTIME_WORKSPACE_SLUG
    assert.match(slug ?? '', /^[a-z0-9][a-z0-9-]+$/)
    const locations = [
      { name: 'API', container: api, root: `${environment.WORKSPACE_PATH}/${slug}`, node: true },
      { name: 'runtime', container: runtime, root: environment.RAPTIX_RUNTIME_WORKSPACE_ROOT },
      { name: 'sandbox', container: sandbox, root: '/workspace' },
    ]
    const created = []
    try {
      for (const source of locations) {
        const file = `.m1-${randomUUID()}.txt`
        const path = `${source.root}/${file}`
        text(['exec', source.container, ...(source.node ? ['node', '-e', 'require("fs").writeFileSync(process.argv[1],process.argv[2],{flag:"wx"})'] : ['python3', '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).open("x").write(sys.argv[2])']), path, source.name])
        created.push({ source, path })
        for (const destination of locations) {
          const value = text(['exec', destination.container, ...(destination.node ? ['node', '-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))'] : ['python3', '-c', 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).read_text(),end="")']), `${destination.root}/${file}`])
          check(`${source.name} write is visible to ${destination.name}`, value === source.name)
        }
      }
    } finally {
      for (const { source, path } of created) text(['exec', source.container, ...(source.node ? ['node', '-e', 'require("fs").unlinkSync(process.argv[1])'] : ['python3', '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).unlink(missing_ok=True)']), path])
    }
  } else throw Error('Pass --backup-restore or --roundtrip explicitly')
  evidence.passed = true
} finally {
  writeFileSync(resolve(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ evidence: resolve(directory, 'evidence.json'), checks: evidence.checks, passed: evidence.passed ?? false }))
}
