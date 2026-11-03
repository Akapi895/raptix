import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadVaultMasterKey, VaultDecryptionError } from "../../src/security/vault-crypto.js";

describe("loadVaultMasterKey", () => {
  it("reads a 32-byte hex key from the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-key-"));
    const file = join(dir, "vault-master-key");
    const hex = randomBytes(32).toString("hex");
    writeFileSync(file, `${hex}\n`);
    expect(loadVaultMasterKey(file).toString("hex")).toBe(hex);
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-key-"));
    const file = join(dir, "vault-master-key");
    writeFileSync(file, randomBytes(16).toString("hex"));
    expect(() => loadVaultMasterKey(file)).toThrow("32 bytes");
  });

  it("rejects when unset", () => {
    expect(() => loadVaultMasterKey(undefined)).toThrow("RAPTIX_VAULT_MASTER_KEY_FILE");
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips plaintext through the same key", () => {
    const key = randomBytes(32);
    const cipherText = encryptSecret("super-secret-value", key);
    expect(decryptSecret(cipherText, key)).toBe("super-secret-value");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const key = randomBytes(32);
    expect(encryptSecret("same-value", key)).not.toBe(encryptSecret("same-value", key));
  });

  it("decrypts the same ciphertext across independent key loads (no rotation on restart)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-key-"));
    const file = join(dir, "vault-master-key");
    writeFileSync(file, randomBytes(32).toString("hex"));
    const keyA = loadVaultMasterKey(file);
    const cipherText = encryptSecret("persists-across-restart", keyA);
    const keyB = loadVaultMasterKey(file); // simulates a second process load of the same file
    expect(decryptSecret(cipherText, keyB)).toBe("persists-across-restart");
  });

  it("throws VaultDecryptionError on the wrong key", () => {
    const cipherText = encryptSecret("value", randomBytes(32));
    expect(() => decryptSecret(cipherText, randomBytes(32))).toThrow(VaultDecryptionError);
  });

  it("throws VaultDecryptionError on corrupted ciphertext", () => {
    const key = randomBytes(32);
    const cipherText = encryptSecret("value", key);
    const corrupted = Buffer.from(cipherText, "base64");
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(() => decryptSecret(corrupted.toString("base64"), key)).toThrow(VaultDecryptionError);
  });
});
