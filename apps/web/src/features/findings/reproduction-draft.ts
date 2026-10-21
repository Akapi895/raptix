import type { FindingReproduction, FindingReproductionInput } from '@raptix/web-contracts'

/**
 * The package an operator edits, with three states kept apart. `undefined`: the form has not touched the package,
 * so the server keeps whatever is stored (a finding that predates the package stays without one). `null`: the
 * operator removed it, and the server must receive that explicitly to clear the stored package. An object: the
 * package as entered.
 */
export const EMPTY_REPRODUCTION: FindingReproductionInput = {
  prerequisites: '',
  inputs: '',
  steps: [],
  expectedObservation: '',
  limitations: '',
  artifact: null,
}

/** The draft a finding opens with: its recorded package, or nothing when it has none. */
export function draftFromReproduction(reproduction: FindingReproduction | undefined): FindingReproductionInput | undefined {
  if (reproduction === undefined) return undefined
  return {
    prerequisites: reproduction.prerequisites,
    inputs: reproduction.inputs,
    steps: reproduction.steps,
    expectedObservation: reproduction.expectedObservation,
    limitations: reproduction.limitations,
    artifact: reproduction.artifact === null ? null : { captureId: reproduction.artifact.captureId, digest: reproduction.artifact.digest },
  }
}

/** The payload the server receives: trimmed text, no blank steps, and the three states passed through unchanged. */
export function draftReproductionPayload(draft: FindingReproductionInput | null | undefined): FindingReproductionInput | null | undefined {
  if (draft === undefined || draft === null) return draft
  return {
    prerequisites: draft.prerequisites.trim(),
    inputs: draft.inputs.trim(),
    steps: draft.steps.map((step) => step.trim()).filter((step) => step.length > 0),
    expectedObservation: draft.expectedObservation.trim(),
    limitations: draft.limitations.trim(),
    artifact: draft.artifact,
  }
}
