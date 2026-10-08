---
name: surface-exploit-ssti
description: "Bounded server-side template injection proof for one assigned input."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit ssti server side template injection assigned cell"
---

# Surface SSTI Cell

Load `/skills/standard/exploit/web/ssti/SKILL.md` before any probe. Test only
the assigned input with the skill's harmless expression proof. Record baseline,
control, and exchange ID; do not execute commands or chain to another class.
