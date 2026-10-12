import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * W15 core E2E: the web-native loop create → planning → run execution →
 * report — entirely through the real UI against the real new API, PostgreSQL
 * and LangGraph runtime, then settings save/reload and the danger delete as
 * the exit. "Execution" is the acknowledged planning run executing in the
 * console (context-only, no tool execution against targets happens in a gate).
 */

const slug = `w15-core-${Date.now()}`

test('web-native create, planning run, report export, settings save and delete', async ({ page }) => {
  test.setTimeout(420000)
  const workspaceRoot = process.env.W15_TEST_WORKSPACE!
  try {
    // 1. Create: real New Project form.
    await page.goto('/projects')
    await page.getByRole('button', { name: 'New Project' }).first().click()
    await page.locator('#real-new-project-display-name').fill('W15 Core Flow')
    await page.locator('#real-new-project-slug').fill(slug)
    await page.locator('#real-new-project-target').fill('https://authorized.invalid')
    await page.locator('#real-new-project-brief').fill('Authorized core flow test brief with scoped constraints.')
    await page.locator('#real-new-project-auth').check()
    await page.getByRole('button', { name: /Create/i }).click()
    await page.waitForURL(/\/projects\/[^/]+\/console$/, { timeout: 30000 })
    await expect(page.getByText(slug).first()).toBeVisible()

    // 2+3. Planning: create a bound planning thread and execute one real run.
    await page.getByRole('button', { name: 'Operator Console' }).click()
    await page.getByRole('button', { name: 'New planning chat' }).click()
    const composer = page.getByPlaceholder('Send a root message to the bound assistant…')
    await expect(composer).toBeEnabled({ timeout: 120000 })
    await composer.fill('This is an authorized context-only integration check, not an assessment. Do not invoke tools, delegate, access targets, or write files. Reply with one short acknowledgement of receiving this message only.')
    await composer.press('Enter')
    await expect(page.getByText('RUN SUCCESS')).toBeVisible({ timeout: 300000 })

    // The acknowledged run is part of the merged operations log.
    await page.getByRole('button', { name: 'Operations Log' }).click()
    await expect(page.getByRole('cell', { name: /Planning run success/ })).toBeVisible({ timeout: 30000 })

    // 4. Report: workspace findings flow into the preview and export.
    const dir = path.join(workspaceRoot, slug)
    await mkdir(path.join(dir, 'findings'), { recursive: true })
    await writeFile(path.join(dir, 'findings', 'FIND-2026-CORE.md'), '# Core Flow Finding (W15)\n\nSeverity: high\n\n## Description\nWritten by the W15 core gate into the engagement workspace.\n', 'utf8')
    await page.getByRole('button', { name: 'Reports' }).click()
    await expect(page.getByText('Core Flow Finding (W15)')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Export JSON' }).click()
    await expect(page.getByText(new RegExp(`Download ready: .*${slug}-export\\.json`))).toBeVisible({ timeout: 30000 })

    // 5. Settings: save is acknowledged and reloaded from the server.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByLabel('Display name').fill('W15 Core Flow Renamed')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toHaveText('Saved — reloaded from the server.', { timeout: 30000 })

    // 6. Danger delete through the real UI returns to the empty home state.
    await page.getByRole('button', { name: 'Delete engagement' }).click()
    await page.getByRole('button', { name: 'Confirm delete' }).click()
    await page.waitForURL(/\/projects$/, { timeout: 30000 })
    await expect(page.locator('#main-content').getByText(slug)).toHaveCount(0, { timeout: 30000 })
  } finally {
    await rm(path.join(workspaceRoot, slug), { recursive: true, force: true })
  }
})
