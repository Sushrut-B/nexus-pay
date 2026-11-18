import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const configured = getServerEnv().TOKEN_ENCRYPTION_KEY;
  // Derive a stable 32-byte key from AUTH_SECRET when no dedicated key is set.
  // Production deployments should configure TOKEN_ENCRYPTION_KEY and rotate it
  // through their normal secret-management process.
  return createHash("sha256").update(configured ?? getServerEnv().AUTH_SECRET).digest();
}

/** Authenticated encryption for provider tokens and account references. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, ciphertextPart] = payload.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Never log or return raw secrets; show only a non-reversible hint. */
export function secretHint(plaintext: string): string {
  return `****${plaintext.slice(-4)}`;
}
