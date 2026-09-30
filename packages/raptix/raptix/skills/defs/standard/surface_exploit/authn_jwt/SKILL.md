---
name: surface-exploit-authn-jwt
description: "Bounded JWT authentication proof for one assigned login or token surface."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1078, T1190
  when_to_use: "surface exploit authn jwt token authentication assigned cell"
---

# Surface JWT Authentication Cell

Load `/skills/standard/exploit/web/jwt/SKILL.md` before any probe. Inspect and
test only the assigned token/authentication surface with a bounded control.
Record exchange IDs and validation behavior; do not forge access or move into
post-exploitation without a confirmed cell result.
