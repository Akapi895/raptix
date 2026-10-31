import { describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/security/password.js";
import { ensureOperatorSeeded } from "../../src/security/operator-bootstrap.js";
import { FakeAuthStore } from "../support/fake-auth-store.js";

describe("ensureOperatorSeeded", () => {
  it("creates an operator with a generated password when none is configured", async () => {
    const store = new FakeAuthStore();
    const result = await ensureOperatorSeeded(store, {});
    expect(result.seeded).toBe(true);
    expect(result.username).toBe("admin");
    expect(result.generatedPassword).toBeDefined();

    const operator = await store.findOperatorByUsername("admin");
    expect(operator).not.toBeNull();
    expect(verifyPassword(result.generatedPassword as string, operator!.passwordHash)).toBe(true);
  });

  it("creates an operator from the configured username/password and does not return it", async () => {
    const store = new FakeAuthStore();
    const result = await ensureOperatorSeeded(store, { operatorUsername: "lead", operatorPassword: "pinned" });
    expect(result).toEqual({ seeded: true, username: "lead" });

    const operator = await store.findOperatorByUsername("lead");
    expect(verifyPassword("pinned", operator!.passwordHash)).toBe(true);
  });

  it("generates a password when RAPTIX_API_OPERATOR_PASSWORD is an empty string, not a silent empty password", async () => {
    // Docker Compose's `${VAR:-}` substitutes exactly this -- a defined,
    // empty env var -- whenever the operator hasn't set one. `??` alone
    // would treat "" as "provided" and seed a real, silent, empty-string
    // password (found via live docker-compose verification, Tier A).
    const store = new FakeAuthStore();
    const result = await ensureOperatorSeeded(store, { operatorUsername: "admin", operatorPassword: "" });
    expect(result.generatedPassword).toBeDefined();
    expect(result.generatedPassword).not.toBe("");

    const operator = await store.findOperatorByUsername("admin");
    expect(verifyPassword("", operator!.passwordHash)).toBe(false);
    expect(verifyPassword(result.generatedPassword as string, operator!.passwordHash)).toBe(true);
  });

  it("is a no-op when an operator already exists", async () => {
    const store = new FakeAuthStore();
    await ensureOperatorSeeded(store, { operatorUsername: "first", operatorPassword: "pw" });
    const second = await ensureOperatorSeeded(store, { operatorUsername: "second", operatorPassword: "pw2" });
    expect(second).toEqual({ seeded: false, username: "first" });
  });
});
