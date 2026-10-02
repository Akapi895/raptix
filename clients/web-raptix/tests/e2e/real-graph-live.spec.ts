import { test, expect } from '@playwright/test'

/**
 * W13 live gate against the real server and the real Neo4j store: seeded
 * engagement-scoped nodes appear through the public projection with redaction,
 * counters derive from the projection, foreign engagement stays 404 and the
 * empty-vs-unavailable distinction survives end to end.
 */

const api = 'http://127.0.0.1:5293/api'
const slug = `w13-graph-${Date.now()}`

async function cypher(statement: string, parameters: Record<string, unknown>): Promise<{ status: number; rows: unknown[] }> {
  const response = await fetch('http://127.0.0.1:7475/db/neo4j/tx/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`neo4j:${process.env.W13_NEO4J_PASSWORD}`).toString('base64')}` },
    body: JSON.stringify({ statements: [{ statement, parameters }] }),
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json().catch(() => null) as { results?: Array<{ data?: Array<{ row?: unknown[] }> }> } | null
  return { status: response.status, rows: body?.results?.[0]?.data?.[0]?.row ?? [] }
}

test('live graph projection serves seeded scoped nodes with redaction and derived counters', async ({ page, request }) => {
  test.setTimeout(180000)
  expect((await (await request.get(`${api}/capabilities`)).json()).capabilities.graphs).toEqual({ supported: true, available: true })
  const create = await request.post(`${api}/engagements`, { data: { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true } })
  expect(create.status()).toBe(201)
  const project = await create.json()

  const seed = await cypher(
    'UNWIND $nodes AS node CREATE (n:Host:LiveGate) SET n = node',
    { nodes: [
      { engagement: slug, hostname: 'dc01.livegate', ip: '10.99.0.5', os: 'Windows Server 2022', password: 'livegate-secret-DO-NOT-LEAK' },
      { engagement: slug, hostname: 'dc01.livegate', ip: '10.99.0.5', port: 445 },
      { engagement: 'w13-foreign-engagement', hostname: 'foreign.host', ip: '10.99.9.9' },
    ] },
  )
  expect(seed.status).toBe(200)

  try {
    await page.goto(`/projects/${project.id}/infrastructure`)
    await expect(page.getByText('2 nodes • 0 edges')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'dc01.livegate' }).first()).toBeVisible()
    await expect(page.getByText('foreign.host')).toHaveCount(0)
    await expect(page.getByText('livegate-secret')).toHaveCount(0)
    const raw = await (await request.get(`${api}/engagements/${project.id}/graph`)).text()
    expect(raw).not.toContain('livegate-secret')

    await page.goto(`/projects/${project.id}/assets`)
    await expect(page.getByText('1 assets')).toBeVisible()
    await expect(page.getByText('Total Assets')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'dc01.livegate' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Inspect' }).first().click()
    await expect(page.getByText('Derived from the engagement-scoped graph with server-side redaction.')).toBeVisible()
    await page.getByRole('button', { name: 'Close asset detail' }).click()

    const graph = await (await request.get(`${api}/engagements/${project.id}/graph`)).json()
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0].properties.hostname).toBe('dc01.livegate')
    for (const node of graph.nodes) expect(JSON.stringify(node)).not.toContain('livegate-secret')
    const foreign = await request.get(`${api}/engagements/not-a-real-engagement/graph`)
    expect(foreign.status()).toBe(404)
  } finally {
    await cypher('MATCH (n:LiveGate) WHERE n.engagement STARTS WITH "w13-graph-" DETACH DELETE n', {})
  }
  await page.getByRole('button', { name: '↻ Refresh' }).click()
  await expect(page.getByText('No scoped assets derived from the engagement graph yet.')).toBeVisible({ timeout: 15000 })
})
