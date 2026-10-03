import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const engagement = process.env.IW04_ENGAGEMENT_ID
if (!engagement || !process.argv.includes('--recreate-api')) throw Error('Set IW04_ENGAGEMENT_ID and pass --recreate-api for this live gate')
const base = process.env.IW04_BASE_URL ?? 'http://127.0.0.1:3000'
const output = resolve(process.env.IW04_EVIDENCE_DIR ?? 'clients/web-raptix/test-results-deployed/iw04')
mkdirSync(output, { recursive: true })
const checks = []
const check = (name, ok) => { checks.push({name,ok}); console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) throw Error(name) }
const secret = `synthetic-iw04-${randomBytes(8).toString('hex')}`
const label = `IW04 persistence ${Date.now()}`
const list = async () => (await (await fetch(`${base}/api/engagements/${engagement}/vault/secrets`)).json()).secrets
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage()
let secretId
try {
  const capabilities = await (await fetch(`${base}/api/capabilities`)).json()
  check('Vault available with configured key', capabilities.capabilities.vault.available === true)
  await page.goto(`${base}/projects/${engagement}/credentials`)
  await page.getByLabel('Secret label').fill(label)
  await page.getByLabel('Secret value').fill(secret)
  const created = page.waitForResponse(r => r.url().endsWith('/vault/secrets') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Store secret', exact: true }).click()
  const response = await created
  check('Store acknowledged by live API', response.status() === 201)
  const stored = await response.json()
  secretId = stored.id
  check('Store returns redacted metadata', !JSON.stringify(stored).includes(secret) && !Object.hasOwn(stored, 'ciphertext'))
  await page.getByText(label, {exact:true}).waitFor()
  check('List contains metadata only', !JSON.stringify(await list()).includes(secret))
  check('UI hides plaintext before reveal', !(await page.locator('body').innerText()).includes(secret))
  const row = page.getByText(label,{exact:true}).locator('xpath=../../..')
  const reveal = page.waitForResponse(r => r.url().endsWith(`/vault/secrets/${secretId}/reveal`))
  await row.getByRole('button', {name:'Reveal',exact:true}).click()
  check('Explicit reveal decrypts original value', (await (await reveal).json()).plaintext === secret)
  check('Reveal recorded in metadata audit', (await list()).find(s=>s.id===secretId).revealCount === 1)

  const query = `(async()=>{const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT ciphertext FROM "VaultSecret" WHERE id=$1',[${JSON.stringify(secretId)}]);console.log(JSON.stringify({encrypted:r.rows[0].ciphertext!==${JSON.stringify(secret)}&&r.rows[0].ciphertext!==${JSON.stringify(Buffer.from(secret).toString('base64'))}}));await c.end()})()`
  const encrypted = JSON.parse(execFileSync('docker',['exec','raptix-web-raptix-api','node','-e',query],{encoding:'utf8'}))
  check('DB stores ciphertext rather than plaintext/base64 plaintext', encrypted.encrypted)
  execFileSync('node',['clients/web-raptix/tools/configure-local-vault-key.mjs'],{stdio:'inherit'})
  execFileSync('docker',['compose','-f','docker-compose.web-raptix.yml','up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','web-raptix-api'],{stdio:'inherit',timeout:180000})
  await page.reload()
  await page.getByText(label,{exact:true}).waitFor({timeout:60000})
  const afterRestart = page.waitForResponse(r => r.url().endsWith(`/vault/secrets/${secretId}/reveal`))
  await page.getByText(label,{exact:true}).locator('xpath=../../..').getByRole('button',{name:'Reveal',exact:true}).click()
  check('Restart/recreate retains key and decrypts stored secret', (await (await afterRestart).json()).plaintext === secret)
  check('Second reveal increments audit', (await list()).find(s=>s.id===secretId).revealCount === 2)
  const revoke = page.waitForResponse(r => r.url().endsWith(`/vault/secrets/${secretId}`) && r.request().method() === 'DELETE')
  await page.getByText(label,{exact:true}).locator('xpath=../../..').getByRole('button',{name:'Revoke',exact:true}).click()
  check('Revoke acknowledged', (await revoke).ok())
  check('Revoked secret absent from list', !(await list()).some(s=>s.id===secretId))
  const auditQuery = `(async()=>{const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT action FROM "VaultAudit" WHERE "secretId"=$1',[${JSON.stringify(secretId)}]);console.log(JSON.stringify(r.rows.map(r=>r.action)));await c.end()})()`
  const actions=JSON.parse(execFileSync('docker',['exec','raptix-web-raptix-api','node','-e',auditQuery],{encoding:'utf8'}))
  check('Audit survives revoke (created/revealed/revoked)', actions.includes('created')&&actions.filter(a=>a==='revealed').length===2&&actions.includes('revoked'))
} finally {
  writeFileSync(resolve(output,'vault.json'),JSON.stringify({engagementId:engagement,secretId,checks},null,2))
  await browser.close()
}
