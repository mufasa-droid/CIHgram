/**
 * User Profile & Settings Types
 *
 * Defines domain models, DTOs, and action response types for
 * authenticated profile viewing and editing.
 */

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountInfo {
  email: string;
  provider: string;
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  membershipStatus: string;
  joinedAt: string;
}

export interface ProfileSettingsData {
  profile: UserProfile;
  account: AccountInfo;
}

export interface UpdateProfileInput {
  displayName: string;
  username: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

export type UpdateProfileResult =
  | {
      success: true;
      profile: UserProfile;
    }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string>;
    };

export interface GetProfileSettingsResult {
  success: boolean;
  data?: ProfileSettingsData;
  error?: string;
}
