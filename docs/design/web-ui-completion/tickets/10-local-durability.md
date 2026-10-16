# 10: Local backup, restore và recreate recovery

**What to build:** Supported local graceful lifecycle giữ checkpoint/history/artifacts và khôi phục từ paired backup đáng tin.
**Blocked by:** 05 — Run recovery; 06 — Tool replay; 07 — Answer history.
**Priority / Profile:** P0 / LOCAL-FULL.
**Status:** draft-awaiting-review.

## Steps
1. Review accepted local durability ADR và actual state/workspace volume mapping; inventory DB, checkpoint, event and secret-key dependencies.
2. Define backup manifest with schema/revision/volume identity and digest; exclude secret bytes from public evidence.
3. Implement or complete safe graceful-stop/backup/isolated-restore procedure and readiness/recovery UI.
4. Preserve legacy unsupported checkpoint behavior as explicit recovery error, not automatic untrusted import.
5. Verify pending questions, answered history, terminal tool events and retained artifacts after recreate/restore.

## Acceptance criteria
- [ ] Graceful recreate restores IDs/questions/output and allows one correct resume.
- [ ] Paired isolated restore matches manifest/digests and key references.
- [ ] Missing/corrupt/legacy checkpoint shows actionable error, not fake empty recovered thread.

## Test / expected result
L20 local portion with real pending and terminal threads; existing durability harness plus retained tool replay. No volume purge or operator-data overwrite; graceful pass does not claim power-loss durability.

## Completion evidence
Backup/restore manifest, service/image identities, before/after IDs/digests and verified recovery results.
