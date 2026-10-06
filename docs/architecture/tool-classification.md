# Tool Classification (Wave T1, v2)

> Status: **Docs only — no code change.** Supersedes the v1 table after
> the T0/T1 freeze review found a materially incomplete inventory and a
> taxonomy gap (see `## Changes from v1` below). Feeds T2–T13 of
> `docs/tool-optimization-implementation-plan.md`.

> Generated 2026-10-06 from a structured table
> (`benchmarks/tool_eval/baseline/_gen_classification.py`, scratch-only,
> not part of the shipped harness) so every count below is computed, never
> hand-tallied.

---

## Changes from v1

The 2026-10-06 freeze review of `tool-classification.md` (v1) and
`capture_baseline.py` (T0a) found the v1 inventory materially
incomplete and one taxonomy gap, before T0/T1 could freeze:

1. **Inventory was incomplete.** v1 scanned only line-start
   `^@tool` decorators under `execution/tools/`. Missed entirely:
   `kg_surface_inventory` (role=`raptix`'s actual KG tool — NOT
   `kg_record`/`kg_ingest`, which v1 assumed for every KG-slot role);
   7 OPPLAN tools (nested `@tool` inside `build_opplan_tools()` in
   `execution/tools/opplan.py`, indented, never matched); 3 Skillogy
   tools (`load_skill`/`find_skill`/`traverse`, outside
   `execution/tools/` entirely, the DEFAULT skill backend since
   `RAPTIX_USE_SKILLOGY` defaults on); the `task` dispatch tool (built
   via `StructuredTool.from_function`, never `@tool`-decorated); and 4
   functional-form `x = tool(fn)` registrations in
   `contracts/tools.py` (`solidity_scan`,
   `foundry_reentrancy_test/_access_test/_flashloan_test`).
   140+2 (v1) → 159 (v2).
2. **Category and target surface were conflated.** v1's decision-tree
   prose read as "planner needs it → semantic capability, specialist
   needs it → execution primitive", which contradicts v1's own table
   (many `worker:ad` rows were correctly tagged Semantic capability).
   v2 makes the two axes independent: **category** answers "is this a
   capability (WHAT a red teamer wants) or a primitive (HOW one worker
   step gets there)"; **target surface** answers "which role sees it".
   A function can be `category=Worker primitive, surface=worker:ad`.
3. **New category: Worker primitive.** Distinct from `Execution
   primitive` (bash/browser — the open-world escape hatch, never
   counted as capability availability). A Worker primitive IS counted
   as part of a capability's declared implementation — it is the HOW
   under a WHAT a planner/worker already decided to pursue (e.g.
   `reversing.analyze_binary` as the capability, with `bin_strings` /
   `ghidra_decompile` / `ghidra_xrefs` as its primitives). 55 functions
   moved from Semantic capability into this new bucket.
4. **Six functions reclassified to Internal service**: `bhce_status`,
   `ghidra_status`, `re_status` (availability probes — T6's
   `CapabilityAvailability` replaces the need for the LLM to ask),
   `metadata_endpoints` (static reference lookup), `cvss_score_tool`
   (deterministic calculator), `fuzz_record_crash` (finding mutation,
   not a decision).
5. **`validate_finding` target surface narrowed** from "all roles" to
   `verifier` — the intended flow is worker produces an Observation/
   Candidate, verifier calls `validate_finding`.
6. **`proxy_scope_rules` flagged for a read/write split** —
   `proxy.inspect_scope` (worker primitive) vs `engagement.update_scope`
   (operator control-plane); it must never substitute for the real
   invocation-time RoE guard.
7. **Target Capability ID added** for every surviving Semantic
   capability and Worker primitive, so T2 does not invent naming a
   second time.

---

## Method

