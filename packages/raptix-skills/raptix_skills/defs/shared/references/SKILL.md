---
name: references
description: External knowledge integration — HackerOne reports, PayloadsAllTheThings, Book of Secret Knowledge, CVE PoC corpora, bug bounty methodologies, and reference pentest agent architectures. Use these to calibrate, look up payloads, and accelerate research.
metadata:
  subdomain: orchestration
  when_to_use: "external reference hackerone payloadsallthethings bsk book of secret knowledge cve poc bug bounty methodology pentest agent calibration"
  upstream_ref: "HackerOne disclosed reports + PayloadsAllTheThings + Book of Secret Knowledge + curated CVE PoC corpora"
---

# External References Skill

Raptix ships with a curated catalogue of high-signal third-party
resources, queried through three semantic fan-out tools:
`research_cve`, `search_security_references`, and `lookup_payload`.
You never pick the corpus, clone a repo, or grep manually — one call
fans out across every corpus that matches.

## Catalogue (13 entries)

| Category        | Slug                    | What's inside                                                  |
|-----------------|-------------------------|----------------------------------------------------------------|
| report-corpus   | hackerone-reports       | Every public H1 disclosure — calibrate CVSS + reward           |
| payload-library | payloads-all-the-things | Canonical payloads for every web vuln class                    |
| cheat-sheet     | book-of-secret-knowledge| Pentester one-liners + recipes                                 |
| reference-agent | pentagi                 | vxcontrol multi-agent pentest platform                         |
| reference-agent | pentestgpt              | Academic pentest LLM agent                                     |
| reference-agent | shannon                 | Keygraph autonomous security agent                             |
| reference-agent | strix                   | Usestrix autonomous pentest agent                              |
| reference-agent | hexstrike-ai            | 150+ tools exposed via MCP                                     |
| reference-agent | neurosploit             | LLM + Metasploit driver                                        |
| tool-index      | redteam-tools           | Kill-chain-phase tool index                                    |
| cve-poc         | trickest-cve            | Continuous CVE + PoC corpus                                    |
| cve-poc         | penetration-testing-poc | Second-opinion PoC mirror                                      |
| methodology     | all-about-bug-bounty    | Per-class bug bounty methodology                               |

## When to use each

### First engagement iteration
- `search_security_references("<your lane or vuln class>")` to see
  which references matter right now — one call fans out across the
  HackerOne / one-liner / methodology / kill-chain corpora.

### When you need a payload RIGHT NOW
- `lookup_payload("imds", vuln_class="ssrf")` — no network needed,
  bundled offline. Covers sqli, ssrf, xss, ssti, deser, rce, xxe,
  idor, jwt, oauth, lfi, cmdi, graphql, prompt-injection,
  proto-pollution, plus any extra class found in the cached
  payloads-all-the-things clone. Curated entries rank first.

### Report calibration
- `search_security_references("<your bug class>", kinds=["h1"])` to
  find similar disclosed reports (and what they paid).
- Copy the report structure that got paid — it's validated by triagers.

### CVE → PoC
- After `cve_lookup` returns a CVE ID, `research_cve("CVE-2024-1234")`
  resolves every id in the query against the local trickest-cve /
  penetration-testing-poc index (instant, no network) and returns the
  public PoC urls.
- Cross-reference `search_security_references` for prior art on the
  same bug class.

### Tool discovery
- `search_security_references("lateral movement", kinds=["killchain"])`
  to find the right tool for a phase you haven't touched yet.

## Workflow

1. Identify the vuln class or phase you're working on.
2. `search_security_references` to surface prior art across the
   corpora (all four kinds, or a `kinds` subset).
3. For payloads, `lookup_payload` — keyword and/or `vuln_class`, no
   clone-or-grep step.
4. For CVEs, `research_cve` — pass the id(s) inside any query text.
5. Record any borrowed payloads / patterns as `Hypothesis`
   observations (`kg_record` on roles carrying the KG slot) until
   validated.

## Shannon, Strix, HexStrike, Pentagi, PentestGPT, NeuroSploit

These are *reference architectures*, not tools to run. Read them to
steal good ideas about:
- Multi-agent orchestration patterns
- Tool wrapping idioms
- Prompt engineering for pentest workflows
- How other projects handle memory / state / observability

Don't reinvent wheels — if one of them solved a problem elegantly,
borrow the pattern into Raptix's next iteration.
