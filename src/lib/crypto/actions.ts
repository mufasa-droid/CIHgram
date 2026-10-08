"use server";

import { registerPublicKey, getRecipientPublicKey, getUserKeyStatus } from "./keys-service";
import type { PublicKeyRecord, UserKeyStatus } from "./types";

export interface RegisterPublicKeyResult {
  success: boolean;
  key?: PublicKeyRecord;
  error?: string;
}

export interface GetRecipientPublicKeyResult {
  success: boolean;
  key?: PublicKeyRecord;
  error?: string;
}

export interface GetUserKeyStatusResult {
  success: boolean;
  status?: UserKeyStatus;
  error?: string;
}

/**
 * Server Action: Registers the caller's active public encryption key.
 */
export async function registerPublicKeyAction(
  publicKeyBase64: string
): Promise<RegisterPublicKeyResult> {
  try {
    const key = await registerPublicKey(publicKeyBase64);
    return { success: true, key };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to register public key";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Retrieves the active public key of an organization peer.
 */
export async function getRecipientPublicKeyAction(
  recipientUserId: string
): Promise<GetRecipientPublicKeyResult> {
  try {
    const key = await getRecipientPublicKey(recipientUserId);
    return { success: true, key };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve recipient key";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Queries the caller's server key registration status.
 */
export async function getUserKeyStatusAction(): Promise<GetUserKeyStatusResult> {
  try {
    const status = await getUserKeyStatus();
    return { success: true, status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check key status";
    return { success: false, error: message };
  }
}
