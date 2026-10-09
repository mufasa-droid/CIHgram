"use server";

import {
  getUserProfileAndAccount,
  updateUserProfile,
} from "./service";
import { AppError } from "@/lib/errors";
import type {
  GetProfileSettingsResult,
  UpdateProfileInput,
  UpdateProfileResult,
} from "./types";

/**
 * Server Action: Updates the authenticated user's public profile attributes.
 */
export async function updateProfileAction(
  input: UpdateProfileInput
): Promise<UpdateProfileResult> {
  try {
    const profile = await updateUserProfile(input);
    return { success: true, profile };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to update profile settings";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Retrieves the authenticated user's profile and account settings.
 */
export async function getProfileSettingsAction(): Promise<GetProfileSettingsResult> {
  try {
    const data = await getUserProfileAndAccount();
    return { success: true, data };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { success: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to load profile settings";
    return { success: false, error: message };
  }
}
