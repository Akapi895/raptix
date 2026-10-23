/**
 * The Capabilities section: one tab per kind of capability, Skills by default. Skills reads the corpus with its facets;
 * Agents, Knowledge, MCP and Tool name the missing source instead of listing invented entries; the review queue waits for an
 * engagement rather than reporting an error on the all-projects view.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  corpus: vi.fn(),
  proposals: vi.fn(),
  catalog: vi.fn(),
  knowledge: vi.fn(),
  knowledgeItem: vi.fn(),
  route: { page: 'capabilities', tab: undefined as string | undefined },
  project: 'RT-2026-014',
  go: vi.fn(),
}))

vi.mock('../query', () => ({
  useLibraryCorpus: (query: unknown) => hooks.corpus(query),
  useLibraryProposals: (enabled: boolean) => hooks.proposals(enabled),
  useCapabilityCatalog: () => hooks.catalog(),
  useKnowledge: (query: unknown) => hooks.knowledge(query),
  useKnowledgeItem: (id: string) => hooks.knowledgeItem(id),
  useSkillDetail: () => ({ isPending: true, isError: false, data: undefined, error: null }),
  useTechniqueDetail: () => ({ isPending: true, isError: false, data: undefined, error: null }),
  useLibraryProposal: () => ({ isPending: true, isError: false, data: undefined, error: null }),
  useLibraryWrites: () => ({}),
  LibraryReadError: class extends Error {},
}))

vi.mock('../../../router/navigate', () => ({
  go: (...args: unknown[]) => hooks.go(...args),
  useRoute: () => hooks.route,
}))

vi.mock('../../../state/keys', () => ({
  useQueryScope: () => ({ actor: 'Alex Morgan', role: 'manager', project: hooks.project }),
}))

const corpus = {
  items: [{ name: 'PB-001', description: 'Discovery', subdomain: 'Discovery', mitreIds: ['T1087', 'T1082'], whenToUse: null, path: 'skills/PB-001/SKILL.md' }],
  page: 1,
  pageSize: 10,
  total: 1,
  counts: { skills: 3, techniques: 12 },
  subdomains: { Discovery: 2, Persistence: 1 },
  techniquesCovered: 4,
  excludedActions: [],
}

const queue = { items: [], counts: { draft: 1, proposed: 2, approved: 0, rejected: 0 } }

const catalogRead = {
  generatedOn: '2026-10-23',
  agents: [{ id: 'recon', description: 'Recon Agent', module: 'packages/raptix/raptix/intelligence/agents/standard/recon.py', toolDomains: ['bash', 'web'], prompt: '# Recon prompt', source: 'class ReconAgent: ...' }],
  subagents: [{ id: 'recon', package: 'raptix-core', target: 'raptix.recon:factory', module: 'packages/raptix/raptix/intelligence/agents/standard/recon.py', source: 'SUBAGENT_SPEC = ...' }],
  tools: [{ name: 'web_fetch', domain: 'web', description: 'Fetch a URL.', docstring: 'Fetch a URL. Bounded.', signature: 'def web_fetch(url: str) -> str', source: 'def web_fetch(url: str) -> str: return url', file: 'packages/raptix/raptix/execution/tools/web/search.py' }],
  binaries: [{ executable: 'nmap', profile: 'base', adapterId: 'network.nmap', capabilityId: 'network.scan', capabilityDescription: 'Port scan', riskClass: 'medium', allowedRoles: ['recon', 'exploit'], sourceModule: 'raptix.execution.adapters.network.nmap', sourceClass: 'NmapAdapter', source: 'class NmapAdapter: ...' }],
  mcp: { envVar: 'RAPTIX_MCP__SERVERS', configured: false, servers: [] },
}

const knowledgeRead = {
  items: [{ id: 'attack:T1078', source: 'attack', type: 'technique', name: 'Valid Accounts', description: 'Adversaries obtain credentials.', status: null }],
  page: 1,
  pageSize: 25,
  total: 1,
  sources: { attack: 2, cisa: 1 },
  types: { technique: 2, kev_entry: 1 },
  generatedOn: '2026-10-23',
}

async function renderPage(tab?: string) {
  hooks.route.tab = tab
  const { capabilityRoutes } = await import('./capabilities-pages')
  const Page = capabilityRoutes.capabilities
  return render(<Page />)
}

afterEach(() => {
  cleanup()
  hooks.corpus.mockReset()
  hooks.proposals.mockReset()
  hooks.catalog.mockReset()
  hooks.knowledge.mockReset()
  hooks.knowledgeItem.mockReset()
  hooks.go.mockReset()
  hooks.project = 'RT-2026-014'
})

describe('capabilities tabs', () => {
  it('opens the Skills tab by default, with the corpus facets and the queue of the engagement', async () => {
    hooks.corpus.mockReturnValue({ isPending: false, isError: false, error: null, data: corpus })
    hooks.proposals.mockReturnValue({ isPending: false, isError: false, error: null, data: queue, refetch: () => {} })
    await renderPage()
    expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Read-only corpus')).toBeTruthy()
    expect(screen.getByText('Techniques covered')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Subdomains' })).getByRole('button', { name: /Persistence/ })).toBeTruthy()
    expect(screen.getByText('PB-001')).toBeTruthy()
    expect(screen.getByText('Review queue')).toBeTruthy()
    expect(hooks.proposals).toHaveBeenCalledWith(true)
  })

  it('lists the agents, plugin subagents and their tool domains on the Specialists tab, without listing skills there', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: false, error: null, data: catalogRead })
    await renderPage('specialists')
    expect(screen.getByRole('tab', { name: 'Specialists' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByText('recon').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Plugin subagents' })).toBeTruthy()
    expect(screen.getByText('raptix-core')).toBeTruthy()
    expect(screen.queryByText('PB-001')).toBeNull()
  })

  it('says why the Specialists tab is empty when the catalog cannot be read', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: true, error: new Error('Console data file capabilities/catalog.json is missing or unreadable.'), data: undefined, refetch: () => {} })
    await renderPage('specialists')
    expect(screen.getByText('Specialists unavailable')).toBeTruthy()
    expect(screen.getByText(/catalog.json is missing/)).toBeTruthy()
  })

  it('shows a repo tool with its signature and source, and lists binary tools in their own section', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: false, error: null, data: catalogRead })
    await renderPage('tool')
    expect(screen.getByRole('columnheader', { name: 'Signature' })).toBeTruthy()
    expect(screen.getByText('def web_fetch(url: str) -> str')).toBeTruthy()
    expect(screen.queryByText('def web_fetch(url: str) -> str: return url')).toBeNull()
    fireEvent.click(screen.getByText('web_fetch'))
    expect(screen.getByText('def web_fetch(url: str) -> str: return url')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Binary tools' }))
    expect(screen.getByRole('columnheader', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByText('Base image')).toBeTruthy()
    expect(screen.queryByText('class NmapAdapter: ...')).toBeNull()
    fireEvent.click(screen.getByText('nmap'))
    expect(screen.getByText('class NmapAdapter: ...')).toBeTruthy()
  })

  it('states that no MCP server is configured, and lists none', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: false, error: null, data: catalogRead })
    await renderPage('mcp')
    expect(screen.getByText('No MCP server configured')).toBeTruthy()
    expect(screen.getByText(/RAPTIX_MCP__SERVERS/)).toBeTruthy()
  })

  it('shows knowledge entries with their source chips and the entry totals', async () => {
    hooks.knowledge.mockReturnValue({ isPending: false, isError: false, error: null, data: knowledgeRead })
    await renderPage('knowledge')
    expect(screen.getByText('Valid Accounts')).toBeTruthy()
    expect(screen.getByText('Entries')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Sources' })).getByRole('button', { name: /attack/ })).toBeTruthy()
  })

  it('asks for an engagement instead of reporting an error on the all-projects view', async () => {
    hooks.project = 'all'
    hooks.corpus.mockReturnValue({ isPending: false, isError: false, error: null, data: corpus })
    hooks.proposals.mockReturnValue({ isPending: false, isError: false, error: null, data: undefined, refetch: () => {} })
    await renderPage()
    expect(hooks.proposals).toHaveBeenCalledWith(false)
    expect(screen.getByText('Select an engagement to see its review queue.')).toBeTruthy()
  })

  it('opens an agent to read its standard prompt and module source', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: false, error: null, data: catalogRead })
    await renderPage('specialists')
    fireEvent.click(screen.getAllByText('recon')[0]!)
    expect(screen.getByText('# Recon prompt')).toBeTruthy()
    expect(screen.getByText('class ReconAgent: ...')).toBeTruthy()
  })

  it('opens a plugin subagent to read the module its entry point resolves to', async () => {
    hooks.catalog.mockReturnValue({ isPending: false, isError: false, error: null, data: catalogRead })
    await renderPage('specialists')
    fireEvent.click(screen.getByText('raptix-core'))
    expect(screen.getByText('SUBAGENT_SPEC = ...')).toBeTruthy()
  })

  it('opens a knowledge entry and reads its record file on demand', async () => {
    hooks.knowledge.mockReturnValue({ isPending: false, isError: false, error: null, data: knowledgeRead })
    hooks.knowledgeItem.mockReturnValue({ isPending: false, isError: false, error: null, data: { item: knowledgeRead.items[0], content: 'id: attack:T1078 name: Valid Accounts' } })
    await renderPage('knowledge')
    fireEvent.click(screen.getByText('Valid Accounts'))
    expect(hooks.knowledgeItem).toHaveBeenLastCalledWith('attack:T1078')
    expect(screen.getByText('id: attack:T1078 name: Valid Accounts')).toBeTruthy()
  })

  it('filters the corpus by a subdomain chip and returns to all skills on a second press', async () => {
    hooks.corpus.mockReturnValue({ isPending: false, isError: false, error: null, data: corpus })
    hooks.proposals.mockReturnValue({ isPending: false, isError: false, error: null, data: queue, refetch: () => {} })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Persistence/ }))
    expect(hooks.corpus).toHaveBeenLastCalledWith(expect.objectContaining({ subdomain: 'Persistence' }))
    fireEvent.click(screen.getByRole('button', { name: /Persistence/ }))
    expect(hooks.corpus).toHaveBeenLastCalledWith(expect.objectContaining({ subdomain: undefined }))
  })
})
