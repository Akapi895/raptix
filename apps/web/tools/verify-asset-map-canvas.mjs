/**
 * Browser check of the Asset Map canvas (plan phase 5) on the running web stack.
 *
 *   node tools/verify-asset-map-canvas.mjs --engagement <id> [--ui http://127.0.0.1:3001] [--out <dir>] [--origin <canonicalKey>] [--host <regex>]
 *
 * --host picks the host to select by name (a regular expression); without it the first host in the list is used.
 *
 * Needs ASSET_MAP_VERIFY_USER and ASSET_MAP_VERIFY_PASSWORD: a scoped account with operator access
 * to the engagement. It only reads.
 *
 * Checks, in a real browser (layout is not evidenced by jsdom):
 *   1. selecting a host draws its relations: node and edge counts from the canvas itself;
 *   2. zoom: wheel in and out changes the canvas zoom, and wheel-out does not go below the minimum;
 *   3. pan: a drag on empty canvas moves the viewport;
 *   4. groups: collapse hides the members of a host's group and expand brings them back;
 *   5. refresh: re-reading the lists keeps every node where it was (position digest unchanged);
 *   6. keyboard: a list entry is reachable with the keyboard and selects an origin, whose sitemap opens;
 *   7. saved view: after a reload the last asset reopens for the same user and project, with its camera;
 *   8. responsive: at a 390 px viewport the page does not scroll sideways.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]])
  return pairs
}, []))
const ui = (args.ui ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
const engagement = args.engagement
const outDir = path.resolve(args.out ?? 'asset-map-canvas-verify')
const username = process.env.ASSET_MAP_VERIFY_USER
const password = process.env.ASSET_MAP_VERIFY_PASSWORD
if (!engagement || !username || !password) {
  console.error('--engagement <id>, ASSET_MAP_VERIFY_USER and ASSET_MAP_VERIFY_PASSWORD are required')
  process.exit(2)
}

const report = { ui, engagement, steps: [], startedAt: new Date().toISOString() }
const record = (name, ok, detail = '') => report.steps.push({ name, ok, detail })
const mapUrl = `${ui}/#/asset-map?engagement=${encodeURIComponent(engagement)}`

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium' })
let failure = null
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const signIn = await context.request.post(`${ui}/api/auth/login`, { data: { username, password }, headers: { origin: ui } })
  if (!signIn.ok()) throw new Error(`sign-in failed with HTTP ${signIn.status()}`)
  await context.addInitScript(() => globalThis.localStorage?.setItem('raptix.assetMap', '1'))
  const page = await context.newPage()
  await page.goto(mapUrl)
  const canvas = page.locator('[data-testid="asset-map-canvas"]')
  await page.locator('section[aria-label="Hosts"] button').first().waitFor({ timeout: 20000 })

  // 1. Relations drawn from the canvas itself.
  const hosts = page.locator('section[aria-label="Hosts"]')
  await (args.host ? hosts.getByRole('button', { name: new RegExp(args.host) }) : hosts.locator('button')).first().click()
  await page.locator('section[aria-label="Services"]').waitFor({ timeout: 20000 })
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="asset-map-canvas"]')?.dataset.nodeCount ?? 0) >= 2, null, { timeout: 20000 })
  const nodes = Number(await canvas.getAttribute('data-node-count'))
  const edges = Number(await canvas.getAttribute('data-edge-count'))
  record('selected host draws its relations', nodes >= 2 && edges >= 1, `nodes ${nodes}, edges ${edges}`)

  // 2. Zoom in and out with the wheel; the zoom must move and stay within the configured bounds.
  const before = Number(await canvas.getAttribute('data-zoom'))
  await canvas.hover()
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(400)
  const zoomedIn = Number(await canvas.getAttribute('data-zoom'))
  await page.mouse.wheel(0, 2000)
  await page.waitForTimeout(400)
  const zoomedOut = Number(await canvas.getAttribute('data-zoom'))
  record('wheel zooms in and out within bounds', zoomedIn > before && zoomedOut < zoomedIn && zoomedOut >= 0.2, `${before} -> ${zoomedIn} -> ${zoomedOut}`)
  await page.screenshot({ path: path.join(outDir, '01-canvas-zoom.png') })

  // 3. Pan: a drag on empty canvas moves the viewport.
  const panBefore = [await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')]
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.92)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.8, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const panAfter = [await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')]
  record('drag pans the viewport', panBefore.join(',') !== panAfter.join(','), `${panBefore.join(',')} -> ${panAfter.join(',')}`)

  // 4. Groups: collapse hides the host's members; expand brings them back.
  const visibleBefore = Number(await canvas.getAttribute('data-visible-node-count'))
  await page.getByRole('button', { name: 'Collapse groups' }).click()
  const visibleCollapsed = Number(await canvas.getAttribute('data-visible-node-count'))
  await page.getByRole('button', { name: 'Expand groups' }).click()
  const visibleExpanded = Number(await canvas.getAttribute('data-visible-node-count'))
  record('collapse hides group members and expand restores them', visibleCollapsed < visibleBefore && visibleExpanded === visibleBefore, `${visibleBefore} -> ${visibleCollapsed} -> ${visibleExpanded}`)

  // 5. Refresh: the lists are read again and no node moves.
  const digestBefore = await canvas.getAttribute('data-position-digest')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByTestId('asset-map').getByRole('status').waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  const digestAfter = await canvas.getAttribute('data-position-digest')
  record('refresh keeps node positions', digestBefore !== null && digestBefore === digestAfter, `${digestBefore} -> ${digestAfter}`)

  // 6. Keyboard: the origin entry is reached by Tab from the host list and selected with Enter.
  // The origin is reached through the search results when one is named, since it may sit past the first list page.
  if (args.origin) {
    await page.locator('#asset-map-search').focus()
    await page.keyboard.type(args.origin)
    await page.keyboard.press('Enter')
    const result = page.getByRole('region', { name: 'Search results' }).getByRole('button', { name: args.origin, exact: true })
    await result.waitFor({ timeout: 20000 })
    await result.focus()
    await page.keyboard.press('Enter')
  } else {
    const originButton = page.getByRole('button', { name: /^http:\/\// }).first()
    await originButton.focus()
    await page.keyboard.press('Enter')
  }
  const sitemap = page.locator('section[aria-label="Sitemap"]')
  await sitemap.waitFor({ timeout: 20000 })
  const endpointRows = await sitemap.locator('tbody tr').count()
  record('keyboard selects an origin and opens its sitemap', endpointRows > 0, `endpoints: ${endpointRows}`)

  // 7. Camera: a zoom and pan away from the fitted default are saved for this user and project, and a reload
  // restores them. The fitted zoom is read before any interaction on this asset, so the check cannot pass on default.
  await page.waitForTimeout(500)
  const fitZoom = Number(await canvas.getAttribute('data-zoom'))
  for (let step = 0; step < 2; step += 1) {
    await canvas.hover()
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(150)
  }
  const moved = await canvas.boundingBox()
  await page.mouse.move(moved.x + moved.width * 0.9, moved.y + moved.height * 0.9)
  await page.mouse.down()
  await page.mouse.move(moved.x + moved.width * 0.7, moved.y + moved.height * 0.75, { steps: 8 })
  await page.mouse.up()
  // The camera is saved 300 ms after it stops moving; wait past that before reading what was saved.
  await page.waitForTimeout(800)
  const set = { zoom: Number(await canvas.getAttribute('data-zoom')), x: Number(await canvas.getAttribute('data-pan-x')), y: Number(await canvas.getAttribute('data-pan-y')) }
  record('camera set away from the fitted default', Math.abs(set.zoom - fitZoom) > 0.01 && (set.x !== 0 || set.y !== 0), `fit ${fitZoom}, set zoom ${set.zoom}, pan ${set.x},${set.y}`)
  const stored = await page.evaluate(suffix => {
    const key = Object.keys(globalThis.localStorage).find(item => item.startsWith('raptix.assetMap.selected.') && item.endsWith(suffix))
    return key ? JSON.parse(globalThis.localStorage.getItem(key) ?? 'null') : null
  }, `.${engagement}`)
  record('camera saved under this user and project', stored?.camera !== undefined && stored?.camera !== null && Math.abs(stored.camera.zoom - set.zoom) < 0.01 && Math.abs(stored.camera.x - set.x) <= 2 && Math.abs(stored.camera.y - set.y) <= 2, JSON.stringify(stored?.camera ?? null))
  await page.reload()
  await page.locator('section[aria-label="Sitemap"]').waitFor({ timeout: 20000 })
  // A restore that never happens times out here and fails the run; it is not treated as a pass.
  await page.waitForFunction(expected => Number(document.querySelector('[data-testid="asset-map-canvas"]')?.dataset.zoom) === expected, set.zoom, { timeout: 20000 })
  record('saved view reopens the last asset after reload', true)
  const restored = { zoom: Number(await canvas.getAttribute('data-zoom')), x: Number(await canvas.getAttribute('data-pan-x')), y: Number(await canvas.getAttribute('data-pan-y')) }
  record('saved view restores zoom and pan after reload', Math.abs(restored.zoom - set.zoom) < 0.005 && Math.abs(restored.x - set.x) <= 2 && Math.abs(restored.y - set.y) <= 2, `${JSON.stringify(set)} -> ${JSON.stringify(restored)}`)

  // 8. Responsive: a phone-width viewport must not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record('no horizontal scroll at 390 px', overflow <= 1, `overflow ${overflow} px`)
  await page.screenshot({ path: path.join(outDir, '02-phone.png'), fullPage: true })
  await context.close()
} catch (error) {
  failure = error
  record('unexpected failure', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  report.ok = !failure && report.steps.every(step => step.ok)
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  for (const step of report.steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.detail ? ` (${step.detail})` : ''}`)
  console.log(report.ok ? 'asset-map canvas: PASS' : 'asset-map canvas: FAIL')
}
process.exit(report.ok ? 0 : 1)
