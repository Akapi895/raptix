# 55: Observed-only attack path

**What to build:** Migrate attack-path graph derivation and evidence navigation separately from coverage aggregation.
**Blocked by:** 54.
**Status:** ready-for-agent
**Owner:** Attack-path domain/read model and SVG interaction.
**Contract:** [execution.md](../execution.md).

- [ ] Only recorded execution events produce edges; missing/unknown data never yields invented lateral movement or success.
- [ ] Edges/nodes retain step/session/evidence provenance and project isolation.
- [ ] Keyboard/pointer selection exposes equivalent details; theme/responsive behavior and no-data state work.
- [ ] Real derivation tests use recorded fixtures with expected absent edges; all analysis direct legacy readers are retired.
