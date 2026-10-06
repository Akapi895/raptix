# Domain Plugins

## Overview

Domain plugin packs live in `plugins/` and provide specialized agent capabilities for different attack surfaces. Each pack imports only `raptix-sdk` and `raptix-core` — never runtime internals.

## Plugin packs (W10)

| Pack | Domain |
|------|--------|
| `plugins/ad/` | Active Directory |
| `plugins/cloud/` | Cloud infrastructure (AWS, Azure, GCP) |
| `plugins/web/` | Web application testing |
| `plugins/network/` | Network reconnaissance and exploitation |
| `plugins/reversing/` | Binary analysis and reverse engineering |
| `plugins/mobile/` | Mobile application testing |
| `plugins/iot/` | IoT device testing |
| `plugins/ics/` | Industrial control systems |
| `plugins/wireless/` | Wireless network testing |
| `plugins/phishing/` | Social engineering / phishing |
| `plugins/contracts/` | Smart contract auditing |

## Plugin API

Plugins use `raptix_sdk.create_domain_agent` (ADR-0038) to register domain-specific agents with the runtime. The SDK provides:

- Agent registration and lifecycle hooks
- Tool definition helpers
- Prompt template utilities
- Type contracts from `raptix-core`

## Dependency rule

Plugins must import only:
- Python stdlib
- `raptix_sdk`
- `raptix_core`

This is enforced by the SDK import invariant test (`test_no_runtime_internals_import.py`).
