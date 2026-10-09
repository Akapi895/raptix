import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const input = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-input-101.json`, 'utf8'));
const out = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-output-101.json`, 'utf8'));
const lineCount = (p) => {
  const r = out.results.find((x) => x.path === p);
  return r ? r.totalLines : input.batchFiles.find((f) => f.path === p).sizeLines;
};
const L = (p) => [1, lineCount(p)];

const nodes = [];
const edges = [];

// ── scripts/init-web-db.sql → table node (theo convention batch-85 cho SQL init script)
nodes.push({
  id: 'table:scripts/init-web-db.sql:raptix_web',
  type: 'table',
  name: 'raptix_web',
  filePath: 'scripts/init-web-db.sql',
  lineRange: [1, 4],
  summary: 'Script SQL bootstrap tạo database raptix_web cho Web dashboard, chạy tự động qua /docker-entrypoint-initdb.d ở lần khởi động Postgres đầu tiên: SELECT ... WHERE NOT EXISTS ... \\gexec để idempotent (chỉ tạo khi chưa có), OWNER là role raptix — bản standalone trong scripts/ song song với containers/postgres-init/01-create-web-db.sql.',
  tags: ['database', 'postgres', 'bootstrap', 'web', 'idempotent'],
  complexity: 'simple',
});
edges.push({ source: 'table:scripts/init-web-db.sql:raptix_web', target: 'table:containers/postgres-init/01-create-web-db.sql:raptix_web', type: 'related', direction: 'forward', weight: 0.5 });

// ── scripts/install.ps1
const psPath = 'scripts/install.ps1';
nodes.push({
  id: `file:${psPath}`,
  type: 'file',
  name: 'install.ps1',
  filePath: psPath,
  lineRange: L(psPath),
  summary: 'Installer Windows (PowerShell 5.1+, chạy cả PS7) là bản đối ứng của scripts/install.sh, chạy qua irm https://decepticon.red/install.ps1 | iex: preflight kiểm tra Docker + Compose v2, dò kiến trúc AMD64/ARM64 qua PROCESSOR_ARCHITECTURE, resolve version từ GitHub releases (env RAPTIX_VERSION), tải về install dir %USERPROFILE%\\.raptix 4 file config (docker-compose.yml, docker-compose.web-raptix.yml, .env.example, config/litellm.yaml) pin theo release tag, verify SHA-256 từng file chống manifest config-checksums.txt của release, tải launcher binary raptix-windows-<arch>.exe + verify chống checksums.txt GoReleaser, thêm bin dir vào PATH user scope (SetEnvironmentVariable), và docker compose --profile cli pull (SKIP_PULL=true để bỏ qua; RAPTIX_SKIP_VERIFY=1 là opt-out verify duy nhất).',
  tags: ['installer', 'windows', 'powershell', 'supply-chain', 'checksum-verification'],
  complexity: 'complex',
  languageNotes: 'Set-StrictMode -Version Latest + $ErrorActionPreference=Stop; usage: irm https://decepticon.red/install.ps1 | iex; env: RAPTIX_VERSION, RAPTIX_HOME, SKIP_PULL, RAPTIX_SKIP_VERIFY.',
});
const psFuncs = [
  ['Invoke-Preflight', 33, 52, 'Preflight Windows: chặn cài đặt khi thiếu Docker, daemon chưa chạy, hoặc thiếu Compose v2 (bundle cùng Docker Desktop) — exit 1 kèm link hướng dẫn cài Docker Desktop.', ['preflight', 'docker', 'validation'], 'simple'],
  ['Resolve-Version', 66, 78, 'Resolve version cài đặt: trả env RAPTIX_VERSION nếu set, ngược lại gọi GitHub API releases/latest (User-Agent raptix-installer) và strip tiền tố v; khi API lỗi thì exit 1 yêu cầu set RAPTIX_VERSION tay.', ['versioning', 'github-api', 'release'], 'simple'],
  ['Assert-Sha256', 83, 100, 'Kiểm tra tính toàn vẹn SHA-256 một file đã tải: thiếu checksum trong manifest thì exit 1 (trừ khi RAPTIX_SKIP_VERIFY=1), mismatch được coi là tampering hoặc download dở — so Get-FileHash thực tế với expected rồi abort.', ['checksum', 'sha256', 'supply-chain', 'integrity'], 'moderate'],
  ['Main', 103, 222, 'Luồng chính installer Windows: preflight → resolve version/arch → tạo install dir + config/ + workspace/ → stage 4 config file pin theo tag v<version> → verify từng dòng manifest config-checksums.txt (bắt buộc có docker-compose.web-raptix.yml) → move vào chỗ + ghi .version → tải launcher raptix-windows-<arch>.exe + verify chống checksums.txt → set PATH user scope (nếu chưa có) → docker compose --profile cli pull với RAPTIX_VERSION/HOME inject, rồi in next steps (raptix onboard, raptix).', ['installer', 'main-flow', 'supply-chain'], 'complex'],
];
for (const [name, s, e, sum, tags, cx] of psFuncs) {
  nodes.push({ id: `function:${psPath}:${name}`, type: 'function', name, filePath: psPath, lineRange: [s, e], summary: sum, tags, complexity: cx });
  edges.push({ source: `file:${psPath}`, target: `function:${psPath}:${name}`, type: 'contains', direction: 'forward', weight: 1 });
}
edges.push({ source: `function:${psPath}:Main`, target: `function:${psPath}:Invoke-Preflight`, type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: `function:${psPath}:Main`, target: `function:${psPath}:Resolve-Version`, type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: `function:${psPath}:Main`, target: `function:${psPath}:Assert-Sha256`, type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: `file:${psPath}`, target: 'file:scripts/install.sh', type: 'related', direction: 'forward', weight: 0.5 });
edges.push({ source: `file:${psPath}`, target: 'service:docker-compose.yml', type: 'depends_on', direction: 'forward', weight: 0.6 });
edges.push({ source: `file:${psPath}`, target: 'config:.env.example', type: 'related', direction: 'forward', weight: 0.5 });

