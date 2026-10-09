#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinh batch-11..15.json (file-analyzer gop, tieng Viet)."""
import json, pathlib, re, ast, collections

PR = pathlib.Path("D:/.VTNet/redteam/raptix")
UA = PR / ".ua"
batches = json.load(open(UA / "intermediate" / "batches.json", encoding="utf-8"))

def cx_file(n):
    if n < 50: return "simple"
    if n <= 200: return "moderate"
    return "complex"

def cx_span(s):
    if s <= 15: return "simple"
    if s <= 60: return "moderate"
    return "complex"

# ---------- verb mapping cho function summary ----------
VERB = [
    ("load", "Tai"), ("fetch", "Tai ve"), ("filter", "Loc"), ("build", "Dung"),
    ("format", "Dinh dang"), ("parse", "Phan tich"), ("validate", "Kiem tra"),
    ("verify", "Xac minh"), ("resolve", "Phan giai"), ("create", "Tao"),
    ("update", "Cap nhat"), ("delete", "Xoa"), ("save", "Luu"), ("render", "Ket xuat"),
    ("export", "Xuat"), ("import", "Nhap"), ("merge", "Hop nhat"), ("reduce", "Rut gon"),
    ("normalize", "Chuan hoa"), ("sanitize", "Lam sach"), ("detect", "Phat hien"),
    ("check", "Kiem tra"), ("get", "Lay"), ("set", "Dat"), ("subscribe", "Dang ky"),
    ("publish", "Phat hanh"), ("notify", "Thong bao"), ("mutate", "Bien doi"),
    ("retain", "Giu lai"), ("release", "Giai phong"), ("seed", "Nap san"),
    ("reload", "Tai lai"), ("refresh", "Lam moi"), ("observe", "Quan sat"),
    ("derive", "Suy ra"), ("extract", "Trich xuat"), ("compute", "Tinh toan"),
    ("count", "Dem"), ("summarize", "Tom tat"), ("summarise", "Tom tat"),
    ("slugify", "Chuan hoa slug"), ("encode", "Ma hoa"), ("decode", "Giai ma"),
    ("classify", "Phan loai"), ("evaluate", "Danh gia"), ("is", "Kiem tra"),
    ("assert", "Khang dinh"), ("ensure", "Dam bao"), ("distinct", "Liet ke gia tri rieng"),
    ("entry", "Xac dinh nguon goc"), ("timeline", "Tong hop timeline"),
    ("use", "Quan ly state"), ("isKnown", "Kiem tra ma loi quen thuoc"),
    ("isWaiting", "Kiem tra trang thai cho"), ("isProject", "Kiem tra kieu du an"),
    ("initial", "Khoi tao danh sach"), ("group", "Nhom theo"), ("cn", "Gop lop CSS"),
]
# fix accents later: we write proper Vietnamese directly in templates below.
# For generic fallback we use ascii-safe then replace via VI map.

def vi_words(name):
    # tach camel/snake
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    s = s.replace("_", " ").replace("-", " ")
    toks = [t for t in re.split(r"\s+", s) if t]
    return toks

