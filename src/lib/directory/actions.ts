"use server";

import { getDirectoryMembers } from "./service";
import type { PublicMember } from "./types";

export interface SearchMembersResponse {
  success: boolean;
  members: PublicMember[];
  error?: string;
}

/**
 * Server Action for searching directory members within the caller's organization.
 */
export async function searchMembersAction(
  query: string
): Promise<SearchMembersResponse> {
  try {
    const result = await getDirectoryMembers(query);
    return {
      success: true,
      members: result.members,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to search members";
    return {
      success: false,
      members: [],
      error: message,
    };
  }
}
