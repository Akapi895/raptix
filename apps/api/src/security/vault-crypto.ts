import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class VaultDecryptionError extends Error {}

/**
 * Reads the vault's AES-256-GCM master key from the file named by
 * RAPTIX_VAULT_MASTER_KEY_FILE. Mirrors loadRuntimeApiToken's shape: hex
 * content, trimmed, length-checked. apps/launcher's InitSecrets writes this
 * file once and never rotates it, so a secret encrypted before a restart
 * still decrypts after -- there is no key-rotation path in this module.
 */
export function loadVaultMasterKey(path: string | undefined): Buffer {
  if (!path) throw new Error("RAPTIX_VAULT_MASTER_KEY_FILE is required");
  const hex = readFileSync(path, "utf8").trim();
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(`RAPTIX_VAULT_MASTER_KEY_FILE must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/** Returns base64(iv(12) || ciphertext || authTag(16)). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

/** Throws VaultDecryptionError if the auth tag does not verify (wrong key or corrupted ciphertext). */
export function decryptSecret(cipherText: string, key: Buffer): string {
  const raw = Buffer.from(cipherText, "base64");
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new VaultDecryptionError("ciphertext too short");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(raw.length - AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new VaultDecryptionError("decryption failed: wrong key or corrupted ciphertext", { cause });
  }
}
