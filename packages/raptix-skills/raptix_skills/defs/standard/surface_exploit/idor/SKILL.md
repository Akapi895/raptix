---
name: surface-exploit-idor
description: "Bounded object-authorization proof for one assigned identifier surface."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit idor broken object level authorization assigned cell"
---

# Surface IDOR Cell

Load `/skills/standard/exploit/web/idor/SKILL.md` before any probe. Compare
only the assigned object identifier under the authorized baseline and one
controlled principal/context. Record the authorization control and exchange
IDs; do not enumerate neighboring objects.
