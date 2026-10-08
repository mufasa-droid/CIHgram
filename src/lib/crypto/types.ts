/**
 * End-to-End Cryptographic Types & Invariants
 *
 * All operations follow Libsodium Sealed Box standards:
 * - Curve25519 (X25519 ECDH)
 * - BLAKE2b KDF
 * - XSalsa20-Poly1305 AEAD
 */

export const CRYPTO_CONSTANTS = {
  ALGORITHM: "x25519-xsalsa20poly1305" as const,
  PROTOCOL_VERSION: 1 as const,
  PUBLIC_KEY_BYTES: 32,
  SECRET_KEY_BYTES: 32,
  SEED_BYTES: 32,
  MAC_BYTES: 16,
  /** crypto_box_seal overhead: 32-byte ephemeral public key + 16-byte Poly1305 tag */
  SEAL_OVERHEAD_BYTES: 48,
  /** 32 bytes in Base64 encoding is always exactly 44 characters (ending in '=') */
  BASE64_PUBLIC_KEY_LENGTH: 44,
  KEYSTORE_DB_NAME: "cih_keystore_v1",
  KEYSTORE_STORE_NAME: "identity_keys",
} as const;

export type SupportedAlgorithm = typeof CRYPTO_CONSTANTS.ALGORITHM;
export type SupportedProtocolVersion = typeof CRYPTO_CONSTANTS.PROTOCOL_VERSION;

/**
 * Raw binary keypair held in client memory.
 * Secret keys MUST NEVER be sent to the server or logged.
 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Public key record as stored in the Supabase public_keys table.
 */
export interface PublicKeyRecord {
  id: string;
  userId: string;
  publicKey: string; // Base64
  algorithm: SupportedAlgorithm;
  isActive: boolean;
  createdAt: string;
}

/**
 * Encrypted envelope format for transiting and storing encrypted messages.
 * Note: messages table itself is NOT created in Prompt 006, but the envelope
 * structure is formally standardized here.
 */
export interface EncryptedMessageEnvelope {
  v: SupportedProtocolVersion;
  alg: SupportedAlgorithm;
  kid: string;
  payload: string; // Base64(ephem_pk [32 bytes] || ciphertext || tag [16 bytes])
}

/**
 * Status of key existence on the server for the current authenticated user.
 */
export interface UserKeyStatus {
  hasActiveKey: boolean;
  activeKeyId: string | null;
  activePublicKey: string | null;
  createdAt: string | null;
  keyCount: number;
}

/**
 * State of local client identity reconciliation.
 */
export type ClientIdentityState =
  | "UNINITIALIZED"
  | "READY"
  | "KEY_MISSING_RESTORE_REQUIRED"
  | "STORAGE_UNAVAILABLE";
