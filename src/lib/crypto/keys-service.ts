import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthenticationError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isValidPublicKey } from "./sodium";
import { CRYPTO_CONSTANTS, type PublicKeyRecord, type UserKeyStatus } from "./types";

/**
 * Registers an active public encryption key for the calling authenticated user.
 * Derives user identity strictly from the verified Supabase session (never client input).
 */
export async function registerPublicKey(publicKeyBase64: string): Promise<PublicKeyRecord> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationError("Authentication required to register encryption key");
  }

  // Validate public key format (must be 32-byte Base64 = 44 characters)
  const valid = await isValidPublicKey(publicKeyBase64);
  if (!valid) {
    throw new ValidationError(
      "Invalid public key format. Expected a 32-byte Base64-encoded X25519 key."
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("register_public_key", {
    p_public_key: publicKeyBase64.trim(),
    p_algorithm: CRYPTO_CONSTANTS.ALGORITHM,
  });

  if (error || !data) {
    logger.error("public_key_registration_failed", {
      userId: user.id,
      error: error?.message,
    });
    throw new Error(error?.message || "Failed to register public key on server");
  }

  const record = data as {
    id: string;
    user_id: string;
    public_key: string;
    algorithm: string;
    is_active: boolean;
    created_at: string;
  };

  logger.info("public_key_registered", {
    userId: user.id,
    keyId: record.id,
    algorithm: record.algorithm,
  });

  return {
    id: record.id,
    userId: record.user_id,
    publicKey: record.public_key,
    algorithm: CRYPTO_CONSTANTS.ALGORITHM,
    isActive: record.is_active,
    createdAt: record.created_at,
  };
}

/**
 * Retrieves the active public key of a recipient.
 * The database enforces that the recipient must belong to the caller's active organization.
 */
export async function getRecipientPublicKey(
  recipientUserId: string
): Promise<PublicKeyRecord> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationError("Authentication required to query recipient key");
  }

  if (!recipientUserId || typeof recipientUserId !== "string") {
    throw new ValidationError("Recipient user ID is required");
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_active_public_key", {
    p_target_user_id: recipientUserId,
  });

  if (error) {
    logger.error("get_active_public_key_failed", {
      callerId: user.id,
      recipientId: recipientUserId,
      error: error.message,
    });
    throw new Error("Failed to retrieve recipient encryption key");
  }

  if (!data || data.length === 0) {
    throw new NotFoundError("Recipient has not registered an encryption key");
  }

  const row = data[0];

  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    algorithm: CRYPTO_CONSTANTS.ALGORITHM,
    isActive: true,
    createdAt: row.created_at,
  };
}

/**
 * Queries whether the authenticated user has an active public key registered on the platform.
 */
export async function getUserKeyStatus(): Promise<UserKeyStatus> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      hasActiveKey: false,
      activeKeyId: null,
      activePublicKey: null,
      createdAt: null,
      keyCount: 0,
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_user_key_status");

  if (error || !data) {
    logger.error("get_user_key_status_failed", {
      userId: user.id,
      error: error?.message,
    });
    return {
      hasActiveKey: false,
      activeKeyId: null,
      activePublicKey: null,
      createdAt: null,
      keyCount: 0,
    };
  }

  const result = data as {
    has_active_key: boolean;
    active_key_id: string | null;
    active_public_key: string | null;
    created_at: string | null;
    key_count: number;
  };

  return {
    hasActiveKey: result.has_active_key,
    activeKeyId: result.active_key_id,
    activePublicKey: result.active_public_key,
    createdAt: result.created_at,
    keyCount: result.key_count ?? 0,
  };
}