# ---------- file summary: content-aware, tieng Viet ----------
def file_summary(path, src, r, imp):
    head = "\n".join(src.splitlines()[:8])
    exps = [e.get("name","") for e in r.get("exports",[])]
    fns = [f.get("name","") for f in r.get("functions",[])]
    base = path.split("/")[-1]
    # --- batch 11: web-raptix features ---
    if path.endswith("use-real-graph.ts"):
        return ("Hook trang thai trang Infrastructure & Assets che do real (W13): tai dong thoi GraphView va AssetsView theo project.id qua real-graph-api, phan biet loi 503 unavailable voi do thi rong va ho tro refresh thu cong.", ["hook", "infrastructure", "do-thi-tan-cong", "real-mode", "react"])
    if path.endswith("members/RealMembers.tsx"):
        return ("Man hinh thanh vien che do real (W19): hien thi topology don nguoi van hanh that tu API moi, kem the moi/RBAC ghi ro ly do vang mat, khong dung du lieu demo gia lap phan quyen.", ["react", "thanh-vien", "real-mode", "giao-dien"])
    if path.endswith("members/real-members-api.ts"):
        return ("Lop API thanh vien che do real (W19): doc members view don nguoi dung qua contract guard, chu y khong co helper moi/doi vai tro vi server khong ton tai API do.", ["api-client", "thanh-vien", "real-mode", "contract-guard"])
    if path.endswith("operations-log/RealLogs.tsx"):
        return ("Man hinh nhat ky van hanh che do real (W14): giu ngon ngu visual cua man hinh goc (bo dem so luong, bo loc, bang, modal chi tiet) nhung gan voi timeline hop nhat tu server, khong chi bao Live gia.", ["react", "nhat-ky-van-hanh", "real-mode", "timeline"])
    if path.endswith("operations-log/logs-view.ts"):
        return ("Anh xa thuan tuy cho nhat ky van hanh (W14): suy ra tuy chon loc tu payload timeline thuc, giu nhan source, tim kiem khong phan biet hoa thuong va tom tat tinh day du mot cach trung thuc.", ["anh-xa", "bo-loc", "timeline", "pure-function"])
    if path.endswith("operations-log/real-logs-api.ts"):
        return ("Lop API nhat ky che do real (W14): chi goi server moi, kiem chung timeline hop nhat bang contract guard, moi muc giu nhan source phan biet runtime/checkpoint/workspace.", ["api-client", "nhat-ky-van-hanh", "contract-guard", "real-mode"])
    if path.endswith("operations-log/use-real-logs.ts"):
        return ("Hook trang thai trang Operations Log che do real (W14): tai timeline hop nhat bi gioi han tu API moi, khong sinh telemetry gia trong trinh duyet va hien thi dung trang thai bounded.", ["hook", "nhat-ky-van-hanh", "real-mode", "react"])
    if path.endswith("planning/RealPlanning.tsx"):
        return ("Man hinh lap ke hoach che do real: tai PlanningView qua API co kiem chung isPlanningView, hien thi tai lieu RoE/CONOPS/deconfliction/OPPLAN va bao loi phan hoi khong hop le thay vi ep kieu.", ["react", "lap-ke-hoach", "real-mode", "contract-guard"])
    if path.endswith("planning/styles.ts"):
        return ("Bang style tap trung cho cum lap ke hoach: nhan kill-chain, huy hieu OPSEC/opplan-status, quyen pham vi va loai muc tieu, dung chung cho DocCard va cac chip mock.", ["style", "lap-ke-hoach", "giao-dien", "kill-chain"])
    if path.endswith("planning/types.ts"):
        return ("Mo hinh kieu cho lat cat lap ke hoach (Charter & ScopeBoundaries): RoEDoc, ConopsDoc, DeconflictionDoc, OpplanObjective/Doc va ScopeTarget/Fixture theo goi planning cua engagement.", ["kieu-du-lieu", "lap-ke-hoach", "roe", "opplan"])
    if path.endswith("planning/ui.tsx"):
        return ("Bo khoi UI dung chung cho lap ke hoach: chip nguon mock, banner canh bao, the tai lieu va trang thai thieu tai lieu, tai xuat CapabilityButton dung chung.", ["component", "lap-ke-hoach", "giao-dien", "tai-su-dung"])
    if path.endswith("projects/api/projects-api.ts"):
        return ("Hop dong API du an cong khai (W03): be mat duy nhat UI duoc goi o che do real, ban mock va real chia se chu ky, yeu cau authorizationConfirmed la literal true khi tao.", ["hop-dong-api", "du-an", "real-mode", "kieu-du-lieu"])
    if path.endswith("projects/api/projects-real.ts"):
        return ("Cai dat ProjectsApi che do real qua API moi (qua proxy /api): kiem chung moi phan hoi bang isProjectViewModel, truyen so dem nullable dung nhu server tra, khong chuan hoa gia.", ["api-client", "du-an", "real-mode", "contract-guard"])
    if path.endswith("projects/components/RealNewProjectModal.tsx"):
        return ("Modal tao du an che do real: form nhap lieu co validateCreateProjectDraft, chon loai muc tieu engagement, giu focus input va bao loi truong, dong qua Dialog dung chung.", ["react", "du-an", "bieu-mau", "real-mode", "validation"])
    if path.endswith("projects/components/RealProjectsHome.tsx"):
        return ("Trang chu du an che do real: the du an, hang danh sach, huy hieu trang thai, chip so dem va hop metric, tim kiem/loc theo lifecycle, khong dung fixture demo.", ["react", "du-an", "trang-chu", "real-mode"])
    if path.endswith("projects/hooks/use-real-projects.ts"):
        return ("Store nhe che do real cho du an (W03, khong dung thu vien query): dong bo qua useSyncExternalStore theo mau mock-adapter, cache snapshot list/detail, mutate tao/cap nhat va tai lai co dedup.", ["hook", "du-an", "store", "real-mode", "react"])
    if path.endswith("projects/real-project.types.ts"):
        return ("Module kieu dung chung cho du an real (W03, thuan tuy): hop dong props Home/New Project, helper dinh dang so dem/thoi gian, dem theo lifecycle, loc du an va validate ban nhap tao.", ["kieu-du-lieu", "du-an", "validation", "helper-thuan-tuy"])
    if path.endswith("projects/summary.ts"):
        return ("Helper tom tat trang thai chay theo du an: rut ra needsAttention va danh sach agent cho phe duyet tu RunSnapshot de Home hien thi canh bao.", ["tom-tat", "du-an", "giam-sat-chay", "helper"])
    if path.endswith("reports/RealReports.tsx"):
        return ("Man hinh bao cao che do real (W14): preview dung tu DTO engagement/findings that, chi cung cap JSON/Markdown vi server chi kiem chung hai dinh dang nay, khong dung deliverable gia.", ["react", "bao-cao", "real-mode", "xuat-ban"])
    if path.endswith("reports/ReportDocument.tsx"):
        return ("Trinh ket xuat tai lieu bao cao: render tung SectionBlock (doan van, ghi chu, diem rui ro, bang, giai doan, code, buoc) thanh BlockView co mau severity nhat quan.", ["react", "bao-cao", "render", "tai-lieu"])
    if path.endswith("reports/ReportsTable.tsx"):
        return ("Bang danh sach bao cao ban demo: doc REPORT_FIXTURES, hien thi avatar viet tat, style loai/trang thai, gioi han nang luc xuat va mo modal chi tiet.", ["react", "bao-cao", "bang-du-lieu", "demo"])
    if path.endswith("reports/export.ts"):
        return ("Xuat bao cao demo: tao ten file slug, dung JSON co watermark mock/notice va Markdown co header DEMO EXPORT, chi ho tro json/markdown, tai xuong qua Blob URL.", ["xuat-ban", "bao-cao", "json", "markdown", "demo"])
    if path.endswith("reports/real-reports-api.ts"):
        return ("API xuat bao cao che do real (W14): goi endpoint attachment da kiem chung cua server, chi ton tai json/markdown, doc ten file tu Content-Disposition va chi bao thanh cong khi body ve den noi.", ["api-client", "bao-cao", "xuat-ban", "real-mode"])
    if path.endswith("reports/styles.ts"):
        return ("Chip kieu demo cho bao cao: DEMO_CHIP tim va disabledStyle mo, dung de danh dau du lieu gia trong preview.", ["style", "bao-cao", "demo", "giao-dien"])
    if path.endswith("reports/types.ts"):
        return ("Kieu bao cao: ReportType/Status, ReportMeta va dinh nghia tai lieu/section/block lam nen cho fixture, preview va xuat JSON/Markdown.", ["kieu-du-lieu", "bao-cao", "tai-lieu"])
    if path.endswith("reports/ui.tsx"):
        return ("Thong bao nang luc bao cao: CapabilityNotice canh bao gioi han PDF/DOCX/AI, tai xuat CapabilityButton dung chung toan trang.", ["component", "bao-cao", "giao-dien", "canh-bao"])
    if path.endswith("settings/RealSettings.tsx"):
        return ("Man hinh cai dat che do real (W15): chi hien thi truong server thuc su luu tru, luu qua PATCH co kiem chung kem xac nhan save/reload, vung nguy hiem ghi ro pham vi xoa.", ["react", "cai-dat", "real-mode", "bieu-mau"])
    if path.endswith("settings/real-settings-api.ts"):
        return ("API cai dat che do real (W15): doc persisted settings view, luu bang PATCH tren route engagement hien co, xoa engagement, caller luon tai lai view de chi hien thi state server da ACK.", ["api-client", "cai-dat", "real-mode", "http"])
    if path.endswith("settings/use-real-settings.ts"):
        return ("Hook trang thai trang Settings che do real (W15): tai persisted view, luu qua PATCH co kiem chung va reload lai, chi bao da luu khi server xac nhan va reload tra ve dung gia tri.", ["hook", "cai-dat", "real-mode", "react"])
    if path.endswith("vault/RealVault.tsx"):
        return ("Ket sat thong tin che do real (W18): mac dinh chi hien metadata da che, tiet lo co canh bao xac nhan (plaintext hien mot lan, khong luu state), thu hoi co audit, moi gia tri tu API that.", ["react", "ket-sat", "bi-mat", "real-mode"])
    if path.endswith("vault/real-vault-api.ts"):
        return ("API ket sat che do real (W18): goi scoped vault endpoints, danh sach metadata do server che (khong ciphertext/plaintext), plaintext chi ton tai trong response reveal va khong luu client.", ["api-client", "ket-sat", "bi-mat", "real-mode"])
    if path.endswith("src/main.tsx"):
        return ("Diem vao trinh duyet: mount App vao #root kem index.css, cau noi giua index.html va cay React.", ["entry-point", "khoi-dong", "react", "vite"])
    if path.endswith("mocks/adapters/projects.ts"):
        return ("Adapter du an che do mock: store useSyncExternalStore tren PROJECTS fixture voi localStorage, tao/cap nhat mock project va bao loi persistence.", ["mock", "du-an", "adapter", "store"])
    # --- batch 12 legacy web ---
    if path.endswith("terminal/web-terminal.tsx"):
        return ("Thiet bi dau cuoi web nhuong quyen (legacy): nhung xterm.js chay CLI Raptix qua WebSocket server rieng, loc byte dau cuoi bang sanitizeTermBytes truoc khi ve.", ["terminal", "xterm", "websocket", "legacy", "component"])
    if path.endswith("ui/alert.tsx"):
        return ("Bo alert kieu shadcn (legacy): Alert/Title/Description/Action dung cva variant va cn gop lop, ke thua Base UI.", ["ui-kit", "alert", "legacy", "component"])
    if path.endswith("ui/avatar.tsx"):
        return ("Bo avatar (legacy): Avatar/Image/Fallback/Badge/Group/GroupCount tren Base UI avatar, dung chung cn va lop tailwind.", ["ui-kit", "avatar", "legacy", "component"])
    if path.endswith("ui/badge.tsx"):
        return ("Badge co variant (legacy): badgeVariants bang cva va component Badge dung mergeProps/useRender cua Base UI.", ["ui-kit", "badge", "legacy", "component"])
    if path.endswith("ui/button.tsx"):
        return ("Nut co variant (legacy): buttonVariants bang cva tren Base UI button, chuan hoa kich thuoc/mau bang cn.", ["ui-kit", "button", "legacy", "component"])
    if path.endswith("ui/card.tsx"):
        return ("Bo the (legacy): Card/Header/Title/Description/Action/Content/Footer la wrapper div thuan tuy dung cn.", ["ui-kit", "card", "legacy", "component"])
    if path.endswith("ui/command.tsx"):
        return ("Bo command palette (legacy): wrapper cmdk Command/Dialog/Input/List/Empty/Group/Item/Shortcut, tich hop dialog va input-group.", ["ui-kit", "command-palette", "legacy", "component"])
    if path.endswith("ui/dialog.tsx"):
        return ("Bo hop thoai (legacy): Dialog/Trigger/Portal/Overlay/Content/Header/Footer/Title/Description tren Base UI dialog, dung nut va cn.", ["ui-kit", "dialog", "legacy", "component"])
    if path.endswith("ui/dropdown-menu.tsx"):
        return ("Menu tha xuong day du (legacy): Menu/Trigger/Content/Group/Label/Item/Checkbox/Radio/Sub/Separator/Shortcut tren Base UI menu.", ["ui-kit", "dropdown-menu", "legacy", "component"])
    if path.endswith("ui/input-group.tsx"):
        return ("Nhom input ket hop (legacy): InputGroup/Addon/Button/Text/Input/Textarea voi variant cva, ghep button/input/textarea thanh mot cum.", ["ui-kit", "input-group", "legacy", "component"])
    if path.endswith("ui/input.tsx"):
        return ("O nhap lieu co so (legacy): wrapper Base UI input dung cn, giu API React input goc.", ["ui-kit", "input", "legacy", "component"])
    if path.endswith("ui/label.tsx"):
        return ("Nhan label (legacy): wrapper label don gian dung cn, dung cho form.", ["ui-kit", "label", "legacy", "component"])
    if path.endswith("ui/popover.tsx"):
        return ("Popover (legacy): Popover/Trigger/Content/Header/Title/Description tren Base UI popover, dinh vi noi dung noi.", ["ui-kit", "popover", "legacy", "component"])
    if path.endswith("ui/scroll-area.tsx"):
        return ("Vung cuon tuy bien (legacy): ScrollArea/ScrollBar tren Base UI scroll-area, giu cuon mem trong panel hep.", ["ui-kit", "scroll-area", "legacy", "component"])
    if path.endswith("ui/select.tsx"):
        return ("Hop chon (legacy): Select/Trigger/Content/Group/Label/Item/Separator/ScrollButton tren Base UI select, ho tro cuon danh sach dai.", ["ui-kit", "select", "legacy", "component"])
    if path.endswith("ui/separator.tsx"):
        return ("Duong phan cach (legacy): wrapper Base UI separator dung cn, dung ngang/doc trong layout.", ["ui-kit", "separator", "legacy", "component"])
    if path.endswith("ui/sheet.tsx"):
        return ("Sheet truot canh (legacy): Sheet/Trigger/Overlay/Content/Header/Footer/Title/Description dung Base UI dialog lam nen.", ["ui-kit", "sheet", "legacy", "component"])
    if path.endswith("ui/skeleton.tsx"):
        return ("Khung cho tai (legacy): div skeleton dung cn voi animation pulse, giu cho noi dung dang tai.", ["ui-kit", "skeleton", "legacy", "tai-du-lieu"])
    if path.endswith("ui/table.tsx"):
        return ("Bo bang (legacy): Table/Header/Body/Footer/Row/Head/Cell/Caption la wrapper table thuan tuy dung cn.", ["ui-kit", "table", "legacy", "component"])
    if path.endswith("ui/tabs.tsx"):
        return ("Tab (legacy): Tabs/List/Trigger/Content voi tabsListVariants bang cva tren Base UI tabs.", ["ui-kit", "tabs", "legacy", "component"])
    if path.endswith("ui/textarea.tsx"):
        return ("Vung van ban (legacy): wrapper textarea don gian dung cn, dung cho nhap lieu nhieu dong.", ["ui-kit", "textarea", "legacy", "component"])
    if path.endswith("ui/tooltip.tsx"):
        return ("Chu thich noi (legacy): Tooltip/Provider/Trigger/Content tren Base UI tooltip, hien thi goi y khi hover.", ["ui-kit", "tooltip", "legacy", "component"])
    if path.endswith("hooks/useAgentActivity.ts"):
        return ("Hook anh xa su kien sub-agent thanh do thi: bien SubagentCustomEvent thanh nodes/edges dung kieu @raptix/streaming, khong parse regex.", ["hook", "sub-agent", "do-thi", "streaming", "legacy"])
    if path.endswith("hooks/useAgents.ts"):
        return ("Hook danh sach agent (legacy): doc AGENTS tu lib/agents bang state/effect, tra ve cau hinh hien thi cho dashboard.", ["hook", "agent", "legacy", "react"])
    if path.endswith("hooks/useCanvasTransform.ts"):
        return ("Hook pan & zoom cho canvas SVG do thi agent: quan ly affine 2D (translate + scale dong nhat) theo thao tac chuot/banh xe.", ["hook", "canvas", "pan-zoom", "do-thi", "legacy"])
    if path.endswith("hooks/useForceSimulation.ts"):
        return ("Hook bo cuc vat ly d3-force cho do thi agent: chay mo phong day/lien ket/can giua/chong lan theo kieu graph/types.", ["hook", "d3-force", "bo-cuc", "do-thi", "legacy"])
    if path.endswith("hooks/useRunObserver.ts"):
        return ("Hook quan sat run LangGraph thoi gian thuc: xu ly su kien qua @raptix/streaming chung voi CLI, cap nhat view truc tiep.", ["hook", "langgraph", "streaming", "quan-sat", "legacy"])
    if path.endswith("lib/agents.ts"):
        return ("Registry hien thi agent (legacy): AGENTS, cau hinh theo vai tro, nhom kill-chain va tra cuu getAgent/getAgentsByRole; backend quyet dinh agent nao ton tai.", ["registry", "agent", "kill-chain", "cau-hinh-hien-thi"])
    if path.endswith("lib/chat/markdown-renderer.tsx"):
        return ("Renderer markdown cho chat (legacy): boc ReactMarkdown + remarkGfm theo interface MessageRenderer, de doi sang OpenUI sau nay.", ["chat", "markdown", "renderer", "legacy"])
    if path.endswith("lib/chat/types.ts"):
        return ("Kieu chat cho dashboard (legacy): MessageRenderer tru tu hien thi output, co the thay bang GenUI/OpenUI.", ["kieu-du-lieu", "chat", "legacy", "giao-dien"])
    if path.endswith("lib/engagement-context.tsx"):
        return ("Context engagement (legacy): EngagementProvider/useEngagementContext cung cap SubagentCustomEvent cho cay dashboard.", ["context", "engagement", "react", "legacy"])
    if path.endswith("lib/graph/types.ts"):
        return ("Kieu do thi thuc thi agent: topology ORCHESTRATOR trung tam theo mau octogent, kem helper isWaitingState nhan dien trang thai cho.", ["kieu-du-lieu", "do-thi", "topo", "legacy"])
    if path.endswith("lib/utils.ts"):
        return ("Ham gop lop CSS duy nhat (legacy): cn ket hop clsx va tailwind-merge, duoc moi component ui-kit su dung.", ["tien-ich", "css", "tailwind", "legacy"])
    # --- batch 13 raptix-core ---
    if path.endswith("raptix_core/__init__.py"):
        return ("Barrel lop hop dong raptix-core: tai xuat contracts/plugin_loader/protocols/registry/types/utils va anh xa bien moi truong legacy, cam import langchain/langgraph/http/fastapi.", ["barrel", "hop-dong", "entry-point", "plugin"])
    if path.endswith("contracts/__init__.py"):
        return ("Barrel hop dong plugin: tai xuat slots va cac contribution, la be mat plugin author implement.", ["barrel", "hop-dong", "plugin", "entry-point"])
    if path.endswith("contracts/contributions.py"):
        return ("Nam dataclass dong gop tap trung cho plugin: Tool/Middleware/Prompt/SubAgent Contribution va SafetyDeclaration tach tu PluginBundle cong kenh, moi loai bao mot mat mo rong.", ["hop-dong", "plugin", "dataclass", "dong-gop"])
    if path.endswith("contracts/slots.py"):
        return ("Enum khe middleware va anh xa theo vai tro: factory duyet MiddlewareSlot theo thu tu khai bao, SLOTS_PER_ROLE quyet dinh slot nao ap dung cho role nao.", ["middleware-slots", "hop-dong", "vai-tro", "plugin"])
    if path.endswith("raptix_core/plugin_loader.py"):
        return ("Phat hien plugin cho Raptix: doc entry-points, ho tro bundle cau hinh, nap tools/middleware/callbacks/skill-sources/prompts/role-specs/subagents qua PluginBundle va SubAgentSpec (681 dong).", ["plugin", "entry-point", "nap-plugin", "sub-agent", "hop-dong"])
    if path.endswith("protocols/__init__.py"):
        return ("Barrel giao thuc tac gia plugin: tai xuat 7 Protocol agent/backend/callback/llm/middleware/sandbox/tool dang runtime_checkable de isinstance luc chay.", ["barrel", "giao-thuc", "plugin", "entry-point"])
    if path.endswith("protocols/agent.py"):
        return ("Giao thuc agent toi thieu: be mat compiled-agent ma factory sub-agent tra ve, truong SubAgentSpec.factory duoc dinh kieu theo Protocol nay.", ["giao-thuc", "agent", "hop-dong", "plugin"])
    if path.endswith("protocols/backend.py"):
        return ("Giao thuc backend filesystem: khop hinh CompositeBackend cua deepagents, dinh tuyen /skills/ doc file noi bo, con lai qua sandbox transport.", ["giao-thuc", "backend", "filesystem", "plugin"])
    if path.endswith("protocols/callback.py"):
        return ("Giao thuc callback: khop hinh BaseCallbackHandler cua langchain, dang ky qua nhom raptix.callbacks va duoc goi tai diem lifecycle chuan.", ["giao-thuc", "callback", "langchain", "plugin"])
    if path.endswith("protocols/llm.py"):
        return ("Giao thuc LLM toi thieu: be mat bound chat model ma LLMFactory tao ra, BaseChatModel cua langchain tuong thich tu nhien.", ["giao-thuc", "llm", "mo-hinh", "plugin"])
    if path.endswith("protocols/middleware.py"):
        return ("Giao thuc middleware: khop hinh middleware langchain, dang ky qua raptix.middleware hoac thay slot chuan bang PluginBundle.", ["giao-thuc", "middleware", "plugin", "hop-dong"])
    if path.endswith("protocols/sandbox.py"):
        return ("Giao thuc sandbox transport: khop hinh HTTPSandbox, moi thao tac bash/filesystem di qua transport nay toi daemon FastAPI trong container sandbox.", ["giao-thuc", "sandbox", "thuc-thi", "plugin"])
    if path.endswith("protocols/tool.py"):
        return ("Giao thuc tool: chap nhan callable @tool cua langchain hoac class implement Protocol, registry build_tools chap nhan ca hai dang.", ["giao-thuc", "cong-cu", "langchain", "plugin"])
    if path.endswith("registry/__init__.py"):
        return ("Barrel registry: tai xuat conflict/plugins/resolution/roles/safety/skills lam catalog role/skill/plugin co the cam duoc.", ["barrel", "registry", "plugin", "entry-point"])
    if path.endswith("registry/conflict.py"):
        return ("Canh bao xung dot plugin: PluginConflictWarning mang owner khi detect_collisions thay hai plugin dang ky cung khoa, phuc vu audit log.", ["registry", "xung-dot", "canh-bao", "plugin"])
    if path.endswith("registry/plugins.py"):
        return ("Registry plugin trung tam (read-only): quet 8 nhom entry-point, chup nhanh moi dong gop, phat hien va cham va API introspect cho nguoi tieu dung.", ["registry", "plugin", "entry-point", "introspection"])
    if path.endswith("registry/resolution.py"):
        return ("Snapshot phan giai role: MiddlewareInfo/ToolInfo/OverrideInfo/RoleResolution dang frozen hashable de audit memoize theo run-id.", ["registry", "phan-giai", "role", "dataclass"])
    if path.endswith("registry/roles.py"):
        return ("Catalog vai tro agent co the cam: role OSS dang ky san tu SLOTS_PER_ROLE, plugin them role moi qua nhom raptix.roles thay vi lam dung vendor apt.", ["registry", "vai-tro", "plugin", "slot"])
    if path.endswith("registry/safety.py"):
        return ("Registry an toan mo rong boi plugin: gop ten tool/middleware safety-critical voi baseline OSS theo kieu additive-only, gate kiem tra luc lookup.", ["registry", "an-toan", "cong-khai", "plugin"])
    if path.endswith("registry/skills.py"):
        return ("Registry nguon skill: kiem tra dinh dang duong dan /skills/<bundle>/ va phat hien trung lap luc dang ky, chan duong dan sai nhu /workspace/foo.", ["registry", "ky-nang", "kiem-tra-duong-dan", "plugin"])
    if path.endswith("types/__init__.py"):
        return ("Barrel kieu pydantic lop hop dong: tai xuat engagement/kg/llm/roe lam nen tai lieu red-team, do thi tan cong, anh xa model va RoE may doc.", ["barrel", "kieu-du-lieu", "pydantic", "entry-point"])
    if path.endswith("types/engagement.py"):
        return ("Luoc do tai lieu engagement red-team (1081 dong): RoE, CONOPS, DeconflictionPlan, Objective/OPPLAN, Finding/Evidence/AttackPath, Cleanup/Abort/Contact/DataHandling va EngagementBundle.", ["luoc-do", "engagement", "red-team", "pydantic", "opplan"])
    if path.endswith("types/kg.py"):
        return ("Do thi tri thuc Neo4j-native (552 dong): NodeKind/EdgeKind anh xa 1-1 sang label/relationship, TechnologyCategory, Severity, Node/Edge va KnowledgeGraph ho tro truy van in-memory.", ["do-thi-tri-thuc", "neo4j", "tan-cong", "luoc-do"])
    if path.endswith("types/llm.py"):
        return ("Dinh nghia model LLM theo tier xac thuc (937 dong): Tier/AuthMethod/ModelProfile/Credentials/ProxyConfig/ModelAssignment/LLMModelMapping va resolve_chain phan giai ollama/lmstudio/llamacpp/openai.", ["llm", "mo-hinh", "xac-thuc", "anh-xa", "tier"])
    if path.endswith("types/roe.py"):
        return ("Luoc do RoE may doc (400 dong): ScopeRule/MachineEnforcement/Decision/EnforcementMode voi glob/wildcard/TLD nhay cam, evaluate_target/evaluate_command/evaluate_time_window dieu khien guardrail.", ["roe", "quy-tac", "phat-hien-pham-vi", "guardrail"])
    if path.endswith("utils/__init__.py"):
        return ("Barrel tien ich lop hop dong: tai xuat config/logging bang stdlib+pydantic, framework va plugin author deu dung duoc.", ["barrel", "tien-ich", "cau-hinh", "nhat-ky"])
    if path.endswith("utils/config.py"):
        return ("Cau hinh ha tang Raptix: gia tri mac dinh + ghi de bien moi truong, anh xa model nam o types.llm, transport sandbox chi HTTP qua SANDBOX_URL.", ["cau-hinh", "bien-moi-truong", "ha-tang", "tien-ich"])
    if path.endswith("utils/logging.py"):
        return ("Logging chuan co JSON tuy chon: text cho dev local, JSON cho production/container/CI, dieu khien qua RAPTIX_LOG_LEVEL tai import/configure_logging.", ["nhat-ky", "json", "cau-hinh", "tien-ich"])
    if path.endswith("tests/test_kg_detection_types.py"):
        return ("Kiem thu hoi quy tu vung KG phong thu Blue Cell: DetectionFired node lien ket -[:DETECTED]->, bao phu topology va truy van tim finding chua co detection.", ["kiem-thu", "do-thi-tri-thuc", "phat-hien", "hoi-quy"])
    if path.endswith("tests/test_kg_technology_types.py"):
        return ("Kiem thu hoi quy tu vung Technology KG (ADR-0007): node Technology tu classifier, canh RUNS, technology_key chuan hoa tien to category va dedup cung san pham.", ["kiem-thu", "do-thi-tri-thuc", "cong-nghe", "hoi-quy"])
    if path.endswith("tests/test_plugin_registry.py"):
        return ("Kiem thu hanh vi PluginRegistry: duyet entry-point va phat hien va cham, khong plugin thi rong, cung ten khac package thi cham, cung package thi khong.", ["kiem-thu", "registry", "plugin", "va-cham"])
    if path.endswith("tests/test_roe_wildcards.py"):
        return ("Kiem thu wildcard RoE dang bug-bounty: *.anduril.dev bao subdomain long nhau nhung khong mo sang apex/lookalike, exclusion thang rule allow, rule path khong thanh host-wide.", ["kiem-thu", "roe", "wildcard", "phat-hien-pham-vi"])
    if path.endswith("tests/test_safety_registry.py"):
        return ("Kiem thu SafetyRegistry additive-only: gop dong gop plugin voi baseline OSS luc lookup, plugin chi duoc mo rong tap safety-critical chu khong duoc go baseline.", ["kiem-thu", "an-toan", "registry", "cong-don"])
    # --- batch 14 ---
    if path.endswith("mocks/adapters/visual-projects.ts"):
        return ("Adapter du an visual demo: store useSyncExternalStore tren PROJECTS dung san voi localStorage, tai/tao project tu fixture correct-projects.", ["mock", "adapter", "du-an", "demo", "store"])
    if path.endswith("mocks/fixtures/agent-runs.ts"):
        return ("Fixture kich ban agent-run demo (314 dong): ACME_ROOT_AGENT va DEMO_RUN_SCENARIOS voi getRunScenario tra kich ban theo id cho RealConsole.", ["mock", "fixture", "agent-run", "demo", "kich-ban"])
    if path.endswith("mocks/fixtures/correct-projects.ts"):
        return ("Fixture du an chuan cho baseline visual: PROJECTS va MEMBERS_BY_PROJECT dung cho demo ma khong gia lap nguoi that ngoai operator.", ["mock", "fixture", "du-an", "demo", "baseline"])
    if path.endswith("mocks/fixtures/planning.ts"):
        return ("Fixture lap ke hoach demo (read-only, dan MOCK): SAMPLE_PLANNING_BUNDLE/SAMPLE_SCOPE theo types planning, khong phai engagement that va khong bi may cuong che.", ["mock", "fixture", "lap-ke-hoach", "demo", "roe"])
    if path.endswith("mocks/fixtures/projects.ts"):
        return ("Fixture du an/thanh vien demo: PROJECTS va MEMBERS_BY_PROJECT voi Alex Kim/Sarah Row mau cho Home/Members ban visual.", ["mock", "fixture", "du-an", "thanh-vien", "demo"])
    if path.endswith("mocks/fixtures/reports.ts"):
        return ("Fixture bao cao demo: REPORT_FIXTURES va DEMO_REPORT_DOCUMENT theo types reports, tac gia la operator don, total severity khop FINDINGS that.", ["mock", "fixture", "bao-cao", "demo", "tai-lieu"])
    if path.endswith("screens/Charter.tsx"):
        return ("Man hinh Hien chuong & RoE (381 dong): hien thi RoE/CONOPS/deconfliction/OPPLAN tu fixture, modal kill-campaign va trang thai halted cuc bo.", ["man-hinh", "hien-chuong", "roe", "demo", "react"])
    if path.endswith("screens/Findings.tsx"):
        return ("Man hinh Phat hien & Bang chung (1112 dong, lon nhat batch): bang loc/tim kiem, modal chi tiet, drawer PoC, trich extractPoc va tai xuong bao cao.", ["man-hinh", "phat-hien", "bang-chung", "demo", "react"])
    if path.endswith("screens/Home.tsx"):
        return ("Man hinh Home muc du an (860 dong): UKC stepper, telemetry, cum avatar, the du an va hang danh sach voi tim kiem/loc theo Screen/types.", ["man-hinh", "trang-chu", "du-an", "demo", "react"])
    if path.endswith("screens/InfrastructureData.tsx"):
        return ("Man hinh Ha tang & Du lieu (1348 dong, lon nhat repo): ban do moi truong, kiem ke tai san, ket sat thong tin voi hang loat modal inspect (AssetInspect/CredDetail) va huy hieu loai/trang thai.", ["man-hinh", "ha-tang", "tai-san", "ket-sat", "demo"])
    if path.endswith("screens/Logs.tsx"):
        return ("Man hinh Operations Log ban visual (541 dong): bo loc Select, bang log, modal chi tiet LogModal va TerminalView xem truc tiep.", ["man-hinh", "nhat-ky", "terminal", "demo", "react"])
    if path.endswith("screens/Members.tsx"):
        return ("Man hinh Thanh vien ban visual (500 dong): danh sach Members voi vai tro/trang thai, modal moi AddMemberModal cuc bo.", ["man-hinh", "thanh-vien", "demo", "react", "bieu-mau"])
    if path.endswith("screens/ProjectSettings.tsx"):
        return ("Man hinh Cai dat du an ban visual (1106 dong): 6 tab General/AI/Integrations/Notifications/ReportTemplates/Danger voi SliderField/Toggle/ApiKeyRow/Modal luu cuc bo.", ["man-hinh", "cai-dat", "demo", "react", "bieu-mau"])
    if path.endswith("screens/Reports.tsx"):
        return ("Man hinh Bao cao ban visual (704 dong): danh sach bao cao voi avatar viet tat, style loai/trang thai va tac vu tai xuong/them moi.", ["man-hinh", "bao-cao", "demo", "react", "danh-sach"])
    if path.endswith("screens/VectorCampaigns.tsx"):
        return ("Man hinh Chien dich Vector (528 dong): chon vector phishing/web/mobile, tao chien dich demo va theo doi trang thai theo project.", ["man-hinh", "chien-dich", "phishing", "demo", "react"])
    if path.endswith("shared/api/errors.ts"):
        return ("Phan loai loi HTTP bien API moi (W03): envelope {statusCode, error:{code,message}}, ApiStatusError giu status goc de nhanh 400/404/409, kem ApiTimeout/Canceled/Network/InvalidResponse.", ["loi-api", "http", "contract", "real-mode", "phan-loai"])
    if path.endswith("shared/api/http.ts"):
        return ("Client JSON toi thieu cho bien API (W03): noi base URL voi path, encodePathSegment cho du lieu dong, gop AbortSignal voi timeout, fetchOnce/requestJson tra JSON da kiem chung.", ["http-client", "api", "abort-signal", "real-mode", "json"])
    if path.endswith("shared/hooks/useNarrowViewport.ts"):
        return ("Hook viewport hep: dang ky matchMedia (max-width: 900px) qua useSyncExternalStore de chuyen layout mobile.", ["hook", "viewport", "responsive", "react"])
    if path.endswith("shared/ui/Dialog.tsx"):
        return ("Hop thoai dung chung co focus-trap: quan ly focusable, dong Escape, khoa cuon nen, dung cho moi modal real/new-project/HITL.", ["component", "dialog", "focus-trap", "tai-su-dung"])
    if path.endswith("src/types.ts"):
        return ("Kieu dung chung web-raptix (48 dong): Screen 13 trang workspace, Project/ProjectStatus/Member/MemberRole lam nen cho router, fixture va man hinh.", ["kieu-du-lieu", "dieu-huong", "du-an", "thanh-vien"])
    if "tests/contracts/console-view.test.ts" in path:
        return ("Kiem thu hop dong console-view: giam su kien stream thanh StreamState va hop nhat lich su thread, bao dung reduceStreamEvent/mergeThreadHistory.", ["kiem-thu", "hop-dong", "console", "stream"])
    if "tests/contracts/findings-view.test.ts" in path:
        return ("Kiem thu hop dong findings-view: anh xa FindingView thanh hang, dem severity, loc tim kiem, duong dan artifact va header noi dung.", ["kiem-thu", "hop-dong", "phat-hien", "bang-chung"])
    if "tests/contracts/graph-view.test.ts" in path:
        return ("Kiem thu hop dong graph-view: loc tai san, bo dem assetCounters, tom tat do thi va nhan hien thi node.", ["kiem-thu", "hop-dong", "do-thi", "tai-san"])
    if "tests/contracts/history-merge.test.ts" in path:
        return ("Kiem thu hop dong history-merge: hop nhat snapshot thread voi su kien stream, xu ly mat ket noi va dem execution quan sat duoc.", ["kiem-thu", "hop-dong", "lich-su", "stream"])
    if "tests/contracts/logs-view.test.ts" in path:
        return ("Kiem thu hop dong logs-view: tuy chon loc, loc timeline, van ban tim kiem, nguon goc muc va dinh dang thoi gian.", ["kiem-thu", "hop-dong", "nhat-ky", "bo-loc"])
    if "tests/contracts/observe-stream.test.ts" in path:
        return ("Kiem thu hop dong observe-stream: theo doi run stream voi scope engagement/thread/run va moc thoi gian co dinh.", ["kiem-thu", "hop-dong", "stream", "quan-sat"])
    if "tests/contracts/projects-real.test.ts" in path:
        return ("Kiem thu hop dong projects-real (356 dong): stub fetch tra ProjectViewModel, kiem chung bien API real, huy fetch, loi client/invalid-response va store use-real-projects.", ["kiem-thu", "hop-dong", "du-an", "real-mode", "mock-fetch"])
    if "tests/contracts/projects.test.ts" in path:
        return ("Kiem thu hop dong projects mock: luu tru Map gia lap localStorage cho adapter visual-projects truoc/sau moi test.", ["kiem-thu", "hop-dong", "du-an", "mock"])
    if "tests/contracts/real-app.test.ts" in path:
        return ("Kiem thu hop dong RealApp: 13 trang workspace tu navigation/router, ly do fallback va unavailable khi real mode loi.", ["kiem-thu", "hop-dong", "dieu-huong", "real-mode"])
    if "tests/contracts/real-project-types.test.ts" in path:
        return ("Kiem thu hop dong real-project.types: dinh dang so dem/thoi gian, dem lifecycle, loc du an va validate ban nhap tao.", ["kiem-thu", "hop-dong", "du-an", "validation"])
    if "tests/contracts/router.test.ts" in path:
        return ("Kiem thu hop dong router: parseRoute/routePath bao dung 13 trang workspace theo NAV_GROUPS/ACTIVE_NAV_ITEMS.", ["kiem-thu", "hop-dong", "router", "dieu-huong"])
    if "tests/contracts/stream-reducer.test.ts" in path:
        return ("Kiem thu hop dong stream-reducer: giam PublicStreamEvent/Payload thanh state, mat ket noi va hop nhat quan sat run.", ["kiem-thu", "hop-dong", "stream", "reducer"])
    # --- batch 15 CLI ---
    if path.endswith("cli/src/app.tsx"):
        return ("Goc CLI (Ink): boc AppStateProvider quanh REPL, nhan initialMessage tuy chon de mo phien co san noi dung.", ["entry-point", "cli", "ink", "repl", "react"])
    if path.endswith("commands/agent.ts"):
        return ("Lenh /agent: chuyen orchestrator hien tai cua phien, chi hien thi orchestration agent, sub-agent goi qua tool task cua orchestrator.", ["lenh-slash", "agent", "orchestrator", "cli"])
    if path.endswith("commands/assistantOverride.ts"):
        return ("Store ghi de orchestrator theo process: /agent ghi vao day, useAgent doc moi submit/resume de lan gui ke tiep co hieu luc, uu tien hon mac dinh.", ["store", "ghi-de", "orchestrator", "cli"])
    if path.endswith("commands/clear.ts"):
        return ("Lenh /clear: xoa lich su hoi thoai cua phien hien tai theo interface Command.", ["lenh-slash", "xoa-lich-su", "cli", "phien"])
    if path.endswith("commands/file.ts"):
        return ("Lenh /file <path>: doc file prompt dai (brief engagement, pham vi VDP) va gui thanh message cho agent, tien cho nhap nhieu dong.", ["lenh-slash", "nap-file", "prompt", "cli"])
    if path.endswith("commands/help.ts"):
        return ("Lenh /help: liet ke lenh kha dung va phim tat tu registry trung tam.", ["lenh-slash", "tro-giup", "registry", "cli"])
    if path.endswith("commands/model.ts"):
        return ("Lenh /model (250 dong): liet ke override hien tai + moi model id ho tro, dat override (/model <id>), kiem tra isKnown va lam phang danh sach.", ["lenh-slash", "mo-hinh", "llm", "cli", "ghi-de"])
    if path.endswith("commands/modelOverride.ts"):
        return ("Store ghi de model theo process: /model ghi vao day, useAgent dua vao config.configurable.model_override moi submit de agent rebind LLM.", ["store", "ghi-de", "mo-hinh", "llm", "cli"])
    if path.endswith("commands/plugins.ts"):
        return ("Lenh /plugins: bat/tat bundle plugin luc chay, mac dinh chi nap standard (10 agent chinh), bundle plugins them vulnresearch + 5 chuyen gia.", ["lenh-slash", "plugin", "bundle", "cli", "agent"])
    if path.endswith("commands/quit.ts"):
        return ("Lenh /quit (alias exit): thoat CLI Raptix theo interface Command.", ["lenh-slash", "thoat", "cli", "phien"])
    if path.endswith("commands/registry.ts"):
        return ("Registry lenh slash trung tam theo mau Claude Code: mang dang ky duy nhat, tra cuu theo ten/alias qua getCommands/findCommand/parseSlashCommand.", ["registry", "lenh-slash", "tra-cuu", "cli"])
    if path.endswith("commands/resume.ts"):
        return ("Lenh /resume (alias r/continue): tiep tuc run dang tam dung hoac phien truoc theo interface Command.", ["lenh-slash", "tiep-tuc", "phien", "cli"])
    if path.endswith("commands/types.ts"):
        return ("Kieu lenh slash CLI: gon tu ba kieu prompt/local/local-jsx cua Claude Code ve mot interface Command thuc thi cuc bo duy nhat.", ["kieu-du-lieu", "lenh-slash", "cli", "giao-dien"])
    if path.endswith("commands/web.test.ts"):
        return ("Kiem thu lenh /web: dung fakeContext ghi su kien de khang dinh in URL dashboard, bao dung registry va types.", ["kiem-thu", "lenh-slash", "web", "cli"])
    if path.endswith("commands/web.ts"):
        return ("Lenh /web: in URL dashboard web; W20 da huu tri dich vu web legacy, chi con thong bao duong dan.", ["lenh-slash", "web", "dashboard", "cli"])
    if path.endswith("components/ActivityIndicator.tsx"):
        return ("Chi bao hoat dong (Ink): chu nhap nhay ShimmerText, dinh dang elapsed/token tu StreamStats/RunState, dung spinner frame va glyph theme.", ["component", "cli", "ink", "trang-thai-chay", "spinner"])
    if path.endswith("components/Banner.tsx"):
        return ("Banner ASCII Raptix (Ink): chon BANNER_FULL braille + block-art khi rong >=140 cot, trich logo bang extractLogo theo stdout.", ["component", "cli", "ink", "banner", "giao-dien"])
    if path.endswith("components/BashResult.tsx"):
        return ("Hien thi ket qua bash (Ink): boc ScreenContext/ExpandOutputContext, mo rong Ctrl+O, dung cho EventItem render output dai.", ["component", "cli", "ink", "bash", "hien-thi"])
    if path.endswith("components/EventItem.tsx"):
        return ("Dieu phoi render su kien agent (Ink): re sang BashResult/AIMessage/BackgroundComplete/Delegate/QA/System/ToolCall/UserMessage theo AgentEvent.", ["component", "cli", "ink", "su-kien", "dieu-phoi"])
    if path.endswith("components/ObjectiveList.tsx"):
        return ("Danh sach muc tieu OPPLAN (Ink): parseObjectives trich ObjectiveItem tu text va render kem STATUS_ICON/GLYPH_HOOK cua theme.", ["component", "cli", "ink", "opplan", "muc-tieu"])
    if path.endswith("components/OpplanStatus.tsx"):
        return ("Trang thai OPPLAN kieu task list (Ink): tom tat so objective hoan thanh/active/pending tu useOpplan, dinh dang theo theme.", ["component", "cli", "ink", "opplan", "trang-thai"])
    if path.endswith("components/Prompt.tsx"):
        return ("O nhap lieu REPL (Ink, 235 dong): TextInput kem goi y phim tat, tich hop registry lenh, useAgent/useSpinnerFrame/useTerminalSize va nhan agents/version.", ["component", "cli", "ink", "nhap-lieu", "repl"])
    if path.endswith("components/QuestionPicker.tsx"):
        return ("Chon cau hoi HITL (Ink): danh sach ActiveQuestion co the tim kiem, dieu huong phim mui ten, Enter chon, Escape huy.", ["component", "cli", "ink", "hitl", "chon-lua"])
    if path.endswith("components/SessionPicker.tsx"):
        return ("Chon phien resume kieu Claude Code (Ink): danh sach phien truoc co the tim kiem tu threadStore, hien thi formatTimeAgo.", ["component", "cli", "ink", "phien", "tiep-tuc"])
    if path.endswith("components/SpinnerIcon.tsx"):
        return ("Icon spinner (Ink): render frame xoay khi active tu useSpinnerFrame, dung trong prompt/activity.", ["component", "cli", "ink", "spinner", "giao-dien"])
    if path.endswith("components/TodoList.tsx"):
        return ("Danh sach viec (Ink): parseTodos trich TodoItem tu text va render kem TODO_ICON cua theme.", ["component", "cli", "ink", "viec-can-lam", "hien-thi"])
    if path.endswith("components/agents/AgentSessionGroup.tsx"):
        return ("Nhom phien sub-agent hybrid (Ink, 233 dong): che do prompt gon kieu Claude Code va transcript day du, gom SessionHeader/Footer voi capitalize/truncText.", ["component", "cli", "ink", "sub-agent", "phien"])
    if path.endswith("components/agents/CoordinatorPanel.tsx"):
        return ("Panel dieu phoi sub-agent (Ink): vung dong hien thi cac phien dang chay qua AgentSessionGroup theo dinh dang inline Claude Code.", ["component", "cli", "ink", "dieu-phoi", "sub-agent"])
    if path.endswith("components/messages/AIMessage.tsx"):
        return ("Tin nhan AI (Ink): render markdown qua renderMarkdown kem GLYPH_DOT cua theme.", ["component", "cli", "ink", "tin-nhan", "markdown"])
    if path.endswith("components/messages/BackgroundCompleteMessage.tsx"):
        return ("Thong bao nen hoan tat (Ink): hien thi lenh da xong kem GLYPH_DOT, dung trong EventItem.", ["component", "cli", "ink", "thong-bao", "nen"])
    if path.endswith("components/messages/DelegateMessage.tsx"):
        return ("Tin nhan uy thac sub-agent (Ink): che do prompt gon va transcript day du voi mo ta tac vu, dung ScreenContext/theme.", ["component", "cli", "ink", "uy-thac", "sub-agent"])
    # fallback dung exports + path
    tail = " ".join(exps[:5])
    if exps:
        return ("Mo-dun %s xuat %s, giu vai tro trong cum %s." % (base, tail, path.split("/")[0]), ["mo-dun", base.split(".")[0].lower(), "xuat-khau"])
    return ("Mo-dun %s thuoc nhom %s." % (base, path.split("/")[1] if "/" in path else "goc"), ["mo-dun", "thanh-phan", "ma-nguon"])

