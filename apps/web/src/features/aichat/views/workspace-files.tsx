/** The project's /workspace as a read-only tree drawn with box characters. A file opens as a bounded preview; nothing here changes the workspace. */
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WorkspaceTreeEntry } from '@raptix/web-contracts'
import { fetchWorkspaceFile, fetchWorkspaceTree } from '../../projects/remote'
import { Banner, Modal } from '../../../ui/index'

interface TreeNode { name: string; path: string; kind: 'file' | 'dir'; size: number; children: TreeNode[] }

/** A visible row: the box-drawing prefix that places it under its parent. */
interface Row { node: TreeNode; prefix: string }

/** Nests the flat listing by path. Directories sort before files, each group by name. */
function buildTree(entries: WorkspaceTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', size: 0, children: [] }
  const byPath = new Map<string, TreeNode>([['', root]])
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const cut = entry.path.lastIndexOf('/')
    const parent = byPath.get(cut < 0 ? '' : entry.path.slice(0, cut)) ?? root
    const node: TreeNode = { name: entry.path.slice(cut + 1), path: entry.path, kind: entry.kind, size: entry.size, children: [] }
    parent.children.push(node)
    byPath.set(entry.path, node)
  }
  const order = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    nodes.forEach((node) => order(node.children))
  }
  order(root.children)
  return root.children
}

/** The visible rows in depth-first order. A collapsed folder hides its children; the prefixes draw each branch. */
function flatten(nodes: TreeNode[], collapsed: Set<string>, parentPrefix = ''): Row[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1
    const prefix = `${parentPrefix}${last ? '└── ' : '├── '}`
    const childPrefix = `${parentPrefix}${last ? '    ' : '│   '}`
    const children = node.kind === 'dir' && !collapsed.has(node.path) ? flatten(node.children, collapsed, childPrefix) : []
    return [{ node, prefix }, ...children]
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WorkspaceTree({ engagementId }: { engagementId: string }): ReactElement {
  const tree = useQuery({ queryKey: ['real', 'workspace-tree', engagementId], queryFn: () => fetchWorkspaceTree(engagementId), refetchInterval: 10_000 })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  if (tree.isPending) return <p className="text-xs text-muted">Reading the workspace…</p>
  if (tree.isError) return <Banner tone="warn" title="Workspace unavailable">{tree.error instanceof Error ? tree.error.message : 'The workspace could not be read.'}</Banner>
  const rows = flatten(buildTree(tree.data.entries), collapsed)
  const toggle = (path: string): void => setCollapsed((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next })
  return <section aria-label="Workspace files" className="space-y-2">
    <p className="font-mono text-xs text-muted">{tree.data.root}/ · {tree.data.entries.length} entries</p>
    {tree.data.truncated && <Banner tone="warn" title="Listing truncated">Only the first entries are shown.</Banner>}
    {rows.length === 0 ? <p className="text-xs text-muted">The workspace is empty.</p> : (
      <ul className="overflow-x-auto font-mono text-xs leading-5">
        {rows.map(({ node, prefix }) => <li key={node.path} className="flex min-w-0 items-baseline whitespace-pre">
          <span className="shrink-0 text-muted" aria-hidden>{prefix}</span>
          {node.kind === 'dir' ? (
            <button type="button" aria-expanded={!collapsed.has(node.path)} onClick={() => toggle(node.path)} className="min-w-0 truncate font-semibold text-fg hover:underline">{node.name}/</button>
          ) : (
            <button type="button" onClick={() => setSelected(node.path)} title={node.path} className="min-w-0 truncate text-fg hover:underline">{node.name}</button>
          )}
          {node.kind === 'file' && <span className="ml-3 shrink-0 text-muted">{formatSize(node.size)}</span>}
        </li>)}
      </ul>
    )}
    <FilePreview engagementId={engagementId} path={selected} onClose={() => setSelected(null)} />
  </section>
}

function FilePreview({ engagementId, path, onClose }: { engagementId: string; path: string | null; onClose: () => void }): ReactElement {
  const file = useQuery({
    queryKey: ['real', 'workspace-file', engagementId, path],
    queryFn: () => fetchWorkspaceFile(engagementId, path ?? ''),
    enabled: path !== null,
  })
  return <Modal open={path !== null} onClose={onClose} width={900} title={path ?? ''}>
    {file.isPending ? <p className="text-sm text-muted">Reading the file…</p> : file.isError ? (
      <Banner tone="warn" title="File unavailable">{file.error instanceof Error ? file.error.message : 'The file could not be read.'}</Banner>
    ) : file.data.binary ? (
      <p className="text-sm text-muted">Binary file · {formatSize(file.data.size)}. Its content is not shown.</p>
    ) : (
      <div className="space-y-3">
        {file.data.truncated && <Banner tone="info" title="Preview">Showing the start of a {formatSize(file.data.size)} file.</Banner>}
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-3 font-mono text-xs">{file.data.content ?? ''}</pre>
      </div>
    )}
  </Modal>
}
