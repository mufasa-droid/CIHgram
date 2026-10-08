/**
 * E2EE Cryptographic Foundation Public Interface
 *
 * All operations adhere to:
 * - Libsodium Sealed Boxes (Curve25519 + XSalsa20-Poly1305)
 * - Local-only private key handling (IndexedDB: cih_keystore_v1)
 * - 256-bit user-held recovery phrases (never server-escrowed)
 * - Zero plaintext / private key persistence on server
 */

export * from "./types";
export * from "./sodium";
export * from "./sealed-box";
export * from "./recovery";
export * from "./keystore";
export * from "./identity";
export * from "./actions";