def func_summary(name, path, span, exported, params, src_snippet):
    low = name
    # test funcs
    if name.startswith("test_"):
        core = name[5:].replace("_", " ")
        return ("Kiem thu %s: %s." % (path.split("/")[-1], core), ["kiem-thu", "hoi-quy", path.split("/")[0].replace("_","-")])
    if name.startswith("Test"):
        return ("Lop kiem thu %s trong %s." % (name, path.split("/")[-1]), ["kiem-thu", "lop-kiem-thu"])
    # hooks
    if name.startswith("use"):
        what = path.split("/")[-1].replace(".ts","").replace(".tsx","")
        if name == "useRealGraph":
            return ("Hook tai GraphView/AssetsView theo project.id qua loadGraph/loadAssets, theo doi loading/error/unavailable (503) va refresh thu cong. Duoc export de trang Infrastructure dung truc tiep.", ["hook", "do-thi", "tai-du-lieu"])
        if name == "useRealLogs":
            return ("Hook tai timeline hop nhat qua loadTimeline, giu loading/error/unavailable va refresh; chi dung API that, khong sinh telemetry gia. Duoc export cho trang Operations Log.", ["hook", "nhat-ky", "tai-du-lieu"])
        if name == "useRealSettings":
            return ("Hook tai/luu/cai dat persisted view qua loadSettings/saveSettings roi reload, chi bao da luu sau ACK server. Duoc export cho trang Settings.", ["hook", "cai-dat", "luu-tru"])
        if name == "useRealProjects" or name == "useRealProject":
            return ("Hook doc snapshot du an real qua store useSyncExternalStore (list/detail), tu dong subscribe/unsubscribe. Duoc export cho Home/modal.", ["hook", "du-an", "store"])
        if name == "useAgentActivity":
            return ("Hook anh xa SubagentCustomEvent thanh nodes/edges do thi dung kieu @raptix/streaming, cap nhat live cho canvas. Duoc export cho dashboard.", ["hook", "sub-agent", "do-thi"])
        if name == "useAgents":
            return ("Hook tai cau hinh hien thi agent tu AGENTS registry bang state/effect. Duoc export cho dashboard.", ["hook", "agent", "tai-du-lieu"])
        if name == "useCanvasTransform":
            return ("Hook quan ly affine pan/zoom cho canvas SVG do thi agent, xu ly wheel/drag va scale dong nhat. Duoc export cho canvas.", ["hook", "canvas", "pan-zoom"])
        if name == "useForceSimulation":
            return ("Hook chay mo phong d3-force (day/lien ket/can giua/chong lan) de bo tri do thi agent theo graph/types. Duoc export cho canvas.", ["hook", "bo-cuc", "do-thi"])
        if name == "useRunObserver":
            return ("Hook quan sat run LangGraph thoi gian thuc qua @raptix/streaming, chuyen su kien thanh view truc tiep. Duoc export cho dashboard.", ["hook", "quan-sat", "streaming"])
        if name == "useNarrowViewport":
            return ("Hook phat hien viewport hep qua matchMedia (max-width 900px) de chuyen layout. Duoc export dung chung.", ["hook", "responsive", "viewport"])
        if name == "useMockProjects" or name == "useVisualProjects":
            return ("Hook store mock du an qua useSyncExternalStore tren fixture, dong bo localStorage va publish thay doi. Duoc export cho man hinh demo.", ["hook", "mock", "store"])
        if name == "useEngagementContext":
            return ("Hook doc EngagementContext (SubagentCustomEvent) tu Provider. Duoc export cho cay dashboard.", ["hook", "context", "engagement"])
        if name == "useConsoleSession":
            return ("Hook phien console: mo stream, giam su kien va hop nhat lich su thread. Duoc export cho RealConsole.", ["hook", "console", "stream"])
        return ("Hook %s quan ly state/tai du lieu cho %s, dong bo effect va tra snapshot cho component. %s" % (name, what, "Duoc export dung chung." if exported else "Ham noi bo cua mo-dun."), ["hook", "state", "react"])
    # components PascalCase
    if name[:1].isupper() and ("tsx" in path or name in ("App","WebTerminal","Dialog","Card")):
        if name == "RealMembers":
            return ("Component trang Members real: mot hang operator that, the invite/RBAC ghi ro ly do vang mat, khong dropdown gia. Duoc export lam trang.", ["component", "thanh-vien", "giao-dien"])
        if name == "RealLogs":
            return ("Component trang Operations Log real: header dem, bo loc, bang timeline va EntryModal chi tiet tu server. Duoc export lam trang.", ["component", "nhat-ky", "giao-dien"])
        if name == "EntryModal":
            return ("Modal chi tiet muc timeline trong RealLogs: hien thi provenance, thoi gian va thuoc tinh entry. Ham noi bo cua mo-dun.", ["component", "modal", "chi-tiet"])
        if name == "RealPlanning":
            return ("Component trang Planning real: tai PlanningView co kiem chung va render RoE/CONOPS/deconfliction/OPPLAN. Duoc export lam trang.", ["component", "lap-ke-hoach", "giao-dien"])
        if name == "RealReports":
            return ("Component trang Reports real tu DTO that, chi cho xuat JSON/Markdown kem attachment that. Duoc export lam trang.", ["component", "bao-cao", "giao-dien"])
        if name == "RealSettings":
            return ("Component trang Settings real: form truong persisted, luu PATCH co xac nhan va vung nguy hiem ghi ro pham vi. Duoc export lam trang.", ["component", "cai-dat", "giao-dien"])
        if name == "RealVault":
            return ("Component Ket sat real: metadata che mat dinh, reveal co canh bao mot lan, thu hoi audit. Duoc export lam trang.", ["component", "ket-sat", "giao-dien"])
        if name == "RealProjectsHome":
            return ("Component trang chu du an real: the/hang du an, huy hieu lifecycle, tim kiem/loc va tao moi. Duoc export lam trang.", ["component", "du-an", "trang-chu"])
        if name == "RealNewProjectModal":
            return ("Modal tao du an real voi validation draft, chon target type va bao loi truong. Duoc export dung chung.", ["component", "bieu-mau", "du-an"])
        if name == "ReportsTable":
            return ("Bang bao cao demo tu REPORT_FIXTURES voi avatar, style loai/trang thai va gioi han xuat. Duoc export lam bang.", ["component", "bang-du-lieu", "bao-cao"])
        if name == "ReportSectionView":
            return ("View mot section bao cao: render cac BlockView theo SectionBlock voi mau severity. Duoc export dung chung.", ["component", "bao-cao", "render"])
        if name == "WebTerminal":
            return ("Component terminal web nhuong quyen: nhung xterm.js, noi WebSocket server rieng spawn CLI, loc byte bang sanitizeTermBytes. Duoc export lam component.", ["component", "terminal", "websocket"])
        if name == "App":
            return ("Goc ung dung: re sang RealApp o che do real va VisualApp o che do mock. Duoc export lam entry.", ["entry-point", "dieu-huong", "react"])
        if name in ("Alert","AlertTitle","AlertDescription","AlertAction","Avatar","AvatarImage","AvatarFallback","AvatarBadge","AvatarGroup","AvatarGroupCount","Badge","Button","Card","CardHeader","CardTitle","CardDescription","CardAction","CardContent","CardFooter","Command","CommandDialog","CommandInput","CommandList","CommandEmpty","CommandGroup","CommandSeparator","CommandItem","CommandShortcut","Dialog","DialogTrigger","DialogPortal","DialogClose","DialogOverlay","DialogContent","DialogHeader","DialogFooter","DialogTitle","DialogDescription","DropdownMenu","DropdownMenuPortal","DropdownMenuTrigger","DropdownMenuContent","DropdownMenuGroup","DropdownMenuLabel","DropdownMenuItem","DropdownMenuCheckboxItem","DropdownMenuRadioGroup","DropdownMenuRadioItem","DropdownMenuSeparator","DropdownMenuShortcut","DropdownMenuSub","DropdownMenuSubTrigger","DropdownMenuSubContent","InputGroup","InputGroupAddon","InputGroupButton","InputGroupText","InputGroupInput","InputGroupTextarea","Input","Label","Popover","PopoverTrigger","PopoverContent","PopoverHeader","PopoverTitle","PopoverDescription","ScrollArea","ScrollBar","SelectGroup","SelectValue","SelectTrigger","SelectContent","SelectLabel","SelectItem","SelectSeparator","SelectScrollUpButton","SelectScrollDownButton","Separator","Sheet","SheetTrigger","SheetClose","SheetPortal","SheetOverlay","SheetContent","SheetHeader","SheetFooter","SheetTitle","SheetDescription","Skeleton","Table","TableHeader","TableBody","TableFooter","TableRow","TableHead","TableCell","TableCaption","Tabs","TabsList","TabsTrigger","TabsContent","Textarea","Tooltip","TooltipProvider","TooltipTrigger","TooltipContent"):
            return ("Thanh phan UI %s kieu shadcn tren Base UI, dung cn gop lop tailwind. Duoc export dung chung." % name, ["component", "ui-kit", "giao-dien"])
        if name in ("Charter","Findings","FindingModal","FindingDrawer","Home","ProjectCard","ListRow","Logs","LogModal","TerminalView","Members","AddMemberModal","ProjectSettings","Reports","VectorCampaigns","InfrastructureData","AssetsInventory","CredentialsVault","EnvironmentMap","AssetInspectModal","CredDetailModal"):
            return ("Man hinh/khoi demo %s: render tu fixture/types cuc bo, giu tuong tac demo (loc/modal/tab). Duoc export lam %s." % (name, "trang" if name in ("Charter","Findings","Home","Logs","Members","ProjectSettings","Reports","VectorCampaigns","InfrastructureData") else "khoi con"), ["component", "man-hinh", "demo"])
        if name in ("MarkdownMessageRenderer",):
            return ("Renderer markdown chat bang ReactMarkdown+remarkGfm theo MessageRenderer, de doi sang GenUI. Duoc export dung chung.", ["component", "chat", "markdown"])
        if name in ("EngagementProvider",):
            return ("Provider context engagement cung cap SubagentCustomEvent cho dashboard. Duoc export dung chung.", ["component", "context", "provider"])
        if name in ("ActivityIndicator","Banner","BashResult","EventItem","ObjectiveList","OpplanStatus","Prompt","QuestionPicker","SessionPicker","SpinnerIcon","TodoList","AgentSessionGroup","CoordinatorPanel","AIMessage","BackgroundCompleteMessage","DelegateMessage"):
            det = {"ActivityIndicator":"chi bao chay voi ShimmerText va elapsed/token","Banner":"banner ASCII chon theo do rong cot","BashResult":"ket qua bash co mo rong Ctrl+O","EventItem":"dieu phoi render theo AgentEvent","ObjectiveList":"danh sach muc tieu OPPLAN","OpplanStatus":"trom tat OPPLAN","Prompt":"o nhap REPL","QuestionPicker":"chon cau hoi HITL","SessionPicker":"chon phien resume","SpinnerIcon":"icon xoay","TodoList":"danh sach viec","AgentSessionGroup":"nhom phien sub-agent hybrid","CoordinatorPanel":"panel sub-agent dang chay","AIMessage":"tin AI render markdown","BackgroundCompleteMessage":"bao nen xong","DelegateMessage":"tin uy thac sub-agent"}.get(name, "khoi UI CLI")
            return ("Component CLI %s (Ink): %s. Duoc export dung chung." % (name, det), ["component", "cli", "ink"])
        return ("Component %s dung giao dien cho %s. %s" % (name, path.split("/")[-1], "Duoc export dung chung." if exported else "Khoi con noi bo."), ["component", "giao-dien", "react"])
    # api/helpers
    ln = name.lower()
    if name == "loadMembers":
        return ("Tai members view don nguoi dung qua GET co kiem chung isMembersView, nem ApiError khi sai envelope. Duoc export cho RealMembers.", ["api-client", "tai-du-lieu", "thanh-vien"])
    if name == "loadTimeline":
        return ("Tai timeline hop nhat co kiem chung contract, giu nhan source runtime/checkpoint/workspace. Duoc export cho useRealLogs.", ["api-client", "tai-du-lieu", "timeline"])
    if name == "filterTimeline" or name == "filterOptions" or name == "entrySearchText" or name == "timelineSummary" or name == "entryProvenance" or name == "formatEntryTime" or name == "distinctValues":
        m = {"filterTimeline":"Loc muc theo source/agent/tool/status/search","filterOptions":"Suy ra tuy chon loc tu payload voi 'all' dau","entrySearchText":"Ghep van ban tim kiem chu thuong tu label/kind/agent/tool/runId","timelineSummary":"Tom tat so muc va trang thai bounded","entryProvenance":"Giai thich nguon goc runtime/checkpoint/workspace","formatEntryTime":"Dinh dang ISO sang chuoi dia phuong","distinctValues":"Liet ke gia tri rieng co sap xep"}[name]
        return ("%s cho operations-log. %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["bo-loc" if "filter" in ln else "dinh-dang", "timeline", "thuan-tuy"])
    if name in ("slugify","buildExportFilename","buildReportJson","blockToMarkdown","buildReportMarkdown","exportReport"):
        m = {"slugify":"Chuan hoa ten thanh slug (rong thi 'report')","buildExportFilename":"Ghep ten file bao cao demo theo dinh dang","buildReportJson":"Dung payload JSON co watermark mock/notice va sections","blockToMarkdown":"Chuyen SectionBlock thanh Markdown theo kind","buildReportMarkdown":"Dung tai lieu Markdown co header DEMO EXPORT","exportReport":"Tai xuong bao cao qua Blob URL theo dinh dang"}[name]
        return ("%s. %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["xuat-ban", "bao-cao", "markdown" if "markdown" in ln else "json"])
    if name in ("loadSettings","saveSettings","deleteEngagement","engagementPath"):
        m = {"loadSettings":"Doc persisted settings view","saveSettings":"Luu PATCH tren route engagement","deleteEngagement":"Xoa engagement","engagementPath":"Ghep duong dan engagement"}[name]
        return ("%s qua API moi, caller tai lai view sau luu. %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["api-client", "cai-dat", "http"])
    if name in ("listVaultSecrets","createVaultSecret","revealVaultSecret","revokeVaultSecret"):
        m = {"listVaultSecrets":"Liet ke metadata da che","createVaultSecret":"Tao secret moi","revealVaultSecret":"Tiet lo plaintext mot lan","revokeVaultSecret":"Thu hoi secret co audit"}[name]
        return ("%s qua scoped vault endpoints. %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["api-client", "ket-sat", "bi-mat"])
    if name in ("loadGraph","loadAssets"):
        return ("Tai %s theo project.id qua API real co kiem chung contract. %s" % ("do thi" if "graph" in ln else "tai san", "Duoc export dung chung." if exported else "Ham noi bo."), ["api-client", "tai-du-lieu", "do-thi"])
    if name in ("createRealProjectsApi",):
        return ("Dung ProjectsApi real: CRUD qua proxy /api voi isProjectViewModel o bien, khong chuan hoa gia. Duoc export lam singleton realProjectsApi.", ["api-client", "du-an", "factory"])
    if name in ("assertProjectViewModel","assertProjectList"):
        return ("Khang dinh hinh DTO du an truoc khi dung, nem loi khi envelope sai. Ham noi bo kiem chung bien.", ["kiem-chung", "du-an", "contract"])
    if name in ("formatPublicCount","formatUpdatedAt","countByLifecycle","filterRealProjects","validateCreateProjectDraft","targetValueError","getProjectRunSummary"):
        m = {"formatPublicCount":"Dinh dang so dem cong khai","formatUpdatedAt":"Dinh dang thoi gian cap nhat","countByLifecycle":"Dem du an theo lifecycle","filterRealProjects":"Loc du an real theo tu khoa/lifecycle","validateCreateProjectDraft":"Kiem tra ban nhap tao (slug/target/authorization)","targetValueError":"Bao loi gia tri target","getProjectRunSummary":"Rut tom tat chay theo du an"}[name]
        return ("%s (thuan tuy, khong React/fetch). %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["helper", "du-an", "thuan-tuy"])
    if name in ("isKnownApiErrorCode","parseApiStatusError","encodePathSegment","joinApiPath","requestJson","fetchOnce","isAbortLike","classifyAbort"):
        m = {"isKnownApiErrorCode":"Kiem tra ma loi co trong API_ERROR_CODES","parseApiStatusError":"Chuyen envelope loi thanh ApiStatusError giu status goc","encodePathSegment":"Ma hoa doan path dong","joinApiPath":"Noi base URL voi path","requestJson":"Goi JSON co timeout + AbortSignal","fetchOnce":"Fetch mot lan co phan loai abort/timeout","isAbortLike":"Nhan dien loi huy","classifyAbort":"Phan loai huy route/timeout"}[name]
        return ("%s cho bien HTTP API moi. %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["http", "loi-api", "tien-ich"])
    if name in ("cn",):
        return ("Gop lop CSS bang clsx+tailwind-merge, dung boi moi ui-kit. Duoc export dung chung.", ["tien-ich", "css", "tailwind"])
    if name in ("getAgent","getAgentsByRole","buildAgentConfig","groupByKillChain"):
        m = {"getAgent":"Tra cau hinh agent theo id","getAgentsByRole":"Loc agent theo vai tro","buildAgentConfig":"Dung cau hinh hien thi co mac dinh","groupByKillChain":"Nhom agent theo kill-chain"}[name]
        return ("%s tu registry AGENTS (backend quyet dinh ton tai). %s" % (m, "Duoc export dung chung." if exported else "Ham noi bo."), ["agent", "registry", "tra-cuu"])
    if name in ("apiBase","listOrchestrators","formatList","getJson","flatten","isKnown","findCommand","getCommands","parseSlashCommand","fakeContext","url","formatElapsed","formatTokens","extractLogo","parseObjectives","parseTodos","formatTimeAgo","capitalize","truncText","isWaitingState","isProject","normalizeProject","initialProjects","publish","getProjectPersistenceError","createMockProject","updateMockProject","loadProjects","createVisualProject","createProjectReal","updateProjectReal","reloadProjects","reloadProject","reloadEntry","readListSnapshot","subscribe","seedAndRefresh","mutate","retain","release","startRead","ensureEntry","notify","detailKey","listEntry","detailEntry","getRunScenario","jsonResponse","projectDto","stubFetch","stubPendingFetch","flush","snapshot","run","event","view","project","isRecord"):
        ex = "Duoc export dung chung." if exported else "Ham noi bo cua mo-dun."
        if name.startswith("test_") or path.startswith("packages/raptix-core/tests") or "/tests/" in path or ".test." in path:
            return ("Helper kiem thu %s trong %s (%d dong). %s" % (name, path.split("/")[-1], span, ex), ["kiem-thu", "tro-giup", "hop-dong"])
        return ("Thuc hien nghiep vu `%s` (%d dong) trong %s. %s" % (name, span, path.split("/")[-1], ex), ["ham", path.split("/")[-1].split(".")[0].lower(), "exported" if exported else "noi-bo"])
    # python core generic
    if path.startswith("packages/raptix-core"):
        ex = "Duoc export de framework/plugin goi truc tiep." if exported else "Ham noi bo, chi phuc vu logic trong mo-dun."
        # verb-based
        clean = name.lstrip("_")
        parts = clean.split("_")
        verb = parts[0].lower() if parts else clean
        vmap = {"load":"Tai","resolve":"Phan giai","evaluate":"Danh gia","parse":"Phan tich","matches":"Khop","within":"Kiem tra pham vi","glob":"Khop glob","sensitive":"Kiem tra TLD nhay cam","network":"Dung pattern pham vi mang","configure":"Cau hinh logging","get":"Lay logger","project":"Xac dinh thu muc du an","normalize":"Chuan hoa gia tri bundle","config":"Doc bundle tu file cau hinh","enabled":"Tinh bundle duoc bat","is":"Kiem tra bundle co bat","looks":"Nhan dien doi tuong runtime","discover":"Quet entry-point phat hien plugin","strict":"Kiem tra che do strict","patch":"Va entry-point gia cho kiem thu","no":"Khang dinh khong va cham khi chua co plugin","single":"Kiem tra mot plugin cho mot thong tin","same":"Kiem tra va cham cung ten","technology":"Kiem tra tu vung Technology KG","detection":"Kiem tra tu vung Detection KG","two":"Kiem tra dedup cung san pham","distinct":"Kiem tra node khac category","bug":"Kiem tra wildcard subdomain long nhau","explicit":"Kiem tra exclusion thang wildcard","root":"Kiem tra rule root URL","path":"Kiem tra rule path khong mo rong","reset":"Dat lai registry an toan","baseline":"Kiem tra baseline khi chua co plugin","plugin":"Kiem tra dong gop plugin","additive":"Kiem tra tinh additive-only","middleware":"Kiem tra khai bao middleware tach biet","check":"Kiem tra gate tieu thu registry"}
        v = vmap.get(verb, None)
        if v:
            obj = " ".join(parts[1:]).replace("_"," ") if len(parts)>1 else "gia tri"
            return ("%s %s. %s" % (v, obj, ex), ["hop-dong" if "contract" in path or "registry" in path or "types" in path else "tien-ich", verb, "exported" if exported else "noi-bo"])
        return ("Thuc hien nghiep vu `%s` (%d dong) trong mo-dun %s. %s" % (name, span, path.split("/")[-1], ex), ["ham", "hop-dong", "exported" if exported else "noi-bo"])
    ex = "Duoc export dung chung." if exported else "Ham noi bo cua mo-dun."
    return ("Thuc hien nghiep vu `%s` (%d dong) trong %s. %s" % (name, span, path.split("/")[-1], ex), ["ham", "tien-ich", "exported" if exported else "noi-bo"])

def class_summary(name, path, methods, span, exported):
    if path.startswith("packages/raptix-core"):
        m = {
            "ToolContribution": ("Dong gop tool cho plugin: ten, factory va sieu du lieu dang ky entry-point.", ["dong-gop", "cong-cu", "plugin"]),
            "MiddlewareContribution": ("Dong gop middleware cho plugin: slot muc tieu va factory thay the slot chuan.", ["dong-gop", "middleware", "plugin"]),
            "PromptContribution": ("Dong gop prompt cho plugin: vai tro ap dung va noi dung tiem vao prompt.", ["dong-gop", "prompt", "plugin"]),
            "SubAgentContribution": ("Dong gop sub-agent cho plugin: mo ta, factory va cau hinh goi.", ["dong-gop", "sub-agent", "plugin"]),
            "SafetyDeclaration": ("Khai bao an toan cho plugin: ten tool/middleware safety-critical kieu additive-only.", ["khai-bao", "an-toan", "plugin"]),
            "MiddlewareSlot": ("Enum khe middleware theo thu tu lap rap, kem SLOTS_PER_ROLE cho tung role.", ["middleware-slots", "enum", "vai-tro"]),
            "PluginBundle": ("Goi dong gop plugin tong: gom tools/middleware/prompts/roles/subagents de factory nap mot lan.", ["plugin", "goi-dong-gop", "entry-point"]),
            "SubAgentSpec": ("Dac ta sub-agent: factory theo AgentProtocol, mo ta va cau hinh cha-con.", ["sub-agent", "dac-ta", "plugin"]),
            "AgentProtocol": ("Giao thuc agent toi thieu ma factory sub-agent tuan thu.", ["giao-thuc", "agent", "hop-dong"]),
            "BackendProtocol": ("Giao thuc backend filesystem khop CompositeBackend deepagents.", ["giao-thuc", "backend", "filesystem"]),
            "CallbackProtocol": ("Giao thuc callback khop BaseCallbackHandler langchain.", ["giao-thuc", "callback", "langchain"]),
            "LLMProtocol": ("Giao thuc LLM bound toi thieu ma LLMFactory tao ra.", ["giao-thuc", "llm", "mo-hinh"]),
            "MiddlewareProtocol": ("Giao thuc middleware khop middleware langchain.", ["giao-thuc", "middleware", "hop-dong"]),
            "SandboxProtocol": ("Giao thuc transport sandbox khop HTTPSandbox toi daemon FastAPI.", ["giao-thuc", "sandbox", "thuc-thi"]),
            "ToolProtocol": ("Giao thuc tool chap nhan @tool hoac class implement.", ["giao-thuc", "cong-cu", "langchain"]),
            "PluginConflictWarning": ("Canh bao xung dot dang ky cung khoa kem owner de audit.", ["canh-bao", "xung-dot", "plugin"]),
            "PluginInfo": ("Thong tin mot plugin phat hien: package, nhom, ten va dong gop.", ["thong-tin", "plugin", "registry"]),
            "PluginRegistry": ("Registry trung tam read-only: quet 8 nhom entry-point, chup nhanh va introspect role.", ["registry", "plugin", "introspection"]),
            "MiddlewareInfo": ("Thong tin middleware trong snapshot phan giai role dang frozen.", ["thong-tin", "middleware", "phan-giai"]),
            "ToolInfo": ("Thong tin tool trong snapshot phan giai role dang frozen.", ["thong-tin", "cong-cu", "phan-giai"]),
            "OverrideInfo": ("Thong tin ghi de trong snapshot phan giai role.", ["thong-tin", "ghi-de", "phan-giai"]),
            "RoleResolution": ("Snapshot phan giai role hashable de audit memoize theo run-id.", ["phan-giai", "role", "snapshot"]),
            "RoleSpec": ("Dac ta vai tro agent: ten, slot ap dung va mo ta.", ["dac-ta", "vai-tro", "registry"]),
            "RoleRegistry": ("Catalog vai tro: role OSS tu SLOTS_PER_ROLE va role plugin tu raptix.roles.", ["registry", "vai-tro", "plugin"]),
            "SafetyRegistry": ("Registry ten safety-critical gop baseline OSS voi plugin theo additive-only.", ["registry", "an-toan", "cong-don"]),
            "SkillSourceRegistry": ("Registry nguon skill: kiem tra /skills/<bundle>/ va phat hien trung.", ["registry", "ky-nang", "kiem-tra"]),
            "EngagementType": ("Enum loai engagement red-team.", ["enum", "engagement", "red-team"]),
            "ObjectivePhase": ("Enum giai doan objective theo kill-chain.", ["enum", "muc-tieu", "kill-chain"]),
            "OpsecLevel": ("Enum muc OPSEC tu loud den silent.", ["enum", "opsec", "red-team"]),
            "C2Tier": ("Enum tier C2 cho ha tang dieu khien.", ["enum", "c2", "ha-tang"]),
            "ObjectiveStatus": ("Enum trang thai objective.", ["enum", "trang-thai", "muc-tieu"]),
            "FindingSeverity": ("Enum do nghiem trong finding.", ["enum", "muc-do", "phat-hien"]),
            "FindingConfidence": ("Enum do tin cay finding.", ["enum", "tin-cay", "phat-hien"]),
            "RemediationPriority": ("Enum uu tien khac phuc.", ["enum", "uu-tien", "khac-phuc"]),
            "Evidence": ("Bang chung kem theo finding: loai, duong dan va hash.", ["bang-chung", "phat-hien", "du-lieu"]),
            "Finding": ("Phat hien red-team voi severity/confidence/evidence va attack path.", ["phat-hien", "du-lieu", "red-team"]),
            "AttackPathStep": ("Mot buoc trong duong tan cong.", ["buoc-tan-cong", "duong-tan-cong", "du-lieu"]),
            "AttackPath": ("Duong tan cong gom chuoi buoc co thu tu.", ["duong-tan-cong", "red-team", "du-lieu"]),
            "ScopeEntry": ("Muc pham vi engagement.", ["pham-vi", "engagement", "du-lieu"]),
            "EscalationContact": ("Lien he leo thang khi vuot pham vi.", ["lien-he", "leo-thang", "engagement"]),
            "RoE": ("Tai lieu RoE may doc kem machine_enforcement.", ["roe", "quy-tac", "engagement"]),
            "ThreatActor": ("Ho so tac nhan de doa cho CONOPS.", ["tac-nhan", "de-doa", "conops"]),
            "KillChainPhase": ("Enum giai doan kill-chain cho CONOPS.", ["enum", "kill-chain", "conops"]),
            "CONOPS": ("Ke hoach tac chien: threat model va giai doan.", ["conops", "ke-hoach", "red-team"]),
            "DeconflictionEntry": ("Muc giam xung dot (IP/UA/khung gio).", ["giam-xung-dot", "engagement", "du-lieu"]),
            "DeconflictionPlan": ("Ke hoach giam xung dot tong the.", ["giam-xung-dot", "ke-hoach", "engagement"]),
            "Objective": ("Muc tieu OPPLAN voi phase/opsec/mitre/phu thuoc/tieu chi nghiem thu.", ["muc-tieu", "opplan", "red-team"]),
            "OPPLAN": ("Ke hoach hanh dong gom objectives co thu tu phu thuoc.", ["opplan", "ke-hoach", "red-team"]),
            "ThreatTier": ("Enum tier de doa cho threat profile.", ["enum", "de-doa", "tier"]),
            "ThreatProfile": ("Ho so de doa voi tier va nang luc.", ["de-doa", "ho-so", "red-team"]),
            "CleanupArtifact": ("Vat the can don dep sau engagement.", ["don-dep", "engagement", "du-lieu"]),
            "CleanupPlan": ("Ke hoach don dep tong the.", ["don-dep", "ke-hoach", "engagement"]),
            "TriggerSeverity": ("Enum muc kich hoat abort.", ["enum", "kich-hoat", "abort"]),
            "AbortTrigger": ("Dieu kien kich hoat abort.", ["kich-hoat", "abort", "dieu-kien"]),
            "AbortPlan": ("Ke hoach abort voi trigger va lien he.", ["abort", "ke-hoach", "engagement"]),
            "Contact": ("Lien he engagement.", ["lien-he", "engagement", "du-lieu"]),
            "ContactPlan": ("Ke hoach lien lac tong the.", ["lien-lac", "ke-hoach", "engagement"]),
            "DataClass": ("Phan loai du lieu cho data handling.", ["phan-loai", "du-lieu", "engagement"]),
            "DataHandlingPlan": ("Ke hoach xu ly du lieu nhay cam.", ["xu-ly-du-lieu", "ke-hoach", "engagement"]),
            "EngagementBundle": ("Goi engagement day du: RoE/CONOPS/OPPLAN/findings/plans.", ["goi", "engagement", "red-team"]),
            "NodeKind": ("Enum loai node KG anh xa 1-1 sang label Neo4j.", ["enum", "node", "do-thi-tri-thuc"]),
            "EdgeKind": ("Enum loai canh KG anh xa sang relationship Neo4j UPPER_CASE.", ["enum", "canh", "do-thi-tri-thuc"]),
            "TechnologyCategory": ("Tu vung dong category cong nghe phat hien.", ["tu-vung", "cong-nghe", "do-thi-tri-thuc"]),
            "Severity": ("Enum muc do cho node KG.", ["enum", "muc-do", "do-thi-tri-thuc"]),
            "Node": ("Node do thi tan cong co kind/thuoc tinh.", ["node", "do-thi", "tan-cong"]),
            "Edge": ("Canh do thi co huong dan va thuoc tinh.", ["canh", "do-thi", "tan-cong"]),
            "KnowledgeGraph": ("Do thi tan cong trong bo nho ho tro truy van detection/technology in-memory.", ["do-thi-tri-thuc", "truy-van", "tan-cong"]),
            "Tier": ("Enum tier suc manh model HIGH/MID/LOW.", ["enum", "tier", "llm"]),
            "AuthMethod": ("Phuong thuc xac thuc cu the (api/oauth/local).", ["xac-thuc", "phuong-thuc", "llm"]),
            "ModelProfile": ("Ho so model theo tier va nha cung cap.", ["ho-so", "mo-hinh", "llm"]),
            "Credentials": ("Thong tin xac thuc da phan giai cho factory.", ["xac-thuc", "thong-tin", "llm"]),
            "ProxyConfig": ("Cau hinh proxy LiteLLM cho factory.", ["proxy", "cau-hinh", "llm"]),
            "ModelAssignment": ("Phan cong model cho role cu the.", ["phan-cong", "mo-hinh", "vai-tro"]),
            "LLMModelMapping": ("Anh xa role sang model kem fallback chain.", ["anh-xa", "mo-hinh", "fallback"]),
            "EnforcementMode": ("Enum che do cuong che RoE.", ["enum", "cuong-che", "roe"]),
            "ScopeRule": ("Quy tac pham vi don (target/type).", ["quy-tac", "pham-vi", "roe"]),
            "MachineEnforcement": ("Khoi machine_enforcement mo rong roe.json dieu khien guardrail.", ["cuong-che", "roe", "guardrail"]),
            "Decision": ("Quyet dinh PASS/WARN/REFUSE cua guardrail.", ["quyet-dinh", "roe", "guardrail"]),
            "LLMConfig": ("Cau hinh ha tang LLM (proxy/sandbox).", ["cau-hinh", "llm", "ha-tang"]),
            "RaptixConfig": ("Cau hinh tong Raptix tu env + mac dinh.", ["cau-hinh", "raptix", "bien-moi-truong"]),
        }
        if name in m:
            s, t = m[name]
            if exported and "exported" not in t and len(t) < 5:
                t = t + ["exported"]
            return (s, t)
        return ("Lop `%s` trong %s voi %d phuong thuc (%d dong). %s" % (name, path.split("/")[-1], len(methods), span, "Duoc export de framework/plugin dung." if exported else "Lop noi bo."), ["lop", "hop-dong", "exported" if exported else "noi-bo"])
    if name in ("ApiClientError","ApiStatusError","ApiTimeoutError","ApiCanceledError","ApiNetworkError","ApiInvalidResponseError"):
        mm = {"ApiClientError":"Loi client chung cho bien HTTP","ApiStatusError":"Loi giu status goc de nhanh 400/404/409","ApiTimeoutError":"Loi het thoi gian goi API","ApiCanceledError":"Loi huy bo (route cancel)","ApiNetworkError":"Loi mang khi goi API","ApiInvalidResponseError":"Loi payload sai envelope contract"}[name]
        return ("%s. Duoc export de lop http/api phan nhanh." % mm, ["loi", "api", "http"])
    if name in ("MarkdownMessageRenderer",):
        return ("Renderer markdown chat bang ReactMarkdown+remarkGfm theo MessageRenderer.", ["renderer", "chat", "markdown"])
    return ("Lop `%s` trong %s voi %d phuong thuc. %s" % (name, path.split("/")[-1], len(methods), "Duoc export dung chung." if exported else "Lop noi bo."), ["lop", "thanh-phan", "exported" if exported else "noi-bo"])

# ---------- main ----------
tot_nodes = 0
tot_edges = 0
for IDX in [11, 12, 13, 14, 15]:
    batch = [b for b in batches["batches"] if b.get("batchIndex") == IDX][0]
    batch_files = batch["files"]
    batch_import = batch.get("batchImportData", {})
    neighbor_map = batch.get("neighborMap", {})
    ext = json.load(open(UA / "tmp" / ("ua-file-extract-results-%d.json" % IDX), encoding="utf-8"))
    results = {r["path"]: r for r in ext.get("results", [])}
    # classes AST cho python (lay bases/methods chuan)
    classes_by_file = {}
    if IDX == 13:
        for f in batch_files:
            p = f["path"]
            if p.endswith(".py"):
                try:
                    tree = ast.parse((PR / p).read_text(encoding="utf-8"))
                    lst = []
                    for n in tree.body:
                        if isinstance(n, ast.ClassDef):
                            ms = [x.name for x in n.body if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))]
                            bases = []
                            for bse in n.bases:
                                if isinstance(bse, ast.Name): bases.append(bse.id)
                                elif isinstance(bse, ast.Attribute): bases.append(bse.attr)
                            lst.append({"name": n.name, "start": n.lineno, "end": n.end_lineno or n.lineno, "methods": ms, "bases": bases})
                    classes_by_file[p] = lst
                except Exception:
                    classes_by_file[p] = []
    # TS classes tu extract
    for p, r in results.items():
        if p not in classes_by_file:
            cl = []
            for c in r.get("classes", []) or []:
                cl.append({"name": c["name"], "start": c["startLine"], "end": c["endLine"], "methods": c.get("methods", []) or [], "bases": []})
            classes_by_file[p] = cl
    # inherits TS: regex extends/implements
    ts_bases = {}
    for f in batch_files:
        p = f["path"]
        if p.endswith(".ts") or p.endswith(".tsx"):
            try:
                src = (PR / p).read_text(encoding="utf-8", errors="replace")
                m = re.findall(r"class\s+(\w+)\s+extends\s+(\w+)", src)
                mi = re.findall(r"class\s+(\w+)\s+implements\s+([\w,\s]+)\{", src)
                ts_bases[p] = (m, mi)
            except Exception:
                ts_bases[p] = ([], [])

    nodes, edges = [], []
    seen = set()
    def add_node(n):
        assert n["id"] not in seen, "trung id " + n["id"]
        seen.add(n["id"])
        nodes.append(n)
    def add_edge(s, t, typ, w):
        if s == t: return
        edges.append({"source": s, "target": t, "type": typ, "direction": "forward", "weight": w})

    exports_by_file = {p: {e.get("name") for e in (results.get(p, {}).get("exports", []) or [])} for p in [f["path"] for f in batch_files]}
    funcs_by_file = {}
    for p, r in results.items():
        funcs_by_file[p] = {f["name"]: f for f in (r.get("functions", []) or [])}

    for f in batch_files:
        p = f["path"]
        r = results.get(p)
        src = (PR / p).read_text(encoding="utf-8", errors="replace")
        if r is None:
            # unreadable: khong tao stub, bao loi
            raise RuntimeError("thieu ket qua trich xuat cho %s" % p)
        non_empty = r.get("nonEmptyLines", f["sizeLines"])
        summ, tags = file_summary(p, src, r, batch_import.get(p, []))
        # dam bao 3-5 tags
        tags = list(dict.fromkeys([t.lower().replace("_", "-").replace(" ", "-") for t in tags]))
        while len(tags) < 3:
            tags.append("ma-nguon")
        tags = tags[:5]
        base = p.split("/")[-1]
        nd = {"id": "file:" + p, "type": "file", "name": base, "filePath": p, "summary": summ, "tags": tags, "complexity": cx_file(non_empty)}
        # languageNotes khi dang chu y
        if p.endswith("use-real-graph.ts"):
            nd["languageNotes"] = "Hook React dung AbortController + Promise.all de tai song song va tranh race khi unmount."
        if p.endswith("types/engagement.py"):
            nd["languageNotes"] = "File pydantic lon nhat batch (1081 dong): mo hinh quan doi cho planning hierarchy."
        if p.endswith("types/llm.py"):
            nd["languageNotes"] = "Ba truc trc giao nhau Tier/AuthMethod/Profile dieu khien resolve_chain da backend."
        if p.endswith("plugin_loader.py"):
            nd["languageNotes"] = "Entry-points + bundle cau hinh: diem mo rong khong sua OSS codebase."
        if p.endswith("web-terminal.tsx"):
            nd["languageNotes"] = "Client component nhuong quyen nhung xterm.js qua WebSocket rieng."
        add_node(nd)
        exported = exports_by_file.get(p, set())
        for fname, fi in (funcs_by_file.get(p, {}) or {}).items():
            sl, el = fi["startLine"], fi["endLine"]
            span = el - sl + 1
            is_exp = fname in exported
            # significance: 10+ dong hoac export
            if span < 10 and not is_exp:
                continue
            params = fi.get("params", [])
            snip = ""
            try:
                snip = "\n".join(src.splitlines()[max(0, sl-1):min(len(src.splitlines()), sl+4)])
            except Exception:
                snip = ""
            s2, t2 = func_summary(fname, p, span, is_exp, params, snip)
            t2 = list(dict.fromkeys([t.lower().replace("_", "-").replace(" ", "-") for t in t2]))[:5]
            while len(t2) < 3:
                t2.append("ham")
            add_node({"id": "function:%s:%s" % (p, fname), "type": "function", "name": fname, "filePath": p, "lineRange": [sl, el], "summary": s2, "tags": t2, "complexity": cx_span(span)})
            add_edge("file:" + p, "function:%s:%s" % (p, fname), "contains", 1.0)
            if is_exp:
                add_edge("file:" + p, "function:%s:%s" % (p, fname), "exports", 0.8)
        for c in classes_by_file.get(p, []):
            n = c["name"]
            sl, el = c["start"], c["end"]
            span = el - sl + 1
            ms = c.get("methods", [])
            is_exp = n in exported
            if len(ms) < 2 and span < 20 and not is_exp:
                continue
            s3, t3 = class_summary(n, p, ms, span, is_exp)
            t3 = list(dict.fromkeys([t.lower().replace("_", "-").replace(" ", "-") for t in t3]))[:5]
            while len(t3) < 3:
                t3.append("lop")
            add_node({"id": "class:%s:%s" % (p, n), "type": "class", "name": n, "filePath": p, "lineRange": [sl, el], "summary": s3, "tags": t3, "complexity": cx_span(span)})
            add_edge("file:" + p, "class:%s:%s" % (p, n), "contains", 1.0)
            if is_exp:
                add_edge("file:" + p, "class:%s:%s" % (p, n), "exports", 0.8)

    # imports 1:1
    for f in batch_files:
        p = f["path"]
        for dst in batch_import.get(p, []):
            add_edge("file:" + p, "file:" + dst, "imports", 0.7)

    # tested_by: production -> test
    for f in batch_files:
        p = f["path"]
        low = p.lower()
        is_test = ("/tests/" in p) or ("/test" in p) or (".test." in p) or ("test_" in low.split("/")[-1])
        if is_test:
            for dep in batch_import.get(p, []):
                add_edge("file:" + dep, "file:" + p, "tested_by", 0.5)

    # name/kind index
    name_kind = {}
    for f in batch_files:
        p = f["path"]
        d = {}
        for fn in funcs_by_file.get(p, {}):
            d[fn] = "function"
        for c in classes_by_file.get(p, []):
            d.setdefault(c["name"], "class")
        name_kind[p] = d
    neigh_sym = {}
    for fp, ns in (neighbor_map or {}).items():
        s = {}
        for n in ns or []:
            for sym in n.get("symbols") or []:
                s.setdefault(sym, n.get("path"))
        neigh_sym[fp] = s
    def dname(p):
        return p.rsplit("/", 1)[0] if "/" in p else ""
    for f in batch_files:
        p = f["path"]
        r = results.get(p, {})
        cg = r.get("callGraph") or []
        local_names = set(funcs_by_file.get(p, {})) | {c["name"] for c in classes_by_file.get(p, [])}
        imported = batch_import.get(p, [])
        srcdir = dname(p)
        for e in cg:
            caller, callee = e.get("caller"), e.get("callee")
            if not caller or not callee:
                continue
            if any(ch in callee for ch in "()[]\"' "):
                if "." in callee and "(" not in callee and " " not in callee:
                    sym = callee.rsplit(".", 1)[-1]
                    if not sym or (not sym[0].isalpha() and sym[0] != "_"):
                        continue
                else:
                    continue
            else:
                sym = callee.split(".")[-1].strip()
            if not sym:
                continue
            if caller not in funcs_by_file.get(p, {}):
                continue
            if sym == caller:
                continue
            tgt_fp, kind = None, None
            if sym in local_names:
                tgt_fp, kind = p, name_kind[p][sym]
            else:
                for cand in imported:
                    if cand in name_kind and sym in name_kind[cand]:
                        tgt_fp, kind = cand, name_kind[cand][sym]
                        break
                if tgt_fp is None and sym in neigh_sym.get(p, {}) and neigh_sym[p][sym] in imported:
                    tgt_fp = neigh_sym[p][sym]
                    kind = "class" if sym[:1].isupper() else "function"
                if tgt_fp is None:
                    cands = [(pp, nn) for pp in name_kind for nn in name_kind[pp] if nn == sym and dname(pp) == srcdir]
                    if len(cands) == 1:
                        tgt_fp = cands[0][0]
                        kind = name_kind[tgt_fp][sym]
                    else:
                        continue
            src_id = "function:%s:%s" % (p, caller)
            tgt_id = "%s:%s:%s" % (kind, tgt_fp, sym)
            if src_id in seen and tgt_id in seen:
                add_edge(src_id, tgt_id, "calls", 0.8)
    # inherits python + ts
    for p, cl in classes_by_file.items():
        for c in cl:
            src_id = "class:%s:%s" % (p, c["name"])
            for bse in c.get("bases", []):
                tgt = None
                if bse in name_kind.get(p, {}):
                    k = name_kind[p][bse]
                    tgt = "%s:%s:%s" % (k, p, bse)
                else:
                    for cand in batch_import.get(p, []):
                        if cand in name_kind and bse in name_kind[cand] and name_kind[cand][bse] == "class":
                            tgt = "class:%s:%s" % (cand, bse)
                            break
                if tgt and tgt in seen:
                    add_edge(src_id, tgt, "inherits", 0.9)
    for p, (exts_, impls) in (ts_bases or {}).items():
        for cls, base in exts_:
            src_id = "class:%s:%s" % (p, cls)
            # chi khi ca hai la node class
            tgt_cands = [nid for nid in seen if nid == "class:%s:%s" % (p, base)]
            if src_id in seen and tgt_cands:
                add_edge(src_id, tgt_cands[0], "inherits", 0.9)
        for cls, impl in impls:
            src_id = "class:%s:%s" % (p, cls)
            if src_id in seen:
                for bse in [x.strip() for x in impl.split(",") if x.strip()]:
                    tgt = "class:%s:%s" % (p, bse)
                    if tgt in seen:
                        add_edge(src_id, tgt, "implements", 0.9)

    # dedupe
    uniq = {}
    for e in edges:
        uniq[(e["source"], e["target"], e["type"])] = e
    edges = list(uniq.values())
    out = {"batchIndex": IDX, "batchFiles": [{"path": f["path"], "language": f["language"], "sizeLines": f["sizeLines"], "fileCategory": f["fileCategory"]} for f in batch_files], "nodes": nodes, "edges": edges}
    op = UA / "intermediate" / ("batch-%d.json" % IDX)
    op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    # validate
    json.load(open(op, encoding="utf-8"))
    valid = ("file:", "function:", "class:", "config:", "document:", "service:", "pipeline:", "resource:", "table:", "schema:", "endpoint:")
    bad = [n["id"] for n in nodes if not n["id"].startswith(valid)]
    assert not bad, bad[:3]
    assert all(n.get("summary") and n.get("tags") for n in nodes)
    # imports 1:1 (tru self-loop vi cam self edge)
    exp_imp = sum(1 for f in batch_files for dst in batch_import.get(f["path"], []) if dst != f["path"])
    got_imp = sum(1 for e in edges if e["type"] == "imports")
    assert exp_imp == got_imp, (IDX, exp_imp, got_imp)
    ids = {n["id"] for n in nodes}
    dang = [e for e in edges if e["type"] in ("contains","exports","calls","inherits","implements","tested_by") and (e["source"] not in ids or e["target"] not in ids)]
    # tested_by target/source la file co the ngoai batch (imported file khong trong batch) -> loai bo dangling
    dang2 = [e for e in dang if e["type"] != "tested_by"]
    # voi tested_by, chi giu khi ca hai dau deu la file trong batch hoac file node da co; neu target ngoai batch thi bo
    edges2 = [e for e in edges if not (e["type"]=="tested_by" and (e["source"] not in ids or e["target"] not in ids))]
    if len(edges2) != len(edges):
        out["edges"] = edges2
        op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        edges = edges2
    print("batch-%d nodes=%d edges=%d files=%d" % (IDX, len(nodes), len(edges), len(batch_files)))
    print("  node types:", dict(collections.Counter(n["type"] for n in nodes)))
    print("  edge types:", dict(collections.Counter(e["type"] for e in edges)))
    tot_nodes += len(nodes)
    tot_edges += len(edges)
print("TOTAL nodes=%d edges=%d" % (tot_nodes, tot_edges))
