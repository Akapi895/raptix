# raptix-skills

Operator-facing skill corpus for the Raptix framework: the
`SKILL.md` knowledge pack (standard / shared / plugins / benchmark
bundles) split out of the runtime in W9 so skills version, review and
ship independently of the loader/registry/selector/engine code that
lives in `packages/raptix`.

The runtime resolves this corpus via
`raptix.execution.backends.SKILLS_LOCAL_PATH` (package data of the
`raptix_skills` module). Virtual `/skills/...` paths are unchanged —
they are derived from the relative path under the corpus root.
