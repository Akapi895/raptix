Infrastructure plumbing — C2, sandboxes, webshell, environments, campaigns —
salvaged from the retired `apps/web/server/src/integrations/*`
(recoverable from git history prior to the ADR-0106 deletion commit: run
`git log --all --diff-filter=D -- apps/web/server/src/integrations` to find
the commit, then `git show <commit>^:apps/web/server/src/integrations/<name>`
per file). This code talks to infrastructure, not to `apps/web`'s old UI
contract, so it is recovered rather than rewritten. Not yet populated.
