import { CryptoError } from "@/lib/errors";
import { toBase64 } from "./sodium";
import { createRecoveryIdentity, restoreKeypairFromRecoveryCode } from "./recovery";
import {
  getLocalIdentity,
  saveLocalIdentity,
  clearLocalIdentity,
  isKeystoreSupported,
  type StoredIdentityRecord,
} from "./keystore";
import {
  registerPublicKeyAction,
  getUserKeyStatusAction,
} from "./actions";
import type { KeyPair } from "./types";

export type IdentityInitResult =
  | {
      state: "READY";
      identity: StoredIdentityRecord;
      recoveryCode?: string; // Only provided on first-time generation
      isNewIdentity: boolean;
    }
  | {
      state: "KEY_MISSING_RESTORE_REQUIRED";
      serverPublicKey: string;
      serverKeyId: string;
    }
  | {
      state: "STORAGE_UNAVAILABLE";
      error: string;
    };

/**
 * Ensures the authenticated user has a valid client cryptographic identity.
 *
 * CRITICAL SAFETY RULES:
 * 1. If a local identity already exists, returns it immediately without regenerating.
 * 2. If no local identity exists BUT the server already has an active public key for this user,
 *    IT MUST NOT silently generate a new key. That would destroy access to historical messages.
 *    Instead, it transitions to `KEY_MISSING_RESTORE_REQUIRED` so the user can enter their recovery phrase.
 * 3. Only if neither local nor server keys exist does it perform first-time key creation.
 */
export async function initializeUserIdentity(): Promise<IdentityInitResult> {
  if (!isKeystoreSupported()) {
    return {
      state: "STORAGE_UNAVAILABLE",
      error: "Browser local storage (IndexedDB) is disabled or unsupported.",
    };
  }

  // 1. Check server key status
  const statusResult = await getUserKeyStatusAction();
  if (!statusResult.success) {
    throw new CryptoError("Unable to verify encryption key status with server");
  }

  const serverStatus = statusResult.status;

  // 2. Check local IndexedDB storage
  const localIdentity = await getLocalIdentity();
  if (localIdentity) {
    // If the server has an active key for this account, verify it matches
    if (serverStatus?.hasActiveKey && serverStatus.activePublicKey) {
      const localPkBase64 = await toBase64(localIdentity.publicKey);
      if (localPkBase64 === serverStatus.activePublicKey) {
        return {
          state: "READY",
          identity: localIdentity,
          isNewIdentity: false,
        };
      }

      // Mismatch: local key belongs to another account or is obsolete
      // Purge foreign key to prevent cross-account pollution
      await clearLocalIdentity();
      return {
        state: "KEY_MISSING_RESTORE_REQUIRED",
        serverPublicKey: serverStatus.activePublicKey,
        serverKeyId: serverStatus.activeKeyId || "",
      };
    }

    // Server has no active key for this account. If local key was left by a previous user, clear it.
    await clearLocalIdentity();
  }

  // 3. Server key exists, but local key is missing (or was purged due to mismatch)
  if (serverStatus?.hasActiveKey && serverStatus.activePublicKey && serverStatus.activeKeyId) {
    return {
      state: "KEY_MISSING_RESTORE_REQUIRED",
      serverPublicKey: serverStatus.activePublicKey,
      serverKeyId: serverStatus.activeKeyId,
    };
  }

  // 4. First-time identity generation (both local and server are empty)
  const { recoveryCode, keyPair } = await createRecoveryIdentity();
  const publicKeyBase64 = await toBase64(keyPair.publicKey);

  // Register public key on server first (derives user_id from session)
  const registerResult = await registerPublicKeyAction(publicKeyBase64);
  if (!registerResult.success || !registerResult.key) {
    throw new CryptoError(registerResult.error || "Failed to register public key on server");
  }

  // Persist keypair in IndexedDB with server key ID
  await saveLocalIdentity(keyPair, registerResult.key.id);

  const saved = await getLocalIdentity();
  if (!saved) {
    throw new CryptoError("Failed to verify saved local cryptographic identity");
  }

  return {
    state: "READY",
    identity: saved,
    recoveryCode,
    isNewIdentity: true,
  };
}

/**
 * Restores identity from a user-provided recovery phrase.
 * Verifies that the derived key matches the active server key before persisting.
 */
export async function restoreIdentity(recoveryCode: string): Promise<StoredIdentityRecord> {
  if (!isKeystoreSupported()) {
    throw new CryptoError("IndexedDB is unavailable in this environment");
  }

  const keyPair: KeyPair = await restoreKeypairFromRecoveryCode(recoveryCode);
  const derivedPublicKeyBase64 = await toBase64(keyPair.publicKey);

  // Check server key status
  const statusResult = await getUserKeyStatusAction();
  if (statusResult.success && statusResult.status?.hasActiveKey) {
    const serverKey = statusResult.status.activePublicKey;
    if (serverKey && serverKey !== derivedPublicKeyBase64) {
      throw new CryptoError(
        "The entered recovery phrase does not match the active encryption key registered for this account."
      );
    }
  }

  // Save to IndexedDB
  const serverKeyId = statusResult.status?.activeKeyId ?? undefined;
  await saveLocalIdentity(keyPair, serverKeyId);

  const restored = await getLocalIdentity();
  if (!restored) {
    throw new CryptoError("Failed to store restored cryptographic identity");
  }

  return restored;
}

/**
 * Explicit user-initiated key rotation.
 * Generates a new keypair, publishes the new key to Supabase (atomically deactivating
 * previous keys), and persists the new identity locally.
 */
export async function rotateIdentity(): Promise<{
  identity: StoredIdentityRecord;
  recoveryCode: string;
}> {
  if (!isKeystoreSupported()) {
    throw new CryptoError("IndexedDB is unavailable in this environment");
  }

  const { recoveryCode, keyPair } = await createRecoveryIdentity();
  const publicKeyBase64 = await toBase64(keyPair.publicKey);

  const registerResult = await registerPublicKeyAction(publicKeyBase64);
  if (!registerResult.success || !registerResult.key) {
    throw new CryptoError(registerResult.error || "Failed to register rotated key on server");
  }

  await saveLocalIdentity(keyPair, registerResult.key.id);

  const rotated = await getLocalIdentity();
  if (!rotated) {
    throw new CryptoError("Failed to verify rotated identity in local store");
  }

  return {
    identity: rotated,
    recoveryCode,
  };
}

/**
 * Clears local identity from IndexedDB (e.g. during account signout or reset).
 */
export async function resetLocalIdentity(): Promise<void> {
  await clearLocalIdentity();
}