// ── scripts/install.sh
const shPath = 'scripts/install.sh';
nodes.push({
  id: `file:${shPath}`,
  type: 'file',
  name: 'install.sh',
  filePath: shPath,
  lineRange: L(shPath),
  summary: 'One-line installer POSIX (curl -fsSL https://decepticon.red/install | bash) cho Linux/macOS, mô hình soak kiểu Claude-Code: channel stable (mặc định, chỉ nhận final release đã "soak" >= RAPTIX_STABLE_SOAK_DAYS=7 ngày) hoặc latest, mọi giá trị lạ fail về stable; preflight kiểm tra curl + runtime Docker/Podman 4.4+ (override RAPTIX_CONTAINER_RUNTIME) + Compose v2 + sha256sum/shasum; tải 4 config file pin theo release tag và verify chống config-checksums.txt (chặn vector hoán đổi docker-compose.yml qua raw CDN), tải launcher Go binary raptix-<os>-<arch> + verify chống checksums.txt GoReleaser (check giá trị nhất cho entry-point của user), setup PATH cho bash/zsh/fish + GitHub Actions GITHUB_PATH, cảnh báo launcher raptix stale (npm link cũ) shadow PATH, pull Docker images (SKIP_PULL=true bỏ qua), và nhắc exec $SHELL / hash -r sau cài; .env hiện có được giữ nguyên chỉ bổ sung RAPTIX_HOME + RAPTIX_CHANNEL, không tự sinh .env để wizard onboard vẫn chạy.',
  tags: ['installer', 'supply-chain', 'checksum-verification', 'docker', 'release-channel'],
  complexity: 'complex',
  languageNotes: 'set -euo pipefail; usage: VERSION=<x.y.z> curl -fsSL https://decepticon.red/install | bash; env: CHANNEL, RAPTIX_STABLE_SOAK_DAYS, VERSION, RAPTIX_HOME, SKIP_PULL, RAPTIX_SKIP_VERIFY.',
});
const shFuncs = [
  ['preflight', 59, 116, 'Preflight POSIX: bắt buộc curl; auto-detect runtime docker/podman (hoặc RAPTIX_CONTAINER_RUNTIME tường minh, ví dụ nerdctl) phải chạy được docker/podman info; với docker yêu cầu Compose v2, với podman yêu cầu "podman compose" (4.4+) hoặc podman-compose; và phải có sha256sum (Linux) hoặc shasum -a 256 (macOS) cho verify.', ['preflight', 'docker', 'podman', 'validation'], 'moderate'],
  ['assert_sha256', 129, 148, 'Verify một file chống expected hash: thiếu record trong manifest → exit 1 trừ khi RAPTIX_SKIP_VERIFY=1 (in cảnh báo opt-out), mismatch → error "possible tampering or partial download" kèm expected/got rồi abort; dùng sha256_of tùy sha256sum/shasum.', ['checksum', 'sha256', 'integrity'], 'simple'],
  ['resolve_stable_soaked', 154, 191, 'Chọn stable version: gọi GitHub API releases?per_page=30, nhúng script python3 lọc bỏ draft/prerelease, bỏ release published chưa đủ soak*86400 giây, trả tag mới nhất theo numeric tuple; thiếu python3 hoặc không release nào qualify thì in rỗng để caller fallback /releases/latest.', ['versioning', 'release-channel', 'github-api'], 'moderate'],
  ['resolve_version', 193, 222, 'Phân giải version cài: VERSION env thắng tất cả; channel stable đi qua resolve_stable_soaked, rỗng (hoặc channel latest) thì fallback releases/latest; hoàn toàn không có release thì dùng image tag :<channel>; có tag thật thì pin RAW_BASE về raw.githubusercontent.com/<repo>/v<version> để config không trôi theo main.', ['versioning', 'release-channel', 'github-api', 'fallback'], 'moderate'],
  ['download_files', 225, 282, 'Tải 4 file config vào .config-stage: docker-compose.yml + docker-compose.web-raptix.yml (luôn overwrite), .env.example (chỉ template — không tự sinh .env vì wizard onboard dò sự tồn tại của file để quyết định chạy), config/litellm.yaml; với .env sẵn có chỉ bổ sung RAPTIX_HOME + ghi RAPTIX_CHANNEL nếu chưa có (lựa chọn cũ của user thắng); tạo workspace/ bind-mount, verify_config_manifest rồi mới move các file vào install dir và ghi marker .version.', ['installer', 'config', 'supply-chain'], 'complex'],
  ['verify_config_manifest', 288, 329, 'Verify toàn bộ config đã ghi chống config-checksums.txt tải từ release v<version> (sha256sum format "<hex>  <path>"): không có release tag → bỏ qua có cảnh báo; tải manifest thất bại → từ chối cài (release <1.0.27) trừ khi RAPTIX_SKIP_VERIFY=1; bắt buộc manifest phải cover docker-compose.web-raptix.yml; thiếu file được manifest liệt kê là hard error — chặn vector hoán đổi raw download bằng cross-check qua GitHub Releases.', ['checksum', 'supply-chain', 'manifest'], 'moderate'],
  ['create_launcher', 332, 377, 'Tải launcher Go binary raptix-<os>-<arch> (uname -s/-m, chuẩn hoá x86_64→amd64, aarch64/arm64→arm64) từ release tag vào ~/.local/bin/raptix, từ chối cài khi version chưa resolve được (latest/stable), và chmod 755; verify_launcher_binary chạy ngay sau tải — integrity của launcher là check giá trị nhất vì nó là entry-point session của user.', ['installer', 'launcher', 'binary'], 'moderate'],
  ['verify_launcher_binary', 381, 399, 'Tải checksums.txt GoReleaser của release, awk tách dòng của binary_name để lấy expected hash rồi assert_sha256; thiếu checksums.txt (release <1.0.27) → từ chối trừ khi RAPTIX_SKIP_VERIFY=1.', ['checksum', 'goreleaser', 'supply-chain'], 'simple'],
  ['detect_stale_launcher', 406, 430, 'Quét PATH (dedupe) tìm executable "raptix" ngoài bin_dir vừa cài — tàn dư npm link/symlink/package manager khác sẽ shadow launcher mới và sinh lỗi khó hiểu (node MODULE_NOT_FOUND); cảnh báo kèm hướng dẫn remove + hash -r.', ['path', 'diagnostics', 'conflict-detection'], 'simple'],
  ['setup_path', 433, 490, 'Thêm bin_dir vào PATH theo shell: đã có thì bỏ qua; GitHub Actions ghi vào $GITHUB_PATH; fish thêm fish_add_path vào config.fish, zsh thêm export vào ~/.zshrc (honor ZDOTDIR), bash/khác thêm vào ~/.bashrc (fallback ~/.profile) — idempotent nhờ grep -q trước khi append.', ['path', 'shell', 'fish', 'zsh', 'bash'], 'moderate'],
  ['pull_images', 493, 513, 'docker compose --profile cli pull trong install dir với RAPTIX_VERSION + RAPTIX_HOME inject tường minh (chưa --env-file vì .env chưa tồn tại, mọi ${VAR} trong compose có :-defaults); SKIP_PULL=true bỏ qua; pull hỏng chỉ warn và chỉ dẫn "raptix update" sau.', ['docker', 'compose', 'images'], 'simple'],
  ['main', 516, 582, 'Điều phối installer: RAPTIX_HOME mặc định ~/.raptix + bin_dir ~/.local/bin → preflight → resolve_version → mkdir → download_files → create_launcher → setup_path → detect_stale_launcher (chạy sau PATH setup để bin_dir là chuẩn "launcher mới") → pull_images → banner hoàn tất kèm 2 bước next (raptix onboard, raptix) và hint exec $SHELL + hash -r giải cả hai failure-mode của shell mới/cũ.', ['main-flow', 'installer', 'orchestration'], 'moderate'],
];
for (const [name, s, e, sum, tags, cx] of shFuncs) {
  nodes.push({ id: `function:${shPath}:${name}`, type: 'function', name, filePath: shPath, lineRange: [s, e], summary: sum, tags, complexity: cx });
  edges.push({ source: `file:${shPath}`, target: `function:${shPath}:${name}`, type: 'contains', direction: 'forward', weight: 1 });
}
const shCalls = [
  ['main', 'preflight'], ['main', 'resolve_version'], ['main', 'download_files'], ['main', 'create_launcher'],
  ['main', 'setup_path'], ['main', 'detect_stale_launcher'], ['main', 'pull_images'],
  ['resolve_version', 'resolve_stable_soaked'], ['download_files', 'verify_config_manifest'],
  ['verify_config_manifest', 'assert_sha256'], ['create_launcher', 'verify_launcher_binary'],
  ['verify_launcher_binary', 'assert_sha256'],
];
for (const [a, b] of shCalls) edges.push({ source: `function:${shPath}:${a}`, target: `function:${shPath}:${b}`, type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: `file:${shPath}`, target: 'service:docker-compose.yml', type: 'depends_on', direction: 'forward', weight: 0.6 });
edges.push({ source: `file:${shPath}`, target: 'config:.env.example', type: 'related', direction: 'forward', weight: 0.5 });

