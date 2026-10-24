/** Durable checkpoint tool activity with truthful attribution and a centered inspector. */
import { useState, type ReactElement } from 'react'
import type { ThreadHistoryEvent } from '@raptix/web-contracts'
import { DescList, Empty, Modal, SearchBox, Select } from '../../../ui'

export function ExecutionLogs({ entries, assistantId }: { entries: ThreadHistoryEvent[]; assistantId: string | null }): ReactElement {
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const rows = entries.map((entry, index) => ({
    entry, id: entry.key ?? `occurrence-${index}`,
    agent: 'agent' in entry.payload ? entry.payload.agent : assistantId ?? 'Thread assistant',
    tool: 'name' in entry.payload ? entry.payload.name : 'tool' in entry.payload ? entry.payload.tool ?? '—' : '—',
  }))
  const normalized = query.trim().toLowerCase()
  const visible = rows.filter(row => (!agent || row.agent === agent) && (!normalized || `${row.id} ${row.agent} ${row.tool} ${row.entry.payload.type}`.toLowerCase().includes(normalized)))
  const event = rows.find(row => row.id === selected)
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search event, tool or agent" />
      <Select aria-label="Execution agent filter" value={agent} onChange={e => setAgent(e.target.value)} className="w-48">
        <option value="">All agents</option>
        {[...new Set(rows.map(row => row.agent))].map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
      <span className="self-center text-xs text-muted">{visible.length} of {rows.length} events · checkpoint history</span>
    </div>
    {!visible.length ? <Empty title={rows.length ? 'No events match these filters' : 'No recorded tool activity'} /> : <div className="max-h-[560px] overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-panel text-muted"><tr><th className="p-3">Event</th><th className="p-3">Agent</th><th className="p-3">Tool</th><th className="p-3">Attribution</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id} className="border-t border-line hover:bg-hover">
          <td className="p-3"><button className="font-mono text-link hover:underline" onClick={() => setSelected(row.id)}>{row.entry.payload.type} · checkpoint{row.entry.truncated ? ' · truncated' : ''}</button></td>
          <td className="p-3">{row.agent}</td><td className="p-3 font-mono">{row.tool}</td><td className="p-3 text-muted">Thread history · run unknown</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <Modal open={!!event} onClose={() => setSelected(null)} width={900} title={event ? `Tool Event Inspector — ${event.id}` : ''}>
      {event && <div className="space-y-4">
        <DescList cols={2} items={[
          { k: 'Event', v: event.entry.payload.type }, { k: 'Tool', v: event.tool },
          { k: 'Agent', v: event.agent }, { k: 'Source', v: 'Checkpoint' },
          { k: 'Run attribution', v: 'Unknown — thread history' }, { k: 'Policy / approval', v: 'Not supplied by this source' },
          { k: 'Truncation', v: event.entry.truncated ? 'Source output is truncated' : 'Not flagged by source' },
        ]} />
        <h3 className="font-semibold">Recorded activity (sanitized)</h3>
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 text-xs">{JSON.stringify(event.entry.payload, null, 2)}</pre>
      </div>}
    </Modal>
  </div>
}
