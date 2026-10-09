/**
 * Anonymous Messaging Types & Payload Contracts
 *
 * INVARIANTS:
 * 1. Plaintext message contents are NEVER defined in server transit types.
 * 2. Recipient inbox transit types NEVER include sender_id or sender metadata.
 * 3. All transiting payloads strictly contain Base64 sealed box ciphertext.
 */

export interface SendMessageInput {
  recipientId: string;
  keyId: string;
  ciphertext: string;
  protocolVersion: 1;
  alg: "x25519-xsalsa20poly1305";
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface RecipientKeyResolution {
  keyId: string;
  publicKey: string;
  algorithm: string;
}

/**
 * Recipient-Safe Inbox Message Record (as received from server)
 * Note: sender_id and organization_id are strictly excluded.
 */
export interface RecipientInboxMessage {
  id: string;
  ciphertext: string;
  keyId: string;
  protocolVersion: number;
  createdAt: string;
  isRead: boolean;
  isStarred: boolean;
}

export interface GetInboxInput {
  cursor?: string;
  limit?: number;
}

export interface GetInboxResult {
  success: boolean;
  messages: RecipientInboxMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  error?: string;
}

export type DecryptionStatus =
  | "decrypted"
  | "failed"
  | "unsupported_version"
  | "missing_key";

/**
 * Client-Side Decrypted Message Item
 * Plaintext exists strictly in ephemeral client memory and is never persisted.
 */
export interface DecryptedInboxMessage {
  id: string;
  plaintext: string | null;
  keyId: string;
  protocolVersion: number;
  createdAt: string;
  isRead: boolean;
  isStarred: boolean;
  decryptionStatus: DecryptionStatus;
  error?: string;
}

export interface MarkMessageReadResult {
  success: boolean;
  updated?: boolean;
  error?: string;
}

export interface SetMessageStarredResult {
  success: boolean;
  isStarred?: boolean;
  error?: string;
}

export interface DeleteMessageResult {
  success: boolean;
  deleted?: boolean;
  error?: string;
}

export interface GetUnreadCountResult {
  success: boolean;
  unreadCount: number;
  error?: string;
}
