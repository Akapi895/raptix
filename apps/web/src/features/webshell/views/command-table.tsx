import type { ReactElement } from 'react'
import type { WebShellCommandView } from '@raptix/web-contracts'
import { utcMinute } from '../../../platform/format'
import { Status } from '../../../ui/index'

const STATUS = { delivered: 'passed', failed: 'failed', uncertain: 'pending', creating: 'pending' } as const

function Output({ command }: { command: WebShellCommandView }): ReactElement {
  return (
    <details className="max-w-xl">
      <summary className="cursor-pointer">View output · {command.id}</summary>
      <div className="mt-2 space-y-2">
        {command.outputTruncated && <p role="note">Output truncated at the 192 KiB bound.</p>}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{command.output || '(empty)'}</pre>
        {command.error !== null && <p className="text-xs text-bad" role="alert">{command.error}</p>}
        <p className="text-xs text-muted">HTTP {command.httpStatus ?? '—'} · exit {command.exitCode ?? '—'}</p>
      </div>
    </details>
  )
}

export function WebShellCommandTable({ commands }: { commands: WebShellCommandView[] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2">Command</th><th className="pb-2">Status</th><th className="pb-2">HTTP</th><th className="pb-2">Created</th><th className="pb-2">Output</th>
        </tr>
      </thead>
      <tbody>
        {commands.map((command) => (
          <tr key={command.id} className="border-t border-line">
            <td className="py-2 pr-3 font-mono text-xs">{command.command}</td>
            <td className="py-2 pr-3"><Status kind="gate" value={STATUS[command.status]} size="sm" label={command.status} /></td>
            <td className="py-2 pr-3 text-xs">{command.httpStatus ?? '—'}</td>
            <td className="py-2 pr-3 text-xs">{utcMinute(command.createdAt)}</td>
            <td className="py-2 text-xs"><Output command={command} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
