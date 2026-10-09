import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { extractEmailDomain } from "@/lib/auth/domains";
import { isDevMockAuthEnabled, DEV_MOCK_ADMISSION_STATUS } from "./dev-mock";

import { usernameSchema, displayNameSchema } from "@/lib/validation/common";
import { ValidationError, ConflictError, AuthorizationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { User } from "@supabase/supabase-js";

export type UserAdmissionStatus =
  | { state: "unauthenticated" }
  | { state: "ineligible"; email: string; domain: string | null }
  | {
      state: "needs_onboarding";
      user: User;
      email: string;
      eligibleOrganization: { id: string; name: string; slug: string };
      suggestedUsername: string;
      suggestedDisplayName: string;
    }
  | {
      state: "admitted";
      user: User;
      profile: { username: string; displayName: string; avatarUrl: string | null };
      organization: { id: string; name: string; slug: string; role: string };
    };

/**
 * Derives a clean suggested username handle from an email localpart or full name.
 */
export function generateSuggestedUsername(email?: string, name?: string): string {
  let base = "";
  if (email) {
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      base = email.slice(0, atIdx);
    }
  }

  if (!base && name) {
    base = name.toLowerCase().replace(/\s+/g, "_");
  }

  // Clean characters: keep only lowercase alphanumeric, hyphens, underscores
  const sanitized = base.toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  const trimmed = sanitized.slice(0, 20);

  if (trimmed.length >= 3) {
    return trimmed;
  }

  return "user_" + Math.random().toString(36).substring(2, 7);
}

/**
 * Resolves the authenticated user's current admission state server-side.
 * Never trusts client headers or client query parameters.
 */
export async function getUserAdmissionStatus(): Promise<UserAdmissionStatus> {
  if (isDevMockAuthEnabled()) {
    return DEV_MOCK_ADMISSION_STATUS;
  }

  const user = await getCurrentUser();
  if (!user || !user.email) {
    return { state: "unauthenticated" };
  }

  const supabase = await createClient();

  // 1. Check if user already has an active profile and membership
  const { data: profileData } = await supabase
    .from("profiles")
    .select()
    .eq("id", user.id)
    .maybeSingle();

  const { data: memberData } = await supabase
    .from("organization_members")
    .select()
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (profileData && memberData) {
    // User is fully admitted; fetch organization details
    const { data: orgData } = await supabase
      .from("organizations")
      .select()
      .eq("id", memberData.organization_id)
      .maybeSingle();

    if (orgData) {
      return {
        state: "admitted",
        user,
        profile: {
          username: profileData.username,
          displayName: profileData.display_name,
          avatarUrl: profileData.avatar_url,
        },
        organization: {
          id: orgData.id,
          name: orgData.name,
          slug: orgData.slug,
          role: memberData.role,
        },
      };
    }
  }

  // 2. User needs admission or has an ineligible domain
  const domain = extractEmailDomain(user.email);
  if (!domain) {
    return { state: "ineligible", email: user.email, domain: null };
  }

  // Find eligible organization matching domain
  // Use RPC find_organization_by_domain or query organizations
  const { data: matchedOrgs } = await supabase.rpc("find_organization_by_domain", {
    check_domain: domain,
  });

  const eligibleOrg = matchedOrgs && matchedOrgs.length > 0 ? matchedOrgs[0] : null;

  if (!eligibleOrg) {
    logger.warn("unauthorized_domain_attempt", {
      userId: user.id,
      domain,
    });
    return { state: "ineligible", email: user.email, domain };
  }

  const suggestedUsername = generateSuggestedUsername(
    user.email,
    user.user_metadata?.full_name || user.user_metadata?.name
  );

  const suggestedDisplayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    suggestedUsername;

  return {
    state: "needs_onboarding",
    user,
    email: user.email,
    eligibleOrganization: {
      id: eligibleOrg.id,
      name: eligibleOrg.name,
      slug: eligibleOrg.slug,
    },
    suggestedUsername,
    suggestedDisplayName,
  };
}

/**
 * Server-enforced onboarding action.
 * Atomically verifies domain, sets up public profile, and grants member status.
 */
export async function completeOnboarding(input: {
  username: string;
  displayName: string;
}): Promise<{
  success: boolean;
  username: string;
  organizationName: string;
}> {
  const user = await requireUser();
  if (!user.email) {
    throw new AuthorizationError("Authenticated account lacks a verified email");
  }

  // Validate username
  const parsedUsername = usernameSchema.safeParse(input.username);
  if (!parsedUsername.success) {
    throw new ValidationError(parsedUsername.error.issues[0].message);
  }

  // Validate display name
  const parsedDisplayName = displayNameSchema.safeParse(input.displayName);
  if (!parsedDisplayName.success) {
    throw new ValidationError(parsedDisplayName.error.issues[0].message);
  }

  const avatarUrl =
    user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

  const supabase = await createClient();

  // Execute server-enforced atomic procedure in database
  const { data, error } = await supabase.rpc("admit_user_to_organization", {
    user_username: parsedUsername.data,
    user_display_name: parsedDisplayName.data,
    user_avatar_url: avatarUrl,
  });

  if (error) {
    if (error.message.includes("USERNAME_TAKEN")) {
      throw new ConflictError("This username is already taken. Please choose another.");
    }
    if (error.message.includes("INELIGIBLE_DOMAIN")) {
      throw new AuthorizationError("Your email domain is not eligible for this organization.");
    }
    logger.error("onboarding_rpc_failure", { error: error.message, userId: user.id });
    throw new Error(error.message);
  }

  logger.info("user_onboarding_completed", {
    userId: user.id,
    organizationId: data.organization_id,
  });

  return {
    success: true,
    username: data.username,
    organizationName: data.organization_name,
  };
}
