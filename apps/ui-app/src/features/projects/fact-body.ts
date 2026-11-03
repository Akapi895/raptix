export const FACT_ATTACK_CHAIN_BODY_TEMPLATE = `## Conclusion (verifiable, one sentence)
<Do not just write "a vulnerability exists"; state the type + location + trigger conditions>

## Target and entry point
- Target: <URL / IP:Port / hostname>
- Entry: <path / endpoint / parameter>
- Preconditions: <anonymous / role / cookie / other dependencies>

## Attack chain (step-by-step reproducible)
1. <Recon / discovery>
2. <Exploitation / trigger>
3. <Impact proof (file read, RCE echo, unauthorized data, etc.)>

## Exploit / POC
### Request
\`\`\`http
<METHOD> <path> HTTP/1.1
Host: ...
...

<body>
\`\`\`

### Response / observed behavior
<Key response fragments, status codes, differences>

### Commands / scripts (if any)
\`\`\`bash
<command>
\`\`\`

## Key evidence
- <Tool output summary / screenshot path / session or message ID>

## Relations
- related_vulnerability_id: <optional>
- Dependent facts: <fact_key, e.g. auth/session_cookie>
  - Structured relation edges (auto-synced; links text format type: source_fact_key):
  - discovered_on: target/primary_domain

## Notes and uncertainties
<Unverified assumptions, environment differences, bypass attempts>`;
export const FACT_ENV_BODY_TEMPLATE = `## Summary
<The core understanding of this fact>

## Details
<Ports / versions / paths / credential traits / business rules, etc.>

## Source and evidence
<Command output, response fragments, discovery time>

## Relations
- Related fact_key: <optional>`;
export function requiresAttackChainFact(category: string, key: string): boolean {
  return ['finding', 'chain', 'exploit', 'poc', 'vuln'].includes(category.trim().toLowerCase()) || ['finding/', 'chain/', 'exploit/', 'poc/'].some(prefix => key.trim().toLowerCase().startsWith(prefix));
}
export function isSparseFactBody(category: string, key: string, body: string): boolean {
  if (!requiresAttackChainFact(category, key)) return false;
  const lower = body.trim().toLowerCase();
  return !['\u653b\u51fb\u94fe', '## \u653b\u51fb', '## exploit', '## poc', '```http', '```bash', 'curl ', 'get ', 'post ', '\u8bf7\u6c42', '\u54cd\u5e94', 'payload'].some(marker => lower.includes(marker));
}
