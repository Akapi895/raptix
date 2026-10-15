/** Operator-managed inventory stays distinct from observed graph assets. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { classifyAsset, fetchAssetInventory, importAssets } from '../api'
import { go, useRoute } from '../../router/navigate'
import { Button, Card, CardHeader, Select, Textarea } from '../../ui'

export function RealInventoryPanel({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  const client = useQueryClient()
  const inventory = useQuery({ queryKey: ['real', 'asset-inventory', engagementId], queryFn: () => fetchAssetInventory(engagementId) })
  const [identifiers, setIdentifiers] = useState('')
  const [kind, setKind] = useState<'host' | 'web_url' | 'ip_range'>('host')
  const [error, setError] = useState<string | null>(null)
  const write = useMutation({
    mutationFn: (action: { id: string; classification: 'pending' | 'in_scope' | 'out_of_scope' } | null) => action
      ? classifyAsset(engagementId, action.id, action.classification)
      : importAssets(engagementId, identifiers.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), kind),
    onSuccess: () => { setError(null); setIdentifiers(''); void client.invalidateQueries({ queryKey: ['real', 'asset-inventory', engagementId] }) },
    onError: (err) => setError(err.message),
  })
  if (inventory.isPending) return <p role="status">Loading inventory…</p>
  if (inventory.isError) return <p role="alert">{inventory.error.message}</p>
  const rows = route.page === 'asset' && route.id ? inventory.data.assets.filter((a) => a.id === route.id) : inventory.data.assets
  return <Card><CardHeader title="Managed asset inventory" sub="New assets stay pending until approved scope permits them. Graph observations are never overwritten." />
    {rows.length === 0 ? <p>{route.id ? 'Asset not found in this engagement.' : 'No managed assets yet.'}</p> : <ul className="space-y-3">{rows.map((asset) => <li key={asset.id} className="flex flex-wrap items-center gap-3">
      <Button onClick={() => go('asset', { id: asset.id, engagementId })}>{asset.identifier}</Button><span>{asset.kind} · v{asset.version} · {asset.classification}</span>
      <Select aria-label={`Classification for ${asset.identifier}`} value={asset.classification} disabled={write.isPending} onChange={(e) => write.mutate({ id: asset.id, classification: e.target.value as 'pending' | 'in_scope' | 'out_of_scope' })}>
        <option value="pending">Pending</option><option value="in_scope">In scope</option><option value="out_of_scope">Out of scope</option>
      </Select>
    </li>)}</ul>}
    <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); write.mutate(null) }}>
      <label className="block">Asset identifiers<Textarea aria-label="Asset identifiers" required value={identifiers} onChange={(e) => setIdentifiers(e.target.value)} /></label>
      <label>Asset kind<Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="host">Host</option><option value="web_url">Web URL</option><option value="ip_range">IP range</option></Select></label>
      <Button type="submit" disabled={write.isPending}>Import assets</Button>
    </form>
    {error && <p role="alert" className="text-bad">{error}</p>}
  </Card>
}
