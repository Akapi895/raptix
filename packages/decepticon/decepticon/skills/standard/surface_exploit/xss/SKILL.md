---
name: surface-exploit-xss
description: "Bounded reflected or stored XSS proof for one assigned surface."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit xss cross site scripting assigned cell"
---

# Surface XSS Cell

Load `/skills/standard/exploit/web/xss/SKILL.md` before any probe. Test only
the assigned parameter or form and confirm unescaped reflection with a safe
marker. Record baseline, control, and exchange ID; stop before unrelated sinks.
