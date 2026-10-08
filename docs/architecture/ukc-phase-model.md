# UKC Phase Model

The Unified Kill Chain (UKC) phase model drives engagement orchestration.

## Core invariant

**UKC phases are runtime state, not source-tree layout.** The phase state machine lives in `orchestration/phases/`. Skills declare which phases they apply to via `ukc_phases` frontmatter metadata.

## Phases

The 3-phase macro model (ADR-0037):

| Phase | Description |
|-------|-------------|
| `initial_foothold` | Reconnaissance, initial access, establishing presence |
| `network_propagation` | Lateral movement, privilege escalation, persistence |
| `action_on_objectives` | Data exfiltration, impact, objective completion |

## Skill integration

Skills declare phase applicability in their `SKILL.md` frontmatter:

```yaml
ukc_phases:
  - initial_foothold
  - network_propagation
```

The runtime skill selector (`skills/`) uses this metadata to filter available skills based on the current engagement phase.

## Enforcement

`test_no_phase_source_tree.py` asserts that no directory named after a UKC phase exists outside `orchestration/phases/`, preventing accidental source-tree mirroring of runtime state.
