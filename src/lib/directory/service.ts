import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { searchQuerySchema } from "./validation";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PublicMember } from "./types";

export interface DirectoryResult {
  members: PublicMember[];
  organizationName: string;
  organizationId: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Retrieves members of the authenticated user's organization.
 * Automatically excludes the caller from the results and enforces safe public projection.
 */
export async function getDirectoryMembers(
  query = "",
  limit = DEFAULT_LIMIT
): Promise<DirectoryResult> {
  const status = await getUserAdmissionStatus();

  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to search the directory.");
  }

  // Validate and sanitize search query
  const parsedQuery = searchQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    throw new ValidationError(parsedQuery.error.issues[0].message);
  }

  const cleanQuery = parsedQuery.data;
  const clampedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("search_organization_members", {
    query_text: cleanQuery,
    result_limit: clampedLimit,
  });

  if (error) {
    logger.error("directory_search_failed", {
      error: error.message,
      userId: status.user.id,
      organizationId: status.organization.id,
    });
    throw new Error("Unable to load member directory. Please try again later.");
  }

  const members: PublicMember[] = (data || []).map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  }));

  return {
    members,
    organizationName: status.organization.name,
    organizationId: status.organization.id,
  };
}

/**
 * Resolves a specific member by username strictly within the caller's organization.
 * Returns null if the user does not exist or belongs to another organization.
 */
export async function getMemberByUsername(
  username: string
): Promise<PublicMember | null> {
  const status = await getUserAdmissionStatus();

  if (status.state !== "admitted") {
    throw new AuthorizationError("You must be an active member to view member profiles.");
  }

  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_organization_member_by_username", {
    target_username: cleanUsername,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}
