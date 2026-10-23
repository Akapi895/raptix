import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Bot, Plug, Wrench } from 'lucide-react'
import { Banner, Drawer, Empty, Mono, Pager, SearchBox, Segmented, Select, Skeleton, Table, cx, type Col } from '../../../ui/index'
import { useCapabilityCatalog, useKnowledge, useKnowledgeItem } from '../query'
import type { CapabilityAgent, CapabilityBinary, CapabilitySubagent, CapabilityTool, KnowledgeItem } from '../service'
import { FilterChip, StatTile } from './capability-ui'

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'The data could not be read.'
}

function tally<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs text-muted">{children}</span>
}

function TagList({ values, max = 6 }: { values: string[]; max?: number }) {
  if (values.length === 0) return <span className="text-muted">None</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.slice(0, max).map((value) => <Tag key={value}>{value}</Tag>)}
      {values.length > max && <span className="text-xs text-muted">+{values.length - max}</span>}
    </div>
  )
}

/* ───────────── Agents ───────────── */

const AGENT_COLS: Col<CapabilityAgent>[] = [
  {
    key: 'agent',
    header: 'Specialist',
    render: (agent) => (
      <div className="min-w-0 py-2">
        <Mono className="font-medium text-accent">{agent.id}</Mono>
        {agent.description && <div className="line-clamp-2 max-w-prose text-xs text-muted">{agent.description}</div>}
      </div>
    ),
  },
  { key: 'domains', header: 'Tool domains', render: (agent) => <TagList values={agent.toolDomains} /> },
  { key: 'module', header: 'Module', hideBelow: 'lg', render: (agent) => <Mono className="text-xs text-muted">{agent.module}</Mono> },
]

const SUBAGENT_COLS: Col<CapabilitySubagent>[] = [
  { key: 'id', header: 'Subagent', render: (subagent) => <Mono className="font-medium">{subagent.id}</Mono> },
  { key: 'package', header: 'Package', render: (subagent) => <Mono className="text-xs text-muted">{subagent.package}</Mono> },
  { key: 'target', header: 'Entry point', hideBelow: 'md', render: (subagent) => <Mono className="text-xs text-muted">{subagent.target}</Mono> },
]

/** The agent's standard prompt, the module that defines it, and the tool domains it imports. */
function AgentDetail({ agent }: { agent: CapabilityAgent }) {
  return (
    <div className="space-y-4">
      <Detail label="Description">{agent.description ?? <span className="text-muted">No description recorded</span>}</Detail>
      <Detail label="Module"><Mono className="text-xs text-muted">{agent.module}</Mono></Detail>
      <Detail label="Tool domains">{agent.toolDomains.length === 0 ? <span className="text-muted">None imported</span> : <TagList values={agent.toolDomains} max={12} />}</Detail>
      <Detail label="Standard prompt">{agent.prompt ? <CodeBlock>{agent.prompt}</CodeBlock> : <span className="text-muted">This agent has no standard prompt file.</span>}</Detail>
      <Detail label="Module source">{agent.source ? <CodeBlock>{agent.source}</CodeBlock> : <span className="text-muted">Source not available</span>}</Detail>
    </div>
  )
}

/** The plugin subagent's entry point and the module that defines it. */
function SubagentDetail({ subagent }: { subagent: CapabilitySubagent }) {
  return (
    <div className="space-y-4">
      <Detail label="Package"><Mono>{subagent.package}</Mono></Detail>
      <Detail label="Entry point"><Mono className="text-xs">{subagent.target}</Mono></Detail>
      <Detail label="Module">{subagent.module ? <Mono className="text-xs text-muted">{subagent.module}</Mono> : <span className="text-muted">Not found in the repo</span>}</Detail>
      <Detail label="Module source">{subagent.source ? <CodeBlock>{subagent.source}</CodeBlock> : <span className="text-muted">Source not available</span>}</Detail>
    </div>
  )
}

