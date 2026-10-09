#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/.VTNet/redteam/raptix';
const BATCHES = JSON.parse(readFileSync(`${ROOT}/.ua/intermediate/batches.json`, 'utf8'));
const PREFIX = 'packages/raptix/raptix/skills/defs/standard/';

// summary keyed by path after PREFIX; [summary, tags, complexity]
const S = {
  // ───────────────────────────── batch 131 ─────────────────────────────
  'ad/ntlm-relay/SKILL.md': ['Sách châm ngôn NTLM relay chuyên sâu: ma trận cấu hình ntlmrelayx qua SMB, LDAP, LDAPS, HTTP, RPC, IMAP, MSSQL; bypass SMB signing, chọn mục tiêu relay (DC cho DCSync, ADCS lấy cert, LAPS reader lấy cleartext); đánh đổi relay session vs crack hash và kỹ thuật multi-relay chuyển tiếp xác thực từ một nạn nhân tới nhiều dịch vụ.', ['ntlm-relay', 'ntlmrelayx', 'lateral-movement', 'active-directory'], 'moderate'],
  'analyst/SKILL.md': ['Node gốc điều hướng cho bộ playbook nghiên cứu lỗ hổng của agent analyst: liệt kê danh mục skill theo lớp lỗ hổng (web, AI security, chain building) để load đúng kỹ năng ở đầu mỗi vòng phân tích.', ['analyst', 'catalog', 'playbook', 'routing'], 'simple'],
  'analyst/adversarial-ml-evasion/SKILL.md': ['Skill chế tạo adversarial examples khiến mô hình ML đã huấn luyện phân loại sai lúc inference: nhận diện ảnh, malware detector, IDS, spam filter; kèm quy trình đo độ nhạy và tạo perturbation tối thiểu.', ['adversarial-ml', 'evasion', 'machine-learning', 'ai-security'], 'complex'],
  'analyst/auth-bypass/SKILL.md': ['Skill săn authentication/authorization bypass trong route guard, kiểm tra vai trò, ranh giới tenant và chuyển trạng thái state machine của ứng dụng web.', ['auth-bypass', 'access-control', 'web'], 'simple'],
  'analyst/bounty-hunting/SKILL.md': ['Phương pháp bug bounty white-box: quy trình đọc mã nguồn dự án open-source có chương trình security advisory/bounty, xếp hạng bề mặt tấn công, tìm biến thể lỗ hổng và viết báo cáo disclosure có trách nhiệm.', ['bug-bounty', 'methodology', 'vulnerability-research', 'analyst'], 'moderate'],
  'analyst/chains/cred-reuse/SKILL.md': ['Mẫu chain tái sử dụng credential: từ credential rò rỉ hoặc yếu, pivot qua nhiều dịch vụ tới quyền truy cập đặc quyền; định nghĩa cách ghép node vuln thành chuỗi có impact.', ['credential-reuse', 'chains', 'privilege-escalation'], 'simple'],
  'analyst/chains/idor-to-priv-esc/SKILL.md': ['Mẫu chain biến IDOR thành privilege escalation và thao tác control-plane có impact cao; mô tả điều kiện ghép và cách validate chuỗi.', ['idor', 'chains', 'privilege-escalation', 'web'], 'simple'],
  'analyst/chains/ssrf-to-rce/SKILL.md': ['Mẫu chain pivot từ SSRF tới metadata/hạ tầng cloud rồi tới code execution; hướng dẫn dựng và xác thực chuỗi với impact cuối là RCE.', ['ssrf', 'chains', 'rce', 'cloud-metadata'], 'simple'],
  'analyst/chains/xss-to-takeover/SKILL.md': ['Mẫu chain từ XSS sang account takeover hoặc thực thi hành động đặc quyền trong phiên người dùng; mô tả payload và điều kiện xác nhận chuỗi.', ['xss', 'chains', 'account-takeover', 'web'], 'simple'],
  'analyst/command-injection/SKILL.md': ['Skill săn OS command injection (CWE-78): input người dùng chạm tới shell/exec/system call; bao gồm bypass bằng argument-array, path confusion và template-string injection trong framework hiện đại.', ['command-injection', 'cwe-78', 'rce', 'web'], 'moderate'],
  'analyst/data-and-model-poisoning/SKILL.md': ['Skill săn poisoning dữ liệu huấn luyện và mô hình LLM (OWASP LLM04:2025): input đối kháng làm lệch hành vi tương lai của model qua fine-tuning, RLHF hoặc vòng học liên tục.', ['data-poisoning', 'model-poisoning', 'owasp-llm', 'ai-security'], 'moderate'],
  'analyst/deserialization/SKILL.md': ['Skill săn insecure deserialization (CWE-502) đa ngôn ngữ: Python pickle, Java ObjectInputStream/Jackson/SnakeYAML, .NET BinaryFormatter/DataContractJson, PHP unserialize, Ruby Marshal/YAML.load; kèm hướng dẫn dựng gadget chain và PoC.', ['deserialization', 'gadget-chain', 'rce', 'web'], 'moderate'],
  'analyst/excessive-agency/SKILL.md': ['Skill săn excessive agency (OWASP LLM06:2025): hệ agentic được cấp quá nhiều tool, quyền mỗi tool quá rộng hoặc quyền tự chủ không giám sát, sinh tác động ngoài ý muốn thay mặt người dùng/doanh nghiệp.', ['excessive-agency', 'owasp-llm', 'agentic', 'ai-security'], 'moderate'],
  'analyst/idor/SKILL.md': ['Skill săn IDOR (CWE-639): thiếu kiểm tra phân quyền trên object ID; phân biệt leo thang ngang/dọc, so sánh UUID vs integer đoán được và biến thể khai thác qua GraphQL introspection.', ['idor', 'access-control', 'cwe-639', 'web'], 'moderate'],
  'analyst/improper-output-handling/SKILL.md': ['Skill săn improper output handling (OWASP LLM05:2025): code phía sau tin output phi cấu trúc của model rồi render/thực thi/chạy shell không sanitize, sinh XSS, SSRF, SQLi và các biến thể phái sinh.', ['output-handling', 'owasp-llm', 'xss', 'ai-security'], 'moderate'],
  'analyst/misinformation/SKILL.md': ['Skill săn misinformation/overreliance (OWASP LLM09:2025): output tự tin nhưng sai chảy vào quyết định tự động, báo cáo compliance, thông điệp khách hàng hoặc luồng tự chủ; kèm tiêu chí validate và CVSS mặc định.', ['misinformation', 'overreliance', 'owasp-llm', 'ai-security'], 'moderate'],
  'analyst/ml-model-extraction/SKILL.md': ['Skill chiết xuất bản sao chức năng của mô hình ML black-box qua API prediction và suy luận membership inference — xác định một bản ghi cụ thể có nằm trong tập huấn luyện hay không.', ['model-extraction', 'membership-inference', 'machine-learning', 'ai-security'], 'complex'],
  'analyst/patch-diff/SKILL.md': ['Quy trình patch-diff được ủy quyền: từ diff nguồn vulnerable-to-fixed, suy ra gốc rễ lỗ hổng và tìm/xác thực các biến thể cùng pattern trong codebase.', ['patch-diff', 'variant-analysis', 'vulnerability-research', 'analyst'], 'moderate'],
  'analyst/path-traversal/SKILL.md': ['Skill săn directory traversal và archive traversal (ZipSlip/TarSlip) từ input người dùng tới thao tác filesystem.', ['path-traversal', 'zipslip', 'filesystem', 'web'], 'simple'],
  'analyst/pattern-exhaustion/SKILL.md': ['Phương pháp pattern exhaustion hệ thống: sau khi xác nhận một lỗ hổng, quét toàn bộ codebase tìm mọi instance cùng root-cause pattern để không bỏ sót biến thể.', ['pattern-exhaustion', 'methodology', 'variant-analysis', 'analyst'], 'moderate'],
  'analyst/prompt-injection/SKILL.md': ['Skill săn prompt injection LLM và tool-call hijacking (CWE-1427): injection trực tiếp/gián tiếp qua RAG, PDF, email, lạm dụng tool, chuỗi exfiltration và pivot jailbreak-to-RCE trên hệ agentic; kèm payload PoC, hợp đồng validate_finding và bảng CVSS.', ['prompt-injection', 'cwe-1427', 'owasp-llm', 'rag', 'ai-security'], 'moderate'],
  'analyst/prototype-pollution/SKILL.md': ['Skill săn prototype pollution JavaScript (CWE-1321) — lỗ hổng meta 2023-2026 chain thành RCE, auth bypass và SSRF trên đa số stack Node.js.', ['prototype-pollution', 'cwe-1321', 'nodejs', 'web'], 'moderate'],
  'analyst/redos/SKILL.md': ['Skill săn ReDoS (CWE-1333, catastrophic backtracking): nhận diện regex có nested quantifier hoặc alternation chồng lấn gây thời gian match siêu tuyến tính, truy vết tainted input tới regex sink và đánh giá impact.', ['redos', 'regex', 'dos', 'cwe-1333'], 'complex'],
  'analyst/sensitive-information-disclosure/SKILL.md': ['Skill săn rò rỉ thông tin nhạy cảm qua LLM (OWASP LLM02:2025): PII, secret, source nội bộ, chi tiết mô hình và dữ liệu tenant khác lộ qua output, extraction từ training-data và prompt.', ['information-disclosure', 'owasp-llm', 'pii', 'ai-security'], 'moderate'],
  'analyst/sql-injection/SKILL.md': ['Skill săn SQL injection (CWE-89) bằng taint tracking từ nguồn tới sink: string concat, format-string, raw query ORM, second-order injection và NoSQL injection trên MongoDB/DynamoDB.', ['sql-injection', 'cwe-89', 'taint-analysis', 'nosql'], 'moderate'],

  // ───────────────────────────── batch 132 ─────────────────────────────
  'analyst/ssrf/SKILL.md': ['Skill săn SSRF (CWE-918) qua taint analysis từ URL do người dùng kiểm soát tới HTTP client sink: pivot cloud metadata, DNS rebinding, gopher smuggling và biến thể IMDS trên từng nhà cung cấp cloud.', ['ssrf', 'cwe-918', 'cloud-metadata', 'web'], 'moderate'],
  'analyst/ssti/SKILL.md': ['Skill săn server-side template injection trên Jinja2/Twig/Freemarker/Velocity/Handlebars và xác thực tiến trình từ expression injection tới code execution.', ['ssti', 'template-injection', 'rce', 'web'], 'simple'],
  'analyst/supply-chain/SKILL.md': ['Skill săn supply-chain compromise LLM (OWASP LLM03:2025): model, dataset, adapter, plugin, MCP server và dependency tokenizer/framework độc hại hoặc cài backdoor đi kèm trong AI stack.', ['supply-chain', 'owasp-llm', 'mcp', 'ai-security'], 'moderate'],
  'analyst/system-prompt-leakage/SKILL.md': ['Skill săn rò rỉ system prompt LLM (OWASP LLM07:2025): exfiltrate privileged system prompt làm lộ rule nội bộ, secret nhúng, inventory tool và business logic cần bảo vệ.', ['system-prompt-leakage', 'owasp-llm', 'prompt-extraction', 'ai-security'], 'moderate'],
  'analyst/ti-anyrun-lookup/SKILL.md': ['Workflow truy vấn Threat Intelligence ANY.RUN: tra hash, domain, IP và chỉ dấu hành vi trên corpus sandbox; bao gồm cú pháp TI Lookup, toán tử tìm kiếm, giới hạn gói miễn phí và cách diễn giải kết quả.', ['threat-intelligence', 'anyrun', 'sandbox', 'ioc'], 'complex'],
  'analyst/ti-ioc-extraction/SKILL.md': ['Skill trích xuất IOC tự động từ báo cáo threat, log và văn bản phi cấu trúc: parse hash, IP, domain, URL, email, CVE; bao gồm extraction bằng regex, defang/refang và chuẩn hóa chỉ dấu.', ['ioc', 'threat-intelligence', 'regex', 'parsing'], 'complex'],
  'analyst/ti-yara-hunting/SKILL.md': ['Skill viết YARA rule từ quan sát hành vi và phân tích báo cáo TI: chuyển sample thành rule, tối ưu điều kiện, tune hiệu năng và retrohunt trên VirusTotal/ANY.RUN.', ['yara', 'threat-hunting', 'malware', 'retrohunt'], 'complex'],
  'analyst/trust-boundary/SKILL.md': ['Skill map trust boundary và audit chuỗi khởi động cho developer tool, CLI app và hệ plugin; dùng khi target là công cụ lập trình, IDE extension hoặc app nạp config/plugin từ nguồn không tin cậy.', ['trust-boundary', 'developer-tools', 'plugins', 'analysis'], 'moderate'],
  'analyst/unbounded-consumption/SKILL.md': ['Skill săn unbounded consumption (OWASP LLM10:2025): denial-of-wallet và denial-of-service vào endpoint LLM qua prompt size không giới hạn, vòng lặp tool chạy mất kiểm soát, chọn model đắt và thiếu rate limiting.', ['unbounded-consumption', 'dos', 'denial-of-wallet', 'owasp-llm'], 'moderate'],
  'analyst/vector-and-embedding-weaknesses/SKILL.md': ['Skill săn điểm yếu vector/embedding (OWASP LLM08:2025): input đối kháng vào lớp RAG/similarity gây leak chéo tenant, mất riêng tư qua embedding inversion, nhầm lẫn ngữ nghĩa và kế thừa quyền sai trong vector store.', ['vector-embeddings', 'rag', 'owasp-llm', 'ai-security'], 'moderate'],
  'analyst/xxe/SKILL.md': ['Skill săn lỗ hổng XML External Entity trong parser và xác thực impact đọc file/SSRF với negative control nghiêm ngặt.', ['xxe', 'xml', 'ssrf', 'web'], 'simple'],
  'cloud/SKILL.md': ['Skill điều hướng lane khai thác cloud: AWS IAM privesc, S3 takeover, k8s RBAC abuse, rò Terraform state, pivot cloud metadata; đọc trước để chọn đúng sub-skill theo bề mặt.', ['cloud', 'routing', 'iam', 'kubernetes'], 'simple'],
  'cloud/aws-iam-enum/SKILL.md': ['Skill enumerate IAM policy AWS và phát hiện đường leo thang đặc quyền theo 21 primitive kinh điển của Rhino Security Labs.', ['aws', 'iam', 'enumeration', 'privesc'], 'moderate'],
  'cloud/aws-iam-passrole-chain/SKILL.md': ['Skill leo thang đặc quyền AWS qua chuỗi iam:PassRole — PassRole vào Lambda/Glue/SageMaker/EC2/ECS với role đặc quyền hơn, chuỗi AssumeRole chéo account, recon sts:GetCallerIdentity và account escalation.', ['aws', 'passrole', 'privesc', 'assumerole'], 'moderate'],
  'cloud/azure-managed-identity/SKILL.md': ['Skill lạm dụng Azure Managed Identity: truy cập IMDS 169.254.169.254 từ VM/App Service/Function bị chiếm, đổi token sang Graph/ARM/KeyVault, lạm dụng federated workload identity và hybrid AAD Connect.', ['azure', 'managed-identity', 'imds', 'token-theft'], 'moderate'],
  'cloud/container/SKILL.md': ['Skill điều hướng nhóm tấn công container/Kubernetes: pod escape, RBAC abuse, khai thác CVE runtime, socket-mount escape; định tuyến theo bề mặt (RCE trong pod vs API-level vs build pipeline).', ['container', 'kubernetes', 'routing', 'cloud-native'], 'simple'],
  'cloud/container/container-cve/SKILL.md': ['Danh mục CVE container-runtime có impact cao: runC Leaky Vessels (CVE-2024-21626/-23651/-23652/-23653), CVE-2022-0185, CVE-2019-5736, CRI-O Dirty COW và cách xác nhận phiên bản dễ tổn thương.', ['container', 'cve', 'runc', 'escape'], 'moderate'],
  'cloud/container/docker-socket-mount/SKILL.md': ['Skill khai thác Docker/containerd socket được mount vào container để đạt host RCE — phổ biến ở CI runner, GitOps controller (ArgoCD, Flux) và Docker-in-Docker; escape một lệnh qua docker run với host rootfs.', ['docker-socket', 'container-escape', 'rce', 'cloud-native'], 'moderate'],
  'cloud/container/k8s-pod-escape/SKILL.md': ['Skill escape pod Kubernetes lên node: container đặc quyền, escape hostPath mount, hostPID/hostIPC, lạm dụng capability (SYS_ADMIN, SYS_PTRACE) và chuỗi CVE runC; pivot từ RCE-in-pod tới kiểm soát toàn bộ node.', ['kubernetes', 'pod-escape', 'hostpath', 'cloud-native'], 'moderate'],
  'cloud/container/k8s-rbac-abuse/SKILL.md': ['Skill leo thang RBAC Kubernetes: enumerate ClusterRole/Role bằng kubectl auth can-i --list, lạm dụng pods/exec, pods/portforward, secrets get, verb escalate/bind, impersonation và tạo binding trái phép.', ['kubernetes', 'rbac', 'privesc', 'cloud-native'], 'moderate'],
  'cloud/entra-conditional-access-bypass/SKILL.md': ['Skill bypass Entra Conditional Access: phát hiện hở policy, khai thác legacy-auth protocol (IMAP/POP/SMTP-AUTH/EWS), giả mạo điều kiện device/platform/UA/location, lạm dụng service principal và app registration.', ['entra', 'conditional-access', 'bypass', 'azure'], 'moderate'],
  'cloud/entra-device-code-phishing/SKILL.md': ['Skill phishing device-code OAuth trên Entra ID để đánh cắp token, illicit consent grant qua app registration độc hại với delegated Graph scope, replay refresh-token và chiếm primary-refresh-token (PRT).', ['entra', 'device-code-phishing', 'oauth', 'token-theft'], 'moderate'],
  'cloud/entra-enum/SKILL.md': ['Skill reconnaissance Entra ID/M365: khám phá tenant không cần xác thực qua OpenID config, GetUserRealm, autodiscover; enumerate user qua mã phản hồi login và OneDrive; đo trạng thái federation/MFA/CA policy.', ['entra', 'reconnaissance', 'enumeration', 'azure'], 'moderate'],
  'cloud/entra-privesc/SKILL.md': ['Skill leo thang đặc quyền và duy trì truy cập trong Entra ID: lạm dụng app role/owner, thêm credential vào service principal, lạm dụng dynamic group, gán vai trò Administrative Unit và hybrid identity abuse.', ['entra', 'privesc', 'persistence', 'azure'], 'complex'],
  'cloud/gcp-org-escalation/SKILL.md': ['Skill leo thang đặc quyền cấp organization trên GCP: pivot chéo project, bypass org policy, chuỗi impersonation service account, secret trong Terraform state và chiếm GKE cluster; escalate từ một project lên phạm vi tổ chức.', ['gcp', 'privesc', 'organization-policy', 'service-account'], 'complex'],

  // ───────────────────────────── batch 133 ─────────────────────────────
  'cloud/gcp-svc-account-impersonation/SKILL.md': ['Skill chuỗi impersonation service account GCP: vai trò iam.serviceAccountTokenCreator và serviceAccountUser, actAs trên Cloud Functions/Cloud Run/Compute Engine; pivot từ tài khoản ít đặc quyền lên SA quản trị dự án.', ['gcp', 'service-account', 'impersonation', 'privesc'], 'moderate'],
  'cloud/imds-pivot/SKILL.md': ['Skill pivot từ SSRF hoặc RCE tới Instance Metadata Service (IMDS): trích IAM role credential, instance identity và secret trong user-data của instance cloud.', ['imds', 'ssrf', 'cloud-metadata', 'credentials'], 'moderate'],
  'cloud/k8s-pivot/SKILL.md': ['Playbook tấn công Kubernetes: đánh cắp service-account token, RBAC abuse, pod escape, lạm dụng hostPath mount và pivot qua kube-apiserver.', ['kubernetes', 'pivot', 'rbac', 'cloud-native'], 'moderate'],
  'cloud/m365-mailbox-compromise/SKILL.md': ['Skill chuỗi chiếm hộp thư Microsoft 365: consent phishing OAuth, lạm dụng delegate access, duy trì bằng mail rule và đánh cắp token qua device-code phishing; kill chain hoàn chỉnh từ initial access tới đọc thư liên tục.', ['m365', 'oauth', 'mailbox', 'persistence'], 'complex'],
  'cloud/s3-takeover/SKILL.md': ['Skill phát hiện và nhận quyền dangling S3 bucket được subdomain tham chiếu (CNAME trỏ hostname S3 nhưng bucket đã không còn tồn tại) để chiếm route và thu dữ liệu.', ['s3', 'subdomain-takeover', 'dangling-dns', 'aws'], 'moderate'],
  'cloud/terraform-state-leak/SKILL.md': ['Skill khai thác file Terraform state bị lộ: secret, cloud credential, mật khẩu RDS, IAM key và topology hạ tầng dạng JSON thô.', ['terraform', 'state-file', 'secrets', 'infrastructure-as-code'], 'moderate'],
  'contracts/SKILL.md': ['Skill điều hướng lane audit smart contract: pattern scanner Solidity/EVM, nạp kết quả Slither, sinh PoC Foundry và playbook tấn công DeFi; đọc trước để chọn sub-skill theo lớp lỗi.', ['smart-contracts', 'solidity', 'routing', 'defi'], 'simple'],
  'contracts/access-control/SKILL.md': ['Skill audit kiểm soát truy cập smart contract: thiếu modifier, check msg.sender sai, hàm mặc định public, thiếu onlyOwner/onlyRole/onlyDAO.', ['access-control', 'solidity', 'authorization', 'audit'], 'moderate'],
  'contracts/bridge-exploit/SKILL.md': ['Skill tấn công cross-chain bridge: bypass kiểm tra message (kiểu Wormhole), đánh cắp validator key (kiểu Ronin/Harmony), reentrancy khi claim token-bridge và forge Merkle-proof trên optimistic bridge.', ['bridge', 'cross-chain', 'validator', 'defi'], 'moderate'],
  'contracts/flash-loan/SKILL.md': ['Skill các mẫu khai thác flash loan: callback reentrancy, khuếch đại qua oracle, governance attack và callback handler không xác thực.', ['flash-loan', 'defi', 'reentrancy', 'oracle'], 'moderate'],
  'contracts/governance-attack/SKILL.md': ['Skill tấn công governance DAO: thao túng phiếu nhờ flash loan, hijack delegation, pha loãng quorum, spam proposal DoS, bypass time-lock qua emergency multisig và lệch giữa snapshot vote và on-chain vote.', ['governance', 'dao', 'flash-loan', 'defi'], 'moderate'],
  'contracts/mev-sandwich/SKILL.md': ['Skill tấn công MEV sandwich: front-run + back-run lệnh swap của nạn nhân trên Uniswap V2/V3, Curve, Balancer; giám sát mempool qua Flashbots/private RPC, khai thác slippage tolerance, JIT liquidity và các biến thể khác.', ['mev', 'sandwich-attack', 'uniswap', 'defi'], 'moderate'],
  'contracts/oracle-manipulation/SKILL.md': ['Skill săn thao túng oracle trong một block: oracle spot-price từ AMM, TWAP có thể thao túng, phép tính phụ thuộc giá và thiếu kiểm tra staleness.', ['oracle', 'defi', 'twap', 'price-manipulation'], 'moderate'],
  'contracts/reentrancy/SKILL.md': ['Skill săn và xác thực lỗi reentrancy: biến thể kinh điển cross-function, same-function, read-only và cross-contract.', ['reentrancy', 'solidity', 'defi', 'audit'], 'simple'],
  'contracts/signature-replay/SKILL.md': ['Skill tấn công replay chữ ký: thiếu nonce, thiếu chain ID, ecrecover trả zero address, signature malleability và replay chéo chain.', ['signature-replay', 'ecrecover', 'solidity', 'audit'], 'complex'],
  'contracts/upgradeable-proxy/SKILL.md': ['Skill các mẫu proxy upgrade và lỗi của chúng: implementation chưa khởi tạo, va chạm storage slot, xung đột selector, xác thực nâng cấp không được bảo vệ.', ['proxy', 'upgradeable', 'storage-collision', 'solidity'], 'complex'],
  'decepticon/engagement-lifecycle/SKILL.md': ['Skill quản lý vòng đời engagement red team: khởi tạo, chuyển phase, cổng go/no-go, deconfliction với blue team, quy trình dừng khẩn cấp và hoàn tất engagement kèm checklist bảo toàn evidence.', ['engagement', 'lifecycle', 'orchestration', 'deconfliction'], 'moderate'],
  'decepticon/engagement-startup/SKILL.md': ['Quy trình startup bắt buộc ở lượt đầu của orchestrator: kiểm tra engagement hiện có, chọn resume/tạo mới và khởi tạo workspace.', ['engagement', 'startup', 'orchestration', 'bootstrap'], 'simple'],
  'decepticon/final-report/SKILL.md': ['Skill sinh báo cáo cuối engagement: executive summary, báo cáo kỹ thuật, tổng hợp findings, tường thuật attack path, ma trận detection gap và lộ trình remediation.', ['reporting', 'final-report', 'findings', 'remediation'], 'complex'],
  'decepticon/kali-mcp-bridge/SKILL.md': ['Skill triển khai và điều khiển công cụ Kali Linux qua MCP-Kali-Server: giao diện tool-call có cấu trúc, thiết lập SSH tunnel và vệ sinh prompt-injection khi dùng AI hỗ trợ engagement.', ['kali', 'mcp', 'tooling', 'opsec'], 'complex'],
  'decepticon/kill-chain-analysis/SKILL.md': ['Skill phân tích kill chain và ra quyết định attack path: phân tích findings, chọn vector tấn công, ưu tiên mục tiêu và chuyển phase.', ['kill-chain', 'attack-path', 'orchestration', 'planning'], 'moderate'],
  'decepticon/orchestration/SKILL.md': ['Skill các pattern orchestrator Raptix: ủy quyền sub-agent, quản lý state, re-planning thích ứng và giao thức bàn giao context.', ['orchestration', 'delegation', 'state-management', 'planning'], 'moderate'],
  'decepticon/pentest-task-tree/SKILL.md': ['Skill suy luận phiên pentest qua cây nhiệm vụ PTT lặp: dựng, cập nhật và duyệt cây nhiệm vụ có đánh số để dẫn dắt quyết định LGUID pentest xuyên suốt phiên; tham chiếu kill-chain-analysis và final-report.', ['pentest-task-tree', 'decision-tree', 'orchestration', 'planning'], 'complex'],
  'dfir/SKILL.md': ['Skill catalog DFIR khép vòng Offensive Vaccine phía phòng thủ: xác thực rule Sigma/YARA do Detector sinh bằng Volatility 3, plaso và sigma-cli trên memory dump, event log, forensic artifact thật; kèm workflow đóng vòng và danh mục tool sandbox.', ['dfir', 'sigma', 'yara', 'volatility', 'blue-team'], 'moderate'],
  'exploit/ad/SKILL.md': ['Skill điều hướng khai thác Active Directory: phân tích BloodHound, Kerberoasting, AS-REP Roasting, lạm dụng AD CS, DCSync, Golden Ticket, Constrained Delegation; đọc trước để chọn sub-skill theo kỹ thuật.', ['active-directory', 'kerberos', 'routing', 'bloodhound'], 'complex'],

  // ───────────────────────────── batch 134 ─────────────────────────────
  'exploit/ad/references/attack-paths.md': ['Tài liệu tham chiếu sâu đường tấn công Active Directory: bộ truy vấn Cypher BloodHound cho high-value path, thu thập SharpHound/bloodhound-python, tham chiếu tấn công Kerberos và bảng mapping hashcat mode cho từng loại hash.', ['active-directory', 'bloodhound', 'kerberos', 'reference'], 'moderate'],
  'exploit/api/SKILL.md': ['Skill điều hướng nhóm API hiện đại — gRPC, SOAP/WSDL, WebSocket, Server-Sent Events; nhận diện giao thức API từ Content-Type hoặc định dạng wire rồi load sub-skill tương ứng.', ['api', 'routing', 'grpc', 'websocket'], 'simple'],
  'exploit/api/grpc/SKILL.md': ['Skill khai thác gRPC: khám phá qua reflection với grpcurl, fuzzing protobuf, thiếu authz trên streaming RPC, SSRF backend qua gRPC-Web, bypass mTLS, inject metadata header và h2c smuggling.', ['grpc', 'protobuf', 'api', 'h2c'], 'moderate'],
  'exploit/api/server-sent-events/SKILL.md': ['Skill khai thác Server-Sent Events (SSE/EventSource): lạm dụng origin để exfiltrate stream chéo site, chèn prompt-injection qua SSE vào LLM client, rò token qua retry-after và phân mảnh event để né phát hiện.', ['sse', 'eventsource', 'exfiltration', 'api'], 'moderate'],
  'exploit/api/soap-wsdl/SKILL.md': ['Skill khai thác SOAP/WSDL: enumerate qua ?wsdl, XXE trong SOAP envelope, replay WS-Addressing, brute WS-Security UsernameToken, inject SAML token qua WS-Trust và bypass schema validation.', ['soap', 'wsdl', 'xxe', 'ws-security'], 'moderate'],
  'exploit/api/websocket/SKILL.md': ['Skill khai thác WebSocket: CSWSH (cross-site WebSocket hijacking) qua bypass origin, thiếu per-message auth, message-type confusion, DoS msg-flood, downgrade ws→wss và lộ RPC route ẩn trong WS handler.', ['websocket', 'cswsh', 'api', 'dos'], 'moderate'],
  'exploit/cicd/SKILL.md': ['Skill điều hướng nhóm tấn công pipeline CI/CD: poisoned pipeline execution, GitHub Actions expression injection, lạm dụng self-hosted runner, exfil secret/OIDC; fingerprint CI provider rồi chọn sub-skill.', ['cicd', 'routing', 'github-actions', 'pipeline'], 'moderate'],
  'exploit/cicd/cicd-secrets-exfil/SKILL.md': ['Skill trích secret CI/OIDC token sau khi có code execution trong build job: exfil bằng echo/printenv, bypass log-masking (base64, tách ký tự, đảo chuỗi), lạm dụng OIDC token để assume cloud role.', ['cicd', 'secrets', 'oidc', 'exfiltration'], 'moderate'],
  'exploit/cicd/github-actions-injection/SKILL.md': ['Skill GitHub Actions expression injection: context do attacker kiểm soát (tiêu đề/nội dung issue/PR, tên branch, commit message) được thay vào run: step, pull_request_target không an toàn và các mẫu workflow dễ tổn thương.', ['github-actions', 'expression-injection', 'cicd', 'rce'], 'moderate'],
  'exploit/cicd/poisoned-pipeline-execution/SKILL.md': ['Skill Poisoned Pipeline Execution (PPE) trực tiếp và gián tiếp: inject lệnh qua build file do attacker kiểm soát (Makefile, package.json scripts, build.gradle, Dangerfile, .pre-commit-config.yaml) để chạy code trong pipeline có secret.', ['ppe', 'cicd', 'build-pipeline', 'rce'], 'moderate'],
  'exploit/cicd/self-hosted-runner-abuse/SKILL.md': ['Skill lạm dụng self-hosted runner: persistence trên runner không ephemeral, chạy job fork-PR trên self-hosted, nhắm runner-label, đánh cắp secret/token từ env runner và lateral movement vào hạ tầng nội bộ.', ['self-hosted-runner', 'cicd', 'persistence', 'lateral-movement'], 'moderate'],
  'exploit/crypto/SKILL.md': ['Skill phát hiện cipher và giải mã tự động qua Ciphey, recipe Cyberchef, hashcat hash-ID, chuyển đổi format và các chuỗi encoding phổ biến.', ['crypto', 'decoding', 'ciphey', 'hashcat'], 'moderate'],
  'exploit/edge-device-exploitation/SKILL.md': ['Skill khai thác thiết bị biên — router, firewall, VPN appliance (Cisco IOS XE, Fortinet, Ivanti, Palo Alto): chuỗi khai thác CVE, post-exploitation trên thiết bị mạng và trích xuất config.', ['edge-device', 'fortinet', 'ivanti', 'network-exploitation'], 'complex'],
  'exploit/ics-ot/SKILL.md': ['Skill điều hướng nhóm tấn công ICS/OT — Modbus, BACnet, S7Comm, DNP3: fingerprint giao thức công nghiệp qua port + Wireshark dissector rồi load sub-skill; nhấn mạnh an toàn tuyệt đối trên hệ production.', ['ics', 'ot', 'routing', 'scada'], 'simple'],
  'exploit/ics-ot/bacnet/SKILL.md': ['Skill tấn công BACnet/IP: discovery UDP/47808 qua broadcast Who-Is, ReadProperty/WriteProperty không xác thực, lạm dụng BBMD để với tới từ xa, phản hồi I-Am theo vendor và subscription COV.', ['bacnet', 'ics-ot', 'building-automation', 'udp'], 'moderate'],
  'exploit/ics-ot/dnp3/SKILL.md': ['Skill tấn công DNP3: enumerate outstation trên TCP/20000, poll binary/analog input, actuate Control Relay Output Block (CROB), lạm dụng unsolicited reporting và điểm yếu bảo mật DNP3.', ['dnp3', 'ics-ot', 'scada', 'control'], 'moderate'],
  'exploit/ics-ot/enip-cip/SKILL.md': ['Playbook tấn công EtherNet/IP + CIP (TCP 44818/UDP 2222): broadcast List Identity, dump tag-database bằng pylogix, đọc/ghi tag trên Allen-Bradley ControlLogix/CompactLogix, CIP Forward Open và rủi ro an toàn khi ghi tag.', ['enip', 'cip', 'allen-bradley', 'ics-ot'], 'complex'],
  'exploit/ics-ot/modbus/SKILL.md': ['Skill tấn công Modbus TCP: enumerate port 502, đọc/ghi coil/holding-register không xác thực, lạm dụng function-code (FC8 diagnostic, FC43 read-device-id), Modbus-over-Serial qua gateway TCP và tác động khi ghi register.', ['modbus', 'ics-ot', 'scada', 'tcp'], 'moderate'],
  'exploit/ics-ot/opcua/SKILL.md': ['Playbook tấn công OPC-UA (TCP 4840): enumerate endpoint, map SecurityPolicy, lạm dụng anonymous/weak-auth, duyệt address-space và đọc tag, exfiltrate HistoryRead, gọi Method điều khiển và các lỗ hổng xác thực.', ['opcua', 'ics-ot', 'industrial', 'hmi'], 'complex'],
  'exploit/ics-ot/profinet/SKILL.md': ['Playbook tấn công PROFINET (L2 EtherType 0x8892/DCP): enumerate broadcast DCP Identify-All, fingerprint thiết bị, gán lại station-name/IP phá mapping IO-controller và flash firmware gây mất trạng thái.', ['profinet', 'dcp', 'ics-ot', 'layer2'], 'complex'],
  'exploit/ics-ot/s7comm/SKILL.md': ['Skill tấn công PLC Siemens S7: TCP/102 ISO-TP + S7-COMM, enumerate bằng snap7/python-snap7, đọc/ghi vùng DB/M/E/A, stop/start/run PLC, bypass mật khẩu (khác nhau giữa S7-300/400 và S7-1200/1500) và các CVE liên quan.', ['s7comm', 'siemens', 'plc', 'ics-ot'], 'moderate'],
  'exploit/reporting/SKILL.md': ['Skill tài liệu hóa finding khai thác: báo cáo initial access, tài liệu hóa exploit chain, chấm điểm CVSS v4.0, inventory shell/credential và phân tích detection gap.', ['reporting', 'cvss', 'exploit-chain', 'documentation'], 'complex'],
  'exploit/rmm-tool-abuse/SKILL.md': ['Skill lạm dụng công cụ RMM hợp pháp: deploy hoặc hijack Atera, ScreenConnect, AnyDesk, TeamViewer để persistence, lateral movement và C2; tận dụng phần mềm tin cậy để né EDR và lẫn vào hoạt động IT bình thường.', ['rmm', 'persistence', 'defense-evasion', 'c2'], 'complex'],
  'exploit/supplychain/SKILL.md': ['Skill điều hướng nhóm tấn công chuỗi cung ứng: dependency confusion, typosquatting, lạm dụng package registry, đầu độc build pipeline, thao túng SBOM.', ['supply-chain', 'routing', 'packages', 'sbom'], 'simple'],
  'exploit/supplychain/dep-confusion/SKILL.md': ['Skill dependency confusion: publish gói trùng tên nội bộ lên public registry (npm/PyPI/Maven/Crates) với version cao hơn để ép CI/CD kéo code của attacker.', ['dependency-confusion', 'npm', 'pypi', 'supply-chain'], 'moderate'],

  // ───────────────────────────── batch 135 ─────────────────────────────
  'exploit/web/SKILL.md': ['Skill điều hướng khai thác web application — category chính cho mọi web attack; là routing skill: đọc trước để xác định loại tấn công rồi load sub-skill chuyên biệt tương ứng.', ['web', 'routing', 'exploitation', 'category'], 'moderate'],
  'exploit/web/ato-methodology/SKILL.md': ['Cây quyết định Account Takeover: 9 đường ATO kinh điển, mẫu ghép chain (IDOR→ATO, XSS→ATO, OAuth→ATO) và các điểm vào để bypass MFA.', ['account-takeover', 'methodology', 'mfa-bypass', 'web'], 'moderate'],
  'exploit/web/bfla/SKILL.md': ['Skill khai thác BFLA (Broken Function Level Authorization): lỗi kiểm soát truy cập cấp hành động cho phép principal đặc quyền thấp gọi hàm admin/staff qua REST, GraphQL, gRPC, WebSocket.', ['bfla', 'authorization', 'api', 'privilege-escalation'], 'complex'],
  'exploit/web/blind-sqli/SKILL.md': ['Playbook blind SQL injection dưới WAF thù địch khi sqlmap thất bại vì các token phổ biến (SUBSTRING, IF, AND, WHERE, quote) bị lọc: fingerprint token, kỹ thuật bypass thủ công và trích xuất từng ký tự.', ['blind-sqli', 'waf-bypass', 'sql-injection', 'manual'], 'complex'],
  'exploit/web/business-logic/SKILL.md': ['Skill khai thác lỗi logic nghiệp vụ/auth bypass/privilege escalation: tamper trường POST (role/is_admin/user_type), bypass 2FA qua response manipulation, TOTP seed đoán được, hidden API và luồng trạng thái thiếu kiểm soát.', ['business-logic', 'auth-bypass', 'privilege-escalation', 'web'], 'moderate'],
  'exploit/web/cache-deception/SKILL.md': ['Web cache deception: lừa CDN/proxy cache response đã xác thực dưới URL không xác thực để lộ PII cho bất kỳ visitor nào.', ['cache-deception', 'cdn', 'pii', 'web'], 'moderate'],
  'exploit/web/clickjacking/SKILL.md': ['UI redressing: thiếu X-Frame-Options/frame-ancestors, bypass frame-buster, drag-and-drop, cursorjacking, double-clickjacking và framing các hành động nhạy cảm.', ['clickjacking', 'ui-redressing', 'framing', 'web'], 'moderate'],
  'exploit/web/command-injection/SKILL.md': ['Khai thác OS Command Injection trên ứng dụng truyền input người dùng vào lệnh hệ điều hành không sanitize: toán tử injection (;, |, ||, &&, $(), backtick, newline), phát hiện blind và exfiltrate output out-of-band.', ['command-injection', 'rce', 'injection', 'web'], 'moderate'],
  'exploit/web/cors/SKILL.md': ['Khai thác CORS cấu hình sai: origin phản chiếu, null origin, lạm dụng trusted-subdomain, bypass validate regex và đánh cắp dữ liệu chéo origin có credential.', ['cors', 'misconfiguration', 'exfiltration', 'web'], 'moderate'],
  'exploit/web/crypto/SKILL.md': ['Khai thác mật mã web: padding-oracle (Vaudenay), bit-flipping/thao túng IV trên AES-CBC, tấn công pattern AES-ECB (cut-and-paste, khôi phục prefix/suffix), bypass HMAC và hash-length extension.', ['crypto', 'padding-oracle', 'aes', 'web'], 'complex'],
  'exploit/web/csrf/SKILL.md': ['Cross-Site Request Forgery: thiếu/invalid token, method override, JSON CSRF, hở SameSite, lỗi double-submit, login/logout CSRF và chuỗi CSRF-via-XSS dẫn tới account takeover.', ['csrf', 'same-site', 'token', 'web'], 'moderate'],
  'exploit/web/cve/SKILL.md': ['Khai thác CVE đã biết: fingerprint phiên bản CMS/framework/plugin, tra ứng viên qua cve_lookup, lấy PoC qua cve_poc_lookup, điều chỉnh exploit công khai cho mục tiêu và xác nhận impact.', ['cve', 'fingerprinting', 'poc', 'exploitation'], 'moderate'],
  'exploit/web/deserialization/SKILL.md': ['Khai thác insecure deserialization — RCE qua serialized object độc hại trên Java (ysoserial), PHP (PHPGGC), .NET (ysoserial.net), Python (pickle): chọn gadget chain, sinh payload và xác nhận thực thi.', ['deserialization', 'ysoserial', 'rce', 'gadget-chain'], 'complex'],
  'exploit/web/dns-rebinding/SKILL.md': ['Tấn công DNS rebinding để bypass same-origin policy của trình duyệt và với tới IMDS/localhost/dịch vụ nội bộ: cơ chế rebind TTL=0, công cụ rbndr.us/singularity, DNS cache pinning của trình duyệt và ghép chuỗi khai thác.', ['dns-rebinding', 'ssrf', 'same-origin', 'browser'], 'complex'],
  'exploit/web/dom-clobbering/SKILL.md': ['DOM clobbering: lạm dụng named HTML element để ghi đè biến global JavaScript, bypass CSP và hijack property lookup của object.', ['dom-clobbering', 'csp-bypass', 'client-side', 'xss'], 'moderate'],
  'exploit/web/graphql/SKILL.md': ['Khai thác GraphQL: introspection, injection, bypass phân quyền và exfiltrate dữ liệu qua GraphQL API.', ['graphql', 'introspection', 'authorization-bypass', 'api'], 'moderate'],
  'exploit/web/header-injection/SKILL.md': ['HTTP header injection: CRLF/response splitting, Host-header cache poisoning, lạm dụng X-Forwarded-*, inject Content-Disposition/Set-Cookie và đầu độc link password-reset qua header không validate.', ['header-injection', 'crlf', 'cache-poisoning', 'web'], 'complex'],
  'exploit/web/hpp/SKILL.md': ['HTTP Parameter Pollution: sai lệch parser giữa proxy/server/app, bypass WAF, bypass auth/ACL và đưa payload qua tham số trùng lặp.', ['hpp', 'parameter-pollution', 'waf-bypass', 'web'], 'moderate'],
  'exploit/web/idor/SKILL.md': ['Khai thác IDOR — bypass phân quyền qua object reference đoán được (ID tuần tự, UUID, filename, ID mã hóa): leo thang ngang/dọc, enumeration và ghép chuỗi lên account takeover.', ['idor', 'access-control', 'enumeration', 'web'], 'complex'],
  'exploit/web/jwt/SKILL.md': ['Tấn công JSON Web Token: algorithm confusion (alg=none, HS256↔RS256), kid header injection, spoof JWKS, crack secret HMAC yếu, strip signature.', ['jwt', 'algorithm-confusion', 'authentication', 'token'], 'moderate'],
  'exploit/web/ldapi/SKILL.md': ['LDAP injection: auth bypass qua thao túng filter, trích xuất blind, lạm dụng search filter và DN injection.', ['ldap', 'injection', 'auth-bypass', 'directory'], 'moderate'],
  'exploit/web/lfi/SKILL.md': ['Path traversal và Local File Inclusion: đọc file tùy ý qua directory traversal, RCE qua PHP filter/input/data wrapper, log poisoning, lộ static resource và trích thông tin cấu hình.', ['lfi', 'path-traversal', 'php-wrappers', 'log-poisoning'], 'complex'],
  'exploit/web/mass-assignment/SKILL.md': ['Mass assignment + ORM leak: chèn trường thừa vào request create/update để leo lên admin và lộ trường được bảo vệ qua response.', ['mass-assignment', 'orm', 'privilege-escalation', 'api'], 'moderate'],
  'exploit/web/mfa-bypass/SKILL.md': ['Lỗi logic 2FA/OTP: tamper response và status, brute force, OTP reuse, lạm dụng backup-code, race condition, thiếu bước 2FA trong luồng, bypass remember-me và password-reset bỏ qua 2FA.', ['mfa-bypass', 'otp', 'authentication', 'logic-flaw'], 'moderate'],
  'exploit/web/nosqli/SKILL.md': ['NoSQL injection: operator injection MongoDB ($ne, $gt, $where, $regex), mẫu tấn công CouchDB/Firebase/Redis, auth bypass và trích xuất blind.', ['nosql', 'mongodb', 'injection', 'auth-bypass'], 'moderate'],
};