```
Category (independent of surface):
  Is this WHAT a red teamer wants to accomplish?
    YES, and it's a goal the planner or a worker actively chooses
      → Semantic capability
    YES, but it's HOW one step of an already-chosen capability
      happens (a specific query/action/analysis primitive)
      → Worker primitive
    NO — it's plan/engagement state, approval, or dispatch
      → Control-plane tool
    NO — it's the open-world escape hatch (bash/browser), never
      counted as a capability's declared implementation
      → Execution primitive
    NO — the resolver picks it deterministically, the LLM never
      chooses between adapters directly
      → Adapter
    NO — housekeeping, CRUD, parsing, rendering, probing — never
      a deliberate LLM choice
      → Internal service

Target surface (orthogonal): which role(s) see it —
  planner / worker:<domain> / verifier / operator / internal /
  all roles (recovery surface)
```

**Count:** 159 — every `@tool`-decorated function anywhere under
`packages/raptix/raptix` (any indentation, so nested/closure-built
tools count), every `x = tool(fn)` functional registration, and the
one `StructuredTool.from_function` call. Scope is this repo's
`packages/raptix` core runtime only — domain-plugin packages under
`plugins/*` (ad_operator, cloud_hunter, contract_auditor, reverser,
phisher, mobile_operator, wireless_operator, ics_operator,
iot_operator — all composed via
`raptix.intelligence.agents.domain_composer.compose_domain_agent`,
confirmed to route through the SAME `build_tools()`/`build_middleware()`
as core roles) declare no `@tool` of their own; they select by name
from this same core inventory (`domain_baseline_tools()` resolves
`DomainAgentDefinition.tool_names` against it). The Ghidra MCP bridge
(~245 tools when active) is excluded — it is a dynamically-discovered
external surface, not declared via `@tool` in this repo, and is
tracked as one unit under T9's dynamic exposure.

---

## `ad` — 12 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `bhce_status` | Internal service | internal | — | Availability probe, not an LLM decision (reclass from v1) |
| `bhce_cypher` | Worker primitive | worker:ad | ad.audit_ad | Ad-hoc Cypher query — HOW, under the AD audit capability |
| `bhce_ingest_zip` | Internal service | internal | — | Bulk ingest |
| `bh_ingest_zip` | Internal service | internal | — | Duplicate ingest path vs bhce_ingest_zip — T4 picks one |
| `bh_ingest_json` | Internal service | internal | — | Ingest |
| `dcsync_check` | Worker primitive | worker:ad | ad.audit_ad | DCSync exposure check |
| `kerberos_classify` | Worker primitive | worker:ad | ad.audit_ad | Hash/ticket classifier |
| `adcs_audit` | Worker primitive | worker:ad | ad.audit_ad | ADCS misconfig check |
| `delegation_audit` | Worker primitive | worker:ad | ad.audit_ad | Delegation check |
| `gpo_audit` | Worker primitive | worker:ad | ad.audit_ad | GPO check |
| `shadow_creds_audit` | Worker primitive | worker:ad | ad.audit_ad | Shadow creds check |
| `adcs_post_process` | Internal service | internal | — | Deterministic post-process |

## `bash/bash.py` — 4 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `bash` | Execution primitive | worker:* (specialist) | — | Open-world escape hatch |
| `bash_output` | Execution primitive | worker:* (specialist) | — | Open-world escape hatch |
| `bash_kill` | Execution primitive | worker:* (specialist) | — | Open-world escape hatch |
| `bash_status` | Execution primitive | worker:* (specialist) | — | Open-world escape hatch |

## `browser/tools.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `browser_action` | Execution primitive | worker:web | — | Generic browser transport |

## `cloud` — 6 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `iam_policy_audit` | Worker primitive | worker:cloud | cloud.audit_cloud |  |
| `s3_buckets_from_text` | Worker primitive | worker:cloud | cloud.audit_cloud |  |
| `user_data_secrets` | Worker primitive | worker:cloud | cloud.audit_cloud |  |
| `k8s_audit` | Worker primitive | worker:cloud | cloud.audit_cloud |  |
| `tfstate_audit` | Worker primitive | worker:cloud | cloud.audit_cloud |  |
| `metadata_endpoints` | Internal service | internal | — | Static reference lookup, not an audit action (reclass from v1) |