export function SpecialistsTab() {
  const catalog = useCapabilityCatalog()
  const [q, setQ] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<CapabilityAgent | null>(null)
  const [selectedSubagent, setSelectedSubagent] = useState<CapabilitySubagent | null>(null)
  if (catalog.isPending) return <Skeleton className="h-64" />
  if (catalog.isError) return <Banner tone="warn" title="Specialists unavailable">{failure(catalog.error)}</Banner>
  const { agents, subagents, tools } = catalog.data
  const needle = q.trim().toLowerCase()
  const rows = agents.filter((agent) => !needle || `${agent.id} ${agent.description ?? ''}`.toLowerCase().includes(needle))
  return (
    <>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <StatTile label="Specialists" value={agents.length} note="Agent graphs behind the specialists" />
        <StatTile label="Plugin subagents" value={subagents.length} note="Registered under raptix.subagents" />
        <StatTile label="Tool definitions" value={tools.length} note="@tool functions in the tool catalog" />
      </div>
      <div className="mb-4 rounded-xl border border-line bg-panel p-2 shadow-sm">
        <SearchBox value={q} onChange={setQ} placeholder="Search specialist name or description…" />
      </div>
      <p className="mb-3 text-sm text-muted">Tool domains are the tool packages each specialist module imports. They show what the agent is built with, not what a run is allowed to call.</p>
      <Table
        rows={rows}
        rowKey={(agent) => agent.id}
        cols={AGENT_COLS}
        onRow={setSelectedAgent}
        empty={<Empty icon={Bot} title="No specialist matches">Clear the search to see every specialist.</Empty>}
      />
      <h2 className="mb-3 mt-8 text-sm font-medium">Plugin subagents</h2>
      <Table
        rows={subagents}
        rowKey={(subagent) => `${subagent.package}:${subagent.id}`}
        cols={SUBAGENT_COLS}
        onRow={setSelectedSubagent}
        empty={<Empty icon={Bot} title="No plugin subagent registered">The runtime found no subagent entry points.</Empty>}
      />
      <Drawer open={selectedAgent !== null} onClose={() => setSelectedAgent(null)} title={selectedAgent?.id ?? ''} width={760}>
        {selectedAgent && <AgentDetail agent={selectedAgent} />}
      </Drawer>
      <Drawer open={selectedSubagent !== null} onClose={() => setSelectedSubagent(null)} title={selectedSubagent?.id ?? ''} width={760}>
        {selectedSubagent && <SubagentDetail subagent={selectedSubagent} />}
      </Drawer>
    </>
  )
}

/* ───────────── Tools ───────────── */

type ToolSection = 'custom' | 'binary'

