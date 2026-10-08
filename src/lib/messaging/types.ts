/**
 * Anonymous Messaging Types & Payload Contracts
 *
 * INVARIANT: Plaintext message contents are NEVER defined in server transit types.
 * All transiting payloads strictly contain Base64 sealed box ciphertext.
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
