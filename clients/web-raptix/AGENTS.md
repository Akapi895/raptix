# @raptix/web-raptix

Frontend visual preview — React 19 + Vite 8 + Tailwind CSS 4, npm workspaces.

## Current user correction (supersedes the earlier single-user scope)

- Canonical visual baseline is now the copied `web-raptix` screens. The original `web-correct` folder may have been removed; do not require it.
- Sidebar has exactly 13 entries: Charter & ROE, Scope & Boundary; Operator Console, Vector Campaigns, C2 & Sessions; Infrastructure & Data, Assets & Inventory, Credentials Vault; Findings & Evidence, Operations Log, Reports; Members, Settings.
- Members/Vault/Campaigns/C2 ARE active frontend-demo pages. Do not apply older backend capability gating to these visual pages.
- Overview, Root Agent, Graphs and separate Evidence screens are not mounted. Home is project entry; workspace starts at Charter. New Chat opens Operator Console.
- Preserve the 13-page visual baseline. Current task is phase-by-phase independent backend integration following `summary/impl-guide-web-raptix-integration.md`; real mode must use verified new-server contracts, mock mode retains demo behavior.
- Do not start a later WP until HEAD verifies the current phase gate. Legacy `clients/web` is reference only; new code ownership is `web-raptix/server` with separate browser/server builds and no legacy upstream/imports.

## Development

```bash
npm install                      # từ repo root
npm run dev --workspace=@raptix/web-raptix
```

Frontend standalone mock mode không cần backend/database/Docker. Dev server `127.0.0.1:5273`.

## Gates bắt buộc trước khi kết thúc thay đổi

```bash
npm run typecheck --workspace=@raptix/web-raptix
npm run lint      --workspace=@raptix/web-raptix
npm run build     --workspace=@raptix/web-raptix
npm run test      --workspace=@raptix/web-raptix
npm run test:e2e  --workspace=@raptix/web-raptix
```

`build` đã chain typecheck; không dùng `vite build` một mình làm bằng chứng type correctness.

## Quy ước

- Node >= 22.12; **npm only** — không pnpm (lockfile cũ đã bị xóa).
- Alias `@` → `src/` (ESM-compatible trong `vite.config.ts`).
- Không import Prisma/`fs`/server modules vào browser code.
- Production build **không đọc** `.figma/` — Figma preview tooling tách biệt.
- Design references và docs khảo sát nằm ở `docs/`; fixtures/repositories nằm ở `src/mocks/`, `src/types.ts` chỉ chứa contracts.
- Routes dùng `src/app/router.ts`; selected project và đúng 13 page ids lấy từ URL. Detail modals giữ local UI state như source. Fixtures thuộc mock mode; real mode unavailable, không được fallback silently.
- Source screens keep local frontend demo interactions. Earlier shared-runtime-store and deferred-screen decisions are historical and do not override the corrected visual scope above.

## Project structure

- `src/main.tsx` — entrypoint, import `index.css`, mount `App`.
- `src/App.tsx` — lazy feature composition, URL-scoped workspace shell and dialogs.
- `src/features/` / `src/shared/` / `src/mocks/` — feature models/components, shared UI and explicit mock data.
- `tests/` — Vitest model regressions, Playwright production-preview flows and real-mode guard.
- `src/index.css` — Tailwind 4 entry + theme tokens.
- `vite.config.ts` — standalone config (react + tailwind + alias, không Figma plugins).
- `tsconfig.json` / `tsconfig.node.json` / `tsconfig.tests.json` — app / tooling / test typecheck.