function CodeBlock({ children }: { children: string }) {
  return <pre className="max-h-96 overflow-auto whitespace-pre rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-relaxed">{children}</pre>
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

const CUSTOM_TOOL_COLS: Col<CapabilityTool>[] = [
  { key: 'tool', header: 'Tool', render: (tool) => <Mono className="font-medium">{tool.name}</Mono> },
  { key: 'domain', header: 'Domain', render: (tool) => <Tag>{tool.domain}</Tag> },
  {
    key: 'description',
    header: 'Description',
    render: (tool) => tool.description ? <span className="line-clamp-2 max-w-prose text-sm text-muted">{tool.description}</span> : <span className="text-muted">No description</span>,
  },
  { key: 'signature', header: 'Signature', hideBelow: 'lg', render: (tool) => <Mono className="block max-w-[28rem] truncate text-xs text-muted">{tool.signature}</Mono> },
]

/** The tool's signature, docstring, file and source. */
function CustomToolDetail({ tool }: { tool: CapabilityTool }) {
  return (
    <div className="space-y-4">
      <Detail label="Signature"><Mono>{tool.signature}</Mono></Detail>
      {tool.docstring && <Detail label="Docstring"><p className="whitespace-pre-line">{tool.docstring}</p></Detail>}
      <Detail label="File"><Mono className="text-xs text-muted">{tool.file}</Mono></Detail>
      <Detail label="Source"><CodeBlock>{tool.source}</CodeBlock></Detail>
    </div>
  )
}

function CustomTools({ tools }: { tools: CapabilityTool[] }) {
  const [q, setQ] = useState('')
  const [domain, setDomain] = useState('')
  const [selected, setSelected] = useState<CapabilityTool | null>(null)
  const domains = tally(tools, (tool) => tool.domain)
  const needle = q.trim().toLowerCase()
  const rows = tools.filter((tool) =>
    (!domain || tool.domain === domain)
    && (!needle || `${tool.name} ${tool.description ?? ''} ${tool.docstring ?? ''} ${tool.domain}`.toLowerCase().includes(needle)))
  return (
    <>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <StatTile label="Tool definitions" value={tools.length} note="@tool functions in the repo" />
        <StatTile label="Domains" value={domains.length} note="Tool packages under execution/tools" />
      </div>
      <div className="mb-4 rounded-xl border border-line bg-panel p-2 shadow-sm">
        <SearchBox value={q} onChange={setQ} placeholder="Search tool name, description or domain…" />
        <div role="group" aria-label="Tool domains" className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="text-xs text-muted">Domain</span>
          <FilterChip label="All" count={tools.length} active={domain === ''} onClick={() => setDomain('')} />
          {domains.map(([name, count]) => (
            <FilterChip key={name} label={name} count={count} active={domain === name} onClick={() => setDomain(domain === name ? '' : name)} />
          ))}
        </div>
      </div>
      <Table
        rows={rows}
        rowKey={(tool) => `${tool.file}:${tool.name}`}
        cols={CUSTOM_TOOL_COLS}
        onRow={setSelected}
        empty={<Empty icon={Wrench} title="No tool matches">Clear the search or domain to see every tool.</Empty>}
      />
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''} width={640}>
        {selected && <CustomToolDetail tool={selected} />}
      </Drawer>
    </>
  )
}

const BINARY_COLS: Col<CapabilityBinary>[] = [
  { key: 'binary', header: 'Binary', render: (binary) => <Mono className="font-medium">{binary.executable}</Mono> },
  {
    key: 'profile',
    header: 'Profile',
    render: (binary) => <Tag>{binary.profile === 'base' ? 'Base image' : `Profile ${binary.profile ?? 'not set'}`}</Tag>,
  },
  { key: 'risk', header: 'Risk', render: (binary) => <Tag>{binary.riskClass}</Tag> },
  { key: 'capability', header: 'Capability', render: (binary) => <Mono className="text-xs">{binary.capabilityId}</Mono> },
  { key: 'adapter', header: 'Adapter', hideBelow: 'lg', render: (binary) => <Mono className="text-xs text-muted">{binary.adapterId}</Mono> },
  {
    key: 'roles',
    header: 'Roles',
    hideBelow: 'md',
    render: (binary) => binary.allowedRoles.length === 0 ? <span className="text-muted">Every role</span> : <TagList values={binary.allowedRoles} />,
  },
]

/** The adapter's class and source: how the runtime invokes the binary. */
function BinaryDetail({ binary }: { binary: CapabilityBinary }) {
  return (
    <div className="space-y-4">
      <Detail label="Capability">
        <span>{binary.capabilityDescription ?? 'No description recorded'}</span>
        <div><Mono className="text-xs text-muted">{binary.capabilityId}</Mono></div>
      </Detail>
      <Detail label="Adapter">
        <Mono>{binary.adapterId}</Mono>
        {binary.sourceClass && <span className="text-muted"> · {binary.sourceClass}</span>}
        {binary.sourceModule && <div><Mono className="text-xs text-muted">{binary.sourceModule}</Mono></div>}
      </Detail>
      <Detail label="Adapter source">
        {binary.source ? <CodeBlock>{binary.source}</CodeBlock> : <span className="text-muted">Source not available</span>}
      </Detail>
    </div>
  )
}

