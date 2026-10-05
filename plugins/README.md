# First-party domain packs

W10 separates domain identity and offline analysis from runtime assembly.
Each directory is an installable uv workspace distribution, importing
only Python stdlib and public SDK/core contracts.

| Pack | Import package | Specialist / owned analysis |
|---|---|---|
| contracts | `raptix_contracts` | Contract auditor, Solidity/Slither, Foundry generators |
| reversing | `raptix_reversing` | Reverser, binary/string/packer/symbol/ROP analysis and recon generators |
| mobile | `raptix_mobile` | Mobile operator and identity/workflow resources |
| iot | `raptix_iot` | IoT operator and identity resources |
| ics | `raptix_ics` | ICS operator and RoE-gated identity resources |
| wireless | `raptix_wireless` | Wireless operator and identity/workflow resources |
| cloud | `raptix_cloud` | Cloud hunter, IAM/S3/user-data/Kubernetes/Terraform/metadata analysis |
| phishing | `raptix_phishing` | Phisher and deconfliction-preserving identity/workflow resources |
| active-directory | `raptix_active_directory` | AD operator, ADCS/Kerberos/delegation/GPO/shadow-credentials/DCSync analysis |
| web | `raptix_web` | JWT, OAuth and cookie/session analysis |
| network | `raptix_network` | Offline vulnerability assessment and report models |

## Public contracts

`raptix_sdk` exports `DomainPack`, `DomainAgentDefinition`, `PromptResource`,
`installed_domain_packs`, `domain_subagent` and `create_domain_agent`.
Domain metadata and subagent declarations load without runtime frameworks.
Executing an agent requires exactly one installed default provider under
`raptix.agent_composers`; missing/ambiguous providers raise
`DomainCompositionError`.

Subagent declarations retain the `standard` bundle, original role names,
priorities, recursion limits and baseline tool names. Existing graph import
paths remain runtime graph-hosting adapters. Tools are resolved by name to
runtime framework adapters; explicit caller tool/middleware/prompt
replacement retains the existing factory semantics.

Prompt identities and workflows are installed package resources registered
under `raptix.prompt_resources`. The runtime reads them before its ordinary
shared policy, tool prompt, locale and cache-boundary assembly. Resources
are package-relative; duplicate ownership fails explicitly. Original
fragment contents are preserved, including workflow whitespace normalization.

## Runtime boundary

The runtime retains sandbox execution, live HTTP/network/Ghidra/BloodHound
transports, engagement context, middleware safety gates and KG lifecycle
adapters. These are execution/knowledge interfaces, not alternate plugin
implementations. Generic recon/exploit and surface-dispatch orchestration
stay runtime-owned. The skill corpus stays in `raptix-skills`; its virtual
paths do not change. Analyzer compatibility modules re-export the canonical
plugin functions/classes and are retired in W11.

## Verify from the repository root

```powershell
uv sync --dev --locked
uv run pytest plugins packages/raptix-core/tests/test_domain_contracts.py packages/raptix-sdk/tests/test_domains.py packages/raptix/tests/unit/agents/test_domain_composer.py -q
uv run ruff check .
uv run basedpyright --level error
uv build --all-packages
```

Authority: `raptix-repository-architecture.md` §17/W10 and
`docs/adr/0038-domain-plugin-composition.md`. Safety overrides continue to
require the existing runtime gate; domain extraction changes no policy.
