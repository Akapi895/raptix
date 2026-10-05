import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium} from 'playwright'

const base=process.env.P1_BASE_URL??'http://127.0.0.1:3000'
const output=resolve('apps/web/test-results-deployed/p1')
mkdirSync(output,{recursive:true})
const health=await(await fetch(base+'/api/health')).json()
const ready=await(await fetch(base+'/api/health/ready')).json()
assert.equal(health.scope,'process_liveness')
assert.equal(health.checks.integrations.status,'not_checked')
assert.equal(ready.scope,'dependency_wiring')
assert.ok(ready.notProbed.includes('model_inference'))
assert.ok(ready.notProbed.includes('tool_execution'))
const projects=await(await fetch(base+'/api/engagements')).json()
const project=projects.find(p=>p.metadataState==='verified')
assert.ok(project,'Live readiness copy gate requires a real engagement')
const browser=await chromium.launch({channel:'chromium'})
try{
  const page=await browser.newPage()
  await page.goto(`${base}/projects/${project.id}/settings`)
  await page.getByText(/Credentials Vault provides encrypted secret storage/).waitFor()
  assert.equal(await page.getByText(/No integration registry or secret storage service exists/).count(),0)
  await page.screenshot({path:resolve(output,'settings-readiness.png'),fullPage:true})
  writeFileSync(resolve(output,'readiness.json'),JSON.stringify({health,ready,settingsCopyVerified:true},null,2))
  console.log('PASS live P1 readiness scopes, unprobed operations and Vault-aware Settings copy')
}finally{await browser.close()}
