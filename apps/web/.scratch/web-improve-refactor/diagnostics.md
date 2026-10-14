# Baseline diagnostics â€” apps/web-improve

Recorded by ticket [01](issues/01-tooling-and-checks.md) from the pre-tooling baseline
(integration tip `bae3e2c`). Source of truth: `npm run lint` on the unmodified export,
except the two `vite.config.ts` findings noted below, which ticket 01 fixed directly.
TypeScript baseline (`tsc --noEmit`): **0 diagnostics**, before and after tooling.

## Totals

| Rule | Count |
|---|---|
| `react-refresh/only-export-components` | 158 |
| `@typescript-eslint/no-explicit-any` | 36 |
| `@typescript-eslint/no-unused-vars` | 27 |
| `react-hooks/exhaustive-deps` | 4 (2 real dep warnings, 2 unused eslint-disable directives) |
| `react-hooks/rules-of-hooks` | 1 |
| **Total** | **226 warnings, 0 errors** |

## Severity policy (ratchet)

- The lint gate enforces **0 errors**. The findings below are pre-existing in the
  Figma export, so the five affected rules ship as `warn` to keep the baseline
  green without disabling or suppressing anything. Every finding stays visible on
  each `npm run lint` run and is inventoried here.
- Zero **new** findings are allowed (execution.md). An owning ticket must clear all
  warnings in the files it migrates and re-promote the affected rules to `'error'`
  in `eslint.config.js` once its files are clean. Do not lower other rules.
- `react-hooks/rules-of-hooks` at `b-detail.tsx:485` is a real conditional-hook
  hazard, not style debt: fixing it is correctness work owned by ticket 20 and
  should be its first change.
- The two "unused eslint-disable directive" warnings (`a-dashboard.tsx:34:41`,
  `ai-copilot.tsx:33:105`) mean stale `eslint-disable` comments exist; the owning
  screens tickets may delete those comments when they touch the files.

## Ownership (best-effort by screen domain; refine when each ticket starts)

| File | Owning ticket(s) |
|---|---|
| `src/store.tsx` | 05 (shared stores) |
| `src/ui.tsx` | 09 (primitives split across 09â€“12) |
| `src/shell.tsx` | 08 |
| `src/screens/a-dashboard.tsx` | 14 |
| `src/screens/b.tsx`, `b-detail.tsx`, `b-detail2.tsx` | 16 / 20 / 23 (projects) |
| `src/screens/c.tsx`, `c-common.tsx`, `c-console.tsx`, `c-results.tsx` | 24 / 27 / 29 / 30 (operations) |
| `src/screens/d-agents.tsx` | 48 |
| `src/screens/d-assets.tsx` | 50 |
| `src/screens/d-library.tsx` | 52 |
| `src/screens/d-shared.tsx` | 48â€“53 (shared agent/asset/library parts) |
| `src/screens/e-analysis.tsx` | 54 |
| `src/screens/e-findings.tsx` | 31 |
| `src/screens/f-report.tsx`, `f.tsx` | 34 / 34â€“37 (reports) |
| `src/screens/g-workspace.tsx`, `g-common.tsx`, `g-plan.tsx`, `g-fanout.tsx` | 38 / 38â€“44 / 39 / 43 (AI) |
| `src/screens/h.tsx`, `h-session.tsx` | 45 / 46â€“47 (C2) |
| `src/screens/ai-copilot.tsx` | 60 |
| `src/screens/demo-guide.tsx`, `scenarios.tsx` | 61 |
| `vite.config.ts` | 01 â€” the 2 `no-explicit-any` findings were fixed by ticket 01 (type-only change); none remain |

## Dependency justification (ticket 01)

Runtime: `react-router` v7 (routing), `zustand` (cross-cutting UI stores),
`@tanstack/react-query` (entity data), `react-hook-form` + `@hookform/resolvers` +
`zod` (forms/validation). Dev: `vitest`, `jsdom`, `@testing-library/react`,
`@testing-library/user-event`, `@testing-library/jest-dom` (test harness),
`eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`,
`eslint-plugin-react-refresh` (lint gate). `npm audit`: 0 vulnerabilities at
install. `pnpm-lock.yaml` was deleted so `package-lock.json` is the only
authoritative lockfile. React Router was pinned to `^7` deliberately (latest
`react-router` is v8; the refactor spec mandates the v7 family).

## Inventory

<!-- Generated from `npm run lint` at ticket 01 time (base bae3e2c), after the
two vite.config.ts `no-explicit-any` findings were fixed by ticket 01; every other
entry matches the unmodified export baseline. Do not edit entries by hand. -->


### `src/screens/a-dashboard.tsx`

- `34:41` warning hooks/exhaustive-deps : Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
- `44:11` warning ts/no-unused-vars : 'db' is assigned a value but never used
- `211:25` warning ts/no-explicit-any : Unexpected any. Specify a different type

### `src/screens/ai-copilot.tsx`

- `33:105` warning hooks/exhaustive-deps : Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
- `63:9` warning ts/no-unused-vars : 'canPropose' is assigned a value but never used

### `src/screens/b-detail.tsx`

- `5:158` warning ts/no-unused-vars : 'Tabs' is defined but never used
- `8:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `9:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `11:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `14:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `17:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `49:53` warning ts/no-unused-vars : 'confirm' is assigned a value but never used
- `485:103` warning hooks/rules-of-hooks : React Hook "useStore" is called conditionally. React Hooks must be called in the exact same order in every component render

### `src/screens/b-detail2.tsx`

- `7:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `23:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `45:110` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `200:123` warning ts/no-explicit-any : Unexpected any. Specify a different type

### `src/screens/b.tsx`

- `11:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/c-common.tsx`

- `40:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `50:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `54:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `59:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `61:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `71:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `80:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `85:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `92:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `95:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `101:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `110:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `111:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `112:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `113:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `114:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `115:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `117:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `134:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `138:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `141:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `153:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `171:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `172:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `173:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `176:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/c-console.tsx`

