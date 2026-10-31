import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/security/password.js";

describe("password", () => {
  it("verifies a correct password against its own hash", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    expect(hashPassword("same input")).not.toBe(hashPassword("same input"));
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});
