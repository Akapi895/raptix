import { test, expect } from '@playwright/test'

const pages = [
  ['Charter & ROE', 'charter'], ['Scope & Boundary', 'scope'],
  ['Operator Console', 'console'], ['Vector Campaigns', 'campaigns'], ['C2 & Sessions', 'sessions'],
  ['Infrastructure & Data', 'infrastructure'], ['Assets & Inventory', 'assets'], ['Credentials Vault', 'credentials'],
  ['Findings & Evidence', 'findings'], ['Operations Log', 'logs'], ['Reports', 'reports'],
  ['Members', 'members'], ['Settings', 'settings'],
] as const

test('sidebar has exactly the requested 13 tabs and every source page renders without backend requests', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/api\//.test(request.url())) apiRequests.push(request.url()) })
  await page.goto('/projects/1/charter')
  const nav = page.locator('aside nav')
  await expect(nav.getByRole('button')).toHaveCount(13)
  const labels = await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
  expect(labels).toEqual(pages.map(([label]) => label))
  for (const [label, path] of pages) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/1/${path}$`))
    await expect(page.locator('.visual-page')).toBeVisible()
    await expect(page.getByText('Loading view…', { exact: true })).toHaveCount(0)
    expect((await page.locator('.visual-page').innerText()).length).toBeGreaterThan(100)
    await page.screenshot({ path: test.info().outputPath(`${path}-desktop.png`), fullPage: true })
  }
  expect(errors).toEqual([])
  expect(apiRequests).toEqual([])
})

test('source new-project form creates a local visual project, opens Charter and survives reload', async ({ page }) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New Project', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('Project Name', { exact: false }).fill('Correct visual acceptance')
  await page.getByLabel('Client', { exact: false }).fill('Demo Client')
  await page.getByRole('button', { name: 'Web Application', exact: true }).click()
  await page.getByRole('button', { name: 'Create Project', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/[^/]+\/charter$/)
  await expect(page.locator('header').getByText('Correct visual acceptance', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('header').getByText('Correct visual acceptance', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Members', exact: true }).click()
  await expect(page.getByText('alex.kim@raptix.io', { exact: true })).toBeVisible()
})

test('source Home console CTA opens Operator Console and breadcrumb returns to Charter', async ({ page }) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: 'Enter Operator Console', exact: true }).first().click()
  await expect(page).toHaveURL(/\/console$/)
  await page.locator('header').getByRole('button', { name: 'Acme Corp External Assessment', exact: true }).click()
  await expect(page).toHaveURL(/\/charter$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/console$/)
})

test('retired extra pages are not mounted while Members and Vault are active visual pages', async ({ page }) => {
  for (const path of ['overview', 'runs', 'graphs', 'attack-graph', 'evidence']) {
    await page.goto(`/projects/1/${path}`)
    await expect(page.getByRole('heading', { name: 'Project or page not found' })).toBeVisible()
  }
  await page.goto('/projects/1/credentials')
  await expect(page.locator('.visual-page')).toContainText('NTLM')
  await page.goto('/projects/1/members')
  await expect(page.getByRole('button', { name: 'Add Member', exact: true })).toBeVisible()
})

test('source Members invite form changes the local demo table', async ({ page }) => {
  await page.goto('/projects/1/members')
  await page.getByRole('button', { name: 'Add Member', exact: true }).click()
  await page.getByPlaceholder('Enter full name…').fill('Demo Reviewer')
  await page.getByPlaceholder('user@example.com').fill('reviewer@example.com')
  await page.getByRole('button', { name: 'Send Invite', exact: true }).click()
  await expect(page.getByText('reviewer@example.com', { exact: true })).toBeVisible()
})

test('HITL dismissal does not resolve the demo request', async ({ page }) => {
  await page.goto('/projects/1/charter')
  await page.getByRole('button', { name: 'HITL Pending', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'HITL Pending', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'HITL Pending', exact: true }).click()
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByRole('button', { name: 'HITL Pending', exact: true })).toHaveCount(0)
})

test('mobile navigation exposes all 13 source pages and records visual preview', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects/1/charter')
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await expect(page.locator('aside nav').getByRole('button')).toHaveCount(13)
  await page.locator('aside nav').getByRole('button', { name: 'Credentials Vault', exact: true }).click()
  await expect(page).toHaveURL(/\/credentials$/)
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible()
  for (const path of ['charter', 'console', 'sessions', 'credentials', 'reports', 'members']) {
    await page.goto(`/projects/1/${path}`)
    await expect(page.locator('.visual-page')).toBeVisible()
    await expect(page.getByText('Loading view…', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath(`${path}-mobile.png`), fullPage: true })
  }
})

test('campaign generation, C2 terminal and credential reveal remain local frontend interactions', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (/\/api\//.test(request.url())) apiRequests.push(request.url()) })
  await page.goto('/projects/1/campaigns')
  const generate = page.getByRole('button', { name: 'Generate Campaign Wave', exact: true })
  await generate.click()
  await expect(page.getByRole('button', { name: 'Generating...', exact: true })).toBeDisabled()
  await expect(generate).toBeEnabled()
  await page.getByRole('button', { name: 'Deploy Campaign Wave', exact: true }).click()
  await expect(page.getByText('Demo only: campaign wave simulated locally, no delivery backend', { exact: true })).toBeVisible()

  await page.goto('/projects/1/sessions')
  const terminal = page.getByPlaceholder('Enter command for SID-001...')
  await terminal.fill('hostname')
  await terminal.press('Enter')
  await expect(page.getByText('[raptix@c2]$ hostname', { exact: true })).toBeVisible()
  await expect(terminal).toHaveValue('')

  await page.goto('/projects/1/credentials')
  await page.getByTitle('Reveal', { exact: true }).first().click()
  await expect(page.getByTitle('Hide', { exact: true }).first()).toBeVisible()
  expect(apiRequests).toEqual([])
})