## `contracts` — 6 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `solidity_scan_file` | Worker primitive | worker:contracts | contracts.scan_solidity | Reads an arbitrary .sol path |
| `solidity_scan` | Worker primitive | worker:contracts | contracts.scan_solidity | Functional `tool(fn)` registration (missed in v1) — scans the active engagement's contract |
| `slither_ingest` | Internal service | internal | — | Duplicates kg_ingest_slither — T4 picks one |
| `foundry_reentrancy_test` | Worker primitive | worker:contracts | contracts.run_foundry_poc | Functional `tool(fn)` registration (missed in v1) |
| `foundry_access_test` | Worker primitive | worker:contracts | contracts.run_foundry_poc | Functional `tool(fn)` registration (missed in v1) |
| `foundry_flashloan_test` | Worker primitive | worker:contracts | contracts.run_foundry_poc | Functional `tool(fn)` registration (missed in v1) |

## `defense` — 9 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `blue_cell_scan` | Semantic capability | worker:defense | defense.scan_coverage |  |
| `defense_brief` | Semantic capability | operator | defense.generate_brief |  |
| `export_attack_navigator` | Semantic capability | operator | defense.export_navigator |  |
| `list_siem_targets` | Control-plane tool | operator | — | Discovery, not analysis |
| `sigma_to_splunk_savedsearch` | Worker primitive | worker:defense | defense.translate_detection_rule |  |
| `sigma_to_sentinel_analyticrule` | Worker primitive | worker:defense | defense.translate_detection_rule |  |
| `sigma_to_elastic_detection_rule` | Worker primitive | worker:defense | defense.translate_detection_rule |  |
| `yara_to_defender_xdr_custom_detection` | Worker primitive | worker:defense | defense.translate_detection_rule |  |
| `yara_to_crowdstrike_ioa` | Worker primitive | worker:defense | defense.translate_detection_rule |  |

## `evidence` — 4 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `export_session_asciicast` | Internal service | internal → inspect_evidence (T5) | — |  |
| `list_session_recordings` | Internal service | internal → inspect_evidence (T5) | — |  |
| `seal_evidence` | Internal service | internal → inspect_evidence (T5) | — |  |
| `verify_evidence` | Internal service | internal → inspect_evidence (T5) | — |  |

## `interaction` — 2 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `ask_user_question` | Control-plane tool | all roles (recovery surface) | — | Safety-critical |
| `complete_engagement_planning` | Control-plane tool | planner | — | Safety-critical |

## `ops` — 4 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `ops_start` | Control-plane tool | operator | — | ops_available()-gated, orchestrator only |
| `ops_stop` | Control-plane tool | operator | — | ops_available()-gated, orchestrator only |
| `ops_cleanup_engagement` | Control-plane tool | operator | — | ops_available()-gated, orchestrator only |
| `ops_status` | Control-plane tool | operator | — | ops_available()-gated, orchestrator only |

## `proxy` — 7 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `proxy_list_requests` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_view_request` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_send_request` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_repeat_request` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_list_sitemap` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_view_sitemap_entry` | Worker primitive | worker:web | web.operate_proxy |  |
| `proxy_scope_rules` | Control-plane tool | worker:web (today) | — | Read+write today in one function; target SPLIT: proxy.inspect_scope (worker primitive) vs engagement.update_scope (operator control-plane). Never a substitute for the real invocation-time RoE guard. |

## `references` — 15 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `ref_list` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `ref_suggest` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `ref_topic` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `ref_fetch` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `ref_status` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `ref_grep` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `killchain_lookup` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `references_hydrate` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `payload_classes` | Internal service | internal → search_security_references/lookup_payload | — |  |
| `payload_search` | Worker primitive | worker:* | research.lookup_payload |  |
| `cve_poc_lookup` | Worker primitive | worker:* | research.cve | Lives in references/tools.py despite the cve_ name |
| `h1_search` | Worker primitive | worker:* | research.search_references |  |
| `oneliner_search` | Worker primitive | worker:* | research.search_references |  |
| `killchain_suggest` | Control-plane tool | planner | — | Suggests next objectives — planner-facing, not a reference lookup |
| `methodology_lookup` | Worker primitive | worker:* | research.search_references |  |

