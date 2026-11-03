# Real scanner output fixtures

Captured 2026-11-03 by actually running each binary inside the `raptix-sandbox`
container (the same image `KGAutoIngestMiddleware` auto-ingests from in
production), per `docs/design/2026-11-03-graph-technical-design.md` Mục 9
roadmap step 1: validate parsing against real tool output, not hand-written
minimal fixtures.

Targets scanned: a throwaway local `python3 -m http.server` the capture
session started inside the sandbox itself (`127.0.0.1:8999`, serving
`/`, `/admin/`, `/api/status.json`), plus `example.com` (IANA's reserved
example domain) for the two DNS-only tools that need a real public name to
query. Nothing outside the sandbox's own loopback and a domain designated for
exactly this kind of testing was touched.

| File | Tool | Real command |
|---|---|---|
| `nmap.xml` | nmap 7.991 | `nmap -sT -p 8999 -oX nmap.xml 127.0.0.1` |
| `httpx.jsonl` | ProjectDiscovery httpx | `httpx-toolkit -u http://127.0.0.1:8999 -json -o httpx.jsonl -silent` |
| `katana.jsonl` | ProjectDiscovery katana | `katana -u http://127.0.0.1:8999 -jsonl -o katana.jsonl -silent` |
| `nuclei.jsonl` | ProjectDiscovery nuclei | `nuclei -u http://127.0.0.1:8999 -t http/technologies -jsonl -o nuclei.jsonl -silent` |
| `ffuf.json` | ffuf | `ffuf -u http://127.0.0.1:8999/FUZZ -w wordlist.txt -of json -o ffuf.json -s` |
| `gobuster.txt` | gobuster | `gobuster dir -u http://127.0.0.1:8999 -w wordlist.txt -o gobuster.txt -q` |
| `dnsx.jsonl` | ProjectDiscovery dnsx | `dnsx -l hosts.txt -json -o dnsx.jsonl -silent -a` against `example.com`/`www.example.com` |
| `subfinder.txt` | ProjectDiscovery subfinder | `subfinder -d example.com -o subfinder.txt -silent`, truncated to the first 30 of 22,249 real results found — the full file is kept only as evidence of the real scale this parser must tolerate, not committed |

**`arjun`** (ran `arjun -u http://127.0.0.1:8999/api/status.json -oJ ...`) found
zero parameters against this static-JSON target and — confirmed by its real
behavior, not assumed — wrote **no output file at all**. That absence is
itself the fixture for the "scanner ran, found nothing, never created the
output path" case; see `test_autoingest_real_scanner_output.py`.

**`masscan.json` is NOT a live capture.** `masscan` hung indefinitely on this
container's Docker bridge network (a well-known masscan limitation: it does
its own ARP resolution for the gateway before sending SYN packets, which
doesn't resolve the way it expects inside `docker0`-style bridges — confirmed
with an explicit `--router-mac`, still hung). The file instead reproduces
masscan's own documented `-oJ` shape verbatim from its README/manual. Treat
the masscan parser test as validated against the documented format, not
against this environment's real binary.

**Binary-name finding (not a fixture, a real bug caught by this exercise):**
on this exact Kali-based sandbox image, the binary literally named `httpx` is
`python3-httpx`'s pip-installed CLI (an unrelated HTTP client, fails with "the
required dependencies were not installed"), not ProjectDiscovery's `httpx` —
that one is packaged as `httpx-toolkit`. Every skill doc
(`packages/raptix-skills/raptix_skills/defs/standard/recon/passive-recon/SKILL.md`
etc.) tells the agent to invoke it as `httpx`. On this image, the agent's
`httpx` auto-ingest path would never fire — `KGAutoIngestMiddleware` would
correctly skip it, since it never even matches a known scanner invocation,
but no observation would ever be recorded either. `kg_autoingest.py`'s
`_output()` now also recognizes `httpx-toolkit` as the same scanner so the
real packaged binary name is covered; the fixture content itself still came
from running `httpx-toolkit` for real.
