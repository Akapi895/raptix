import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncFindingsForProject } from "../../src/services/findings-sync.js";
import { FakeSandbox } from "../support/fake-sandbox.js";
import { FakeVulnerabilityStore } from "../support/fake-vulnerability-store.js";

/** Mirrors findings-sync.ts's own sealOf(): sha256 of the block's canonical JSON
 * (keys sorted, spec_sha256 excluded). Used to build fixtures with a seal that
 * genuinely matches, the same way the real generator/verifier compute it. */
function sealOf(block: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(block).filter((k) => k !== "spec_sha256").sort()) body[key] = block[key];
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

function pocMarkdown(findingId: string, status: string, block: Record<string, unknown>): string {
  return `---\nid: ${findingId}\nseverity: high\ntitle: Test finding\nstatus: ${status}\n---\n\n## Evidence\n- proof\n\n## Proof of Concept\n\`\`\`json\n${JSON.stringify(block)}\n\`\`\`\n`;
}

const BASE_BLOCK = {
  file: "findings/poc/FIND-010.py",
  poc_sha256: "a".repeat(64),
  payload: "x",
  command: "run x",
  success_patterns: ["ok"],
  negative_command: "run ",
  negative_patterns: ["no"],
  cvss_vector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N",
};

/** A realistic finding-protocol-shaped file (see
 * packages/raptix-skills/.../shared/finding-protocol/SKILL.md), including a
 * sealed Proof of Concept block -- the exact shape syncFindingsForProject must parse. */
const FINDING_MD = `---
id: FIND-001
severity: critical
title: SQL injection in /api/search
status: confirmed
cwe: CWE-89
agent: exploit
objective_id: OBJ-001
discovered_at: "2026-04-06T14:23:11Z"
evidence_pointer: findings/evidence/FIND-001_search.txt
location: http://app.example.com/api/search
---

## Description
The \`q\` parameter of \`/api/search\` is concatenated directly into a SQL query without parameterization, allowing boolean-based blind SQL injection.

## Evidence
- findings/evidence/FIND-001_search.txt: timing delta confirms blind injection (baseline 42ms, payload 5021ms)
- findings/evidence/FIND-001_response.txt: UNION-based extraction returned admin password hash

## Proof of Concept
Sealed as described in "Sealed Proof of Concept" below.

\`\`\`json
{"file":"findings/poc/FIND-001.py","poc_sha256":"abc123","payload":"' OR SLEEP(5)--","command":"curl -s 'http://app.example.com/api/search?q=test%27%20OR%20SLEEP(5)--'","success_patterns":["real\\\\s+0m5"],"negative_command":"curl -s 'http://app.example.com/api/search?q=test'","negative_patterns":["real\\\\s+0m0"],"cvss_vector":"CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N","spec_sha256":"def456"}
\`\`\`

## Verification
Confirmed by verify_workspace_candidate: timing delta reproduced (5043ms vs 41ms baseline).

## Next
next agent should: hand off to analyst for CVSS write-up and remediation guidance.
`;

/** A legacy/malformed finding with no "## " headings at all -- must fall back to the
 * previous whole-body-as-description behavior, never regress to an empty description. */
const LEGACY_FINDING_MD = `---
id: FIND-002
severity: medium
title: Legacy unstructured finding
---

Just a flat paragraph of notes with no section headings.
`;