## `reporting` — 6 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `cvss_score_tool` | Internal service | internal/verifier | — | Deterministic calculator (reclass from v1 Semantic capability) |
| `report_hackerone` | Internal service | internal → generate_report | — |  |
| `report_bugcrowd_csv` | Internal service | internal → generate_report | — |  |
| `report_executive` | Internal service | internal → generate_report | — |  |
| `report_timeline` | Internal service | internal → generate_report | — |  |
| `report_sarif` | Internal service | internal → generate_report | — |  |

## `research/bounty.py` — 2 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `bounty_scope_check` | Control-plane tool | planner, verifier | — | Authorization-adjacent; not a substitute for the real invocation-time guard |
| `format_bounty_report` | Internal service | internal → generate_report | — | Overlaps reporting/tools.py renderers |

## `research/dedupe.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `kg_dedupe_findings` | Internal service | internal | — |  |

## `research/osint.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `osint_enrich` | Semantic capability | worker:osint | osint.enrich_domain |  |

## `research/patch.py` — 2 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `patch_propose` | Semantic capability | worker:analyst | analyst.propose_patch |  |
| `patch_verify` | Semantic capability | worker:analyst | analyst.verify_patch |  |

## `research/scanner_tools.py` — 3 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `scan_shard` | Semantic capability | worker:analyst | analyst.run_scan_shard | Bounded-worker candidate for T10 |
| `rank_candidates` | Internal service | internal | — |  |
| `kg_add_candidate` | Internal service | internal | — |  |

## `research/secret_scanner.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `scan_secrets` | Semantic capability | worker:web, worker:analyst | web.scan_secrets |  |

## `research/tech_detection.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `detect_tech_stack` | Semantic capability | worker:recon | recon.detect_tech_stack |  |

## `research/tools.py` — 34 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `fuzz_classify` | Semantic capability | worker:analyst | analyst.fuzz_target |  |
| `fuzz_harness` | Semantic capability | worker:analyst | analyst.fuzz_target |  |
| `fuzz_record_crash` | Internal service | internal | — | Finding mutation, not a decision (reclass from v1 Semantic capability) |
| `kg_add_node` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_add_edge` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_query` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_neighbors` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_stats` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_backend_health` | Internal service | internal → inspect_asset/search_knowledge | — |  |
| `kg_ingest_sarif` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_nmap_xml` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_nuclei_jsonl` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_subfinder` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_httpx_jsonl` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_slither` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_dnsx` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_katana` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_masscan` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_ffuf` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_gobuster` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_testssl` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_crackmapexec` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_ingest_asrep_hashes` | Internal service | internal (T3 ParserRegistry) | — |  |
| `kg_analyze_jwt` | Worker primitive | worker:web | web.audit_jwt | Duplicates jwt_parse — T4 merges |
| `kg_analyze_oauth_callback` | Worker primitive | worker:web | web.audit_oauth | Duplicates oauth_audit — T4 merges |
| `kg_analyze_cookie_value` | Worker primitive | worker:web | web.audit_cookie | Duplicates cookie_audit — T4 merges |
| `kg_scan_solidity` | Worker primitive | worker:contracts | contracts.scan_solidity | Duplicates solidity_scan_file — T4 merges |
| `kg_triage_binary` | Worker primitive | worker:reversing | reversing.analyze_binary | Duplicates bin_identify/bin_strings — T4 merges |
| `cve_lookup` | Worker primitive | worker:*, planner | research.cve |  |
| `cve_by_package` | Worker primitive | worker:*, planner | research.cve |  |
| `cve_enrich_dependencies` | Worker primitive | worker:*, planner | research.cve |  |
| `plan_attack_chains` | Control-plane tool | planner | — | OPPLAN-adjacent |
| `suggest_objectives_from_chains` | Control-plane tool | planner | — | OPPLAN-adjacent |
| `validate_finding` | Control-plane tool | verifier | — | Target surface narrowed from 'all roles' (v1) to verifier — worker produces Evidence/Observation/Candidate, verifier calls validate_finding. Matched by exact name in EventLogMiddleware._FINDING_TOOLS; name must stay stable. |

