import { CryptoError } from "@/lib/errors";
import { CRYPTO_CONSTANTS, type KeyPair } from "./types";
import { zeroize } from "./sodium";

export interface StoredIdentityRecord {
  id: "active_identity";
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  createdAt: number;
  keyId?: string; // Optional UUID of corresponding public_keys row on server
}

const DB_NAME = CRYPTO_CONSTANTS.KEYSTORE_DB_NAME;
const STORE_NAME = CRYPTO_CONSTANTS.KEYSTORE_STORE_NAME;
const DB_VERSION = 1;
const RECORD_ID = "active_identity";

/**
 * Checks whether IndexedDB is available in the current runtime environment.
 */
export function isKeystoreSupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

/**
 * Opens or initializes the local IndexedDB key store database.
 */
function openDatabase(): Promise<IDBDatabase> {
  if (!isKeystoreSupported()) {
    return Promise.reject(
      new CryptoError("IndexedDB is not supported or accessible in this environment")
    );
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        new CryptoError(
          "Failed to access local cryptographic key store",
          request.error?.message
        )
      );
    };
  });
}

/**
 * Persists an identity keypair to the client's local IndexedDB keystore.
 * Secret keys are stored locally and never transmitted off the client.
 */
export async function saveLocalIdentity(
  keyPair: KeyPair,
  keyId?: string
): Promise<void> {
  if (!keyPair.publicKey || !keyPair.privateKey) {
    throw new CryptoError("Cannot save empty or invalid keypair");
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const record: StoredIdentityRecord = {
      id: RECORD_ID,
      publicKey: new Uint8Array(keyPair.publicKey),
      privateKey: new Uint8Array(keyPair.privateKey),
      createdAt: Date.now(),
      ...(keyId ? { keyId } : {}),
    };

    const request = store.put(record);

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(new CryptoError("Failed to store local cryptographic identity", request.error?.message));
    };

    tx.onerror = () => {
      db.close();
      reject(new CryptoError("Transaction error during key persistence", tx.error?.message));
    };
  });
}

/**
 * Retrieves the client's active local cryptographic identity from IndexedDB.
 * Returns null if no identity exists.
 */
export async function getLocalIdentity(): Promise<StoredIdentityRecord | null> {
  if (!isKeystoreSupported()) {
    return null;
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RECORD_ID);

    request.onsuccess = () => {
      db.close();
      const record = request.result as StoredIdentityRecord | undefined;
      if (!record || !record.privateKey || !record.publicKey) {
        resolve(null);
        return;
      }
      resolve({
        id: RECORD_ID,
        publicKey: new Uint8Array(record.publicKey),
        privateKey: new Uint8Array(record.privateKey),
        createdAt: record.createdAt,
        ...(record.keyId ? { keyId: record.keyId } : {}),
      });
    };

    request.onerror = () => {
      db.close();
      reject(new CryptoError("Failed to read local cryptographic identity", request.error?.message));
    };

    tx.onerror = () => {
      db.close();
      reject(new CryptoError("Transaction error during key retrieval", tx.error?.message));
    };
  });
}

/**
 * Updates the associated server key ID for the stored local identity.
 */
export async function updateLocalKeyId(keyId: string): Promise<void> {
  const existing = await getLocalIdentity();
  if (!existing) {
    throw new CryptoError("No local identity found to update key ID");
  }

  await saveLocalIdentity(
    { publicKey: existing.publicKey, privateKey: existing.privateKey },
    keyId
  );
}

/**
 * Clears the local cryptographic identity from IndexedDB and zeroizes memory buffers.
 */
export async function clearLocalIdentity(): Promise<void> {
  if (!isKeystoreSupported()) {
    return;
  }

  // Attempt to read and zeroize existing buffer before delete
  try {
    const existing = await getLocalIdentity();
    if (existing) {
      await zeroize(existing.privateKey);
    }
  } catch {
    // Continue with delete regardless
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(RECORD_ID);

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(new CryptoError("Failed to clear local cryptographic identity", request.error?.message));
    };

    tx.onerror = () => {
      db.close();
      reject(new CryptoError("Transaction error while clearing keys", tx.error?.message));
    };
  });
}
