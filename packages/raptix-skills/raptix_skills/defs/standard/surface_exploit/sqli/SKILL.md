---
name: surface-exploit-sqli
description: "Bounded SQL injection proof for one assigned endpoint and parameter."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit sqli SQL injection assigned cell"
---

# Surface SQLi Cell

Load `/skills/standard/exploit/web/sqli/SKILL.md` before any probe. Apply only
its bounded confirmation flow to the assigned endpoint and parameter. Preserve
the baseline, control response, and exchange ID; do not dump data or switch
to another vulnerability class.