## `reversing` — 12 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `bin_identify` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `bin_strings` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `bin_packer` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `bin_rop` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `ghidra_analyze` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `ghidra_decompile` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `ghidra_xrefs` | Worker primitive | worker:reversing | reversing.analyze_binary |  |
| `bin_symbols_report` | Internal service | internal | — | Pure formatting |
| `bin_ghidra_script` | Adapter | internal (resolver picks) | — |  |
| `bin_r2_script` | Adapter | internal | — |  |
| `ghidra_status` | Internal service | internal | — | Availability probe, not an LLM decision (reclass from v1); folds into T6 CapabilityAvailability |
| `re_status` | Internal service | internal | — | Availability probe, not an LLM decision (reclass from v1); folds into T6 CapabilityAvailability |

## `verification.py` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `validate_workspace_finding` | Control-plane tool | verifier | — |  |

## `web` — 10 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `web_fetch` | Semantic capability | planner, worker:* | research.web_fetch | ADR-0010 |
| `web_search` | Semantic capability | planner, worker:* | research.web_search | ADR-0010 |
| `jwt_parse` | Worker primitive | worker:web | web.audit_jwt | Duplicates kg_analyze_jwt |
| `jwt_forge` | Worker primitive | worker:web | web.audit_jwt |  |
| `jwt_crack` | Worker primitive | worker:web | web.audit_jwt |  |
| `graphql_plan` | Worker primitive | worker:web | web.audit_graphql |  |
| `oauth_audit` | Worker primitive | worker:web | web.audit_oauth | Duplicates kg_analyze_oauth_callback |
| `cookie_audit` | Worker primitive | worker:web | web.audit_cookie | Duplicates kg_analyze_cookie_value |
| `http_request` | Worker primitive | worker:web | web.operate_proxy | Generic HTTP primitive |
| `http_history` | Internal service | internal | — | Read of http_request's own log |

## `knowledge/graph/tools.py (via KGMiddleware)` — 2 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `kg_record` | Control-plane tool (today) | analyst, ad_operator, contract_auditor, osint_operator | — | Target: mostly Internal (Observation → KnowledgeService); LLM should not CRUD canonical state directly |
| `kg_ingest` | Control-plane tool (today) | same roles as kg_record | — | Agent-facing twin of the 14 kg_ingest_* parsers; target is internal ParserRegistry/auto-ingest |

## `knowledge/graph/tools.py (via KGMiddleware, role=raptix only)` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `kg_surface_inventory` | Semantic capability | planner (raptix orchestrator) | — | Missed entirely in v1 — KGMiddleware swaps its tool surface to this ONE tool for role='raptix' instead of kg_record/kg_ingest. Target: PlanningContext / knowledge-inspection abstraction (T4) |

## `middleware/dispatch.py (StructuredTool.from_function, via DispatchMiddleware)` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `task` | Control-plane tool | planner (orchestrator roles with SUBAGENT slot) | — | Missed in v1 — not @tool-decorated, built via StructuredTool.from_function |

## `execution/tools/opplan.py (via OPPLANMiddleware)` — 7 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `add_objective` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `get_objective` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `list_objectives` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `update_objective` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `objective_expand` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `objective_collapse` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |
| `load_opplan` | Control-plane tool | planner (orchestrator roles with OPPLAN slot) | — | Missed in v1 — defined as a nested @tool inside build_opplan_tools(), not matched by a line-start-anchored scan |

## `execution/tools/skills.py (via legacy SkillsMiddleware)` — 1 function

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `load_skill` | Control-plane tool | all roles (recovery surface) | — | Missed in v1 — nested @tool inside build_load_skill_tool(). Legacy backend; RAPTIX_USE_SKILLOGY=1 (default) swaps to the Skillogy variant below instead. |

## `middleware/skillogy.py (via SkillogyMiddleware, default backend)` — 3 functions

