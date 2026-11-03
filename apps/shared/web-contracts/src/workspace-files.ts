/** The project's /workspace as its sandbox holds it: a read-only listing and a bounded file preview for the operator. */

export interface WorkspaceTreeEntry {
  /** Path relative to /workspace, '/'-separated. */
  path: string
  kind: 'file' | 'dir'
  size: number
  /** ISO-8601 UTC modification time. */
  modifiedAt: string
}

export interface WorkspaceTreeView {
  root: string
  entries: WorkspaceTreeEntry[]
  truncated: boolean
}

export interface WorkspaceFileView {
  path: string
  size: number
  binary: boolean
  truncated: boolean
  /** The start of the file as UTF-8 text; null for a binary file. */
  content: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTreeEntry = (value: unknown): value is WorkspaceTreeEntry =>
  isRecord(value) && typeof value.path === 'string' && (value.kind === 'file' || value.kind === 'dir')
  && typeof value.size === 'number' && typeof value.modifiedAt === 'string'

export function isWorkspaceTreeView(value: unknown): value is WorkspaceTreeView {
  return isRecord(value) && typeof value.root === 'string' && typeof value.truncated === 'boolean'
    && Array.isArray(value.entries) && value.entries.every(isTreeEntry)
}

export function isWorkspaceFileView(value: unknown): value is WorkspaceFileView {
  return isRecord(value) && typeof value.path === 'string' && typeof value.size === 'number'
    && typeof value.binary === 'boolean' && typeof value.truncated === 'boolean'
    && (value.content === null || typeof value.content === 'string')
}