// parent mapping: child (after PREFIX) -> parent path after PREFIX (may be cross-batch)
const PARENT = {
  'ad/ntlm-relay/SKILL.md': 'ad/SKILL.md',
  'analyst/adversarial-ml-evasion/SKILL.md': 'analyst/SKILL.md',
  'analyst/auth-bypass/SKILL.md': 'analyst/SKILL.md',
  'analyst/bounty-hunting/SKILL.md': 'analyst/SKILL.md',
  'analyst/chains/cred-reuse/SKILL.md': 'analyst/SKILL.md',
  'analyst/chains/idor-to-priv-esc/SKILL.md': 'analyst/SKILL.md',
  'analyst/chains/ssrf-to-rce/SKILL.md': 'analyst/SKILL.md',
  'analyst/chains/xss-to-takeover/SKILL.md': 'analyst/SKILL.md',
  'analyst/command-injection/SKILL.md': 'analyst/SKILL.md',
  'analyst/data-and-model-poisoning/SKILL.md': 'analyst/SKILL.md',
  'analyst/deserialization/SKILL.md': 'analyst/SKILL.md',
  'analyst/excessive-agency/SKILL.md': 'analyst/SKILL.md',
  'analyst/idor/SKILL.md': 'analyst/SKILL.md',
  'analyst/improper-output-handling/SKILL.md': 'analyst/SKILL.md',
  'analyst/misinformation/SKILL.md': 'analyst/SKILL.md',
  'analyst/ml-model-extraction/SKILL.md': 'analyst/SKILL.md',
  'analyst/patch-diff/SKILL.md': 'analyst/SKILL.md',
  'analyst/path-traversal/SKILL.md': 'analyst/SKILL.md',
  'analyst/pattern-exhaustion/SKILL.md': 'analyst/SKILL.md',
  'analyst/prompt-injection/SKILL.md': 'analyst/SKILL.md',
  'analyst/prototype-pollution/SKILL.md': 'analyst/SKILL.md',
  'analyst/redos/SKILL.md': 'analyst/SKILL.md',
  'analyst/sensitive-information-disclosure/SKILL.md': 'analyst/SKILL.md',
  'analyst/sql-injection/SKILL.md': 'analyst/SKILL.md',
  'analyst/ssrf/SKILL.md': 'analyst/SKILL.md',
  'analyst/ssti/SKILL.md': 'analyst/SKILL.md',
  'analyst/supply-chain/SKILL.md': 'analyst/SKILL.md',
  'analyst/system-prompt-leakage/SKILL.md': 'analyst/SKILL.md',
  'analyst/ti-anyrun-lookup/SKILL.md': 'analyst/SKILL.md',
  'analyst/ti-ioc-extraction/SKILL.md': 'analyst/SKILL.md',
  'analyst/ti-yara-hunting/SKILL.md': 'analyst/SKILL.md',
  'analyst/trust-boundary/SKILL.md': 'analyst/SKILL.md',
  'analyst/unbounded-consumption/SKILL.md': 'analyst/SKILL.md',
  'analyst/vector-and-embedding-weaknesses/SKILL.md': 'analyst/SKILL.md',
  'analyst/xxe/SKILL.md': 'analyst/SKILL.md',
  'cloud/aws-iam-enum/SKILL.md': 'cloud/SKILL.md',
  'cloud/aws-iam-passrole-chain/SKILL.md': 'cloud/SKILL.md',
  'cloud/azure-managed-identity/SKILL.md': 'cloud/SKILL.md',
  'cloud/container/container-cve/SKILL.md': 'cloud/container/SKILL.md',
  'cloud/container/docker-socket-mount/SKILL.md': 'cloud/container/SKILL.md',
  'cloud/container/k8s-pod-escape/SKILL.md': 'cloud/container/SKILL.md',
  'cloud/container/k8s-rbac-abuse/SKILL.md': 'cloud/container/SKILL.md',
  'cloud/entra-conditional-access-bypass/SKILL.md': 'cloud/SKILL.md',
  'cloud/entra-device-code-phishing/SKILL.md': 'cloud/SKILL.md',
  'cloud/entra-enum/SKILL.md': 'cloud/SKILL.md',
  'cloud/entra-privesc/SKILL.md': 'cloud/SKILL.md',
  'cloud/gcp-org-escalation/SKILL.md': 'cloud/SKILL.md',
  'cloud/gcp-svc-account-impersonation/SKILL.md': 'cloud/SKILL.md',
  'cloud/imds-pivot/SKILL.md': 'cloud/SKILL.md',
  'cloud/k8s-pivot/SKILL.md': 'cloud/SKILL.md',
  'cloud/m365-mailbox-compromise/SKILL.md': 'cloud/SKILL.md',
  'cloud/s3-takeover/SKILL.md': 'cloud/SKILL.md',
  'cloud/terraform-state-leak/SKILL.md': 'cloud/SKILL.md',
  'contracts/access-control/SKILL.md': 'contracts/SKILL.md',
  'contracts/bridge-exploit/SKILL.md': 'contracts/SKILL.md',
  'contracts/flash-loan/SKILL.md': 'contracts/SKILL.md',
  'contracts/governance-attack/SKILL.md': 'contracts/SKILL.md',
  'contracts/mev-sandwich/SKILL.md': 'contracts/SKILL.md',
  'contracts/oracle-manipulation/SKILL.md': 'contracts/SKILL.md',
  'contracts/reentrancy/SKILL.md': 'contracts/SKILL.md',
  'contracts/signature-replay/SKILL.md': 'contracts/SKILL.md',
  'contracts/upgradeable-proxy/SKILL.md': 'contracts/SKILL.md',
  'exploit/ad/references/attack-paths.md': 'exploit/ad/SKILL.md',
  'exploit/api/grpc/SKILL.md': 'exploit/api/SKILL.md',
  'exploit/api/server-sent-events/SKILL.md': 'exploit/api/SKILL.md',
  'exploit/api/soap-wsdl/SKILL.md': 'exploit/api/SKILL.md',
  'exploit/api/websocket/SKILL.md': 'exploit/api/SKILL.md',
  'exploit/cicd/cicd-secrets-exfil/SKILL.md': 'exploit/cicd/SKILL.md',
  'exploit/cicd/github-actions-injection/SKILL.md': 'exploit/cicd/SKILL.md',
  'exploit/cicd/poisoned-pipeline-execution/SKILL.md': 'exploit/cicd/SKILL.md',
  'exploit/cicd/self-hosted-runner-abuse/SKILL.md': 'exploit/cicd/SKILL.md',
  'exploit/ics-ot/bacnet/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/dnp3/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/enip-cip/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/modbus/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/opcua/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/profinet/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/ics-ot/s7comm/SKILL.md': 'exploit/ics-ot/SKILL.md',
  'exploit/supplychain/dep-confusion/SKILL.md': 'exploit/supplychain/SKILL.md',
  'exploit/web/ato-methodology/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/bfla/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/blind-sqli/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/business-logic/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/cache-deception/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/clickjacking/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/command-injection/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/cors/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/crypto/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/csrf/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/cve/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/deserialization/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/dns-rebinding/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/dom-clobbering/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/graphql/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/header-injection/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/hpp/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/idor/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/jwt/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/ldapi/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/lfi/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/mass-assignment/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/mfa-bypass/SKILL.md': 'exploit/web/SKILL.md',
  'exploit/web/nosqli/SKILL.md': 'exploit/web/SKILL.md',
};

