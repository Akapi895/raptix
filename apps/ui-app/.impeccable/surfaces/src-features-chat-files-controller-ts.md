---
version: 1
slug: "src-features-chat-files-controller-ts"
primary_target: "src/features/chat-files/controller.ts"
related_targets: ["src/features/chat-files/manager-view.ts","src/styles/file-manager.css"]
---

# File Management

Mode: Operate. Target: `/#chat-files`. Audience and product truth inherit `PRODUCT.md`.

## Direction contract

THESIS: Project-scoped file access has one home. The large name-first list leads; a collapsible right Explorer supplies physical storage hierarchy. No permanent preview column.

OWN-WORLD: Inherit Raptix's system type, neutral surfaces, thin borders, compact 4/8/12/16/24px rhythm, existing action red, and light/dark theme tokens. Global navigation and header stay intact.

STORY: Arrive at all selected-project files; narrow by conversation, search, source, or type; navigate folders with Explorer and breadcrumbs; inspect a file in a focused modal, then download or copy its path.

FIRST VIEWPORT: Main list and 300px Explorer share one bordered workspace. Search and conversation selection sit above breadcrumbs, sorting, and compact metadata rows. Explorer collapses by default on intermediate/mobile widths and opens above the list on narrow screens. Preview opens only on demand.

FORM: User-pinned two-panel layout, confirmed all-project-files initial view; code-led extension of established identity. seed: none (user-pinned structure).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Storage contract

Reuse `/api/chat-uploads` inventory and file operations. Uploads, tool outputs, workspace, and conversation artifacts are distinct stores, identified by original source and virtual path. Do not synthesize writable sandbox paths. API authorization stays authoritative. Only uploads support mutations. The API enumerates empty upload folders but does not enumerate empty sandbox folders; render all folders it exposes and ancestor hierarchy derived from returned file paths. Large inventories use paginated rows and demand-expanded bounded tree branches.
