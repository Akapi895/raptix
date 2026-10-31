import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSandboxControllerToken, loadSandboxKey } from "../../src/adapters/sandbox/token.js";

const LONG = "a".repeat(32);

describe("loadSandboxKey", () => {
  it("reads the key from the file when configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-key-"));
    const file = join(dir, "sandbox-key");
    writeFileSync(file, `${"k".repeat(64)}\n`);
    expect(loadSandboxKey(file)).toBe("k".repeat(64));
  });

  it("falls back to the inline key when no file is configured", () => {
    expect(loadSandboxKey(undefined, LONG)).toBe(LONG);
  });

  it("prefers the file over the inline key", () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-key-"));
    const file = join(dir, "sandbox-key");
    writeFileSync(file, `${"f".repeat(64)}\n`);
    expect(loadSandboxKey(file, LONG)).toBe("f".repeat(64));
  });

  it("rejects a too-short inline key", () => {
    expect(() => loadSandboxKey(undefined, "short")).toThrow("RAPTIX_SANDBOX_KEY");
  });

  it("returns undefined when nothing is configured", () => {
    expect(loadSandboxKey(undefined)).toBeUndefined();
  });
});

describe("loadSandboxControllerToken", () => {
  it("reads the token from the file when configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "controller-token-"));
    const file = join(dir, "controller-token");
    writeFileSync(file, `${"t".repeat(64)}\n`);
    expect(loadSandboxControllerToken(file)).toBe("t".repeat(64));
  });

  it("falls back to the inline token when no file is configured", () => {
    expect(loadSandboxControllerToken(undefined, LONG)).toBe(LONG);
  });

  it("rejects a too-short inline token", () => {
    expect(() => loadSandboxControllerToken(undefined, "nope")).toThrow("RAPTIX_SANDBOX_CONTROLLER_TOKEN");
  });

  it("returns undefined when nothing is configured", () => {
    expect(loadSandboxControllerToken(undefined)).toBeUndefined();
  });
});
