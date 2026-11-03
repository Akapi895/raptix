# Deployment readiness

## Classification

**READY_FOR_STAGING.**

Not `PRODUCTION_READY`. Not `READY_FOR_DEPLOYMENT_REVIEW` yet: the open decisions in OPEN-ISSUES.md (OI-01 and OI-02 especially) and the runtime-dependent workflows (NV) need an owner's decision or a run on a stack with a runtime and a C2 provider first. `READY_FOR_MANUAL_UAT` is met: MANUAL-UAT.md can be run now.

| Level | Met? | Why |
|---|---|---|
| READY_FOR_MANUAL_UAT | Yes | Stack starts and stops cleanly; credentials are read from a file outside the repository; the journeys in MANUAL-UAT.md have automated counterparts that pass |
| READY_FOR_STAGING | Yes | Gates pass; no database migration in the delta; the delta is UI plus one additive response field |
| READY_FOR_DEPLOYMENT_REVIEW | No, yet | Needs the decisions in OI-01 and OI-02, and a run on a stack with a runtime and a C2 provider for the NV rows |
| PRODUCTION_READY | Not assessed, not claimed | Outside this pass's scope |

## What is deployed and what would change

- The web container `raptix-web-raptix-ui` (127.0.0.1:3001) runs `ghcr.io/akapi895/raptix-web-raptix-ui:d3225f63`. It has been up for about ten hours. **This pass did not touch it.** No redeploy was made (DEP-1 stays with the owner).
- HEAD of this pass is 27 commits ahead of `d3225f63`. Of those, the changes that reach the running product:
  - Web source: 59 files changed under `apps/web/src` since `d3225f63`. Most are the structural rounds already on HEAD before this pass; the one change of this pass is the governance tab (`fdceb370`).
  - Server source: one file, `apps/web/server/src/services/inbox-service.ts`, which adds two fields, `limited` and `limitedKinds`, to the task inbox response. The change is additive; existing fields are unchanged. Its test file `apps/web/server/tests/t15-inbox.test.ts` is updated to match.
  - Database: **no change**. `git diff d3225f63 HEAD -- apps/web/server/prisma` is empty, so no migration runs on deploy.
  - Verification tooling and documentation: not part of the product image.

## Migrations

None in the delta. `apps/web/server/prisma/migrations` is unchanged since `d3225f63`. The stack applied the existing migrations to its own database at each start.

## Compatibility

- The task inbox response gains fields; a client that ignores unknown fields is unaffected. The web client reads `limited` and `limitedKinds` for the lower-bound display.
- Governance: the server contract is unchanged. The console now hides controls the server would refuse; no request that the server accepts is blocked for a member who holds the role.
- No API path, status code or role floor changed.

## Rollback

- The running container is the previous build (`d3225f63`). Keeping the container as it is makes rollback a no-op.
- Images present locally: `ghcr.io/akapi895/raptix-web-raptix-ui:d3225f63` and `:stable`; `ghcr.io/akapi895/raptix-web-raptix-api:d3225f63` and `:stable`.
- If a new image is built later, its rollback is to start the `d3225f63` image again on the same port. No database step is involved because the delta has no migration.

## Conditions before a deployment review

1. Owner decision on OI-01 (ROE rules at approval) and OI-02 (wording and behaviour when a pending revision supersedes the approved ROE).
2. A run of the NV rows on a stack with a runtime and a C2 provider, under the rules in the engagement packages; no live target.
3. Accessibility pass on the governance controls (UIUX-ACCEPTANCE-REPORT, not verified here).
4. MANUAL-UAT.md executed by a person, with the checkpoints recorded.
5. Owner decision on whether to redeploy 3001 (DEP-1). This pass recommends that it wait for item 4.

## What was not checked here

- A rebuilt production image from HEAD (only the Vite builds with and without the prototype flags were run, into scratch folders).
- Container health and resource limits of the target environment.
- Backups, restore and the real database.
