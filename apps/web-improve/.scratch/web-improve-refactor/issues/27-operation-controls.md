# 27: Start, pause, resume and normal stop

**What to build:** Implement canonical operation control transitions with current preflight/approval checks, confirmation/reasons and audited outcomes. Emergency stop has a separate owner.
**Blocked by:** 26.
**Status:** ready-for-agent
**Owner:** Operation control API.
**Contract:** [execution.md](../execution.md).

- [ ] Real handlers reject invalid states, unauthorized actors and failed current gates; UI reasons match refusals.
- [ ] Start/pause/resume/stop require deliberate confirmation/reasons as specified; stopped/estop operations never resume automatically.
- [ ] Start/session creation, agent reservations and normal-stop cleanup commit coherently to the shared authority.
- [ ] Test policy changes between render and click, expired linked approval and both legacy/new control consumers.
