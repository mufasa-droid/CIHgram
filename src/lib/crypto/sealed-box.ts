import { CryptoError } from "@/lib/errors";
import { getSodium, toBase64, fromBase64 } from "./sodium";
import { CRYPTO_CONSTANTS, type KeyPair } from "./types";

/**
 * Generates a high-entropy Curve25519 (X25519) keypair using Libsodium.
 * If seed is provided (must be 32 bytes), uses deterministic seed-based generation.
 * Otherwise uses cryptographically secure random bytes from the OS/browser CSPRNG.
 */
export async function generateIdentityKeypair(seed?: Uint8Array): Promise<KeyPair> {
  const s = await getSodium();

  let keypair: { publicKey: Uint8Array; privateKey: Uint8Array };

  if (seed) {
    if (seed.length !== CRYPTO_CONSTANTS.SEED_BYTES) {
      throw new CryptoError(
        `Invalid seed length: expected ${CRYPTO_CONSTANTS.SEED_BYTES} bytes, got ${seed.length}`
      );
    }
    keypair = s.crypto_box_seed_keypair(seed);
  } else {
    keypair = s.crypto_box_keypair();
  }

  if (
    keypair.publicKey.length !== CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES ||
    keypair.privateKey.length !== CRYPTO_CONSTANTS.SECRET_KEY_BYTES
  ) {
    throw new CryptoError("Cryptographic keypair generation produced invalid key length");
  }

  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
  };
}

/**
 * Generates a 32-byte (256-bit) cryptographically secure random root seed.
 */
export async function generateSeed(): Promise<Uint8Array> {
  const s = await getSodium();
  return s.randombytes_buf(CRYPTO_CONSTANTS.SEED_BYTES);
}

/**
 * Derives an X25519 public key from a 32-byte private key via scalar multiplication with the base point.
 */
export async function derivePublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  if (!privateKey || privateKey.length !== CRYPTO_CONSTANTS.SECRET_KEY_BYTES) {
    throw new CryptoError(
      `Invalid private key length: expected ${CRYPTO_CONSTANTS.SECRET_KEY_BYTES} bytes`
    );
  }
  const s = await getSodium();
  return s.crypto_scalarmult_base(privateKey);
}

/**
 * Encrypts a message using Libsodium Sealed Box (crypto_box_seal).
 *
 * Wire payload format:
 * [ephemeral_public_key (32 bytes)] || [XSalsa20 ciphertext] || [Poly1305 MAC (16 bytes)]
 *
 * Ephemeral secret key is generated internally and wiped immediately upon completion.
 * The sender cannot decrypt this message after sealing, preserving anonymous drop-box invariants.
 *
 * @param plaintext Message content (string or UTF-8 Uint8Array)
 * @param recipientPublicKeyBase64 Base64-encoded 32-byte recipient public key
 * @returns Base64-encoded encrypted envelope payload
 */
export async function encryptSealedBox(
  plaintext: string | Uint8Array,
  recipientPublicKeyBase64: string
): Promise<string> {
  const s = await getSodium();

  const recipientPkBytes = await fromBase64(recipientPublicKeyBase64);
  if (recipientPkBytes.length !== CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES) {
    throw new CryptoError(
      `Invalid recipient public key length: expected ${CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES} bytes`
    );
  }

  try {
    const ciphertextBytes = s.crypto_box_seal(plaintext, recipientPkBytes);
    return await toBase64(ciphertextBytes);
  } catch (err) {
    throw new CryptoError("Failed to seal message with recipient public key", err);
  }
}

/**
 * Decrypts a sealed box ciphertext using recipient private and public keys (crypto_box_seal_open).
 *
 * Poly1305 MAC tag detects any single-bit tampering or corruption.
 * On failure, throws a calm, generic CryptoError without leaking cryptographic internals.
 *
 * @param ciphertextBase64 Base64-encoded sealed box ciphertext
 * @param recipientPrivateKey Recipient's 32-byte private key
 * @param recipientPublicKey Recipient's 32-byte public key (optional; derived if omitted)
 * @returns Decrypted UTF-8 string plaintext
 */
/**
 * Decrypts a sealed box ciphertext using recipient private and public keys,
 * returning raw decrypted bytes.
 *
 * @param ciphertextBase64 Base64-encoded sealed box ciphertext
 * @param recipientPrivateKey Recipient's 32-byte private key
 * @param recipientPublicKey Recipient's 32-byte public key (optional; derived if omitted)
 * @returns Decrypted raw bytes (Uint8Array)
 */
export async function decryptSealedBoxRaw(
  ciphertextBase64: string,
  recipientPrivateKey: Uint8Array,
  recipientPublicKey?: Uint8Array
): Promise<Uint8Array> {
  const s = await getSodium();

  if (!recipientPrivateKey || recipientPrivateKey.length !== CRYPTO_CONSTANTS.SECRET_KEY_BYTES) {
    throw new CryptoError("Invalid or missing recipient private key");
  }

  const pubKey = recipientPublicKey ?? (await derivePublicKey(recipientPrivateKey));
  if (pubKey.length !== CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES) {
    throw new CryptoError("Invalid recipient public key");
  }

  const ciphertextBytes = await fromBase64(ciphertextBase64);
  if (ciphertextBytes.length < CRYPTO_CONSTANTS.SEAL_OVERHEAD_BYTES) {
    throw new CryptoError("This message could not be decrypted with your current key.");
  }

  try {
    const decryptedBytes = s.crypto_box_seal_open(ciphertextBytes, pubKey, recipientPrivateKey);
    if (!decryptedBytes) {
      throw new Error("Decryption returned falsy result");
    }
    return decryptedBytes;
  } catch {
    // Preserve calm generic error per security design invariant
    throw new CryptoError("This message could not be decrypted with your current key.");
  }
}

/**
 * Decrypts a sealed box ciphertext using recipient private and public keys (crypto_box_seal_open),
 * returning UTF-8 string plaintext.
 *
 * Poly1305 MAC tag detects any single-bit tampering or corruption.
 * On failure, throws a calm, generic CryptoError without leaking cryptographic internals.
 *
 * @param ciphertextBase64 Base64-encoded sealed box ciphertext
 * @param recipientPrivateKey Recipient's 32-byte private key
 * @param recipientPublicKey Recipient's 32-byte public key (optional; derived if omitted)
 * @returns Decrypted UTF-8 string plaintext
 */
export async function decryptSealedBox(
  ciphertextBase64: string,
  recipientPrivateKey: Uint8Array,
  recipientPublicKey?: Uint8Array
): Promise<string> {
  const decryptedBytes = await decryptSealedBoxRaw(
    ciphertextBase64,
    recipientPrivateKey,
    recipientPublicKey
  );

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(decryptedBytes);
  } catch {
    throw new CryptoError("This message could not be decrypted with your current key.");
  }
}