| Function | Category | Target surface | Target capability | Notes |
|---|---|---|---|---|
| `load_skill` | Control-plane tool | all roles (recovery surface) | — | Missed in v1 — outside execution/tools/ entirely |
| `find_skill` | Control-plane tool | all roles (recovery surface) | — | Missed in v1 — outside execution/tools/ entirely |
| `traverse` | Control-plane tool | all roles (recovery surface) | — | Missed in v1 — outside execution/tools/ entirely |

## Summary by category

Computed directly from the 159-row table above — never hand-tallied.

| Category | Count |
|---|---:|
| Internal service | 55 |
| Worker primitive | 55 |
| Control-plane tool | 28 |
| Semantic capability | 14 |
| Execution primitive | 5 |
| Adapter | 2 |
| **Total** | **159** |

Of the 55 Internal service functions, 20 (6 KG CRUD + 14
`kg_ingest_*`) are T3/T4's direct target; the remaining 35 are
reference-corpus browsing, reporting renderers, evidence/housekeeping,
availability probes, and duplicate ingest paths, targeted by T3–T6
collectively. Of the 55 Worker primitive functions, 6 are exact
duplicates of another primitive under the same target capability
(see Cross-cutting finding 1) and should collapse at T4.

---

## Cross-cutting findings for later waves

1. **Duplicate primitive paths under the same target capability**
   (T4 merge candidates, now sharing one Target Capability ID so the
   merge target is unambiguous): `slither_ingest` vs
   `kg_ingest_slither` (internal, not capability-ID'd — pick one
   ingest path); `kg_scan_solidity` vs `solidity_scan_file`
   (`contracts.scan_solidity`); `kg_triage_binary` vs
   `bin_identify`/`bin_strings` (`reversing.analyze_binary`);
   `kg_analyze_jwt` vs `jwt_parse` (`web.audit_jwt`);
   `kg_analyze_oauth_callback` vs `oauth_audit` (`web.audit_oauth`);
   `kg_analyze_cookie_value` vs `cookie_audit` (`web.audit_cookie`).
2. **`kg_ingest` (KGMiddleware) vs `kg_ingest_*` (14 module
   functions) vs `kg_surface_inventory` (role=`raptix` only)**: THREE
   separate KG-tool surfaces exist today depending on role. T3/T4
   should make ingestion uniformly internal and give
   `kg_surface_inventory` a PlanningContext-style read path instead of
   a bespoke per-role tool swap.
3. **Reporting fragmentation**: `reporting/tools.py` (5 formats) and
   `research/bounty.py`'s `format_bounty_report` both render findings.
   T5's `generate_report(format=...)` should absorb both.
4. **Authorization-adjacent tools flagged, not reclassified**:
   `bounty_scope_check` and `proxy_scope_rules` read/write scope state
   bordering T2's `InvocationGuard`. Neither substitutes for the real
   invocation-time guard; `proxy_scope_rules` additionally needs a
   read/write split (Changes from v1, #6).
5. **Ghidra MCP bridge** (~245 tools when active, per the reverser
   plugin's own description) stays out of this table's scope — tracked
   as one external dynamic-surface unit under T9.
6. **Two parallel skill-tool backends** (`execution/tools/skills.py`'s
   `load_skill`, legacy, vs `middleware/skillogy.py`'s
   `load_skill`/`find_skill`/`traverse`, default-on via
   `RAPTIX_USE_SKILLOGY`) are swapped, never both present — T0b's
   baseline profile must pin which one it captured.

---

## Acceptance

Classification complete for all 159 functions in `packages/raptix`'s
core runtime (`execution/tools/`, `knowledge/graph/tools.py`,
`middleware/dispatch.py`, `middleware/skillogy.py`). Domain-plugin
packages under `plugins/*` select from this same inventory by name
and declare no `@tool` of their own (verified for all 9 via their
`DEFINITION.tool_names` + `compose_domain_agent`). Signed off by
review before any T2+ code change consumes these target-surface /
target-capability assignments.
