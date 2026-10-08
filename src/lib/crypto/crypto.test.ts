import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto"; // Polyfills indexedDB on globalThis for keystore testing

import {
  getSodium,
  toBase64,
  fromBase64,
  isValidPublicKey,
  generateIdentityKeypair,
  generateSeed,
  derivePublicKey,
  encryptSealedBox,
  decryptSealedBox,
  decryptSealedBoxRaw,
  createRecoveryIdentity,
  formatRecoveryCode,
  parseRecoveryCode,
  restoreKeypairFromRecoveryCode,
  saveLocalIdentity,
  getLocalIdentity,
  updateLocalKeyId,
  clearLocalIdentity,
  CRYPTO_CONSTANTS,
  type EncryptedMessageEnvelope,
} from "./index";
import { CryptoError } from "@/lib/errors";
import { sanitizeLogPayload } from "@/lib/logger";

describe("Cryptographic Subsystem (Libsodium Sealed Box)", () => {
  beforeEach(async () => {
    await clearLocalIdentity();
  });

  describe("1. Libsodium Initialization", () => {
    it("initializes libsodium wrapper successfully", async () => {
      const sodium = await getSodium();
      expect(sodium).toBeDefined();
      expect(typeof sodium.crypto_box_seal).toBe("function");
      expect(typeof sodium.crypto_box_seal_open).toBe("function");
    });

    it("is safe and idempotent for repeated and concurrent initializations", async () => {
      const results = await Promise.all([
        getSodium(),
        getSodium(),
        getSodium(),
      ]);
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
    });
  });

  describe("2. Keypair Generation & Determinism", () => {
    it("generates keypairs with exact expected byte lengths", async () => {
      const kp = await generateIdentityKeypair();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey.length).toBe(CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES);
      expect(kp.privateKey.length).toBe(CRYPTO_CONSTANTS.SECRET_KEY_BYTES);
    });

    it("generates distinct keypairs across invocations (CSPRNG entropy)", async () => {
      const kp1 = await generateIdentityKeypair();
      const kp2 = await generateIdentityKeypair();
      const b64_1 = await toBase64(kp1.publicKey);
      const b64_2 = await toBase64(kp2.publicKey);
      expect(b64_1).not.toBe(b64_2);
    });

    it("generates identical keypairs deterministically from the same seed", async () => {
      const seed = await generateSeed();
      const kp1 = await generateIdentityKeypair(seed);
      const kp2 = await generateIdentityKeypair(seed);

      const pk1 = await toBase64(kp1.publicKey);
      const pk2 = await toBase64(kp2.publicKey);
      const sk1 = await toBase64(kp1.privateKey);
      const sk2 = await toBase64(kp2.privateKey);

      expect(pk1).toBe(pk2);
      expect(sk1).toBe(sk2);
    });

    it("derives the exact matching public key from a private key scalar", async () => {
      const kp = await generateIdentityKeypair();
      const derivedPk = await derivePublicKey(kp.privateKey);
      const originalPk = await toBase64(kp.publicKey);
      const computedPk = await toBase64(derivedPk);
      expect(computedPk).toBe(originalPk);
    });

    it("rejects seed with invalid length", async () => {
      const badSeed = new Uint8Array(16);
      await expect(generateIdentityKeypair(badSeed)).rejects.toThrow(CryptoError);
    });
  });

  describe("3. Key Serialization & Validation", () => {
    it("preserves exact binary bytes across Base64 serialization roundtrip", async () => {
      const kp = await generateIdentityKeypair();
      const base64 = await toBase64(kp.publicKey);
      expect(base64.length).toBe(CRYPTO_CONSTANTS.BASE64_PUBLIC_KEY_LENGTH);
      expect(base64.endsWith("=")).toBe(true);

      const restored = await fromBase64(base64);
      expect(restored).toEqual(kp.publicKey);
    });

    it("validates well-formed public keys", async () => {
      const kp = await generateIdentityKeypair();
      const base64 = await toBase64(kp.publicKey);
      expect(await isValidPublicKey(base64)).toBe(true);
    });

    it("rejects malformed public keys", async () => {
      expect(await isValidPublicKey("")).toBe(false);
      expect(await isValidPublicKey("too-short")).toBe(false);
      expect(await isValidPublicKey("not-base64!@#$")).toBe(false);
      expect(await isValidPublicKey("a".repeat(44))).toBe(false); // Does not end in '='
    });

    it("throws CryptoError when fromBase64 encounters invalid input", async () => {
      await expect(fromBase64("")).rejects.toThrow(CryptoError);
      await expect(fromBase64("   ")).rejects.toThrow(CryptoError);
      await expect(fromBase64("!!!invalid-base64-characters!!!")).rejects.toThrow(CryptoError);
    });
  });

  describe("4. Sealed Box Encryption & Decryption", () => {
    it("successfully encrypts and decrypts a plaintext message", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const message = "Secret message payload intended only for the recipient.";

      const ciphertext = await encryptSealedBox(message, recipientPkBase64);
      expect(typeof ciphertext).toBe("string");
      expect(ciphertext).not.toContain(message);

      const decrypted = await decryptSealedBox(ciphertext, recipient.privateKey, recipient.publicKey);
      expect(decrypted).toBe(message);
    });

    it("decrypts correctly even when recipientPublicKey is omitted", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const message = "Recipient public key is derived on-the-fly.";

      const ciphertext = await encryptSealedBox(message, recipientPkBase64);
      const decrypted = await decryptSealedBox(ciphertext, recipient.privateKey);
      expect(decrypted).toBe(message);
    });

    it("generates distinct ciphertexts for identical plaintexts (ephemeral keypair per message)", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const message = "Identical message content";

      const ct1 = await encryptSealedBox(message, recipientPkBase64);
      const ct2 = await encryptSealedBox(message, recipientPkBase64);
      expect(ct1).not.toBe(ct2);

      // Both must decrypt to the identical original message
      expect(await decryptSealedBox(ct1, recipient.privateKey)).toBe(message);
      expect(await decryptSealedBox(ct2, recipient.privateKey)).toBe(message);
    });

    it("handles empty string plaintext", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);

      const ciphertext = await encryptSealedBox("", recipientPkBase64);
      const decrypted = await decryptSealedBox(ciphertext, recipient.privateKey);
      expect(decrypted).toBe("");
    });

    it("handles Unicode, non-Latin scripts, and emojis seamlessly", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const unicodeMessage = "🔐 Secure confidential note: 日本語 • العربية • Été à l'Opéra • 🚀✨";

      const ciphertext = await encryptSealedBox(unicodeMessage, recipientPkBase64);
      const decrypted = await decryptSealedBox(ciphertext, recipient.privateKey);
      expect(decrypted).toBe(unicodeMessage);
    });

    it("handles large bounded message payloads (~16KB)", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const largeMessage = "A".repeat(16000);

      const ciphertext = await encryptSealedBox(largeMessage, recipientPkBase64);
      const decrypted = await decryptSealedBox(ciphertext, recipient.privateKey);
      expect(decrypted).toBe(largeMessage);
    });

    it("handles binary Uint8Array plaintext and raw decryption", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);
      const binaryPayload = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);

      const ciphertext = await encryptSealedBox(binaryPayload, recipientPkBase64);
      const decryptedRaw = await decryptSealedBoxRaw(ciphertext, recipient.privateKey);
      expect(decryptedRaw).toEqual(binaryPayload);
    });
  });

  describe("5. Cryptographic Failure Modes & Tamper Detection", () => {
    it("fails with calm generic error when decrypted with wrong private key", async () => {
      const recipientA = await generateIdentityKeypair();
      const recipientB = await generateIdentityKeypair();
      const pkABase64 = await toBase64(recipientA.publicKey);

      const ciphertext = await encryptSealedBox("Sensitive data", pkABase64);

      await expect(
        decryptSealedBox(ciphertext, recipientB.privateKey, recipientB.publicKey)
      ).rejects.toThrow("This message could not be decrypted with your current key.");
    });

    it("fails when ciphertext payload is tampered (Poly1305 MAC failure)", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);

      const ciphertext = await encryptSealedBox("Tamper test payload", recipientPkBase64);
      const rawBytes = await fromBase64(ciphertext);

      // Flip one bit in the middle of ciphertext
      rawBytes[rawBytes.length - 5] ^= 0x01;
      const tamperedCiphertext = await toBase64(rawBytes);

      await expect(
        decryptSealedBox(tamperedCiphertext, recipient.privateKey, recipient.publicKey)
      ).rejects.toThrow("This message could not be decrypted with your current key.");
    });

    it("fails when ephemeral public key is tampered", async () => {
      const recipient = await generateIdentityKeypair();
      const recipientPkBase64 = await toBase64(recipient.publicKey);

      const ciphertext = await encryptSealedBox("Tamper test ephemeral key", recipientPkBase64);
      const rawBytes = await fromBase64(ciphertext);

      // Ephemeral public key is the first 32 bytes; flip one bit
      rawBytes[5] ^= 0x01;
      const tamperedCiphertext = await toBase64(rawBytes);

      await expect(
        decryptSealedBox(tamperedCiphertext, recipient.privateKey, recipient.publicKey)
      ).rejects.toThrow("This message could not be decrypted with your current key.");
    });

    it("rejects truncated ciphertext shorter than seal overhead (48 bytes)", async () => {
      const recipient = await generateIdentityKeypair();
      const truncated = await toBase64(new Uint8Array(20));

      await expect(
        decryptSealedBox(truncated, recipient.privateKey, recipient.publicKey)
      ).rejects.toThrow("This message could not be decrypted with your current key.");
    });
  });

  describe("6. Recovery Phrase & Key Restoration", () => {
    it("creates a valid recovery seed, formatted code, and matching keypair", async () => {
      const { seed, recoveryCode, keyPair } = await createRecoveryIdentity();

      expect(seed.length).toBe(CRYPTO_CONSTANTS.SEED_BYTES);
      expect(typeof recoveryCode).toBe("string");
      // Formatted as 8 groups of 8 hex characters: 64 hex + 7 hyphens = 71 chars
      expect(recoveryCode).toMatch(/^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/);
      expect(keyPair.publicKey.length).toBe(CRYPTO_CONSTANTS.PUBLIC_KEY_BYTES);
      expect(keyPair.privateKey.length).toBe(CRYPTO_CONSTANTS.SECRET_KEY_BYTES);
    });

    it("formats and parses recovery codes accurately across roundtrip", async () => {
      const seed = await generateSeed();
      const code = await formatRecoveryCode(seed);
      const parsedSeed = await parseRecoveryCode(code);
      expect(parsedSeed).toEqual(seed);
    });

    it("restores the exact identical keypair from recovery code", async () => {
      const { recoveryCode, keyPair: originalKp } = await createRecoveryIdentity();
      const restoredKp = await restoreKeypairFromRecoveryCode(recoveryCode);

      const originalPk = await toBase64(originalKp.publicKey);
      const restoredPk = await toBase64(restoredKp.publicKey);
      const originalSk = await toBase64(originalKp.privateKey);
      const restoredSk = await toBase64(restoredKp.privateKey);

      expect(restoredPk).toBe(originalPk);
      expect(restoredSk).toBe(originalSk);

      // Verify that ciphertext encrypted to original can be decrypted by restored key
      const message = "Decrypted with restored key!";
      const ct = await encryptSealedBox(message, originalPk);
      expect(await decryptSealedBox(ct, restoredKp.privateKey)).toBe(message);
    });

    it("accepts raw Base64 string as a valid recovery code", async () => {
      const seed = await generateSeed();
      const base64Seed = await toBase64(seed);
      const parsed = await parseRecoveryCode(base64Seed);
      expect(parsed).toEqual(seed);
    });

    it("rejects malformed recovery codes", async () => {
      await expect(parseRecoveryCode("")).rejects.toThrow(CryptoError);
      await expect(parseRecoveryCode("invalid-short-code")).rejects.toThrow(CryptoError);
      await expect(parseRecoveryCode("ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ")).rejects.toThrow(
        CryptoError
      );
    });
  });

  describe("7. Local Keystore (IndexedDB)", () => {
    it("saves and retrieves cryptographic identity from IndexedDB", async () => {
      const kp = await generateIdentityKeypair();
      const keyId = "test-uuid-1234";

      await saveLocalIdentity(kp, keyId);
      const loaded = await getLocalIdentity();

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe("active_identity");
      expect(loaded?.keyId).toBe(keyId);
      expect(loaded?.publicKey).toEqual(kp.publicKey);
      expect(loaded?.privateKey).toEqual(kp.privateKey);
    });

    it("updates key ID on existing local record", async () => {
      const kp = await generateIdentityKeypair();
      await saveLocalIdentity(kp);

      await updateLocalKeyId("updated-uuid-5678");
      const loaded = await getLocalIdentity();
      expect(loaded?.keyId).toBe("updated-uuid-5678");
    });

    it("clears local identity cleanly", async () => {
      const kp = await generateIdentityKeypair();
      await saveLocalIdentity(kp);
      expect(await getLocalIdentity()).not.toBeNull();

      await clearLocalIdentity();
      expect(await getLocalIdentity()).toBeNull();
    });
  });

  describe("8. Private Key Leakage Safeguards & Sanitization", () => {
    it("redacts private_key, secret_key, and recovery secrets from logger payloads", () => {
      const sensitivePayload = {
        userId: "user-123",
        private_key: "should_not_leak_private_key",
        secret_key: "should_not_leak_secret_key",
        recovery_phrase: "ABCD-EF01-2345-6789",
        seed: "secret_seed_buffer",
        mnemonic: "word1 word2 word3",
        plaintext: "Secret message content",
        ciphertext: "sealed_box_base64",
      };

      const sanitized = sanitizeLogPayload(sensitivePayload) as Record<string, unknown>;

      expect(sanitized.userId).toBe("user-123");
      expect(sanitized.private_key).toBe("[REDACTED]");
      expect(sanitized.secret_key).toBe("[REDACTED]");
      expect(sanitized.recovery_phrase).toBe("[REDACTED]");
      expect(sanitized.seed).toBe("[REDACTED]");
      expect(sanitized.mnemonic).toBe("[REDACTED]");
      expect(sanitized.plaintext).toBe("[REDACTED]");
      expect(sanitized.ciphertext).toBe("[REDACTED]");
    });

    it("verifies encrypted envelope contains only safe public metadata and payload", () => {
      const envelope: EncryptedMessageEnvelope = {
        v: 1,
        alg: "x25519-xsalsa20poly1305",
        kid: "some-uuid",
        payload: "base64-ciphertext-here",
      };

      expect(envelope).not.toHaveProperty("privateKey");
      expect(envelope).not.toHaveProperty("secretKey");
      expect(envelope).not.toHaveProperty("plaintext");
      expect(envelope.v).toBe(1);
      expect(envelope.alg).toBe("x25519-xsalsa20poly1305");
    });
  });
});
