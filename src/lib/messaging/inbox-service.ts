import { getLocalIdentity, isKeystoreSupported } from "@/lib/crypto/keystore";
import { decryptSealedBox } from "@/lib/crypto/sealed-box";
import { getUserKeyStatusAction } from "@/lib/crypto/actions";
import { CRYPTO_CONSTANTS } from "@/lib/crypto/types";
import { toBase64 } from "@/lib/crypto/sodium";
import type {
  RecipientInboxMessage,
  DecryptedInboxMessage,
} from "./types";

export type InboxKeyState = "ready" | "missing_key" | "unsupported";

export interface DecryptInboxResult {
  items: DecryptedInboxMessage[];
  keyState: InboxKeyState;
  serverKeyRegistered?: boolean;
}

/**
 * Client-Side Decryption Orchestrator for Recipient Inbox:
 *
 * PRIVACY & SECURITY INVARIANTS:
 * 1. Decryption occurs strictly inside the recipient's browser using local IndexedDB private key.
 * 2. Private keys never leave the browser client.
 * 3. Decrypted plaintext is held strictly in ephemeral component/memory state.
 * 4. Failed decryptions never display false plaintext or leak raw ciphertext.
 * 5. Corrupted individual messages do not break or fail the entire inbox batch.
 * 6. Account switching defense: verifies local key belongs to the current authenticated account.
 */
export async function decryptInboxMessages(
  messages: RecipientInboxMessage[]
): Promise<DecryptInboxResult> {
  if (!isKeystoreSupported()) {
    return {
      items: messages.map((m) => ({
        id: m.id,
        plaintext: null,
        keyId: m.keyId,
        protocolVersion: m.protocolVersion,
        createdAt: m.createdAt,
        isRead: m.isRead,
        isStarred: m.isStarred,
        decryptionStatus: "failed",
        error: "Local cryptographic keystore is not supported in this browser.",
      })),
      keyState: "unsupported",
    };
  }

  // 1. Retrieve client's private identity from browser IndexedDB
  const identity = await getLocalIdentity();

  // Check if current user has an active key registered on the server
  let serverKeyRegistered = false;
  let activeServerPublicKey: string | null = null;
  try {
    const statusRes = await getUserKeyStatusAction();
    if (statusRes.success && statusRes.status?.hasActiveKey) {
      serverKeyRegistered = true;
      activeServerPublicKey = statusRes.status.activePublicKey || null;
    }
  } catch {
    // Non-blocking fallback
  }

  if (!identity || !identity.privateKey || identity.privateKey.length === 0) {
    return {
      items: messages.map((m) => ({
        id: m.id,
        plaintext: null,
        keyId: m.keyId,
        protocolVersion: m.protocolVersion,
        createdAt: m.createdAt,
        isRead: m.isRead,
        isStarred: m.isStarred,
        decryptionStatus: "missing_key",
        error: "Encryption key not found on this device.",
      })),
      keyState: "missing_key",
      serverKeyRegistered,
    };
  }

  // Cross-account switching defense: verify that local key matches current account's active server key
  if (activeServerPublicKey) {
    const localPkBase64 = await toBase64(identity.publicKey);
    if (localPkBase64 !== activeServerPublicKey) {
      return {
        items: messages.map((m) => ({
          id: m.id,
          plaintext: null,
          keyId: m.keyId,
          protocolVersion: m.protocolVersion,
          createdAt: m.createdAt,
          isRead: m.isRead,
          isStarred: m.isStarred,
          decryptionStatus: "missing_key",
          error: "Encryption key on this device belongs to a different account.",
        })),
        keyState: "missing_key",
        serverKeyRegistered: true,
      };
    }
  }

  // 2. Decrypt messages locally in client RAM
  const items: DecryptedInboxMessage[] = [];

  for (const message of messages) {
    // Check protocol version
    if (message.protocolVersion !== CRYPTO_CONSTANTS.PROTOCOL_VERSION) {
      items.push({
        id: message.id,
        plaintext: null,
        keyId: message.keyId,
        protocolVersion: message.protocolVersion,
        createdAt: message.createdAt,
        isRead: message.isRead,
        isStarred: message.isStarred,
        decryptionStatus: "unsupported_version",
        error: `Unsupported protocol version (${message.protocolVersion}).`,
      });
      continue;
    }

    try {
      const plaintext = await decryptSealedBox(
        message.ciphertext,
        identity.privateKey,
        identity.publicKey
      );

      items.push({
        id: message.id,
        plaintext,
        keyId: message.keyId,
        protocolVersion: message.protocolVersion,
        createdAt: message.createdAt,
        isRead: message.isRead,
        isStarred: message.isStarred,
        decryptionStatus: "decrypted",
      });
    } catch {
      // Sealed box MAC mismatch, wrong key, or corrupted payload
      items.push({
        id: message.id,
        plaintext: null,
        keyId: message.keyId,
        protocolVersion: message.protocolVersion,
        createdAt: message.createdAt,
        isRead: message.isRead,
        isStarred: message.isStarred,
        decryptionStatus: "failed",
        error: "This message could not be decrypted with your current key.",
      });
    }
  }

  return {
    items,
    keyState: "ready",
  };
}

/**
 * Decrypts a single message item using local identity.
 */
export async function decryptSingleMessage(
  message: RecipientInboxMessage
): Promise<DecryptedInboxMessage> {
  const result = await decryptInboxMessages([message]);
  return (
    result.items[0] || {
      id: message.id,
      plaintext: null,
      keyId: message.keyId,
      protocolVersion: message.protocolVersion,
      createdAt: message.createdAt,
      isRead: message.isRead,
      isStarred: message.isStarred,
      decryptionStatus: "failed",
      error: "Decryption unavailable.",
    }
  );
}
