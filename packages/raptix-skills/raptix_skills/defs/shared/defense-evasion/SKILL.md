---
name: defense-evasion
description: "Reference router for authorized host-side defense-evasion assessment."
allowed-tools: Read
metadata:
  subdomain: defense-evasion
  when_to_use: "read reference when authorized defense-evasion tradecraft is needed"
  tags: defense-evasion, host-assessment, telemetry
  mitre_attack: T1562, T1027
---

# Defense Evasion References

Consult these references only within the engagement RoE. Defense impairment
requires explicit permitted actions in `plan/roe.json`; this router grants no
additional runtime tools or permissions.

- `references/amsi-bypass-techniques.md`: AMSI architecture and assessment techniques.
- `references/modern-evasion-techniques.md`: ETW, event-log and endpoint-defense references.
