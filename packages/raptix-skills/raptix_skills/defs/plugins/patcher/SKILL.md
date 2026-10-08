---
name: patcher-overview
description: Stage 4 patch generation playbook. Minimal diffs for validated findings with mandatory patch_verify. Load at patcher-agent startup.
metadata:
  subdomain: orchestration
  when_to_use: "patcher stage 4 patch generation minimal diff validated finding patch_verify pipeline"
  upstream_ref: "Raptix vulnresearch pipeline — stage 4 patcher role"
---

# Patcher Skill

You fix validated findings and prove the fix holds. Minimal diffs, one
concern at a time, mandatory PoC-failure check before claiming done.
KG tools are not on your surface — the task handoff carries the
validated-finding brief (file, line, severity, PoC command).

## Iteration loop

```
while not patched and attempts < 3:
    1. Take the next validated finding from the task handoff
       (pick validated=True, patched!=True)
    2. Read the function around (file, line)
    3. Design minimal fix (validate / escape / parameterize / safe API)
    4. Write the unified diff
    5. Apply diff via Edit or bash patch
    6. bash: run repo tests, abort on failure
    7. bash: re-run the finding's PoC command — it MUST now fail
       (that is your verification gate)
    8. if the PoC fails and tests pass: done
       else: revert, analyze, retry
    attempts += 1
```

## Diff style

- **Unified diff.** Use `git diff --no-color` output or write one by hand.
- **Minimal hunk.** One concern. No formatting. No renames. No "while I'm
  here" cleanups. No new files (unless adding one regression test).
- **Safe-API preference.**

| Bug class               | Preferred fix                                        |
|-------------------------|------------------------------------------------------|
| SQL injection           | Parameterized query / ORM.filter(), NOT escaping     |
| Command injection       | Arg-list subprocess, shell=False                     |
| Path traversal          | `os.path.realpath` + prefix check                    |
| SSRF                    | Allowlist + resolve → check not private/loopback     |
| Deserialization         | Switch to safe loader (`yaml.safe_load`, JSON, etc.) |
| Broken auth             | Move check to pre-hook, not inside handler           |
| Reflected XSS           | Framework auto-escape, remove `Markup`/`safe`        |

- **Add a regression test** in the same diff when the repo has a test
  directory for the affected module. One test that exercises the fixed
  path is sufficient.

## Commit message format

Conventional commits. Example:

```
fix(auth): use constant-time comparison in verify_hmac

Prevents timing side-channel recovery of the HMAC. CWE-208.
```

## Decisive-completion rule

Only report "patched" after the finding's PoC command fails on the
patched tree. A green test suite is NOT sufficient — the PoC must
actually fail.

If all 3 attempts fail, STOP on the finding, report the failure in
your return summary (`patch_attempts=3, last_failure=...`) and return
to the orchestrator. Do not spiral.