// extra decepticon cross-references (evidence-backed, within batch 133)
const EXTRA_RELATED = [
  ['decepticon/pentest-task-tree/SKILL.md', 'decepticon/kill-chain-analysis/SKILL.md'],
  ['decepticon/pentest-task-tree/SKILL.md', 'decepticon/final-report/SKILL.md'],
];

for (const bi of [131, 132, 133, 134, 135]) {
  const b = BATCHES.batches[bi - 1];
  const ext = JSON.parse(readFileSync(`${ROOT}/.ua/tmp/ua-file-analyzer-output-${bi}.json`, 'utf8'));
  const lineOf = {};
  for (const r of ext.results) lineOf[r.path] = r.totalLines;

  const out = {
    batchIndex: bi,
    batchFiles: b.files.map(f => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
    nodes: [],
    edges: [],
  };

  for (const f of out.batchFiles) {
    const rel = f.path.slice(PREFIX.length);
    const entry = S[rel];
    if (!entry) throw new Error(`missing summary for ${rel}`);
    const [summary, tags, complexity] = entry;
    const total = lineOf[f.path] ?? f.sizeLines;
    if (total !== f.sizeLines) throw new Error(`line mismatch ${f.path}: ${total} vs ${f.sizeLines}`);
    out.nodes.push({
      id: `document:${f.path}`,
      type: 'document',
      name: f.path.split('/').pop(),
      filePath: f.path,
      lineRange: [1, total],
      summary,
      tags,
      complexity,
    });
  }

  const ids = new Set(out.nodes.map(n => n.id));
  for (const f of out.batchFiles) {
    const rel = f.path.slice(PREFIX.length);
    const parent = PARENT[rel];
    if (!parent) continue;
    const src = `document:${f.path}`;
    const tgt = `document:${PREFIX}${parent}`;
    if (src === tgt) throw new Error(`self-edge ${src}`);
    if (!ids.has(src)) throw new Error(`edge source not a node: ${src}`);
    out.edges.push({ source: src, target: tgt, type: 'related', direction: 'forward', weight: 0.5 });
  }
  for (const [child, parent] of EXTRA_RELATED) {
    if (bi !== 133) continue;
    const src = `document:${PREFIX}${child}`;
    const tgt = `document:${PREFIX}${parent}`;
    if (!ids.has(src) || !ids.has(tgt)) throw new Error(`extra edge endpoint missing: ${src} -> ${tgt}`);
    out.edges.push({ source: src, target: tgt, type: 'related', direction: 'forward', weight: 0.5 });
  }

  const outPath = `${ROOT}/.ua/intermediate/batch-${bi}.json`;
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`batch ${bi}: nodes=${out.nodes.length} edges=${out.edges.length} -> ${outPath}`);
}
