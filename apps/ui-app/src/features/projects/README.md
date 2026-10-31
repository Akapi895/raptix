# Projects and fact-graph migration

## Entry and integration hooks

```ts
import { installProjectsBridge } from './legacy/projects-bridge';

// After shell mount, before runClassicScripts (and auth/router ready callbacks).
const projects = installProjectsBridge();
runClassicScripts(appScripts());
projects.afterClassicScripts(); // Idempotent; binds the existing shell and starts the selector.
```

The integrating entry must remove `fact-graph` and `projects` from the classic
script-name list in `src/legacy/order.ts`. Their original JavaScript files have
been removed after the scoped checks passed. Main/order integration is owned by
the main migration and is deliberately outside this change's file scope.

`projects.dispose()` removes the feature's document/browser listeners, timers,
previews and Cytoscape instance. Feature-to-feature consumers can import the
typed public surface from `features/projects/index.ts` and
`features/fact-graph/index.ts`. The bridge preserves the old exported function
names (including implicit classic declarations still used by the shell and
project-switcher: `loadProjectsList`, `fetchProjectsList`, `setActiveProjectId`,
scope format/example and asset page-size handlers).

## Files and responsibilities

All feature paths below are relative to `src/features/`.

| Files | Responsibility |
| --- | --- |
| `projects/index.ts`, `types.ts` | Public exports, initialization and typed dependencies/DTOs |
| `projects/service.ts`, `client.ts` | Persistence, pagination/probing/cache, race-safe selection/assets/graph requests, Go endpoints and local demo response normalization |
| `projects/view.ts`, `context.ts`, `dom.ts` | Composition, lifecycle, finite shell bindings, delegated data-actions, DOM/date helpers |
| `projects/list.ts`, `selects.ts` | Sidebar, pagination, detail header, pin/archive/delete menu, custom selects |
| `projects/forms.ts`, `fact-body.ts` | Project/settings/fact/detail forms, scope JSON, templates, sparse-body rules, vulnerability linking/creation |
| `projects/tables.ts` | Facts, assets, bound conversations and vulnerability tables/actions |
| `projects/graph.ts` | Project graph loading, sidebar, synthetic-edge protection, connect/edit/delete controls |
| `projects/folder-service.ts`, `folders.ts` | Conversation folder data, task/approval/read state, pin/order, expansion/search/load-more |
| `projects/approvals.ts`, `previews.ts`, `picker.ts` | Countdown/urgency badges, hover/focus previews, chat/webshell pickers and conversation project binding |
| `fact-graph/index.ts`, `types.ts`, `service.ts` | Public graph types, node classification and semantic layers |
| `fact-graph/cards.ts`, `layout.ts`, `view.ts` | Themed SVG cards/text wrapping, ELK with breadth-first fallback, Cytoscape selection/search/resize/lifecycle |
| `projects/service.test.ts`, `fact-graph/service.test.ts` | Public services, HTTP contracts, cache/pagination/races, folder state and graph rules |
| `projects/browser.spec.ts`, `playwright.config.ts` | Isolated real-shell browser checks, including the unchanged demo mock |

Other scoped files:

- `src/legacy/projects-bridge.ts`: typed, lazy compatibility boundary.
- `src/platform/projects-browser.ts`: browser dialogs, hash, viewport, animation
  frame and browser event capabilities; no feature imports.
- Deleted `src/legacy/scripts/projects.js` and `fact-graph.js`.

The pre-existing `projects/service.ts` and `client.ts` were extended in place;
`projects/types.ts` and `fact-graph/types.ts` were retained unchanged. No packages
were added.

## Transitional dependencies

Every legacy callback resolves at call time in `projects-bridge.ts`:

- Translation/name display: `t`, `formatProjectNameForDisplay`, `applyProjectNameDisplay`.
- RBAC: `hasPermission`, `requirePermission`, `applyRBACToUI`.
- Shared UI: `openAppModal`, `closeAppModal`, `isAppModalOpen`,
  `syncAppModalBodyLock`, `deferModalContent`, `showNotification`,
  `showInlineToast`, `notifyApiError`, `initPaginationSelects`.
- Chat: `currentConversationId`, `_loadedConversationProjectId`,
  `loadConversation`, `startNewConversation`, `openConversationContextMenuForId`,
  `onConversationProjectBindingChanged`, `refreshChatWelcomeEmptyState`,
  `refreshConversationProjectFilter`, `closeRoleSelectionPanel`,
  `closeChatReasoningPanel`.
- Webshell: `wsCloseProjectPanel`, `applyWebshellAiProjectSelection`, and the
  existing `_projectModalFromWebshellConnId` handoff consumed by the bridge.
- Navigation/other domains: `switchPage`, `setVulnerabilityProjectFilter`,
  `setVulnerabilityIdFilter`, `refreshVulnerabilityProjectFilter`,
  `refreshAllProjectFilterSelects`, `openAssetDetailRecord`.

Document events: `languagechange`, `raptix-themechange`,
`conversation-pinned-changed`, `conversation-deleted`. Browser events:
`hitl-interrupt`, `hitl-resolved`, preview resize/capture-scroll.

Storage keys retain their exact names:
`raptix.activeProjectId`, `raptix.projects_list_page_size`,
`raptix.project_assets_page_size`, `raptix-project-folder-completion-seen`.

Existing CSS, DOM IDs, API route names and query conventions remain in use.
Static owned handlers are replaced at mount through an explicit finite mapping;
dynamic controls use data-actions or direct listeners. There is no source-code
interpreter, eval/Function, raw JavaScript wrapper, `any`, or suppression.

The local fact client accepts Go's single-fact response and the demo's array
response, numeric incoming-link count and missing creation timestamp. Confidence
operations send both Go's `fact_key` and the historical demo's `fact_keys`;
deprecated filtering sends the corresponding compatible query aliases. Shared
API types, transport and mock code were not modified.

## Verification

Run from `ui-app/`:

```text
npm run typecheck
npx eslint src/features/projects src/features/fact-graph src/legacy/projects-bridge.ts src/platform/projects-browser.ts
npx vitest run src/features/projects/service.test.ts src/features/fact-graph/service.test.ts
npx playwright test --config src/features/projects/playwright.config.ts
```

Results: typecheck and scoped lint pass; 16 unit tests and 2 browser tests pass.
The browser suite serves an isolated shell on an OS-assigned port (`port: 0`),
uses a disposable Vite cache below the approved temp `opencode` directory, and
writes Playwright results there. It does not use shared builds or preview ports.
It verifies shell/dynamic actions, lazy bridge dependencies and idempotent mount,
fact forms/links, settings scope/pins, graph canvas and edge creation/deletion,
permission fallback, chat folders/binding/navigation, real demo mock CRUD,
and preservation of unsaved scope edits across language changes.

Remaining integration: wire the hooks above and remove the two classic names in
main/order, then run the main application's integrated smoke checks. No shared
build, main entry, classic order, package, shared API/mock, other feature or
shared e2e files were changed; no commit was created.
