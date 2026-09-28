# 0016. Parse Gobuster directory results into existing KG node types

- **Status:** Proposed
- **Date:** 2026-09-28
- **Related:** `docs/incalmo-lessons-implementation-guide.md` WP-L2b

## Coverage audit

`skills/standard/recon/active-recon/SKILL.md` directs agents to run
`gobuster dir -u ... -o ...`. Its upstream `gobusterdir/result.go` writes a
relative path followed by `(Status: NNN)` and optionally `[Size: N]`.
`tools/research/tools.py` has parsers for nmap, nuclei, subfinder, httpx,
masscan, dnsx, katana, ffuf, testssl, crackmapexec, asrep, slither and SARIF.
The ffuf parser requires JSON with a full URL; it cannot read Gobuster's
directory-mode text. This is a verified gap. `amass -o` plain domain lists
can use the existing subfinder plaintext format and do not justify a second
parser. Other output formats require separate fixtures before implementation.

## Decision

Add `kg_ingest_gobuster(path, base_url)` for **directory mode only** to the
existing research-tool bundle. The caller supplies the exact base URL because
the `-o` file alone does not include the target. Only status-coded relative
directory hits under that same HTTP(S) origin become `Host`, `URL` and
`Entrypoint` nodes with existing `EXPOSES` edges. Reject malformed files,
oversized files, directory traversal and out-of-origin URLs. DNS/vhost output
and hits without a status code remain untouched. No new graph node or edge
type, KG store, tool-execution path, or L2a auto-ingest mapping is changed.

## Verification

T0 fixtures cover two hits (including a forbidden/403 path) and prove that
DNS output and an external URL create no nodes. Existing ffuf parser tests
protect the adjacent ingestion surface. T1 records the ingester's tool reply
then replays it with `ReplayMiddleware`, confirming the same visible reply
without a second KG write. The tool is optional; no agent input is changed.
