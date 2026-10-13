# 33: Standalone evidence inspector

**What to build:** Migrate both evidence route aliases to a typed inspector showing metadata, producer links and simulated capture integrity.
**Blocked by:** 32.
**Status:** ready-for-agent
**Owner:** Evidence inspector/read/download policy; sequenced after shared findings-source migration.
**Contract:** [execution.md](../execution.md).

- [ ] Finding/asset/session/analysis evidence links open the same scoped record; legacy source links remain supported.
- [ ] Missing/cross-project evidence reveals no content; switching scope requires access and an explicit prompt.
- [ ] Sensitive display/download gates are enforced independently of the link's originating screen.
- [ ] Simulated hashes describe retained-capture integrity, not proof of findings; both route aliases and producer references are verified.
