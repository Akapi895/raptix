import type { ReactElement } from 'react'
import type { FindingReproductionArtifact, FindingReproductionInput } from '@raptix/web-contracts'
import { Banner, Button, Field, Select, Textarea } from '../../ui'
import type { RetainedCaptureOption } from './service'
import { EMPTY_REPRODUCTION } from './reproduction-draft'

/** The capture list as the picker can show it: still loading, failed (with the reason), or ready. */
export type CaptureListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }

/** Why the original bytes of a listed capture cannot be read yet, or null when they can. */
function unreadableNote(capture: RetainedCaptureOption): string {
  if (capture.classification === 'unclassified') return ' · classify it to read the original'
  return capture.canReadOriginal ? '' : ' · original not readable for your role'
}

/** A linked artifact's label when the list is not at hand: its recorded name, or a restricted marker. */
function linkedLabel(artifact: FindingReproductionArtifact): string {
  return `${artifact.filename ?? 'Restricted capture'} · ${artifact.sizeBytes} bytes`
}

/**
 * Edits one reproduction package. `null` or `undefined` means no package: nothing is sent unless an operator adds one.
 * The picker never shows an empty list as "no captures" while the list is loading or failed, and the artifact the
 * draft points at always keeps a visible label, so the form can never display one capture while saving another.
 */
export function ReproductionFields({ value, onChange, captures, captureList, linked, onRetryCaptures }: {
  value: FindingReproductionInput | null | undefined
  onChange: (next: FindingReproductionInput | null) => void
  captures: RetainedCaptureOption[]
  captureList: CaptureListState
  /** The artifact the finding already records; it keeps its label while the list is loading or after it failed. */
  linked: FindingReproductionArtifact | null
  onRetryCaptures: () => void
}): ReactElement {
  if (value === null || value === undefined) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted">No reproduction package. Add one when the steps are known; nothing is inferred.</span>
        <Button variant="secondary" onClick={() => onChange(EMPTY_REPRODUCTION)}>Add reproduction package</Button>
      </div>
    )
  }
  const selectedId = value.artifact?.captureId ?? ''
  const listed = captureList.status === 'ready' ? captures : []
  const selectedIsListed = listed.some((capture) => capture.captureId === selectedId)
  return (
    <div className="space-y-3">
      <Field label="Prerequisites"><Textarea value={value.prerequisites} onChange={(e) => onChange({ ...value, prerequisites: e.target.value })} /></Field>
      <Field label="Inputs"><Textarea value={value.inputs} onChange={(e) => onChange({ ...value, inputs: e.target.value })} /></Field>
      <Field label="Steps (one per line)"><Textarea value={value.steps.join('\n')} onChange={(e) => onChange({ ...value, steps: e.target.value.split('\n') })} /></Field>
      <Field label="Expected observation"><Textarea value={value.expectedObservation} onChange={(e) => onChange({ ...value, expectedObservation: e.target.value })} /></Field>
      <Field label="Limitations"><Textarea value={value.limitations} onChange={(e) => onChange({ ...value, limitations: e.target.value })} /></Field>
      <Field label="Reproduction artifact (retained capture)">
        <Select
          value={selectedId}
          disabled={captureList.status !== 'ready'}
          onChange={(e) => {
            const next = listed.find((capture) => capture.captureId === e.target.value)
            onChange({ ...value, artifact: next ? { captureId: next.captureId, digest: next.digest } : null })
          }}
        >
          <option value="">None</option>
          {listed.map((capture) => (
            <option key={capture.captureId} value={capture.captureId}>
              {`${capture.filename ?? 'Restricted capture'} · ${capture.sizeBytes} bytes${unreadableNote(capture)}`}
            </option>
          ))}
          {selectedId !== '' && !selectedIsListed && (
            <option value={selectedId}>{linked?.captureId === selectedId ? linkedLabel(linked) : 'Linked capture (not in the current list)'}</option>
          )}
        </Select>
      </Field>
      {captureList.status === 'loading' && <p className="text-xs text-muted" role="status">Loading the project's captures…</p>}
      {captureList.status === 'error' && (
        <Banner tone="bad" title="Captures could not be loaded">
          <span>{captureList.message} The current selection is kept as it is.</span>{' '}
          <Button size="sm" variant="secondary" onClick={onRetryCaptures}>Retry</Button>
        </Banner>
      )}
      <div className="flex justify-end"><Button variant="ghost" onClick={() => onChange(null)}>Remove package</Button></div>
    </div>
  )
}