function BinaryTools({ binaries }: { binaries: CapabilityBinary[] }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<CapabilityBinary | null>(null)
  const executables = new Set(binaries.map((binary) => binary.executable)).size
  const inBase = binaries.filter((binary) => binary.profile === 'base').length
  const needle = q.trim().toLowerCase()
  const rows = binaries.filter((binary) =>
    !needle || `${binary.executable} ${binary.capabilityId} ${binary.adapterId} ${binary.capabilityDescription ?? ''}`.toLowerCase().includes(needle))
  return (
    <>
      <p className="mb-4 text-sm text-muted">Binaries run inside the Kali sandbox. Base-image binaries ship in every sandbox; the other profiles are not in the base image.</p>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <StatTile label="Binaries" value={executables} note="External executables behind capabilities" />
        <StatTile label="Capabilities" value={binaries.length} note="Binary-backed capability declarations" />
        <StatTile label="In base image" value={inBase} note="Declarations that use the base profile" />
      </div>
      <div className="mb-4 rounded-xl border border-line bg-panel p-2 shadow-sm">
        <SearchBox value={q} onChange={setQ} placeholder="Search binary, capability or adapter…" />
      </div>
      <Table
        rows={rows}
        rowKey={(binary) => `${binary.adapterId}:${binary.executable}`}
        cols={BINARY_COLS}
        onRow={setSelected}
        empty={<Empty icon={Wrench} title="No binary matches">Clear the search to see every binary.</Empty>}
      />
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.executable ?? ''} width={640}>
        {selected && <BinaryDetail binary={selected} />}
      </Drawer>
    </>
  )
}

export function ToolsTab() {
  const catalog = useCapabilityCatalog()
  const [section, setSection] = useState<ToolSection>('custom')
  if (catalog.isPending) return <Skeleton className="h-64" />
  if (catalog.isError) return <Banner tone="warn" title="Tools unavailable">{failure(catalog.error)}</Banner>
  return (
    <>
      <div className="mb-5">
        <Segmented<ToolSection> options={[{ id: 'custom', label: 'Custom tools' }, { id: 'binary', label: 'Binary tools' }]} value={section} onChange={setSection} />
      </div>
      {section === 'custom' ? <CustomTools tools={catalog.data.tools} /> : <BinaryTools binaries={catalog.data.binaries} />}
    </>
  )
}

/* ───────────── Knowledge ───────────── */

const KNOWLEDGE_COLS: Col<KnowledgeItem>[] = [
  {
    key: 'entry',
    header: 'Entry',
    render: (item) => (
      <div className="min-w-0 py-2">
        <div className="font-medium">{item.name}</div>
        <Mono className="text-xs text-muted">{item.id}</Mono>
      </div>
    ),
  },
  { key: 'source', header: 'Source', render: (item) => <Tag>{item.source}</Tag> },
  { key: 'type', header: 'Type', hideBelow: 'md', render: (item) => <Mono className="text-xs">{item.type}</Mono> },
  {
    key: 'description',
    header: 'Description',
    hideBelow: 'lg',
    render: (item) => item.description ? <span className="line-clamp-2 max-w-prose text-sm text-muted">{item.description}</span> : <span className="text-muted">No description</span>,
  },
]

/** A knowledge record's metadata, and its record file read when the row opens. */
function KnowledgeDetail({ item }: { item: KnowledgeItem }) {
  const record = useKnowledgeItem(item.id)
  return (
    <div className="space-y-4">
      <Detail label="Identifier"><Mono className="text-xs">{item.id}</Mono></Detail>
      <Detail label="Source"><Tag>{item.source}</Tag></Detail>
      <Detail label="Type"><Mono className="text-xs">{item.type}</Mono></Detail>
      <Detail label="Status">{item.status ?? <span className="text-muted">Not recorded</span>}</Detail>
      <Detail label="Description">{item.description ?? <span className="text-muted">No description</span>}</Detail>
      <Detail label="Record file">
        {record.isPending ? <Skeleton className="h-40" /> : record.isError ? <Banner tone="warn" title="Record unavailable">{failure(record.error)}</Banner> : <CodeBlock>{record.data.content}</CodeBlock>}
      </Detail>
    </div>
  )
}

