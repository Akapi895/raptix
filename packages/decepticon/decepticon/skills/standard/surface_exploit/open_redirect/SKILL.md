---
name: surface-exploit-open-redirect
description: "Bounded open redirect proof for one assigned redirect parameter."
metadata:
  subdomain: web-exploitation
  mitre_attack: T1190
  when_to_use: "surface exploit open redirect next return redirect assigned cell"
---

# Surface Open Redirect Cell

Load `/skills/standard/exploit/web/open-redirect/SKILL.md` before any probe.
Test only the assigned redirect parameter and verify the final `Location`
behavior against a same-origin control. Record exchange ID and stop.
