# Skills and Capabilities

## Skill corpus

Skills live in `packages/raptix-skills/` as content (Markdown + YAML metadata), not Python code. Each skill is a `SKILL.md` file with structured frontmatter.

## Frontmatter schema (W8)

```yaml
name: skill-name
description: One-line description
capabilities:
  - capability_tag
ukc_phases:
  - initial_foothold
  - network_propagation
requires:
  - prerequisite_skill
produces:
  - output_artifact
```

| Field | Purpose |
|-------|---------|
| `capabilities` | Tags for skill selection and filtering |
| `ukc_phases` | Which UKC phases this skill applies to |
| `requires` | Skills or artifacts that must exist before this skill runs |
| `produces` | Artifacts this skill creates when it runs |

## Runtime loading

The skill runtime in `raptix/skills/` handles:
- **Loader**: reads `SKILL.md` files from the corpus
- **Registry**: indexes skills by capability, phase, and dependency
- **Selector**: chooses applicable skills for the current engagement state
- **Engine**: executes skill instructions within the agent context

## Validation

- `make audit-skills-strict` — validates skill metadata completeness
- `make check-skill-graph` — checks skill dependency graph consistency against MITRE STIX
- `test_no_runtime_logic.py` — asserts skill corpus contains no Python runtime imports