export function KnowledgeTab() {
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<KnowledgeItem | null>(null)
  useEffect(() => { setPage(1) }, [q, source, type])
  const knowledge = useKnowledge({ q: q || undefined, source: source || undefined, type: type || undefined, page })
  const data = knowledge.data
  const filtered = q !== '' || source !== '' || type !== ''
  const sources = data ? Object.entries(data.sources).sort(([a], [b]) => a.localeCompare(b)) : []
  const types = data ? Object.keys(data.types).sort() : []
  const entries = sources.reduce((sum, [, count]) => sum + count, 0)
  const reset = () => { setQ(''); setSource(''); setType('') }
  return (
    <>
      {knowledge.isError && <Banner tone="warn" title="Knowledge unavailable">{failure(knowledge.error)}</Banner>}
      {data && (
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <StatTile label="Entries" value={entries} note="Reference entries in the index" />
          <StatTile label="Sources" value={sources.length} note="Standards and catalogs in the index" />
          <StatTile label="Types" value={types.length} note="Entry kinds across all sources" />
        </div>
      )}
      <div className={cx('mb-4 rounded-xl border bg-panel p-2 shadow-sm', filtered ? 'border-primary/40' : 'border-line')}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, ID or description…" className="min-w-[14rem] flex-1" />
          <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="!w-auto min-w-[11rem]">
            <option value="">All types</option>
            {types.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          {filtered && <button type="button" onClick={reset} className="h-9 rounded-lg px-3 text-sm text-muted hover:text-fg">Reset all</button>}
        </div>
        {data && (
          <div role="group" aria-label="Sources" className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <span className="text-xs text-muted">Source</span>
            <FilterChip label="All" count={entries} active={source === ''} onClick={() => setSource('')} />
            {sources.map(([name, count]) => (
              <FilterChip key={name} label={name} count={count} active={source === name} onClick={() => setSource(source === name ? '' : name)} />
            ))}
          </div>
        )}
      </div>
      {knowledge.isPending ? <Skeleton className="h-64" /> : data && (
        <>
          <Table
            rows={data.items}
            rowKey={(item) => item.id}
            cols={KNOWLEDGE_COLS}
            onRow={setSelected}
            empty={<Empty icon={BookOpen} title="No entry matches">Clear the filters to see the index.</Empty>}
          />
          <Pager page={data.page} pages={Math.max(1, Math.ceil(data.total / data.pageSize))} setPage={setPage} total={data.total} />
        </>
      )}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''} width={760}>
        {selected && <KnowledgeDetail item={selected} />}
      </Drawer>
    </>
  )
}

/* ───────────── MCP ───────────── */

const MCP_COLS: Col<{ name: string; transport: string }>[] = [
  { key: 'server', header: 'Server', render: (server) => <Mono className="font-medium">{server.name}</Mono> },
  { key: 'transport', header: 'Transport', render: (server) => <Mono className="text-xs">{server.transport}</Mono> },
]

export function McpTab() {
  const catalog = useCapabilityCatalog()
  if (catalog.isPending) return <Skeleton className="h-40" />
  if (catalog.isError) return <Banner tone="warn" title="MCP servers unavailable">{failure(catalog.error)}</Banner>
  const { mcp } = catalog.data
  if (!mcp.configured) {
    return (
      <Empty icon={Plug} title="No MCP server configured">
        Set {mcp.envVar} on the runtime to attach MCP tool servers. Only server names and transports are listed here, never their addresses.
      </Empty>
    )
  }
  return <Table rows={mcp.servers} rowKey={(server) => server.name} cols={MCP_COLS} />
}
