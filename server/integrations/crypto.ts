import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "rook-aes-gcm-v1";

function encryptionKey(): Buffer {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  }

  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  try {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to a deterministic SHA-256 derivation for long passphrases.
  }

  if (configured.length < 32) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY must be a 32-byte base64 value, 64 hex characters, or a passphrase of at least 32 characters");
  }

  return createHash("sha256").update(configured, "utf8").digest();
}

export function encryptSecret(value: string): string {
  if (!value) throw new Error("Cannot encrypt an empty secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(value: string): string {
  const [prefix, ivText, tagText, ciphertextText] = value.split(":");
  if (prefix !== PREFIX || !ivText || !tagText || !ciphertextText) {
    throw new Error("Encrypted secret has an unsupported format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
