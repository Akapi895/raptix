---
name: roe-template
description: "Rules of Engagement document creation — scope definition, prohibited/permitted actions, testing windows, escalation contacts, incident procedures."
allowed-tools: Read Write Edit
metadata:
  subdomain: planning
  when_to_use: "create RoE, define scope, engagement boundaries, start new engagement"
  tags: roe, scope, engagement, authorization, legal
  upstream_ref: "Soundwave Rules of Engagement template — scope / window / escalation / incident procedures"
---

# Rules of Engagement (RoE) Generator

The RoE is the **legally binding** foundation of every red team engagement. All other documents build on it.

## When to Use

- Starting a new engagement
- User says "create RoE", "define scope", "set boundaries"
- Before any other planning document can be created

## Workflow

### Step 1: Interview the User

Drive each dimension through one `ask_user_question` call (per CRITICAL_RULES #8 — every operator-facing question goes through the tool). **Budget: 6 questions max for RoE** (soundwave.md CRITICAL_RULES → Question Budget). Combine related fields into a single free-form answer instead of asking one field at a time — the picker returns raw text either way, so the agent parses multiple values out of one answer.

**Identity & Scope**
1. Engagement name + client organization (ONE combined free-form question, `allow_other=true` with a sensible guessed pair as the option)
2. Engagement type — single-select: `external` / `internal` / `hybrid` / `assumed-breach` / `physical`
3. Start date / end date / testing window with timezone (free-form, `allow_other=true` — suggest defaults like "Mon-Fri 09:00-18:00 client TZ")
4. In-scope targets AND out-of-scope targets (ONE combined free-form question — "What's in scope, and what's explicitly excluded?", `allow_other=true`)

**Dangerous methods (mandatory, always asked)**
1b. Ask once with `ask_user_question`: "Confirm the dangerous-method list. These methods are always prohibited and always need operator approval at runtime, even when HITL is off." Options: `Confirm the default list (Recommended)` (description lists the six labels below) and `Add more methods` with `allow_other=true`. This call counts as one of the six RoE questions. If the six are otherwise used up, fold item 3 (dates and window) into item 1's combined answer. Never skip this step.
   The six default labels, kept verbatim in `prohibited_actions`:
   - `Denial of Service (DoS/DDoS) and flooding`
   - `Brute-force or password spraying`
   - `Destructive data changes (wipe, format, mass delete, drop)`
   - `Encrypting data for impact (ransomware)`
   - `Persistence beyond the engagement`
   - `Disabling security controls or audit logging`
   Operator additions are appended. A default label is never removed, even if the operator answers with nothing else.

**Boundaries & Escalation**
5. Special permitted actions — phishing, raw-socket scans (multi-select). Do NOT offer password spraying here: it is a dangerous method, always prohibited by Step 1b. Prohibitions are handled by Step 1b, not by this question.
6. Escalation contacts (ONE combined free-form question asking for both slots at once — "Who are your primary contacts? (client lead + red team lead, with name/role/channel for each)", minimum 2) AND authorization reference / contract # folded into the same answer as a trailing field (`allow_other=true`)

If the operator's opening message already answers a dimension (e.g. they paste a CIDR range and say "external pentest"), extract it directly — do not re-ask it as one of the 6.

### Step 2: Generate plan/roe.json

Use the `RoE` schema from `raptix_core.types.engagement`. Write to the engagement directory.

See `references/roe-example.json` for a complete example and `../references/schema-quick-reference.md` for all required fields and valid values.

### Step 3: Validate

Run through the checklist in `references/validation-checklist.md` before presenting to user.

## Generation Rules

1. **Always include default prohibited actions** — the six dangerous-method labels from Step 1b (verbatim), unauthorized social engineering, unauthorized physical access, real data exfiltration, production data modification
2. **Scope must be specific** — CIDR notation for IPs, wildcard notation for domains
3. **Testing window must include timezone**
4. **At least 2 escalation contacts** required
5. **Authorization reference must not be empty**

## Output

Write `plan/roe.json` to the engagement directory, then present a human-readable summary to the user for confirmation.
