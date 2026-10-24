import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// CI bootstrap smoke, not the DB/LLM-backed deployed gate. No .env, credentials,
// host data volumes or API interception. The Dockerfile's default mode is
// tested: the API starts degraded without DATABASE_URL,
// the console boots on the real capabilities document, refuses unavailable
// data sources and never falls back to demo data (ADR-0068).
const uiImage = process.env.IW05_UI_IMAGE ?? 'raptix-web-raptix-ui:ci'
const apiImage = process.env.IW05_API_IMAGE ?? 'raptix-web-raptix-server:ci'
const output = resolve(process.env.IW05_EVIDENCE_DIR ?? 'apps/web/test-results-deployed/iw05')
mkdirSync(output, { recursive: true })
const network = `raptix-iw05-${randomUUID().slice(0, 8)}`
const containers = []
const requests = []
let networkCreated = false, browser, page
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
try {
  docker(['network', 'create', network])
  networkCreated = true
  const api = `${network}-api`
  docker(['run', '-d', '--name', api, '--network', network, '--network-alias', 'web-raptix-api', '-e', 'HOST=0.0.0.0', '-e', 'PORT=8081', apiImage, 'node', 'dist/main.js'])
  containers.push(api)
  const ui = `${network}-ui`
  docker(['run', '-d', '--name', ui, '--network', network, '-p', '127.0.0.1::8080', uiImage])
  containers.push(ui)
  const port = docker(['port', ui, '8080/tcp']).match(/:(\d+)$/)?.[1]
  assert.ok(port, 'Docker must publish a loopback-only ephemeral UI port')
  const base = `http://127.0.0.1:${port}`
  let health
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) { health = await response.json(); break }
    } catch (error) { console.log('Waiting for isolated bootstrap API:', error.message) }
    await sleep(1000)
  }
  assert.equal(health?.service, 'web-raptix-server', 'nginx must reach the actual compiled new API')
  const capabilities = await (await fetch(`${base}/api/capabilities`)).json()
  assert.equal(capabilities.capabilities.projects.available, false, 'This smoke intentionally has no database')
  const unconfigured = await fetch(`${base}/api/engagements`)
  assert.ok(unconfigured.status >= 400, 'The unconfigured engagements API must not fabricate a successful data response')
  browser = await chromium.launch({ channel: 'chromium' })
  page = await browser.newPage()
  page.on('request', request => { if (request.url().startsWith(`${base}/api/`)) requests.push(request.url()) })
  await Promise.all([
    page.waitForResponse(response => response.url() === `${base}/api/capabilities`, { timeout: 15000 }),
    page.goto(`${base}/#/projects`, { waitUntil: 'domcontentloaded' }),
  ])
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 15000 })
  await page.getByText('Projects are unavailable on this server').waitFor({ timeout: 15000 })
  assert.ok(!requests.some(url => url === `${base}/api/engagements`), 'The console must not read engagement data while the capability is unavailable')
  const body = await page.locator('body').innerText()
  for (const fixture of ['RT-2026-014', 'Internal Red Team Q4', 'Alex Morgan']) assert.ok(!body.includes(fixture), `Docker must not render demo fixture ${fixture}`)
  await page.screenshot({ path: resolve(output, 'docker-real-mode.png'), fullPage: true })
  writeFileSync(resolve(output, 'smoke.json'), JSON.stringify({ uiImage, apiImage, bootstrapOnly: true, apiRequests: requests, unconfiguredProjectsStatus: unconfigured.status, passed: true }, null, 2))
  console.log('PASS Docker default real-mode: the console boots on the real capabilities document, refuses unavailable data sources and never falls back to demo data')
} catch (error) {
  writeFileSync(resolve(output, 'smoke.json'), JSON.stringify({ uiImage, apiImage, bootstrapOnly: true, apiRequests: requests, passed: false, error: error.message }, null, 2))
  for (const name of containers) {
    try { console.error(docker(['logs', name])) } catch (cause) { console.error('Smoke diagnostics:', cause.message) }
  }
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(cause => console.error('Failure screenshot:', cause.message))
  throw error
} finally {
  if (browser) await browser.close()
  for (const name of containers.reverse()) {
    try { docker(['rm', '-f', name]) } catch (error) { console.error('Smoke container cleanup failed:', error.message); process.exitCode = 1 }
  }
  if (networkCreated) {
    try { docker(['network', 'rm', network]) } catch (error) { console.error('Smoke network cleanup failed:', error.message); process.exitCode = 1 }
  }
}
