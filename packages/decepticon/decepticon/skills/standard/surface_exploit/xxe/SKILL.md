---
name: surface-exploit-xxe
description: "Bounded XML external entity proof for one assigned XML endpoint."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit xxe XML external entity assigned cell"
---

# Surface XXE Cell

Load `/skills/standard/exploit/web/xxe/SKILL.md` before any probe. Use only the
assigned XML body and a bounded, non-destructive oracle. Record parser behavior,
control, and exchange ID; do not extract unrelated files.
