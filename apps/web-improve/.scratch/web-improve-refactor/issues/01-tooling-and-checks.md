# 01: App-local tooling and verification commands

**What to build:** Isolated dependency/configuration preparation: install the agreed router, state, Query and form packages plus Vitest/RTL/user-event/jsdom and lint tooling; expose app-local npm verification scripts. Domain and UI changes follow in other tickets.
**Blocked by:** None (after execution prerequisites).
**Status:** ready-for-agent
**Owner:** Toolchain, manifests and lockfile.
**Contract:** [execution.md](../execution.md).

- [ ] Node/Vite compatibility verified; app-local npm lockfile is authoritative and the conflicting pnpm lockfile is retired deliberately.
- [ ] Typecheck, lint, build and non-watch test commands exist; test configuration can run without loading Figma preview plugins.
- [ ] Existing diagnostics are recorded with owning migration tickets; the tooling introduces no new diagnostics and does not suppress rules to obtain green.
- [ ] A runner smoke check passes; dependency justification and supply-chain review requirements are recorded separately from feature work.
