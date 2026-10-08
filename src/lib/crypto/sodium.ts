import sodium from "libsodium-wrappers";
import { CryptoError } from "@/lib/errors";
import { CRYPTO_CONSTANTS } from "./types";

let sodiumPromise: Promise<typeof sodium> | null = null;

/**
 * Initializes and returns the Libsodium WebAssembly/native wrapper instance.
 * Thread-safe and safe for repeated or concurrent calls.
 */
export async function getSodium(): Promise<typeof sodium> {
  if (!sodiumPromise) {
    sodiumPromise = (async () => {
      try {
        await sodium.ready;
        return sodium;
      } catch (err) {
        // Reset cached promise so future attempts can retry
        sodiumPromise = null;
        throw new CryptoError("Failed to initialize cryptographic subsystem", err);
      }
    })();
  }

  return sodiumPromise;
}

/**
 * Encodes binary buffer to standard Base64 string.
 */
export async function toBase64(bytes: Uint8Array): Promise<string> {
  const s = await getSodium();
  return s.to_base64(bytes, s.base64_variants.ORIGINAL);
}

/**
 * Decodes standard Base64 string to Uint8Array.
 * Throws CryptoError if encoding is malformed.
 */
export async function fromBase64(base64: string): Promise<Uint8Array> {
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new CryptoError("Invalid Base64 input: empty or non-string");
  }

  const s = await getSodium();
  try {
    return s.from_base64(base64.trim(), s.base64_variants.ORIGINAL);
  } catch (err) {
    throw new CryptoError("Malformed Base64 payload", err);
  }
}

/**
 * Zeroizes sensitive key material in memory to mitigate retention attacks.
 */
export async function zeroize(bytes: Uint8Array): Promise<void> {
  if (!bytes || !(bytes instanceof Uint8Array)) return;
  const s = await getSodium();
  s.memzero(bytes);
}

/**
 * Validates whether a given string is a syntactically valid Base64-encoded
 * 32-byte X25519 public key.
 */
export async function isValidPublicKey(base64Key: string): Promise<boolean> {
  if (
    typeof base64Key !== "string" ||
    base64Key.length !== CRYPTO_CONSTANTS.BASE64_PUBLIC_KEY_LENGTH ||
    !base64Key.endsWith("=")
  ) {
    return false;
  }

  try {
    const bytes = await fromBase64(base64Key);
    return bytes.length === CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES;
  } catch {
    return false;
  }
}
