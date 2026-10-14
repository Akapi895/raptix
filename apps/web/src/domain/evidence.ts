/**
 * Findings/evidence vocabulary for the service layer, aligned with the repo
 * root GLOSSARY.md (recorded claim, evidence reference, capture integrity,
 * producer lineage). Naming only: these types carry no behavior, and an
 * evidence reference is never parsed or dereferenced by the console.
 *
 * Mechanical mapping (spec.md, glossary alignment): the UI's
 * "Integrity verified (simulated)" renders a {@link CaptureIntegrity};
 * findings record claims — the presence of a claim never establishes that it
 * is true. Entity fields holding these identities (`Finding.evidence`,
 * `Step.evidence`, `ToolEvent.evidence`, `Branch.evidence`) are plain strings
 * in `./entities` and map 1:1 to {@link EvidenceReference}.
 */
import type { Instant } from './service'

/**
 * Opaque identity of a retained capture or verification record
 * (GLOSSARY: evidence reference). Opaque means the console never parses it,
 * derives meaning from its format, or treats it as a path/URL.
 */
export type EvidenceReference = string

/**
 * Identity of an assertion recorded during an engagement (GLOSSARY: recorded
 * claim). A claim's presence or the author's confidence does not establish
 * that it is true; finding review status is claim state, not proof.
 */
export type ClaimId = string

/**
 * Identity of the producing invocation behind referenced evidence
 * (GLOSSARY: producer lineage). Copies and aliases preserve the origin;
 * counting distinct invocations does not by itself establish independent
 * corroboration.
 */
export type ProducerInvocationId = string

/**
 * Whether retrieved capture bytes match the capture's recorded identity and
 * content digest (GLOSSARY: capture integrity). Integrity describes the
 * retained bytes; it never establishes a security claim.
 */
export type CaptureIntegrityStatus = 'verified' | 'mismatch' | 'unverified'

export interface CaptureIntegrity {
  status: CaptureIntegrityStatus
  /** Content digest of the retained capture, once integrity has been evaluated. */
  digest?: string
  /** Instant the integrity check ran, when it has run. */
  checkedAt?: Instant
}

/** The producing invocation behind an evidence reference. */
export interface ProducerLineage {
  invocation: ProducerInvocationId
  /** Producer that created the capture (agent/system identity). */
  producer: string
  /** Instant the capture was produced, when recorded. */
  recordedAt?: Instant
}
