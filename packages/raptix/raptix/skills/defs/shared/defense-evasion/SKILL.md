---
name: defense-evasion
description: "Defense evasion knowledge base — AMSI bypass, ETW patching, event-log impairment, and modern evasion tradecraft. Load before payload delivery on Windows targets or whenever execution artifacts must survive EDR/AV inspection."
allowed-tools: Bash Read
metadata:
  subdomain: defense-evasion
  when_to_use: "defense evasion, AMSI, ETW, EDR, AV bypass, event log, payload delivery, obfuscation, execution artifact, evade detection"
  tags: defense-evasion, amsi, etw, edr, av-bypass, event-log, obfuscation
  mitre_attack: T1562, T1562.001, T1562.002, T1562.006, T1027
---

# Defense Evasion Knowledge Base

Evasion tradecraft for keeping authorized red-team operations inside the
engagement window without tripping endpoint defenses. This is the shared
router — the deep reference material lives in `references/`:

- `references/amsi-bypass-techniques.md` — AMSI architecture and the
  bypass catalog (AmsiScanBuffer patching, provider unhooking, PowerShell
  host variants). Load when delivering script-based payloads on Windows.
- `references/modern-evasion-techniques.md` — 2024–2026 threat-intel
  reference: ETW bypass, event-log impairment, emerging EDR evasion
  patterns, with MITRE ATT&CK coverage per technique.

## When to Load

- Before payload delivery on any Windows target (see `opsec` for traffic
  OPSEC; this skill covers host-side execution evasion).
- When a delivered payload is quarantined or a process is killed by EDR —
  pick an alternate technique class from the references instead of
  re-hashing the same payload.
- Only within RoE-permitted engagements; impairment techniques
  (T1562.*) require explicit `permitted_actions` in `plan/roe.json`.

## Reference Index

| Reference | Covers | Load when |
|---|---|---|
| `references/amsi-bypass-techniques.md` | AMSI internals + bypass classes | Script payload blocked by AMSI |
| `references/modern-evasion-techniques.md` | ETW / event-log / 2024–2026 EDR evasion | Hardened telemetry host, impairment authorized |