- `2:168` warning ts/no-unused-vars : 'PanelRightClose' is defined but never used
- `2:185` warning ts/no-unused-vars : 'PanelRightOpen' is defined but never used
- `3:188` warning ts/no-unused-vars : 'SearchBox' is defined but never used
- `3:232` warning ts/no-unused-vars : 'Toggle' is defined but never used
- `7:16` warning ts/no-unused-vars : 'OpStatus' is defined but never used
- `7:106` warning ts/no-unused-vars : 'runtimeLabel' is defined but never used
- `147:364` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `147:460` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `267:19` warning ts/no-unused-vars : 'now' is assigned a value but never used
- `276:9` warning ts/no-unused-vars : 'lost' is assigned a value but never used
- `479:9` warning hooks/exhaustive-deps : The 'logs' logical expression could make the dependencies of useMemo Hook (at line 497) change on every render. To fix this, wrap the initialization of 'logs' in its own useMemo() Hook
- `500:9` warning ts/no-unused-vars : 'current' is assigned a value but never used
- `501:76` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `501:126` warning ts/no-explicit-any : Unexpected any. Specify a different type

### `src/screens/c-results.tsx`

- `3:51` warning ts/no-unused-vars : 'DemoTag' is defined but never used
- `3:60` warning ts/no-unused-vars : 'DescList' is defined but never used
- `3:70` warning ts/no-unused-vars : 'Drawer' is defined but never used
- `5:10` warning ts/no-unused-vars : 'TECHNIQUES' is defined but never used

### `src/screens/c.tsx`

- `2:37` warning ts/no-unused-vars : 'GitBranch' is defined but never used
- `16:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `101:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `140:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `338:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `449:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `510:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `549:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `566:7` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `567:7` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `568:7` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/d-agents.tsx`

- `15:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `32:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `98:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `223:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `296:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `380:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `447:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `526:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `548:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/d-assets.tsx`

- `18:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `531:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/d-library.tsx`

- `11:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `16:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `94:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `204:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `296:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/d-shared.tsx`

- `8:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `15:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `17:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `19:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `25:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `45:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `101:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/demo-guide.tsx`

- `15:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `255:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `258:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `267:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/e-analysis.tsx`

- `87:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `93:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `116:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `125:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `130:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `185:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `212:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `222:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `235:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `257:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `279:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `303:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `426:48` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `429:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `620:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `725:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/e-findings.tsx`

- `2:135` warning ts/no-unused-vars : 'X' is defined but never used
- `2:138` warning ts/no-unused-vars : 'Search' is defined but never used
- `10:7` warning ts/no-unused-vars : 'STATUSES' is assigned a value but never used
- `392:64` warning ts/no-unused-vars : 'scoped' is assigned a value but never used
- `884:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/f-report.tsx`

- `9:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `17:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `24:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `47:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/f.tsx`

- `18:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `47:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `102:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `154:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/g-common.tsx`

- `9:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `14:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `29:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `45:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `56:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `59:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `198:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `372:123` warning ts/no-explicit-any : Unexpected any. Specify a different type

### `src/screens/g-fanout.tsx`

- `500:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/g-plan.tsx`

- `86:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `121:10` warning ts/no-unused-vars : 'PlanTabs' is defined but never used
- `445:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/g-workspace.tsx`

- `11:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `12:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `29:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `36:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/h-session.tsx`

- `8:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `9:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `10:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `13:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `21:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `78:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `96:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `112:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `115:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `117:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `139:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/screens/h.tsx`

- `14:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `66:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `103:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `113:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `167:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `209:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `235:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/screens/scenarios.tsx`

- `121:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `133:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option
- `323:10` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Move your component(s) to a separate file. If all exports are HOCs, add them to the `extraHOCs` option

### `src/shell.tsx`

- `3:145` warning ts/no-unused-vars : 'Moon' is defined but never used
- `4:112` warning ts/no-unused-vars : 'XIcon' is defined but never used
- `4:168` warning ts/no-unused-vars : 'Sun' is defined but never used
- `21:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `60:19` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `61:54` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `64:41` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `65:40` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `244:21` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `248:47` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `394:19` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `561:19` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `563:39` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `567:12` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `597:21` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `683:24` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `684:33` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `687:35` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `688:35` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `703:29` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `703:126` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `704:27` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `711:30` warning ts/no-explicit-any : Unexpected any. Specify a different type

### `src/store.tsx`

- `8:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `12:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `16:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `17:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `32:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `35:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `42:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `48:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `56:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `101:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `104:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `126:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `127:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `146:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `164:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `225:34` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `225:66` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `323:42` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `324:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `326:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `336:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `384:59` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `385:48` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `490:6` warning hooks/exhaustive-deps : React Hook useCallback has a missing dependency: 'DETAIL_MAP'. Either include it or remove the dependency array
- `723:13` warning ts/no-unused-vars : 'initial' is assigned a value but never used
- `857:74` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `1212:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `1223:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

### `src/ui.tsx`

- `5:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `14:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `65:30` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `77:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `337:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `477:12` warning ts/no-explicit-any : Unexpected any. Specify a different type
- `606:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `625:17` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components
- `630:14` warning refresh/only-export-components : Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components