// ── scripts/web-hotswap.sh
const hsPath = 'scripts/web-hotswap.sh';
nodes.push({
  id: `file:${hsPath}`,
  type: 'file',
  name: 'web-hotswap.sh',
  filePath: hsPath,
  lineRange: L(hsPath),
  summary: 'Hot-swap web dashboard vào container raptix-web đang chạy mà không ngắt WebSocket operator (~25s có build, ~5s inject-only): build Next.js trên host (prisma generate với DATABASE_URL mặc định postgresql://raptix:raptix@localhost:5432/raptix_web + npm run build), rm .next cũ trong container (docker exec -u 0), bơm standalone .next + .next/static qua tar pipe và docker cp terminal-server.ts + server.js, chown nextjs:nodejs, rồi reload — mặc định gửi SIGUSR1 cho PID 1 (entrypoint supervisor restart riêng Next.js, terminal server sống) với fallback docker restart, --full thì restart container + chờ health; --skip-build chỉ inject build cuối; kết thúc bằng curl kiểm tra HTTP 200 trên :3000, exit 1 kèm chỉ dẫn docker logs nếu khác.',
  tags: ['hotswap', 'nextjs', 'docker', 'developer-experience', 'zero-downtime'],
  complexity: 'moderate',
  languageNotes: 'set -euo pipefail; usage: ./scripts/web-hotswap.sh [--skip-build|--full]; ghép cặp với SIGUSR1 handler restart_next trong containers/web-entrypoint.sh.',
});
edges.push({ source: `file:${hsPath}`, target: 'service:docker-compose.yml', type: 'related', direction: 'forward', weight: 0.5 });
edges.push({ source: `file:${hsPath}`, target: 'config:clients/web/package.json', type: 'depends_on', direction: 'forward', weight: 0.6 });
edges.push({ source: `file:${hsPath}`, target: 'file:clients/web/server/terminal-server.ts', type: 'depends_on', direction: 'forward', weight: 0.6 });

// ── assemble
const batch = {
  batchIndex: 101,
  batchFiles: input.batchFiles.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
  nodes,
  edges,
};
writeFileSync(`${UA}/intermediate/batch-101.json`, JSON.stringify(batch, null, 1), 'utf-8');
console.log(`batch-101.json: nodes=${nodes.length} edges=${edges.length}`);
