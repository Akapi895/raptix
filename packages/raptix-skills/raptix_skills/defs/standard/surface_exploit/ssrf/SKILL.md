---
name: surface-exploit-ssrf
description: "Bounded SSRF proof for one assigned URL, callback, or webhook parameter."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit ssrf server side request forgery assigned cell"
---

# Surface SSRF Cell

Load `/skills/standard/exploit/web/ssrf/SKILL.md` before any probe. Use only
the assigned URL-like parameter and the skill's safe oracle. Record the
control, target signature, and exchange ID; do not pivot to unrelated internal
services or metadata endpoints.
