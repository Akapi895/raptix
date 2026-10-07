---
name: analyst-overview
description: Root pointer for the analyst's vulnerability research playbooks. Load this first at iteration start to see the full catalog of vuln-class and chain-building skills.
metadata:
  subdomain: analyst
  when_to_use: "analyst overview vulnerability research playbook catalog chain building routing iteration start"
  upstream_ref: "Raptix analyst lane: vulnerability research playbook catalog"
---

# Analyst Skill Catalog

The analyst has specialised playbooks under this tree. Load the one
matching your current hunting lane — don't load them all at once.

## Taint / source-review playbooks
Use when you have source code and are hunting a specific weakness class.

| Skill                                       | Use for                                                        |
|---------------------------------------------|----------------------------------------------------------------|
| `/skills/standard/analyst/sql-injection/SKILL.md`    | String-concat + format-string → SQL sink                       |
| `/skills/standard/analyst/ssrf/SKILL.md`             | User-controlled URL reaches http client                        |
| `/skills/standard/analyst/deserialization/SKILL.md`  | pickle / Java ObjectInputStream / .NET BinaryFormatter / YAML  |
| `/skills/standard/analyst/ssti/SKILL.md`             | User input rendered by Jinja/Twig/Freemarker/Velocity          |
| `/skills/standard/analyst/xxe/SKILL.md`              | XML parser with external entity expansion enabled              |
| `/skills/standard/analyst/path-traversal/SKILL.md`   | User input reaches filesystem path                             |
| `/skills/standard/analyst/prototype-pollution/SKILL.md` | JS merge / assign / clone of untrusted object                 |
| `/skills/standard/analyst/command-injection/SKILL.md`| User input → shell, exec, system                              |
| `/skills/standard/analyst/idor/SKILL.md`             | Missing authorization check on object reference                |
| `/skills/standard/analyst/auth-bypass/SKILL.md`      | Broken auth state machine, missing session checks              |
| `/skills/standard/analyst/prompt-injection/SKILL.md` | LLM prompts built from untrusted input                         |

## Research expansion playbooks

| Skill | Use for |
|---|---|
| `/skills/standard/analyst/patch-diff/SKILL.md` | Pinned vulnerable-to-fixed differential testing and variant analysis |
| `/skills/standard/analyst/pattern-exhaustion/SKILL.md` | Independent validation of related root-cause candidates |

## Chain playbooks
Use when you have a bag of individual findings and want to combine them
into a critical impact chain.

| Skill                                       | Use for                                                        |
|---------------------------------------------|----------------------------------------------------------------|
| `/skills/standard/analyst/chains/ssrf-to-rce/SKILL.md`  | SSRF → metadata → IAM → RCE                                |
| `/skills/standard/analyst/chains/xss-to-takeover/SKILL.md` | Self-XSS → CSRF → admin creds                            |
| `/skills/standard/analyst/chains/cred-reuse/SKILL.md`   | Low-priv cred → service pivot → domain admin               |
| `/skills/standard/analyst/chains/idor-to-priv-esc/SKILL.md` | IDOR on settings → role elevation                      |

## Workflow
1. Review the task handoff and your findings so far (workspace files)
   — you have no graph-read tool, so the handoff and your notes are
   the memory.
2. Identify the target's language / framework.
3. Load the matching vuln-class skill (one or two per iteration).
4. Run the skill's recipe, record findings via `kg_record` (your KG
   slot) or your findings file.
5. When enough vulns exist, load a chain playbook — chain planning is
   not on your tool surface; persist complete chains as `AttackPath`
   observations via `kg_record` instead.
