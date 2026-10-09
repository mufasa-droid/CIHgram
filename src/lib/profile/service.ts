import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { updateProfileSchema } from "./validation";
import { AuthorizationError, ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ProfileSettingsData, UserProfile } from "./types";

/**
 * Retrieves the authenticated user's profile and account settings.
 *
 * CRITICAL SECURITY BOUNDARIES:
 * - Session derived strictly from verified Supabase Auth cookies / JWT.
 * - Caller must possess active organization membership ('admitted' state).
 * - Only the caller's own profile row is retrieved (id = status.user.id).
 * - Never returns or references sender metadata or foreign profiles.
 */
export async function getUserProfileAndAccount(): Promise<ProfileSettingsData> {
  const status = await getUserAdmissionStatus();

  if (status.state !== "admitted") {
    throw new AuthorizationError(
      "You must be an active member of an organization to view your profile settings."
    );
  }

  const supabase = await createClient();

  // Retrieve user's own profile record
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, created_at, updated_at")
    .eq("id", status.user.id)
    .single();

  if (profileError || !profileData) {
    logger.error("profile_fetch_failed", {
      userId: status.user.id,
      error: profileError?.message,
    });
    throw new Error("Unable to load profile data. Please try again.");
  }

  // Retrieve user's own active organization membership record
  const { data: memberData } = await supabase
    .from("organization_members")
    .select("joined_at, role, status")
    .eq("user_id", status.user.id)
    .eq("status", "active")
    .maybeSingle();

  return {
    profile: {
      id: profileData.id,
      username: profileData.username,
      displayName: profileData.display_name,
      avatarUrl: profileData.avatar_url,
      bio: profileData.bio,
      createdAt: profileData.created_at,
      updatedAt: profileData.updated_at,
    },
    account: {
      email: status.user.email || "",
      provider: "Google OAuth",
      userId: status.user.id,
      organizationId: status.organization.id,
      organizationName: status.organization.name,
      organizationSlug: status.organization.slug,
      role: memberData?.role || status.organization.role || "member",
      membershipStatus: memberData?.status || "active",
      joinedAt: memberData?.joined_at || profileData.created_at,
    },
  };
}

/**
 * Updates the authenticated user's public profile attributes.
 *
 * CRITICAL SECURITY & PRODUCT INVARIANTS:
 * - Target user ID is derived strictly from server session; client cannot supply a foreign ID.
 * - Only permitted public fields are updated (display_name, username, bio, avatar_url).
 * - Organization membership, role, status, and auth.users fields are completely unmodifiable.
 * - Cryptographic keypair and public key records are 100% untouched.
 * - Username uniqueness is checked and enforced; collisions return ConflictError.
 */
export async function updateUserProfile(rawInput: unknown): Promise<UserProfile> {
  const status = await getUserAdmissionStatus();

  if (status.state !== "admitted") {
    throw new AuthorizationError(
      "You must be an active member of an organization to update your profile."
    );
  }

  const parsed = updateProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0].message);
  }

  const { displayName, username, bio, avatarUrl } = parsed.data;
  const supabase = await createClient();

  // If username is changing, verify it is not already claimed by another user
  if (username.toLowerCase() !== status.profile.username.toLowerCase()) {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", status.user.id)
      .maybeSingle();

    if (existing) {
      throw new ConflictError("This username is already taken. Please choose another.");
    }
  }

  // Execute database update scoped strictly to the session's user ID
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      username,
      bio,
      avatar_url: avatarUrl,
    })
    .eq("id", status.user.id)
    .select("id, username, display_name, avatar_url, bio, created_at, updated_at")
    .single();

  if (error) {
    if (
      error.code === "23505" ||
      error.message.includes("idx_profiles_username") ||
      error.message.includes("unique")
    ) {
      throw new ConflictError("This username is already taken. Please choose another.");
    }
    logger.error("profile_update_failed", {
      userId: status.user.id,
      error: error.message,
    });
    throw new Error("Unable to save profile changes. Please try again.");
  }

  logger.info("user_profile_updated", {
    userId: status.user.id,
    organizationId: status.organization.id,
  });

  return {
    id: updated.id,
    username: updated.username,
    displayName: updated.display_name,
    avatarUrl: updated.avatar_url,
    bio: updated.bio,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}
