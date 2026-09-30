---
name: surface-exploit-graphql
description: "Bounded GraphQL introspection or authorization proof for one assigned endpoint."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit graphql GraphQL assigned cell"
---

# Surface GraphQL Cell

Load `/skills/standard/exploit/web/graphql/SKILL.md` before any probe. Use only
the assigned GraphQL endpoint and one generated query/control. Record schema,
authorization behavior, and exchange IDs; do not enumerate unrelated fields.
