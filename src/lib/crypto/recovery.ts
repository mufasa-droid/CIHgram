import { CryptoError } from "@/lib/errors";
import { getSodium, zeroize, fromBase64 } from "./sodium";
import { generateIdentityKeypair, generateSeed } from "./sealed-box";
import { CRYPTO_CONSTANTS, type KeyPair } from "./types";

/**
 * Formats a 32-byte seed into an uppercase, hyphenated 64-character hexadecimal
 * recovery code grouped into 8 chunks of 8 characters:
 * e.g. "A1B2C3D4-E5F6A7B8-..."
 */
export async function formatRecoveryCode(seed: Uint8Array): Promise<string> {
  if (!seed || seed.length !== CRYPTO_CONSTANTS.SEED_BYTES) {
    throw new CryptoError(
      `Invalid recovery seed length: expected ${CRYPTO_CONSTANTS.SEED_BYTES} bytes`
    );
  }
  const s = await getSodium();
  const hex = s.to_hex(seed).toUpperCase();
  // Split into 8 groups of 8 characters
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += 8) {
    chunks.push(hex.substring(i, i + 8));
  }
  return chunks.join("-");
}

/**
 * Parses and validates a user-provided recovery code (either 64-character hex or 44-character Base64).
 * Returns the validated 32-byte seed.
 * Caller is responsible for zeroizing the returned seed when finished.
 */
export async function parseRecoveryCode(input: string): Promise<Uint8Array> {
  if (!input || typeof input !== "string") {
    throw new CryptoError("Recovery code cannot be empty");
  }

  const s = await getSodium();
  const clean = input.trim();

  // 1. Try formatted or raw hex (64 hex characters)
  const hexCandidate = clean.replace(/[\s-]/g, "").toLowerCase();
  if (hexCandidate.length === 64 && /^[0-9a-f]{64}$/.test(hexCandidate)) {
    try {
      const bytes = s.from_hex(hexCandidate);
      if (bytes.length === CRYPTO_CONSTANTS.SEED_BYTES) {
        return bytes;
      }
    } catch {
      // Fall through to Base64 check
    }
  }

  // 2. Try Base64 candidate (44 characters ending in '=')
  if (clean.length === CRYPTO_CONSTANTS.BASE64_PUBLIC_KEY_LENGTH) {
    try {
      const bytes = await fromBase64(clean);
      if (bytes.length === CRYPTO_CONSTANTS.SEED_BYTES) {
        return bytes;
      }
    } catch {
      // Fall through to error
    }
  }

  throw new CryptoError(
    "Invalid recovery phrase format. Expected a 64-character hexadecimal code or 32-byte Base64 key."
  );
}

/**
 * Generates a fresh 32-byte root seed, its human-readable recovery code,
 * and the derived X25519 identity keypair.
 */
export async function createRecoveryIdentity(): Promise<{
  seed: Uint8Array;
  recoveryCode: string;
  keyPair: KeyPair;
}> {
  const seed = await generateSeed();
  const recoveryCode = await formatRecoveryCode(seed);
  const keyPair = await generateIdentityKeypair(seed);

  return { seed, recoveryCode, keyPair };
}

/**
 * Restores an identical X25519 keypair from a user-held recovery code.
 * Memory zeroizes the intermediate seed immediately upon derivation.
 */
export async function restoreKeypairFromRecoveryCode(code: string): Promise<KeyPair> {
  const seed = await parseRecoveryCode(code);
  try {
    const keyPair = await generateIdentityKeypair(seed);
    return keyPair;
  } finally {
    await zeroize(seed);
  }
}
