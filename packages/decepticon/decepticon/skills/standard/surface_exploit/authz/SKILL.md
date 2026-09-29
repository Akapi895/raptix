---
name: surface-exploit-authz
description: "Bounded authorization-control proof for one assigned protected route."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit authz authorization privilege protected route assigned cell"
---

# Surface Authorization Cell

Load `/skills/standard/exploit/web/bfla/SKILL.md` before any probe. Compare the
assigned route only with its permitted and controlled unauthorized contexts.
Record the denial control, response signature, and exchange IDs; do not crawl
other protected routes.
