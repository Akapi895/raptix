import { randomBytes } from "node:crypto";
import type { AuthStore } from "../db/auth-store.js";
import { hashPassword } from "./password.js";

export interface SeedResult {
  seeded: boolean;
  username: string;
  /** Only set when no RAPTIX_API_OPERATOR_PASSWORD was configured -- log it once, loudly, then forget it. */
  generatedPassword?: string;
}

/**
 * Single-operator deployment (ADR-0100-style): exactly one Operator row.
 * Create it from env on first boot; a later boot with an existing row is a
 * no-op, matching ADR-0094/0100's "a rerun applies nothing" convention.
 */
export async function ensureOperatorSeeded(
  store: AuthStore,
  env: { operatorUsername?: string; operatorPassword?: string },
): Promise<SeedResult> {
  const existing = await store.findFirstOperator();
  if (existing) return { seeded: false, username: existing.username };

  const username = env.operatorUsername ?? "admin";
  const password = env.operatorPassword ?? randomBytes(9).toString("base64url");
  await store.createOperator({
    username,
    displayName: "Operator",
    passwordHash: hashPassword(password),
  });

  return {
    seeded: true,
    username,
    ...(env.operatorPassword ? {} : { generatedPassword: password }),
  };
}
