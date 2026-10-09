import { describe, it, expect, vi, beforeEach } from "vitest";
import { decryptInboxMessages, decryptSingleMessage } from "./inbox-service";
import * as keystore from "@/lib/crypto/keystore";
import * as cryptoActions from "@/lib/crypto/actions";
import {
  generateIdentityKeypair,
  encryptSealedBox,
  toBase64,
} from "@/lib/crypto";
import type { RecipientInboxMessage } from "./types";

describe("Prompt 008: Client-Side Inbox Decryption Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("decrypts valid sealed box ciphertext messages using local IndexedDB identity", async () => {
    const keypair = await generateIdentityKeypair();
    const recipientPkBase64 = await toBase64(keypair.publicKey);

    // Mock local identity
    vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
    vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
      id: "active_identity",
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: Date.now(),
      keyId: "key-1234",
    });

    const plaintext1 = "Hello anonymous world! First secret message.";
    const plaintext2 = "Another thoughtful peer feedback note.";

    const ciphertext1 = await encryptSealedBox(plaintext1, recipientPkBase64);
    const ciphertext2 = await encryptSealedBox(plaintext2, recipientPkBase64);

    const messages: RecipientInboxMessage[] = [
      {
        id: "msg-1",
        ciphertext: ciphertext1,
        keyId: "key-1234",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:00:00Z",
        isRead: false,
        isStarred: false,
      },
      {
        id: "msg-2",
        ciphertext: ciphertext2,
        keyId: "key-1234",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:05:00Z",
        isRead: true,
        isStarred: true,
      },
    ];

    const result = await decryptInboxMessages(messages);

    expect(result.keyState).toBe("ready");
    expect(result.items).toHaveLength(2);

    expect(result.items[0].decryptionStatus).toBe("decrypted");
    expect(result.items[0].plaintext).toBe(plaintext1);
    expect(result.items[0].isRead).toBe(false);

    expect(result.items[1].decryptionStatus).toBe("decrypted");
    expect(result.items[1].plaintext).toBe(plaintext2);
    expect(result.items[1].isStarred).toBe(true);
  });

  it("handles missing local identity gracefully and prompts for recovery without silent key generation", async () => {
    vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
    vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue(null);

    // Server has an active key registered
    vi.spyOn(cryptoActions, "getUserKeyStatusAction").mockResolvedValue({
      success: true,
      status: {
        hasActiveKey: true,
        activeKeyId: "key-server-1",
        activePublicKey: "AAAA",
        createdAt: "2026-10-08T00:00:00Z",
        keyCount: 1,
      },
    });

    const messages: RecipientInboxMessage[] = [
      {
        id: "msg-1",
        ciphertext: "dGVzdA==",
        keyId: "key-server-1",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:00:00Z",
        isRead: false,
        isStarred: false,
      },
    ];

    const result = await decryptInboxMessages(messages);

    expect(result.keyState).toBe("missing_key");
    expect(result.serverKeyRegistered).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].decryptionStatus).toBe("missing_key");
    expect(result.items[0].plaintext).toBeNull();
    expect(result.items[0].error).toContain("Encryption key not found");
  });

  it("marks individual corrupted message as failed without failing the rest of the batch", async () => {
    const keypair = await generateIdentityKeypair();
    const recipientPkBase64 = await toBase64(keypair.publicKey);

    vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
    vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
      id: "active_identity",
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: Date.now(),
      keyId: "key-1234",
    });

    const validPlaintext = "I am a valid message!";
    const validCiphertext = await encryptSealedBox(validPlaintext, recipientPkBase64);
    // Invalid/corrupted ciphertext
    const corruptedCiphertext = "B".repeat(64);

    const messages: RecipientInboxMessage[] = [
      {
        id: "msg-corrupted",
        ciphertext: corruptedCiphertext,
        keyId: "key-1234",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:00:00Z",
        isRead: false,
        isStarred: false,
      },
      {
        id: "msg-valid",
        ciphertext: validCiphertext,
        keyId: "key-1234",
        protocolVersion: 1,
        createdAt: "2026-10-09T08:01:00Z",
        isRead: false,
        isStarred: false,
      },
    ];

    const result = await decryptInboxMessages(messages);

    expect(result.keyState).toBe("ready");
    expect(result.items).toHaveLength(2);

    // Corrupted message must fail safely and NEVER display ciphertext as plaintext
    expect(result.items[0].decryptionStatus).toBe("failed");
    expect(result.items[0].plaintext).toBeNull();
    expect(result.items[0].error).toContain("could not be decrypted");

    // Valid message must decrypt normally
    expect(result.items[1].decryptionStatus).toBe("decrypted");
    expect(result.items[1].plaintext).toBe(validPlaintext);
  });

  it("handles unsupported protocol version safely", async () => {
    const keypair = await generateIdentityKeypair();

    vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
    vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
      id: "active_identity",
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: Date.now(),
      keyId: "key-1234",
    });

    const messages: RecipientInboxMessage[] = [
      {
        id: "msg-future-version",
        ciphertext: "dGVzdA==",
        keyId: "key-1234",
        protocolVersion: 2, // Unsupported future version
        createdAt: "2026-10-09T08:00:00Z",
        isRead: false,
        isStarred: false,
      },
    ];

    const result = await decryptInboxMessages(messages);

    expect(result.items[0].decryptionStatus).toBe("unsupported_version");
    expect(result.items[0].plaintext).toBeNull();
    expect(result.items[0].error).toContain("Unsupported protocol version");
  });

  it("decrypts a single message using decryptSingleMessage", async () => {
    const keypair = await generateIdentityKeypair();
    const recipientPkBase64 = await toBase64(keypair.publicKey);

    vi.spyOn(keystore, "isKeystoreSupported").mockReturnValue(true);
    vi.spyOn(keystore, "getLocalIdentity").mockResolvedValue({
      id: "active_identity",
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: Date.now(),
      keyId: "key-1234",
    });

    const text = "Single message decryption test";
    const ciphertext = await encryptSealedBox(text, recipientPkBase64);

    const decrypted = await decryptSingleMessage({
      id: "msg-single",
      ciphertext,
      keyId: "key-1234",
      protocolVersion: 1,
      createdAt: "2026-10-09T08:00:00Z",
      isRead: false,
      isStarred: false,
    });

    expect(decrypted.decryptionStatus).toBe("decrypted");
    expect(decrypted.plaintext).toBe(text);
  });
});