describe("syncFindingsForProject", () => {
  it("splits a finding-protocol file into description/evidence/reproductionSteps instead of dumping the whole body into description", async () => {
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-001.md", Buffer.from(FINDING_MD, "utf8"));

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { vulnerabilities } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(vulnerabilities).toHaveLength(1);
    const vuln = vulnerabilities[0]!;

    expect(vuln.title).toBe("SQL injection in /api/search");
    expect(vuln.severity).toBe("critical");
    expect(vuln.type).toBe("CWE-89");

    // description holds only the "## Description" section, not the whole file body.
    expect(vuln.description).toContain("boolean-based blind SQL injection");
    expect(vuln.description).not.toContain("## Evidence");
    expect(vuln.description).not.toContain("success_patterns");

    // evidence combines the "## Evidence" bullets and the "## Proof of Concept" section.
    expect(vuln.evidence).toContain("timing delta confirms blind injection");
    expect(vuln.evidence).toContain("UNION-based extraction");
    expect(vuln.evidence).toContain("Sealed as described");

    // reproductionSteps is the sealed PoC's exact `command` field.
    expect(vuln.reproductionSteps).toBe(
      "curl -s 'http://app.example.com/api/search?q=test%27%20OR%20SLEEP(5)--'",
    );

    // The frontmatter says `status: confirmed`, but its spec_sha256 ("def456") does not
    // match a real seal of the block, and there's no verification.json -- the self-reported
    // status must NOT be trusted. This is the Layer-2 gate ADR-0103 flags as unclosed.
    expect(vuln.verificationVerdict).toBe("candidate");
  });

  it("falls back to the whole body as description when a finding has no '## ' sections (legacy/malformed files)", async () => {
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-002.md", Buffer.from(LEGACY_FINDING_MD, "utf8"));

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { vulnerabilities } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(vulnerabilities).toHaveLength(1);
    expect(vulnerabilities[0]!.description).toContain("Just a flat paragraph");
    expect(vulnerabilities[0]!.evidence).toBe("");
    expect(vulnerabilities[0]!.reproductionSteps).toBe("");
  });

  it("trusts status: confirmed only when verification.json matches the current seal", async () => {
    const block = { ...BASE_BLOCK };
    const seal = sealOf(block);
    const sealedBlock = { ...block, spec_sha256: seal };
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-010.md", Buffer.from(pocMarkdown("FIND-010", "confirmed", sealedBlock), "utf8"));
    await sandbox.write(
      "proj-slug",
      "findings/evidence/FIND-010_verification.json",
      Buffer.from(JSON.stringify({ finding_id: "FIND-010", verdict: "confirmed", spec_sha256: seal }), "utf8"),
    );

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { vulnerabilities } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(vulnerabilities[0]!.verificationVerdict).toBe("confirmed");
  });

  it("downgrades to candidate when verification.json's seal is stale (block edited after verification)", async () => {
    const block = { ...BASE_BLOCK };
    const seal = sealOf(block);
    const sealedBlock = { ...block, spec_sha256: seal };
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-011.md", Buffer.from(pocMarkdown("FIND-011", "confirmed", sealedBlock), "utf8"));
    // Recorded verification is for a DIFFERENT seal -- e.g. the PoC was edited after verifying.
    await sandbox.write(
      "proj-slug",
      "findings/evidence/FIND-011_verification.json",
      Buffer.from(JSON.stringify({ finding_id: "FIND-011", verdict: "confirmed", spec_sha256: "stale-seal" }), "utf8"),
    );

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { vulnerabilities } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(vulnerabilities[0]!.verificationVerdict).toBe("candidate");
  });

  it("downgrades to candidate when there is no verification.json at all, regardless of frontmatter status", async () => {
    const block = { ...BASE_BLOCK };
    const sealedBlock = { ...block, spec_sha256: sealOf(block) };
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-012.md", Buffer.from(pocMarkdown("FIND-012", "confirmed", sealedBlock), "utf8"));

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { vulnerabilities } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(vulnerabilities[0]!.verificationVerdict).toBe("candidate");
  });

  it("is idempotent: re-running never creates a duplicate for the same finding id", async () => {
    const sandbox = new FakeSandbox();
    const store = new FakeVulnerabilityStore();
    await sandbox.write("proj-slug", "findings/FIND-001.md", Buffer.from(FINDING_MD, "utf8"));

    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");
    await syncFindingsForProject(sandbox, store, "proj-1", "proj-slug");

    const { total } = await store.list({ projectId: "proj-1", limit: 10, offset: 0 });
    expect(total).toBe(1);
  });
});
