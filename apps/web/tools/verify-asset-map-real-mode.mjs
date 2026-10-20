/**
 * Real-mode check of the Asset Map flow on the running web stack (plan phase 4–5).
 *
 *   node tools/verify-asset-map-real-mode.mjs --engagement <id> [--ui http://127.0.0.1:3000] [--out <dir>]
 *
 * Checks, in a real browser against the real API and graph:
 *   1. With the flag off (no opt-in) the page does not render.
 *   2. With the flag on: hosts and origins list from the catalog; selecting a host shows its services
 *      and its relations on the canvas; selecting the origin shows its sitemap with redacted URLs;
 *      the inspector lists sources and evidence.
 *
 * It only reads. It exits non-zero with the failing step named, and writes a screenshot per step.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]])
  return pairs
}, []))
const ui = (args.ui ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const engagement = args.engagement
const outDir = path.resolve(args.out ?? 'asset-map-verify')
if (!engagement) {
  console.error('--engagement <id> is required')
  process.exit(2)
}

const username = process.env.ASSET_MAP_VERIFY_USER
const password = process.env.ASSET_MAP_VERIFY_PASSWORD
if (!username || !password) {
  console.error('ASSET_MAP_VERIFY_USER and ASSET_MAP_VERIFY_PASSWORD must be set (a scoped test account with operator access)')
  process.exit(2)
}

/** Signs the browser context in through the real login endpoint; the session cookie is shared with pages. */
async function signIn(context) {
  const response = await context.request.post(`${ui}/api/auth/login`, { data: { username, password }, headers: { origin: ui } })
  if (!response.ok()) throw new Error(`sign-in failed with HTTP ${response.status()}`)
}

const report = { ui, engagement, steps: [], startedAt: new Date().toISOString() }
const record = (name, ok, detail = '') => report.steps.push({ name, ok, detail })

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium' })
let failed = null
try {
  // 1. Flag off: a fresh context has no opt-in, so the map must not render.
  const off = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await signIn(off)
  const offPage = await off.newPage()
  await offPage.goto(`${ui}/#/asset-map?engagement=${encodeURIComponent(engagement)}`)
  await offPage.waitForTimeout(2500)
  const offVisible = await offPage.locator('[data-testid="asset-map"]').count()
  record('flag off hides the Asset Map', offVisible === 0, `asset-map nodes: ${offVisible}`)
  await offPage.screenshot({ path: path.join(outDir, '01-flag-off.png') })
  await off.close()

  // 2. Flag on.
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await signIn(context)
  await context.addInitScript(() => globalThis.localStorage?.setItem('raptix.assetMap', '1'))
  const page = await context.newPage()
  await page.goto(`${ui}/#/asset-map?engagement=${encodeURIComponent(engagement)}`)
  await page.locator('[data-testid="asset-map"]').waitFor({ timeout: 20000 })
  record('flag on renders the Asset Map', true)

  const hostButtons = page.locator('section[aria-label="Hosts"] button')
  await hostButtons.first().waitFor({ timeout: 20000 })
  const hostCount = await hostButtons.count()
  record('hosts list from the catalog', hostCount > 0, `hosts: ${hostCount}`)
  await page.screenshot({ path: path.join(outDir, '02-overview.png') })

  const selectedAt = Date.now()
  await hostButtons.first().click()
  await page.locator('section[aria-label="Services"]').waitFor({ timeout: 20000 })
  const serviceRows = await page.locator('section[aria-label="Services"] tbody tr').count()
  record('host shows its services', serviceRows > 0, `services: ${serviceRows}`)
  await page.locator('[data-testid="asset-map-canvas"] canvas').first().waitFor({ timeout: 20000 })
  const canvasReadyMs = Date.now() - selectedAt
  report.canvasReadyMs = canvasReadyMs
  record('relations render on the canvas', true, `ready ${canvasReadyMs} ms after selection, budget 2000 ms`)
  record('canvas ready within 2 s of selection', canvasReadyMs <= 2000, `${canvasReadyMs} ms`)
  const evidence = await page.locator('[data-testid="evidence"] li').count()
  record('inspector lists evidence', evidence > 0, `evidence refs: ${evidence}`)
  await page.screenshot({ path: path.join(outDir, '03-host.png') })

  const originButtons = page.locator('section[aria-label="Web origins"] button')
  const originCount = await originButtons.count()
  record('web origins list from the catalog', originCount > 0, `origins: ${originCount}`)
  await originButtons.first().click()
  await page.locator('section[aria-label="Sitemap"]').waitFor({ timeout: 20000 })
  const endpointRows = await page.locator('section[aria-label="Sitemap"] tbody tr').count()
  record('origin shows its sitemap', endpointRows > 0, `endpoints: ${endpointRows}`)
  const sitemapText = await page.locator('section[aria-label="Sitemap"]').innerText()
  const leaked = /hunter2|abc123/.test(sitemapText)
  record('sitemap shows no credentials', !leaked)
  await page.screenshot({ path: path.join(outDir, '04-origin-sitemap.png') })
  await context.close()
} catch (error) {
  failed = error
  record('unexpected failure', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  report.ok = !failed && report.steps.every(step => step.ok)
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  for (const step of report.steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.detail ? ` (${step.detail})` : ''}`)
  console.log(report.ok ? 'asset-map real-mode: PASS' : 'asset-map real-mode: FAIL')
}
process.exit(report.ok ? 0 : 1)
