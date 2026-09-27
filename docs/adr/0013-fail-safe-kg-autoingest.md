# 0013. Fail-safe KG auto-ingest after scanner tool calls

- **Status:** Proposed
- **Date:** 2026-09-27
- **Related:** `docs/incalmo-lessons-implementation-guide.md` WP-L2a

## Context

Network specialists can save scanner results without subsequently asking the KG to ingest them.
The existing `kg_ingest_*` research tools use a compatibility shim; the newer
`KGMiddleware` has engagement-scoped `KGStore` adapters but is only installed on three
specialists, none of them `recon`. Scanner files reside in an HTTP sandbox rather than
the LangGraph container. Import-time agent construction must also work without Neo4j.

## Decision

Add a middleware slot only to `recon`, `exploit`, `postexploit`, `ad_operator`, and
`cloud_hunter`. After a foreground `bash` call reports exit code zero, recognize only unambiguous,
absolute workspace outputs from `nmap -oX`, `httpx -json -o`, and `nuclei -jsonl -o`.
These three already have engagement-scoped adapters in `kg_internal.ingest`; do not
copy their parsers or route writes through the legacy engagement contextvar.
Read small sandbox files through its existing file API (or nmap XML stdout), place
the bounded bytes in a temporary local file for the adapter, then delete the file.
Skip commands, paths, or scanner formats we cannot classify reliably. Other existing
legacy ingesters remain manual until their output and scoped write path are verified.

`DECEPTICON_KG_AUTOINGEST=1` enables the hook (default off until a live validation
on a test engagement). The slot degrades
when KG credentials or the sandbox are unavailable. The tool runs before ingestion;
errors are logged at debug level and the exact tool result is returned unchanged.
Cap file size and post-tool wait time. An auto-ingest write uses the trusted engagement
from agent state, never output text or a model-supplied engagement identifier.

## Consequences and verification

Successful scans populate the existing KG without another agent tool call. Only the
three verified formats opt in; background scans, ambiguous relative paths, oversized
files and unavailable KG remain on the pre-existing manual path. The sandbox's
`download_files` API reads a whole file, so metadata is checked first and received
bytes are checked again; a concurrent file growth between checks may still cost a
larger sandbox response, but the hook times out from the agent's point of view.

T0 verifies successful ingestion, failure passthrough, flag and scope. T1 replays a
recorded tool reply via `ReplayMiddleware` and checks KG observations and unchanged
tool response. No exploit-execution or guardrail implementation changes are required.
