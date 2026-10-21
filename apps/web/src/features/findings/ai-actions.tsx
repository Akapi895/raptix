import { useQueryClient } from '@tanstack/react-query'
import type { Finding } from '../../data'
import { ROLE_LABEL } from '../../auth/policy'
import { go } from '../../router/navigate'
import { useCan, useMe, useReadOnly } from '../../state/console'
import { useSessionStore } from '../../state/session'
import { useToastStore } from '../../state/stores'
import { Mono } from '../../ui'
import { useFindingWrites } from './query'

/**
 * Verify / dismiss actions for an AI-suggested finding (never counted as
 * verified until verified). Ticket 32: verification imports the suggestion
 * through the typed write, which can only land it as a DRAFT (invariant 5
 * at the handler) — curation and the submit to review stay human-driven.
 */
export function useAiActions() {
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const readOnly = useReadOnly()
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  const why = (f: Finding) => (readOnly(f.projectId) ? 'Project is read-only.' : !can('createFinding', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot verify or dismiss AI suggestions. An Analyst or Operator can.` : '')
  const verify = (f: Finding) => confirm({
    title: `Verify & import ${f.id} as a draft?`, confirmLabel: 'Verify & create finding',
    body: <div className="space-y-2">
      <p>You confirm you reviewed the source claim. It becomes a draft for curation, enters review only after you submit it, and needs an independent Reviewer before it can count in reports.</p>
      {f.producer && <p>Producer source: <Mono>{f.producer.path}</Mono>. The source evidence text is a claim, not an evidence reference.</p>}
      {f.producer?.quality?.defaultSeverity && <p className="text-warn">The parser supplied the severity default; verify the source before keeping it.</p>}
      {f.producer?.quality?.placeholderDescription && <p className="text-warn">The source has no description beyond a placeholder.</p>}
      {f.producer?.quality?.placeholderEvidence && <p className="text-warn">The source has no evidence reference beyond a placeholder.</p>}
      {f.producer?.quality?.unreadable && <p className="text-warn">The producer source has parser-quality problems.</p>}
    </div>,
    onConfirm: async () => {
      const res = await writes.importSuggestion(f.id)
      if (res.ok) { toast(`${f.id} imported as draft ${res.data.id}.`); go('finding', { id: res.data.id }) }
      else toast(res.failure.message, 'warn')
    },
  })
  const dismiss = (f: Finding) => confirm({
    title: `Dismiss ${f.id}?`, confirmLabel: 'Dismiss suggestion', danger: true, reasonLabel: 'Reason for dismissing', reasonRequired: true,
    body: 'The suggestion is removed from the active AI Suggestions list. It is never added to confirmed counts or reports. The reason is recorded.',
    onConfirm: async (r) => {
      const result = await writes.setSuggestionDisposition(f.id, { producerRef: f.producer?.path ?? '', dismissed: true, reason: r, expectedVersion: f.suggestionDisposition?.version ?? 0 })
      if (!result.ok) { toast(result.failure.message, 'warn'); return }
      void queryClient.invalidateQueries({ queryKey: ['finding'] })
      toast(`${f.id} dismissed.`, 'warn')
    },
  })
  return {
    why,
    dismissWhy: (f: Finding) => why(f),
    verify,
    dismiss,
    restore: async (f: Finding) => {
      const result = await writes.setSuggestionDisposition(f.id, { producerRef: f.producer?.path ?? '', dismissed: false, reason: '', expectedVersion: f.suggestionDisposition?.version ?? 0 })
      if (!result.ok) { toast(result.failure.message, 'warn'); return }
      void queryClient.invalidateQueries({ queryKey: ['finding'] })
    },
  }
}
