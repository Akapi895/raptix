# tools optim

## Prompt:
06/10/2026, 14:21:18

tôi có nên chuyển bớt thành các tool cần không, chứ tôi không chắc việc tự viết các tool. sau khi tôi yêu cầu agent khảo sát kỹ các tool, nó phản hồi như sau:
Kết quả kiểm kê tool
1. Custom tools (tool tự viết code Python)
Tổng: 148 tool (hàm @tool-decorated, AST-parse toàn repo), nằm trong 31 file, tất cả dưới
packages/raptix/raptix/execution/tools/ (sau W6, cũ là raptix/tools/). Plugins không định nghĩa @tool nào.
Nhóm	Số lượng	File	Tool tiêu biểu
KG / knowledge graph	25	research/tools.py (25), research/scanner_tools.py (3)	kg_add_node/edge/query/neighbors/stats, plan_attack_chains, rank_candidates, scan_shard
Parser output security tool (nạp XML/JSON vào KG)	14	research/tools.py	kg_ingest_nmap_xml, kg_ingest_ffuf, kg_ingest_gobuster, kg_ingest_masscan, kg_ingest_nuclei_jsonl, kg_ingest_katana, kg_ingest_subfinder, kg_ingest_dnsx, kg_ingest_httpx_jsonl, kg_ingest_testssl, kg_ingest_crackmapexec, kg_ingest_asrep_hashes, kg_ingest_sarif, kg_ingest_slither
Reversing	12	reversing/tools.py	ghidra_analyze/decompile/xrefs, bin_r2_script, bin_rop, bin_packer
References / payload corpus	15	references/tools.py	payload_search, oneliner_search, h1_search, cve_poc_lookup, killchain_lookup, ref_*
Web (HTTP client + JWT tự viết)	10	web/tools.py (8), web/search.py (2)	http_request, jwt_parse/crack/forge, oauth_audit, cookie_audit, graphql_plan, web_search/fetch
AD / BloodHound	12	ad/tools.py (9), ad/bh_tools.py (3)	bhce_cypher, kerberos_classify, adcs_audit, dcsync_check, delegation_audit
Defense (blue_cell)	9	defense/tools.py (6), brief.py (2), blue_cell.py (1)	sigma_to_splunk/sentinel/elastic, yara_to_defender/crowdstrike, blue_cell_scan
Proxy (mitm-style, tự viết)	7	proxy/tools.py	proxy_send/repeat_request, proxy_scope_rules, proxy_list_sitemap
Reporting	6	reporting/tools.py (5), cvss.py (1)	report_executive, report_hackerone, report_bugcrowd_csv, cvss_score_tool
Cloud (analyzer offline)	6	cloud/tools.py	iam_policy_audit, k8s_audit, tfstate_audit
Bash transport	4	bash/bash.py	bash, bash_output, bash_kill, bash_status
Evidence	4	evidence/tools.py	seal_evidence, verify_evidence (HMAC-sealed)
Ops (vòng đời container)	4	ops/tools.py	ops_start/stop/status — spawn BloodHound/Sliver/Ghidra on demand
Vuln-research pipeline	16	research/tools.py (9), patch.py (2), bounty.py (2), dedupe/osint/secret_scanner/tech_detection (4·1)	cve_lookup, fuzz_harness, validate_finding, patch_propose/verify, scan_secrets, detect_tech_stack
Contracts	2	contracts/tools.py	slither_ingest, solidity_scan_file
OPPLAN (factory closure)	7	opplan.py	add_objective, get_objective, list_objectives…
Proxy • Browser • Interaction • Skills • Verification	1·1·2·1·1	browser/tools.py, interaction/*, skills.py, verification.py	browser_action (Playwright), ask_user_question, load_skill, validate_workspace_finding
Lưu ý thêm 3 bề mặt agent-facing không phải code tự viết trong repo: filesystem tools (read_file/write_file/grep… — của thư viện deepagents, lọc tại filesystem.py), MCP tools (nạp động từ env, mcp/client.py — sidecar Ghidra MCP cung cấp ~245 tool khi bật), và hạ tầng tự viết không phải agent tool: execution/sandbox/{kernel,server,web} (HTTPSandbox daemon + open-web acquisition engine).
2. Security tools (mature tool — KHÔNG phải code trong repo)
Đây là binary cài sẵn trong image Kali sandbox (infra/containers/sandbox.Dockerfile:36-73), agent gọi gián tiếp qua custom tool bash trong tmux session:
Nhóm	Tools (apt, kali-rolling)
Recon	nmap, dnsutils(dig), whois, netcat-openbsd, subfinder, ping
Exploit	hydra, sqlmap, nikto, smbclient, exploitdb(searchsploit), dirb, gobuster
Lateral movement	openssh-client, sshpass
AD	responder, impacket (ntlmrelayx, secretsdump…)
C2	sliver (client, sandbox) + sliver-server (container c2-sliver)
Mobile	adb, apktool
DFIR	yara
Reversing (profile reversing)	ghidra 12.1, radare2, binwalk
Browser	chromium (Playwright stealth stack)
Điểm đáng chú ý: ffuf (ví dụ bạn nêu), masscan, nuclei, katana, httpx, dnsx, testssl, crackmapexec có parser (kg_ingest_*) nhưng không được cài trong sandbox image — repo chỉ nạp được kết quả nếu bạn tự chạy tool đó (hoặc cài thêm vào image). Metasploit cũng không có trong image.
3. Tóm tắt phân biệt
- Custom tool = 148 hàm Python @tool — logic tự viết (KG, parsers, analyzers offline, JWT/proxy/reporting/defense…), chạy trong container langgraph.
- Security tool ≈ 20 binary mature — chỉ tồn tại trong Kali sandbox, agent chạm tới qua duy nhất tool bash.
- Lớp nối: 14 tool kg_ingest_* + reversing/contracts wrappers là code tự viết bọc/đọc output của security tool, đổ vào Neo4j knowledge graph.

custom tool được viết như sau:
packages/raptix/raptix/execution/tools
├── README.md (43 lines)
├── __init__.py (39 lines)
├── ad
│   ├── ad/__init__.py (44 lines)
│   ├── ad/adcs_post.py (646 lines)
│   ├── ad/bh_tools.py (242 lines)
│   ├── ad/bhce_client.py (349 lines)
│   ├── ad/bloodhound.py (1229 lines)
│   └── ad/tools.py (248 lines)
├── bash
│   ├── bash/__init__.py (18 lines)
│   ├── bash/bash.py (670 lines)
│   └── bash/prompt.py (361 lines)
├── browser
│   ├── browser/__init__.py (29 lines)
│   └── browser/tools.py (384 lines)
├── cloud
│   ├── cloud/__init__.py (44 lines)
│   └── cloud/tools.py (90 lines)
├── contracts
│   ├── contracts/__init__.py (38 lines)
│   ├── contracts/slither.py (53 lines)
│   └── contracts/tools.py (82 lines)
├── defense
│   ├── defense/__init__.py (39 lines)
│   ├── defense/blue_cell.py (229 lines)
│   ├── defense/brief.py (262 lines)
│   ├── defense/conops.py (113 lines)
│   ├── defense/edr.py (222 lines)
│   ├── defense/elastic.py (178 lines)
│   ├── defense/sentinel.py (216 lines)
│   ├── defense/splunk.py (186 lines)
│   └── defense/tools.py (208 lines)
├── evidence
│   ├── evidence/__init__.py (19 lines)
│   ├── evidence/asciicast.py (179 lines)
│   └── evidence/tools.py (256 lines)
├── filesystem.py (20 lines)
├── interaction
│   ├── interaction/__init__.py (13 lines)
│   ├── interaction/ask_user.py (187 lines)
│   └── interaction/complete_planning.py (123 lines)
├── mcp
│   ├── mcp/__init__.py (26 lines)
│   └── mcp/client.py (269 lines)
├── network
│   ├── network/__init__.py (61 lines)
│   ├── network/protocols.py (855 lines)
│   └── network/scanners.py (895 lines)
├── opplan.py (1244 lines)
├── ops
│   ├── ops/__init__.py (38 lines)
│   ├── ops/client.py (143 lines)
│   └── ops/tools.py (210 lines)
├── proxy
│   ├── proxy/__init__.py (41 lines)
│   └── proxy/tools.py (290 lines)
├── references
│   ├── references/__init__.py (51 lines)
│   ├── references/catalog.py (386 lines)
│   ├── references/cve_poc_index.py (322 lines)
│   ├── references/fetch.py (260 lines)
│   ├── references/h1_corpus.py (330 lines)
│   ├── references/hydrate.py (147 lines)
│   ├── references/killchain.py (329 lines)
│   ├── references/killchain.yaml (361 lines)
│   ├── references/methodology.py (196 lines)
│   ├── references/oneliners.py (198 lines)
│   ├── references/payloads.py (361 lines)
│   ├── references/payloads_ingest.py (285 lines)
│   └── references/tools.py (439 lines)
├── reporting
│   ├── reporting/__init__.py (39 lines)
│   ├── reporting/bugcrowd.py (72 lines)
│   ├── reporting/cvss.py (267 lines)
│   ├── reporting/executive.py (97 lines)
│   ├── reporting/hackerone.py (133 lines)
│   ├── reporting/kg_adapter.py (173 lines)
│   ├── reporting/sarif.py (254 lines)
│   ├── reporting/timeline.py (74 lines)
│   └── reporting/tools.py (118 lines)
├── research
│   ├── research/__init__.py (37 lines)
│   ├── research/_apoc_safety.py (145 lines)
│   ├── research/_engagement_scope.py (58 lines)
│   ├── research/_state.py (336 lines)
│   ├── research/bounty.py (357 lines)
│   ├── research/chain.py (436 lines)
│   ├── research/cve.py (480 lines)
│   ├── research/dedupe.py (342 lines)
│   ├── research/fuzz.py (357 lines)
│   ├── research/graph.py (36 lines)
│   ├── research/health.py (49 lines)
│   ├── research/osint.py (424 lines)
│   ├── research/patch.py (298 lines)
│   ├── research/poc.py (431 lines)
│   ├── research/sarif.py (240 lines)
│   ├── research/sarif_export.py (261 lines)
│   ├── research/scanner_tools.py (601 lines)
│   ├── research/secret_scanner.py (273 lines)
│   ├── research/tech_detection.py (370 lines)
│   └── research/tools.py (2574 lines)
├── reversing
│   ├── reversing/__init__.py (58 lines)
│   ├── reversing/ghidra.py (493 lines)
│   └── reversing/tools.py (187 lines)
├── skills.py (296 lines)
├── skills_registry.py (284 lines)
├── verification.py (78 lines)
└── web
    ├── web/__init__.py (46 lines)
    ├── web/graphql.py (317 lines)
    ├── web/http.py (303 lines)
    ├── web/search.py (204 lines)
    └── web/tools.py (260 lines)

Còn các security tool được lưu trong infra\containers\sandbox.Dockerfile:
    apt-get install -y --no-install-recommends --no-install-suggests \
        # ── Core runtime ──
        curl \
        wget \
        python3 \
        python3-pip \
        tmux \
        # ── Recon ──
        nmap \
        dnsutils \
        whois \
        netcat-openbsd \
        iputils-ping \
        subfinder \
        # ── Exploit & post-exploitation ──
        hydra \
        sqlmap \
        nikto \
        smbclient \
        exploitdb \
        dirb \
        gobuster \
        # SSH client + sshpass for lateral movement / multi-host scenarios
        # (e.g., MHBench OpenStack topologies — attacker pivots through a
        # jump host via ProxyJump to reach internal ring hosts).
        openssh-client \
        sshpass \
        # ── JavaScript runtime (JSFuck payload encoding/validation) ──
        nodejs \
        npm \
        # ── C2 client (connects to the separate c2-sliver server container) ──
        sliver \
        # ── AD attack chain — Responder → ntlmrelayx → secretsdump ──
        # responder + python3-impacket are both in kali-rolling apt; they
        # chain together for the canonical internal-network AD attack
        # documented in docs/red-team/tools-techniques.md.
        responder \
        python3-impacket \
        # ── Mobile triage host-side (Mobile agent) ──
        # adb + apktool are in kali-rolling apt and let the agent do quick
        # APK / device triage from the bash tool without leaving the sandbox.
        adb \
        apktool \
        # ── YARA (DFIR validation; complements yara-x on the host) ──
        yara

Tôi đang gặp vấn đề gì? phân tích kỹ cho tôi

## Response:
06/10/2026, 14:21:22 · gpt-5-6-thinking

> **Diagnosing the architecture**
>
> I’m seeing a mismatch: the system exposes many custom tools, yet lacks mature execution primitives. The central problem is tool-surface sprawl, duplicated capabilities, weak abstraction boundaries, and likely excessive cognitive load for the agent.
>
> **Diagnosed the architecture**
>
> 
>
> **Refining the diagnosis**
>
> I’m narrowing the issue further: core boundaries have collapsed. Ingestion, parsing, ranking, planning, and execution are exposed as model decisions, while mature capabilities remain underused. I’d reduce agent-facing tools selectively, not rewrite everything.
>
> **Searched 5 websites**
>
> 
>
> Worked for 1m 20s

Có. Sau khi nhìn kỹ inventory này, vấn đề chính của bạn **không phải đơn giản là “148 custom tool là quá nhiều”**. Vấn đề sâu hơn là Raptix đang **đánh đồng “một hàm Python hữu ích” với “một action mà LLM cần được quyền lựa chọn”**, trong khi execution substrate thực tế lại khá mỏng.

Nói ngắn gọn, hệ thống hiện tại đang **surface-rich nhưng substrate-thin**: agent-facing surface rất rộng, nhưng lớp công cụ offensive trưởng thành phía dưới lại hẹp và còn lệch với chính skill/parser corpus của repo. Cấu trúc repo cũng thể hiện `execution/tools/` đang ôm KG, research, AD, web, reporting, reversing, cloud, defense… trong core runtime thay vì domain plugins. `repo-structure.txt`

## 1. Lỗi kiến trúc căn bản: `@tool` đang bị dùng như một decorator “public”

Bạn hiện có đại loại bốn loại chức năng khác nhau:

```text
A. Internal deterministic service
   parser, normalizer, report renderer, evidence sealing

B. Control-plane operation
   objective CRUD, graph query, skill lookup, ops status

C. High-level cyber capability
   scan network, enumerate AD, validate credential,
   establish pivot, analyze binary

D. Low-level executor
   bash, nmap, Impacket, sqlmap, Ghidra, Sliver...
```

Nhưng hiện tại rất nhiều thứ trong cả A+B+C đều được biến thành:

```python
@tool
def ...
```

nên từ góc nhìn runtime:

```text
Python function
≈
agent decision
```

Đó là chỗ sai.

Một parser như:

```text
kg_ingest_nmap_xml
```

có thể rất cần trong codebase.

Nhưng **LLM có thực sự cần quyết định “bây giờ tôi gọi parser Nmap XML” không?**

Thường là không.

Pipeline đúng phải là:

```text
agent
 ↓
scan_network
 ↓
executor chooses nmap
 ↓
nmap.xml artifact
 ↓
ArtifactNormalizer detects nmap
 ↓
NmapParser
 ↓
Observation[]
 ↓
AKG ingest
```

LLM chỉ cần quyết định:

```text
scan_network
```

chứ không phải:

```text
run nmap
then call kg_ingest_nmap_xml
then kg_add_node
then kg_add_edge
```

Nếu LLM phải tự làm chuỗi đó thì bạn đang bắt model làm orchestration mà deterministic code làm tốt hơn.

---

# 2. 148 tool không đáng sợ; **bao nhiêu tool model nhìn thấy cùng lúc** mới đáng sợ

Đây là distinction quan trọng nhất.

Bạn hoàn toàn có thể có:

```text
Global capability catalog = 300
```

mà không có vấn đề gì nếu mỗi decision chỉ expose:

```text
8-15 tools
```

Ngược lại, analyst của bạn hiện có khoảng 45 tool và Ghidra MCP có thể tung ra ~245 tool khi bật. Đây là chỗ đáng lo.

OpenAI hiện khuyến nghị giữ số function khả dụng ban đầu nhỏ để tăng accuracy, với mức gợi ý mềm là **dưới khoảng 20 function trong một turn**, và dùng deferred/tool search cho hệ tool lớn; function schemas cũng chiếm context tokens. ([OpenAI Developers](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com))

Anthropic cũng ghi nhận rằng quá nhiều tool hoặc tool có chức năng chồng lấn có thể làm agent chọn sai đường; họ đặc biệt khuyên chỉ tạo tool có purpose rõ và gom các thao tác liên quan thành natural task boundary thay vì mirror API/function nội bộ. ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com))

Vậy:

```text
148 code-level @tools
```

không phải metric mình quan tâm nhất.

Metric nên là:

```text
active_tool_count_per_turn
tool_selection_error_rate
tool_schema_tokens_per_turn
unnecessary_tool_calls
```

---

# 3. Parser layer của bạn đang bị expose sai abstraction

Bạn có 14 tool:

```text
kg_ingest_nmap_xml
kg_ingest_ffuf
kg_ingest_gobuster
kg_ingest_masscan
kg_ingest_nuclei_jsonl
kg_ingest_katana
kg_ingest_subfinder
kg_ingest_dnsx
kg_ingest_httpx_jsonl
kg_ingest_testssl
kg_ingest_crackmapexec
kg_ingest_asrep_hashes
kg_ingest_sarif
kg_ingest_slither
```

Theo mình, **gần như cả 14 cái nên mất khỏi agent-facing tool surface**.

Không phải xóa code.

Chuyển thành:

```text
knowledge/ingest/parsers/
├── nmap.py
├── ffuf.py
├── nuclei.py
├── httpx.py
├── ...
```

với interface:

```text
ArtifactParser
  supports(artifact)
  parse(artifact) -> Observation[]
```

rồi:

```text
ParserRegistry
```

tự chọn parser.

Agent chỉ cần:

```text
run capability
```

và runtime tự ingest output.

Đây là ví dụ rõ nhất của vấn đề hiện tại:

> **Internal implementation detail đang bị lộ thành cognitive burden của LLM.**

---

# 4. Tương tự với KG: 25 tool là quá low-level

Những tool như:

```text
kg_add_node
kg_add_edge
kg_query
kg_neighbors
kg_stats
...
```

là kiểu database API.

Không phải interface tốt cho strategic planner.

Bạn không muốn LLM nghĩ:

```text
Tôi phải tạo node Credential,
sau đó tạo edge CAN_AUTH...
```

Raptix mới của chúng ta đã định hướng ngược lại:

```text
Tool execution
      ↓
Observation
      ↓
Normalizer
      ↓
AKG
```

Agent nên **đọc graph qua projection**, chẳng hạn:

```text
get_attack_context()
find_attack_paths()
inspect_asset()
inspect_access()
```

và ghi graph **gián tiếp qua observation/action result**.

Tức là 25 KG tools có thể co lại thành khoảng một surface logic như:

```text
graph_context
graph_search
attack_paths
record_observation   # nếu thật sự cần explicit
```

Còn:

```text
add_node
add_edge
rank_candidates
normalization
dedupe
ingest
```

là internal services.

Đặc biệt `rank_candidates` thậm chí không nên là tool nếu planner luôn phải dùng nó; đó là một bước của orchestration.

---

# 5. Bạn đang có một mismatch rất rõ giữa **skills/parsers** và **execution environment**

Đây có lẽ là vấn đề thực tế nghiêm trọng thứ hai.

Bạn có parser cho:

```text
ffuf
masscan
nuclei
katana
httpx
dnsx
testssl
crackmapexec
```

nhưng Dockerfile mặc định lại không cài các binary đó.

Điều này **không nhất thiết là bug** nếu mục tiêu là hỗ trợ import artifact do bên ngoài tạo ra.

Nhưng với một hệ thống autonomous red team, nó tạo ra một dạng **capability illusion**:

```text
Repo:
  có skill
  có parser
  có reference
  có schema

Runtime:
  không có executable
```

Agent có thể “biết” kỹ thuật tồn tại nhưng không thực hiện được.

Ví dụ repo của bạn có skill `netexec`, `certipy-esc-chain`, BloodHound… nhưng execution image cơ bản lại không có NetExec/Certipy; BloodHound chỉ là specialist workload riêng. Cây repo thực tế cho thấy skill/domain breadth rộng hơn rất nhiều execution substrate. `repo-structure.txt`

Bạn cần một invariant:

```text
Advertised Capability
      ↓
must resolve to
      ↓
Executable Implementation
```

Ví dụ:

```text
capability: ad_credential_validation

implementation:
  - netexec
  - impacket
```

Nếu không implementation nào available:

```text
capability.available = false
```

Skill selector không được đề xuất nó.

---

# 6. Đừng giải quyết mismatch đó bằng cách viết thêm Python

Đây là bẫy rất dễ mắc.

Bạn thấy:

```text
không có NetExec
```

rồi nghĩ:

> Viết `smb_login_check()` bằng Python.

Sau đó:

```text
không có Certipy
→ viết ADCS logic

không có Ligolo
→ viết tunnel

không có nuclei
→ viết scanner
```

Cuối cùng Raptix trở thành một offensive-security toolkit tự viết.

Đó **không phải lợi thế cạnh tranh bạn đang tìm kiếm**.

Mature security tools đã giải quyết hàng loạt edge cases mà wrapper của bạn rất khó theo kịp.

Raptix nên sở hữu:

```text
planning
state
tool selection
policy
normalization
verification
orchestration
```

chứ không nên cố sở hữu:

```text
SMB implementation
Kerberos implementation
scanner engine
ADCS exploit engine
binary analysis engine
...
```

---

# 7. Pattern đúng là: **custom interface, mature implementation**

Ví dụ thay vì agent thấy:

```text
netexec_smb_login
impacket_psexec
ssh_login
winrm_login
```

planner có thể thấy:

```text
validate_credential(...)
move_laterally(...)
```

Rồi resolver:

```text
move_laterally()
        │
        ├── SSH → openssh
        │
        ├── SMB → NetExec / Impacket
        │
        ├── WinRM → appropriate executor
        │
        └── ...
```

Đây gần với nguyên lý của Incalmo: LLM chọn high-level task như scan/infect/move, hệ thống phía dưới dịch thành primitive/command cụ thể. Paper cho thấy các high-level abstractions và auxiliary services là thành phần quan trọng để LLM thực hiện multi-stage network attacks. ([arXiv](https://arxiv.org/abs/2501.16466?utm_source=chatgpt.com))

Do đó mình không khuyên:

```text
custom tool → security binary
```

theo nghĩa “xóa custom interface”.

Mình khuyên:

```text
agent-facing custom capability
        ↓
adapter
        ↓
mature security binary
```

---

# 8. Bạn đang có quá nhiều “one API endpoint = one agent tool”

Nhìn riêng References:

```text
payload_search
oneliner_search
h1_search
cve_poc_lookup
killchain_lookup
ref_*
```

15 tool.

LLM có thật sự cần hiểu backend corpus nào cần search không?

Có thể agent chỉ cần:

```text
security_research(
    query,
    kinds=[...]
)
```

hoặc:

```text
cve_research(...)
reference_search(...)
payload_lookup(...)
```

Backend tự fan-out:

```text
HackerOne corpus
PoC index
killchain catalog
methodology
oneliners
payload corpus
```

Anthropic đưa ví dụ rất giống nguyên tắc này: thay vì expose nhiều endpoint nhỏ, nên tạo tool theo natural task boundary và trả context liên quan một cách cô đọng. ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com))

---

# 9. Reporting và Evidence cũng bị agent hóa quá mức

Bạn có:

```text
report_executive
report_hackerone
report_bugcrowd_csv
...
```

và:

```text
seal_evidence
verify_evidence
```

Mình đặt câu hỏi:

> LLM có thật sự cần quyết định khi nào HMAC-seal evidence không?

Nếu evidence là canonical artifact thì:

```text
ArtifactStore.put()
  ↓
hash
  ↓
seal
  ↓
metadata
```

nên tự động.

Tương tự report formatting:

```text
Finding[]
    ↓
ReportService
    ↓
format = executive / hackerone / sarif / ...
```

agent-facing surface có thể chỉ là:

```text
generate_report(format=...)
```

hoặc thậm chí reporting được operator/UI trigger, không phải tool của attack agent.

---

# 10. `research/tools.py` 2,574 dòng là symptom, không phải root cause

Một file:

```text
research/tools.py - 2574 lines
```

không tự động là xấu.

Nhưng kết hợp với:

```text
25 KG tools
14 parsers
research pipeline
fuzz
CVE
PoC
bounty
patch
...
```

thì nó cho thấy boundary:

```text
Research
```

đang trở thành catch-all.

Trong architecture mới, bạn nên tách:

```text
knowledge/
  ingest/
  queries/
  reasoning/

intelligence/
  research/

execution/
  capabilities/

plugins/
  vuln_research/
```

Điều quan trọng hơn là **một module nội bộ không cần tương ứng với một agent tool**.

---

# 11. Plugin architecture hiện tại gần như chưa được tận dụng cho tool ownership

Bạn nói:

> Plugins không định nghĩa `@tool` nào.

Trong khi repo có:

```text
raptix-sdk
plugin loader
plugin specialist agents
domain skills
```

và core runtime lại giữ:

```text
AD
Cloud
Contracts
Defense
Reversing
Web
...
```

Đây chính xác là vấn đề architecture chúng ta bàn trước đó.

Core runtime đang biết quá nhiều domain.

Ví dụ:

```text
execution/tools/ad
execution/tools/contracts
execution/tools/reversing
```

dài hạn nên thành:

```text
plugins/
├── active_directory/
│   ├── capabilities/
│   ├── adapters/
│   └── skills/
├── reversing/
├── contracts/
└── ...
```

Core chỉ hiểu:

```text
Capability
ToolAdapter
Observation
Artifact
```

Việc plugin hiện không sở hữu tools cho thấy **extension mechanism tồn tại nhưng domain implementation chưa thực sự được externalize**.

---

# 12. Ghidra MCP ~245 tools là một ví dụ cực đoan

Nếu bạn inject cả 245 Ghidra tools vào một general agent thì đó gần như chắc chắn là sai abstraction.

Decepticon hiện cũng coi Ghidra, BloodHound, Sliver là **specialist workloads được bật on-demand**, thay vì tất cả đều luôn nằm trong management plane. ([GitHub](https://github.com/BitterSecurity/Decepticon?utm_source=chatgpt.com))

Raptix nên làm thêm một bước:

```text
General planner
    ↓
analyze_binary
    ↓
Reversing specialist
    ↓
Ghidra MCP
```

Và ngay cả reversing specialist cũng không nhất thiết phải thấy cả 245 tool ngay từ đầu nếu MCP/tool-search có thể defer.

Đó là hierarchical tool exposure:

```text
global agent:
  8 tools

reversing specialist:
  10-20 relevant actions

Ghidra backend:
  245 underlying primitives
```

245 primitives không đồng nghĩa 245 planner choices.

---

# 13. Static role registry cũng không còn phù hợp với UKC architecture mới

Hiện tại bạn có:

```text
_STANDARD_TOOLS[role]
```

Đây là một bước tốt hơn việc mọi agent nhìn toàn bộ 148 tools.

Nhưng nó vẫn quá static.

Ví dụ post-exploit agent đang ở một engagement mà chưa có credential:

```text
credential reuse capability
```

không cần expose.

Nếu đang ở Initial Foothold:

```text
DCSync
```

không cần xuất hiện.

Hướng phù hợp với architecture mới là:

```text
Active tools =
    role
  ∩ current UKC phase
  ∩ graph state
  ∩ available executors
  ∩ scope/policy
```

Ví dụ:

```text
NETWORK_PROPAGATION
+
AKG has Windows host
+
AKG has NTLM credential
+
NetExec available
=
enable credential_validation / lateral_movement
```

Đây mới là dynamic capability loading.

---

# 14. Bạn cũng đang bị trùng lặp giữa **Skill** và **Tool**

Repo có skill corpus rất lớn; Decepticon docs cho thấy skills được load theo role, mô tả chỉ được inject trước và full nội dung được lấy on-demand qua `load_skill`. ([GitHub](https://github.com/PurpleAILAB/Decepticon/blob/main/docs/agents.md?utm_source=chatgpt.com))

Nhưng rất nhiều custom tool lại encode tiếp domain knowledge.

Bạn nên enforce distinction:

```text
Skill
= knowledge / procedure / WHEN / WHY

Capability
= WHAT the system can do

Executor
= HOW it is done
```

Ví dụ:

```text
SKILL: AD credential reuse
  - khi nào thử
  - preconditions
  - failure interpretation
  - OPSEC guidance

Capability:
  validate_credential
  move_laterally

Executor:
  NetExec
  Impacket
  SSH
```

Nếu `@tool` lại encode luôn strategy, bạn đang duplicate SKILL.md.

---

# 15. `bash` không phải vấn đề; nó là escape hatch cần thiết

Bạn không nên xóa `bash`.

Cyber là open-world:

```text
new CVE
weird binary
PoC GitHub mới
custom script
unknown protocol
manual troubleshooting
```

Typed capability catalog không bao phủ hết.

Do đó architecture nên là:

```text
Preferred path:
Capability → adapter → mature tool

Fallback:
Specialist → bash
```

Không phải:

```text
Planner → bash mọi thứ
```

và cũng không phải:

```text
Planner chỉ được làm những gì developer đã viết @tool
```

---

# 16. Vậy từng nhóm hiện tại nên xử lý thế nào?

Đây là mapping mình sẽ dùng.

| Nhóm hiện tại | Xử lý |
|---|---|
| KG 25 | **Giảm mạnh agent-facing surface**; phần lớn thành `knowledge` service |
| 14 `kg_ingest_*` | **Không còn là agent tools**; chuyển parser registry tự động |
| Reversing 12 | Plugin/specialist; wrap Ghidra/radare2, không custom engine |
| References 15 | **Merge còn ~2-4 semantic search tools** |
| Web 10 | Giữ HTTP/browser primitives; analyzers thành capability/service tùy loại |
| AD 12 | **Pluginize + wrap mature AD tools**; tránh tự implement protocol nếu không cần |
| Defense 9 | Plugin, không thuộc default offensive core |
| Proxy 7 | Giảm surface; backend proxy service tự quản state |
| Reporting 6 | Reporting service; agent-facing tối đa 1-2 action |
| Cloud 6 | Plugin; offline analyzers có thể giữ nhưng không phải luôn agent-facing |
| Bash 4 | **Giữ** |
| Evidence 4 | Phần lớn automate trong artifact pipeline |
| Ops 4 | Giữ, lead-only |
| Vuln research 16 | Specialist/plugin, dynamic exposure |
| Contracts 2 | Plugin |
| OPPLAN 7 | Giữ control plane nhưng có thể giảm CRUD surface |
| Filesystem | Giữ generic |
| Browser | Giữ |
| Interaction | Giữ |
| Skill lookup | Giữ |
| Verification | Giữ một semantic verifier action |

Đây không phải mục tiêu “148 → 20 code functions”.

Mục tiêu là:

```text
148 Python functions
    ↓
vẫn có thể còn 100+ internal functions

Global capability catalog
    ↓
30-60 semantic capabilities

Active per-agent surface
    ↓
~8-15 typical
```

Con số cuối là target kiến trúc đề xuất; bạn nên benchmark để hiệu chỉnh. OpenAI chỉ đưa `<20` như một guideline mềm, không phải luật cứng. ([OpenAI Developers](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com))

---

# 17. Security tools trong Docker cũng không nên cài tất cả vào một image

Đừng đi từ cực:

```text
sandbox quá nghèo
```

sang:

```text
Kali full + 500 tools trong mọi container
```

Bạn đã có concept specialist workload.

Nên đi theo profile:

```text
sandbox-base
  curl
  python
  nmap
  ssh
  netcat
  basic utilities

sandbox-web
  sqlmap
  ffuf/gobuster
  nuclei...
  
sandbox-ad
  impacket
  NetExec
  Certipy
  Responder
  BloodHound collector

sandbox-reversing
  radare2
  Ghidra
  binwalk

sandbox-mobile
  adb
  apktool
```

Hoặc dynamic sidecars.

Như vậy:

```text
capability resolver
```

biết execution environment nào support capability nào.

Decepticon hiện cũng dùng dynamic specialist workloads cho BloodHound, Sliver và Ghidra thay vì bật tất cả mặc định. ([GitHub](https://github.com/BitterSecurity/Decepticon?utm_source=chatgpt.com))

---

# 18. Một vấn đề nữa là bạn chưa có **Capability Registry làm source of truth**

Hiện có ít nhất ba nguồn nói “Raptix làm được gì”:

```text
SKILL.md corpus

@tool registry

Docker-installed binaries
```

và chúng đang lệch nhau.

Bạn cần một canonical registry:

```yaml
id: lateral_move.smb

phases:
  - network_propagation

requires:
  - windows_target
  - credential

implementations:
  - type: binary
    name: netexec
    profile: ad
  - type: binary
    name: impacket-psexec
    profile: ad

skills:
  - ad/netexec
  - analyst/chains/cred-reuse

outputs:
  - session
  - evidence
```

Startup health check:

```text
Skill exists?
Executor exists?
Parser exists?
Profile available?
```

Sau đó capability được mark:

```text
AVAILABLE
PARTIAL
UNAVAILABLE
```

Đây giải quyết trực tiếp tình trạng:

> Có skill + parser nhưng không có executable.

---

# 19. Kiến trúc đích của tool layer nên là thế này

```text
                    Planner
                       │
                       ▼
              Candidate Capability
                       │
                       ▼
              Capability Registry
                /       |       \
               /        |        \
          Skills    Preconditions   Policy
                          │
                          ▼
                Capability Resolver
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
         Adapter       Adapter       Bash
             │            │         fallback
             ▼            ▼
          nmap          NetExec
          nuclei        Certipy
          sqlmap        Impacket
                          │
                          ▼
                    Raw Artifact
                          │
                          ▼
                  Parser Registry
                          │
                          ▼
                    Observation
                          │
                          ▼
                         AKG
```

Agent không cần thấy:

```text
parser
normalizer
add_edge
seal evidence
retry transport
tmux status
```

trừ khi đó thực sự là decision có ý nghĩa cho agent.

---

# 20. Tiêu chí rất đơn giản để quyết định một function có nên là `@tool`

Với mỗi function hiện tại, hỏi ba câu:

**Câu 1: LLM có cần lựa chọn hành động này không?**

Nếu không → internal service.

**Câu 2: Hành động này có natural semantic meaning đối với red teamer không?**

Nếu nó chỉ là:

```text
parse XML
add edge
seal HMAC
convert report
```

→ thường không nên là tool.

**Câu 3: Nếu bỏ tool này, LLM có mất một chiến lược hợp lệ không?**

Nếu không → merge hoặc hide.

Ví dụ:

```text
kg_ingest_nmap_xml
```

Câu 1: không.  
Câu 2: không, implementation detail.  
Câu 3: không.

→ **hide.**

Trong khi:

```text
establish_pivot
```

Câu 1: có.  
Câu 2: có.  
Câu 3: có.

→ **agent-facing capability.**

---

## Chốt: bạn đang gặp 5 vấn đề cùng lúc

Không phải một.

1. **Tool/API leakage:** internal helpers bị expose thành agent actions.
2. **Tool-selection overload:** một số role nhìn quá nhiều/overlapping tools; MCP có thể làm vấn đề tăng mạnh.
3. **Capability drift:** skill/parser/tool catalog không khớp binaries thực sự có trong sandbox.
4. **Core-domain coupling:** AD/cloud/reversing/etc. vẫn nằm core dù đã có plugin architecture.
5. **Custom implementation burden:** có xu hướng tự viết logic mà mature offensive ecosystem đã giải quyết tốt hơn.

Vì vậy mình **không khuyên bạn “xóa custom tools rồi cài Kali tools thay thế”**. Điều đó sẽ chuyển từ một cực sang cực khác.

Hướng đúng là:

> **Giữ custom tool ở mức semantic capability và control plane; chuyển parser/normalizer/report/evidence mechanics thành internal services; dùng mature security tools làm execution implementations; load capability động theo role + UKC phase + AKG state + executor availability; giữ bash làm fallback.**

Nếu áp dụng đúng hướng này thì số file Python có thể chưa giảm quá nhiều ngay, nhưng **cognitive surface dành cho LLM sẽ giảm mạnh**, execution capability lại tăng, và kiến trúc Raptix mới bắt đầu thực sự phù hợp với mục tiêu Incalmo-style abstraction mà bạn đang xây.

---

**Sources:**

- [Function calling | OpenAI API](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com)
- [Writing effective tools for AI agents—using AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com)
- [On the Feasibility of Using LLMs to Execute Multistage Network Attacks](https://arxiv.org/abs/2501.16466?utm_source=chatgpt.com)
- [GitHub - BitterSecurity/Decepticon: Autonomous Hacking Agent for Red Team · GitHub](https://github.com/BitterSecurity/Decepticon?utm_source=chatgpt.com)

## Prompt:
06/10/2026, 14:31:32

nghĩa là giờ tôi cần xây dựng lại kiến trúc folder (cho các loại tool), bổ sung tool tinh chỉnh lại cho hợp lệ và test xem hệ thống có thật sự sẽ gọi đến các tool đó không à? liệu việc cho 1 worker tự dùng tool thì có giữ được điểm mạnh của Incalmo không? ngoài ra, tôi nên hiểu tool nào nên thêm để sử dụng, tool nào không nên viết custom, và những gì không nên được coi là tool?

## Response:
06/10/2026, 14:31:41 · gpt-5-6-thinking

> **Assessing worker autonomy**
>
> I’m distinguishing two designs: a worker executing semantic actions through reliable adapters, versus an LLM freely choosing raw tools. The first preserves hierarchical strengths better; the second adds flexibility but risks error propagation and weaker guarantees.
>
> **Assessed worker autonomy**
>
> 
>
> **Structuring the rebuild**
>
> I’m recommending a semantic inventory before moving files. I’ll classify capabilities, define a registry, expose narrow worker toolsets, then test selection, execution, recovery, and end-to-end outcomes before reorganizing folders.
>
> **Structured the rebuild**
>
> 
>
> **Searched 18 websites**
>
> 
>
> Worked for 1m 9s

Đúng, nhưng **không nên bắt đầu bằng việc move 148 tool sang folder mới**. Việc đầu tiên là phân loại lại chúng theo semantics: cái nào thực sự là **quyết định mà agent cần đưa ra**, cái nào chỉ là **implementation nội bộ**, và capability nào hiện tại chỉ “có trên giấy” nhưng chưa có executor thực sự.

Inventory hiện tại của bạn cho thấy core runtime vẫn ôm một lượng lớn domain-specific tooling trong `execution/tools/`, trong khi skill corpus và plugin mechanism đã tồn tại. `repo-structure.txt` Đây là lúc thích hợp để đổi từ **tool-centric architecture** sang **capability-centric architecture**.

## 1. Trước hết: một Worker tự chọn tool vẫn có thể giữ được điểm mạnh của Incalmo

Nhưng phải có ranh giới.

Điểm cốt lõi của Incalmo không phải “task agent tuyệt đối không được suy luận”. Điểm cốt lõi là **planner không phải sinh low-level command và không phải reasoning trên hàng trăm implementation detail**. Paper mô tả LLM planner phát ra high-level task như scan network, lateral movement hay exfiltrate; action planner dịch chúng thành low-level primitives, còn auxiliary services quản lý state/context. ([Google Cloud Storage](https://storage.googleapis.com/arxiv-dataset/arxiv/arxiv/pdf/2501/2501.16466v2.pdf?utm_source=chatgpt.com))

Vì vậy kiến trúc này vẫn giữ được tinh thần Incalmo:

```text
                High-level Planner
                       │
                       │
             "move laterally to B"
                       │
                       ▼
                Specialist Worker
                scope = one task
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
          NetExec   Impacket   SSH
              │        │        │
              └────────┼────────┘
                       ▼
                  Observation
                       │
                       ▼
                      AKG
```

Worker có thể là LLM.

Nhưng Worker phải:

- nhận **một task semantic rõ ràng**;
- có context nhỏ;
- chỉ thấy một nhóm tool phù hợp;
- có success/failure criteria rõ;
- không tự giữ canonical state;
- output được normalize trước khi ghi AKG.

Nếu Worker lại nhận:

```text
bash
+ 148 tools
+ 245 Ghidra MCP tools
+ toàn bộ mission
```

thì bạn gần như quay trở lại failure mode mà Incalmo muốn tránh.

### Mức độ tách tốt nhất

Mình sẽ dùng ba tầng:

```text
Planner
    ↓
Semantic Capability
    ↓
Bounded Worker / deterministic resolver
    ↓
Mature executor
```

Ví dụ:

```text
Planner:
    validate_credential(target=B, credential=C)

Worker:
    "SMB target + NTLM credential"

Resolver:
    NetExec available? → use NetExec
    else Impacket available? → use Impacket

Executor:
    chạy tool

Normalizer:
    auth_success=true

AKG:
    tạo verified access/session
```

Planner không cần biết syntax NetExec.

Worker cũng không nhất thiết phải tự viết syntax nếu adapter đã biết.

**LLM chỉ suy luận ở nơi suy luận tạo giá trị; phần deterministic thì để code làm.**

---

# 2. Nhưng đừng refactor folder trước - hãy refactor ontology của tool trước

Bạn nên đi theo thứ tự:

```text
Inventory
   ↓
Classify
   ↓
Define capability contracts
   ↓
Map capability → implementation
   ↓
Hide internal helpers
   ↓
Add missing mature executors
   ↓
Dynamic exposure
   ↓
Evaluation
   ↓
Cuối cùng mới cleanup/move folder
```

Nếu move folder ngay, bạn chỉ tạo:

> 148 tool được tổ chức đẹp hơn.

Nhưng architectural problem vẫn còn nguyên.

---

# 3. Chỉ nên gọi một thứ là “Agent Tool” nếu agent thực sự cần quyết định sử dụng nó

Mình sẽ đặt rule rất cứng:

> **Tool là một action/query có ý nghĩa semantic mà model cần chủ động lựa chọn tại runtime.**

Ví dụ đúng:

```text
inspect_asset
find_attack_paths
scan_network
enumerate_service
validate_credential
establish_pivot
escalate_privilege
ask_operator
```

Đây là các decision có ý nghĩa với red teamer.

Ngược lại:

```text
parse_nmap_xml
add_neo4j_edge
seal_hmac
convert_sarif
deduplicate_nodes
normalize_httpx
increment_revision
render_hackerone_markdown
```

không phải strategic decisions.

Đó là code nội bộ.

Anthropic cũng khuyến nghị tool nên phản ánh natural task boundaries thay vì mirror từng API/internal function, và nên gom các operation liên quan để giảm ambiguity. ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com))

---

# 4. Mình sẽ chia mọi thứ hiện tại thành **5 loại**

Đây là classification bạn nên yêu cầu agent làm cho toàn bộ 148 function.

| Loại | Agent gọi? | Ví dụ |
|---|---:|---|
| **Semantic capability** | Có | `scan_network`, `validate_credential`, `establish_pivot` |
| **Control-plane tool** | Có, rất ít | `get_objectives`, `ask_user`, `get_attack_context` |
| **Execution primitive** | Chỉ specialist | `bash`, browser, MCP |
| **Adapter** | Không trực tiếp | Nmap/NetExec/Certipy wrapper |
| **Internal service** | Không | parser, normalizer, KG CRUD, evidence seal, report renderer |

Đây là distinction quan trọng nhất.

---

# 5. `Semantic capability` mới là tool surface chính

Ví dụ UKC Initial Foothold có thể expose:

```text
discover_surface
scan_network
enumerate_service
research_vulnerability
attempt_initial_access
validate_access
```

Network Propagation:

```text
discover_internal_network
enumerate_local_state
validate_credential
escalate_privilege
move_laterally
establish_pivot
```

Action on Objectives:

```text
locate_objective
collect_objective
validate_objective_access
```

Planner không cần thấy:

```text
nmap
masscan
httpx
netexec
impacket-psexec
ssh
certipy
```

ở level này.

---

# 6. Security binaries không phải “agent tools”

Đây là điểm bạn nên thay đổi cách nghĩ.

Ví dụ:

```text
nmap
NetExec
Impacket
Certipy
Nuclei
ffuf
Ligolo
```

là **executors/implementations**.

Không nhất thiết chúng phải tương ứng:

```python
@nmap_tool
@netexec_tool
@certipy_tool
```

Planner có thể chỉ gọi:

```text
scan_network
```

và resolver chọn:

```text
small subnet, accurate scan
→ nmap

large scoped subnet
→ masscan → nmap validation
```

Tương tự:

```text
validate_windows_credential
    ↓
NetExec
```

hay:

```text
enumerate_adcs
    ↓
Certipy
```

---

# 7. Folder architecture mình khuyên dùng

Sau khi semantics ổn, mới migrate thành cấu trúc này:

```text
raptix/
├── orchestration/
│   ├── planning/
│   ├── phases/
│   └── actions/
│       ├── discovery.py
│       ├── access.py
│       ├── privilege.py
│       ├── movement.py
│       └── objectives.py
│
├── execution/
│   ├── registry/
│   │   ├── capability.py
│   │   ├── resolver.py
│   │   ├── availability.py
│   │   └── manifests/
│   │
│   ├── adapters/
│   │   ├── network/
│   │   │   ├── nmap.py
│   │   │   └── masscan.py
│   │   ├── web/
│   │   │   ├── nuclei.py
│   │   │   ├── ffuf.py
│   │   │   └── sqlmap.py
│   │   └── ...
│   │
│   ├── transports/
│   │   ├── bash.py
│   │   ├── browser.py
│   │   ├── mcp.py
│   │   └── tmux.py
│   │
│   └── sessions/
│
├── knowledge/
│   ├── graph/
│   └── ingest/
│       ├── registry.py
│       └── parsers/
│           ├── nmap.py
│           ├── nuclei.py
│           ├── ffuf.py
│           ├── httpx.py
│           └── ...
│
├── intelligence/
│   ├── workers/
│   ├── skills/
│   └── tooling/
│       ├── exposure.py
│       └── catalog.py
│
└── ...
```

Và domain-specific executor sau này có thể move tiếp sang:

```text
plugins/
├── active-directory/
├── web/
├── reversing/
└── cloud/
```

---

# 8. Ví dụ cụ thể: 14 `kg_ingest_*` nên biến mất khỏi agent surface

Current:

```text
kg_ingest_nmap_xml
kg_ingest_masscan
kg_ingest_nuclei_jsonl
kg_ingest_httpx_jsonl
...
```

Target:

```text
Artifact
   ↓
ParserRegistry
   ↓
detect format
   ↓
appropriate parser
   ↓
Observation[]
   ↓
AKG
```

Không có LLM decision.

Vẫn giữ code parser.

Chỉ bỏ `@tool`.

Đây có lẽ là nhóm bạn nên xử lý đầu tiên.

---

# 9. 25 KG tools cũng nên giảm cực mạnh

Planner không nên thấy:

```text
kg_add_node
kg_add_edge
kg_neighbors
kg_stats
kg_ingest
...
```

Nó nên thấy semantic query:

```text
get_attack_context
inspect_asset
find_attack_paths
```

Có thể thêm:

```text
search_knowledge
```

nếu thực sự cần free exploration.

Mutation graph nên chủ yếu tự động từ:

```text
ActionResult
→ Observation
→ Knowledge service
```

chứ không phải LLM tự CRUD database.

---

# 10. Reference tools: 15 → khoảng 2-4

Hiện:

```text
payload_search
oneliner_search
h1_search
methodology_lookup
killchain_lookup
cve_poc_lookup
ref_*
```

Có thể thành:

```text
research_cve
search_security_references
lookup_payload
```

Backend tự chọn corpus.

Agent không cần biết:

> “Thông tin này nằm trong H1 corpus hay methodology catalog?”

Đó là implementation detail.

---

# 11. Reporting: 6 → thường chỉ cần 0-1 tool

Không cần attack worker quyết định:

```text
report_hackerone
report_executive
report_bugcrowd_csv
```

Report nên là service:

```text
ReportService.generate(format)
```

được UI/operator/finalization workflow gọi.

Nếu cần agent-facing:

```text
generate_report(format)
```

một tool là đủ.

---

# 12. Evidence: phần lớn không nên là tool

Current:

```text
seal_evidence
verify_evidence
```

Nếu evidence pipeline đúng thì:

```text
tool output
   ↓
ArtifactStore
   ↓
hash
   ↓
seal
   ↓
Evidence metadata
```

phải automatic.

LLM không nên quyết định:

> “Bây giờ tôi có nên hash bằng chứng không?”

Đó là invariant của hệ thống.

---

# 13. Những tool mình nghĩ **nên bổ sung** vào execution substrate

Không phải tất cả vào base image. Nên theo profile.

### Network/Web profile

Hiện có `nmap`, `subfinder`, `sqlmap`, `nikto`, `gobuster`.

Mình sẽ cân nhắc thêm:

```text
httpx
nuclei
ffuf
katana
testssl.sh
```

Lý do rất đơn giản: repo của bạn **đã có parser/skill cho nhiều cái này** nhưng executable lại thiếu. Việc đó tạo capability mismatch.

`masscan` chỉ đáng thêm nếu bạn thật sự có subnet đủ lớn; với lab nhỏ, Nmap thường đủ.

---

### Multi-host / AD profile

Đây là ưu tiên cao nhất nếu mục tiêu nghiên cứu là propagation/lateral movement:

```text
NetExec
Certipy
BloodHound collector/integration
Evil-WinRM (nếu cần)
```

Bạn đã có Impacket + Responder, nên đây là các khoảng trống rõ.

---

### Pivot profile

Hiện chỉ có SSH/ProxyJump là tương đối hạn chế.

Nên có một implementation mature cho tunneling/pivot:

```text
Ligolo-ng
```

hoặc:

```text
Chisel
```

Không cần cả hai ở bước đầu.

---

### Credential auditing

Có thể cân nhắc:

```text
John the Ripper
```

hoặc Hashcat tùy môi trường.

Nhưng đây không phải ưu tiên đầu nếu máy không có GPU và benchmark không cần cracking.

---

### Reversing

Bạn đã có:

```text
Ghidra
radare2
binwalk
```

khá đủ.

Đừng thêm một loạt custom reversing engine.

---

# 14. Những thứ **không nên tự viết custom implementation**

Trừ khi nó chính là contribution nghiên cứu của bạn, mình sẽ tránh viết lại:

```text
port scanner
network scanner
HTTP fuzzer
directory brute-forcer
SMB client
Kerberos implementation
NTLM tooling
ADCS enumerator
credential dumper
tunneling protocol
C2
binary decompiler
password cracker
generic vulnerability scanner
```

Tức là tránh việc viết lại:

```text
nmap
ffuf
Nuclei
NetExec
Impacket
Certipy
Ligolo
Sliver
Ghidra
Hashcat/John
```

Bạn nên sở hữu **adapter**, không sở hữu lại attack engine.

---

# 15. Nhưng vẫn có custom code rất đáng viết

Đây mới là “chất xám” của Raptix.

Nên tự viết:

```text
Capability registry
Capability resolver
Phase-aware exposure
AKG projection
Attack-path reasoner
Observation normalizer
State/provenance machinery
Scope guard
Policy enforcement
Verifier
Execution lifecycle
Retry/recovery
Artifact manager
Tool availability/health detection
Skill selector
```

Đây là những thứ làm Raptix khác việc:

> “LLM + Kali Linux”.

---

# 16. Worker nên được cấp bao nhiêu tool?

Không cần luật cứng, nhưng mình sẽ target:

```text
Planner:
  ~5-10 high-level tools

Ordinary worker:
  ~5-15 relevant tools

Specialist:
  có thể nhiều hơn nhưng load động

MCP with hundreds tools:
  deferred/search/on-demand
```

OpenAI hiện khuyến nghị giữ số function ban đầu nhỏ, mức mềm dưới khoảng 20, đồng thời hỗ trợ deferred tool search để chỉ đưa function cần thiết vào context. ([OpenAI Developers](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com))

Với Ghidra 245 tools, đừng eager-load tất cả.

---

# 17. Dynamic exposure nên dựa trên 5 yếu tố

Tool set cho một Worker nên là:

```text
role
  ∩
UKC phase
  ∩
AKG state
  ∩
available executor
  ∩
scope/policy
```

Ví dụ:

```text
phase = NETWORK_PROPAGATION

AKG:
  Windows host discovered
  NTLM credential available

runtime:
  NetExec installed
  target in scope
```

thì expose:

```text
validate_credential
enumerate_remote_access
move_laterally
```

Không expose:

```text
scan_public_web
DCSync
exfiltrate
```

nếu chưa đủ precondition.

Đây là nơi AKG và tool architecture bắt đầu thực sự gắn với nhau.

---

# 18. Capability Registry nên là canonical source of truth

Đây là thứ mình nghĩ bạn nên implement trước cả folder migration lớn.

Ví dụ:

```yaml
id: lateral_move.smb

phase:
  - network_propagation

requires:
  - session_or_credential
  - reachable_smb_service

skills:
  - ad/netexec
  - analyst/chains/cred-reuse

implementations:
  - adapter: netexec
    executable: nxc
    profile: ad

  - adapter: impacket_psexec
    executable: impacket-psexec
    profile: ad

outputs:
  - session
  - evidence
```

Startup:

```text
capability registry
      │
      ├── Is executable present?
      ├── Is adapter healthy?
      ├── Does parser exist?
      ├── Is target in scope?
      └── Does current state satisfy requirements?
```

Result:

```text
AVAILABLE
PARTIAL
UNAVAILABLE
```

Sau đó worker chỉ nhìn thấy AVAILABLE capability.

---

# 19. Đây cũng giải quyết mismatch skill/tool/binary

Hiện tại có ba “truth”:

```text
SKILL says capability exists
@tool says capability exists
Dockerfile says executor exists
```

Chúng đang không đồng bộ.

Sau refactor:

```text
Capability Registry
       │
       ├── Skills = knowledge
       ├── Adapters = implementation
       ├── Binary/MCP = executor
       └── Parser = observation support
```

Registry mới là truth.

Skill không đồng nghĩa “chạy được”.

Parser không đồng nghĩa “chạy được”.

Binary không đồng nghĩa planner nên sử dụng nó.

---

# 20. Và đúng: bạn cần test **agent có gọi đúng tool không**

Nhưng đừng chỉ test:

> “Model có gọi `scan_network` không?”

Bạn cần 4 tầng evaluation.

### Tầng A - Registry correctness

Không cần LLM:

```text
capability → implementation resolution
availability
precondition
phase filtering
scope filtering
```

100% deterministic.

---

### Tầng B - Tool-selection evaluation

Cho model các tình huống nhỏ:

```text
Situation:
Windows host, SMB open,
NTLM credential available,
network propagation phase.

Expected:
validate_credential hoặc lateral movement

Forbidden:
public recon, reporting, DCSync chưa đủ precondition
```

Đo:

```text
correct capability selection
irrelevant capability selection
invalid parameter
unnecessary bash fallback
```

Đây là eval cực kỳ quan trọng.

Anthropic cũng khuyến nghị xây evaluation từ các realistic agent tasks rồi tối ưu tool definition dựa trên observed failures, thay vì chỉ dựa vào cảm giác tool API đẹp. ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com))

---

### Tầng C - Executor tests

Không LLM:

```text
semantic capability
→ correct adapter
→ expected command/API
→ expected normalized output
```

Dùng fixtures/mock lab.

---

### Tầng D - End-to-end

Cuối cùng mới chạy lab:

```text
mission
→ planner
→ worker
→ capability
→ executor
→ observation
→ AKG
→ next decision
```

Đo:

```text
success
tool calls
model calls
tokens
failed tool selections
retries
bash fallbacks
wall time
```

---

# 21. Bạn nên chạy một ablation rất hay

Ba config:

```text
A - Current Raptix
    static role tools

B - Dynamic tool filtering
    same current tools

C - Capability abstraction
    dynamic semantic tools
    + mature executors
```

Giữ:

```text
same model
same prompt
same lab
same budget
```

Nếu:

```text
B > A
```

thì chứng minh dynamic exposure có lợi.

Nếu:

```text
C > B
```

thì chứng minh semantic capability abstraction có lợi.

Đây sẽ là bằng chứng thực nghiệm rất sạch cho chính architecture contribution của bạn.

---

# 22. Cách hiểu đơn giản nhất: cái gì là Tool?

Bạn có thể dùng decision tree này:

```text
                    Function / operation
                           │
             LLM có cần chủ động chọn nó?
                    /              \
                  NO                YES
                  │                  │
          Internal service      Có ý nghĩa semantic
                                  với task?
                                /             \
                              NO               YES
                              │                 │
                     Internal service        Tool
```

Sau đó nếu Tool:

```text
Planner cần nó?
   │
   ├── YES → semantic capability/control-plane
   │
   └── NO
        │
        └── Specialist cần?
               ├── YES → worker primitive
               └── NO → internal
```

---

## Ví dụ trên code hiện tại

```text
kg_ingest_nmap_xml
→ NOT TOOL

kg_add_edge
→ NOT TOOL

seal_evidence
→ NOT TOOL

report_hackerone
→ probably NOT attack-agent tool

nmap
→ executor, NOT planner tool

bash
→ specialist primitive / escape hatch

find_attack_paths
→ TOOL

scan_network
→ TOOL

validate_credential
→ TOOL

establish_pivot
→ TOOL

ask_user_question
→ TOOL

load_skill
→ TOOL / runtime knowledge query
```

---

# 23. Hướng implement mình sẽ chọn cho bạn

Không phải:

```text
W1 rewrite folder
W2 install 50 tools
W3 hope the agent uses them
```

Mà là:

```text
W1 - Classify all 148 @tools
     AGENT_CAPABILITY
     CONTROL
     PRIMITIVE
     ADAPTER
     INTERNAL

W2 - Introduce Capability Registry
     không đổi behavior

W3 - Remove @tool from parser/KG/report/evidence mechanics
     thêm compatibility shims

W4 - Implement dynamic exposure
     role + phase + AKG + availability + policy

W5 - Add missing mature executor profiles
     web
     AD
     pivot

W6 - Implement adapters + normalized observations

W7 - Bounded worker execution
     high-level task → small tool surface

W8 - Tool-selection evaluation

W9 - Small multi-host end-to-end tests

W10 - Only now physically reorganize/pluginize remaining domains
```

Điểm mình muốn chốt là: **không cần chọn giữa Incalmo-style abstraction và Worker tự dùng tools**. Worker tự dùng tools hoàn toàn tương thích với abstraction đó, miễn Worker nằm **sau high-level capability boundary** và bị giới hạn trong một nhiệm vụ hẹp. Incalmo cho thấy giá trị nằm ở việc LLM phía trên không phải xử lý low-level implementation và command syntax. ([Google Cloud Storage](https://storage.googleapis.com/arxiv-dataset/arxiv/arxiv/pdf/2501/2501.16466v2.pdf?utm_source=chatgpt.com))

Kiến trúc Raptix mình sẽ hướng tới vì vậy là:

```text
Planner decides WHAT
        ↓
Worker decides limited HOW
        ↓
Adapter handles exact syntax
        ↓
Mature tool performs execution
        ↓
Normalizer determines WHAT HAPPENED
        ↓
AKG records VERIFIED STATE
```

Đây là điểm cân bằng tốt nhất giữa **khả năng thích ứng của LLM** và **độ tin cậy của deterministic tooling**.

---

**Sources:**

- [On the Feasibility of Using LLMs to Execute Multistage Network Attacks](https://storage.googleapis.com/arxiv-dataset/arxiv/arxiv/pdf/2501/2501.16466v2.pdf?utm_source=chatgpt.com)
- [Writing effective tools for AI agents—using AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents?_bhlid=034a77614e0eb86338163a52740c89c5ddf8f102&utm_source=chatgpt.com)
- [Function calling | OpenAI API](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com)
