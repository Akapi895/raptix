# W18 — Encrypted Vault & Reveal Lifecycle (accepted 2026-10-02)

## Scope

Guide §12.8 (Credentials Vault) plus the W18 outcome: server storage with
encryption/key management, audited reveal lifecycle, and no raw secret
workaround anywhere in the stack.

## Server

- `services/vault-service.ts` — AES-256-GCM sealing under an
  operator-provided 32-byte key (`VAULT_ENCRYPTION_KEY`, base64). The key is
  validated at startup (`config/env.ts`): a missing key answers 503 on every
  write/reveal and the capability reports
  `{ supported: true, available: false, reason: 'configuration_missing' }` —
  the vault never degrades to plaintext storage, and an invalid key length
  fails loudly instead of silently weakening the service.
- Metadata is redacted by construction: `GET .../vault/secrets` returns
  kind/label/createdBy/revealCount/lastRevealedAt only. No ciphertext column
  ever leaves the service; no plaintext is ever included in list responses
  (asserted in the verifier by scanning the full response JSON).
- Reveal is a dedicated endpoint (`POST .../vault/secrets/:secretId/reveal`)
  that returns the plaintext exactly once per call and appends an audited
  `revealed` row; create/revoke are audited too. The audit log
  (`VaultAudit`) is engagement-scoped with no secret FK, so it survives
  deletion. Decryption failures (e.g. after re-keying) answer 503 without
  echoing any material.
- Revocation (`DELETE .../vault/secrets/:secretId`) is a first-class audited
  action that removes the ciphertext row.

## Frontend

- `features/vault/` — redacted metadata cards, store form with a password
  input, explicit Reveal that names the audit consequence and shows the
  plaintext only in the acknowledged response banner, and Revoke with
  truthful empty-state recovery. No fixture eye-toggle exists.

## Gates

- Contracts: 45 tests (redacted metadata + dedicated reveal validators).
- Server: 211 tests total, including `w18-vault.test.ts` (redaction of both
  responses, reveal lifecycle with audit counts, missing-key 503 + env
  validation, wrong-key fail-closed, revocation, foreign 404s, capabilities).
- Frontend: real lane 29/29 includes `real-vault.spec.ts` (3 tests: redacted
  DOM, explicit audited reveal, truthful revocation); mock lane 8/8.
- Verifier `--w18` (12 groups): store → metadata scanned free of plaintext →
  reveal with audit counts → validation → revocation → foreign 404 →
  capability assert with a dedicated test key; evidence `w18-live.json`.

## Non-goals / next

Key rotation, multiple key versions and vault sharing across roles need the
identity/RBAC strategy first (W19 dependency order); the stored-value model
is intentionally minimal until then.
