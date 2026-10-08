import { encryptSealedBox } from "@/lib/crypto/sealed-box";
import { getRecipientPublicKeyAction } from "@/lib/crypto/actions";
import { CRYPTO_CONSTANTS } from "@/lib/crypto/types";
import { sendMessageAction } from "./actions";
import { messageTextSchema } from "./validation";
import type { SendMessageInput, SendMessageResult } from "./types";

export interface SendAnonymousMessageOptions {
  recipientId: string;
  plaintext: string;
}

/**
 * Client-Side Orchestrator for Anonymous Message Delivery:
 * 1. Validates plaintext bounds (1 - 2,000 characters).
 * 2. Fetches the recipient's active public key and key_id from the server.
 * 3. Encrypts the plaintext in client memory using Libsodium Sealed Box (crypto_box_seal).
 * 4. Submits the encrypted payload to the server.
 * 5. Returns delivery confirmation.
 *
 * INVARIANT: Plaintext NEVER leaves this client execution boundary.
 */
export async function sendAnonymousMessage({
  recipientId,
  plaintext,
}: SendAnonymousMessageOptions): Promise<SendMessageResult> {
  // 1. Client-side input validation
  const validation = messageTextSchema.safeParse(plaintext);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid message text",
    };
  }

  const cleanText = validation.data;

  // 2. Resolve recipient's registered public key
  const keyResponse = await getRecipientPublicKeyAction(recipientId);
  if (!keyResponse.success || !keyResponse.key) {
    return {
      success: false,
      error:
        keyResponse.error ||
        "This member has not yet activated encryption on their account and cannot receive messages.",
    };
  }

  const recipientKey = keyResponse.key;

  // 3. Encrypt locally in client RAM
  let ciphertext: string;
  try {
    ciphertext = await encryptSealedBox(cleanText, recipientKey.publicKey);
  } catch {
    return {
      success: false,
      error: "Failed to encrypt message on your device. Please try again.",
    };
  }

  // 4. Assemble encrypted envelope
  const envelope: SendMessageInput = {
    recipientId,
    keyId: recipientKey.id,
    ciphertext,
    protocolVersion: CRYPTO_CONSTANTS.PROTOCOL_VERSION,
    alg: CRYPTO_CONSTANTS.ALGORITHM,
  };

  // 5. Submit ciphertext envelope to server
  const response = await sendMessageAction(envelope);

  return response;
}
