import type { User, Session } from "@supabase/supabase-js";
import type { UserAdmissionStatus } from "./onboarding";
import type { PublicMember } from "@/lib/directory/types";
import type { ProfileSettingsData } from "@/lib/profile/types";
import type { PublicKeyRecord, UserKeyStatus } from "@/lib/crypto/types";

/**
 * Safe development-only mock auth toggle.
 * Strictly forbidden and inactive in production or test environments.
 */
export function isDevMockAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_MOCK_AUTH === "true"
  );
}

export const DEV_MOCK_USER_ID = "00000000-0000-4000-a000-000000000001";
export const DEV_MOCK_PUBLIC_ID = "00000000-0000-4000-d000-000000000001";
export const DEV_MOCK_ORG_ID = "00000000-0000-4000-b000-000000000001";

export const DEV_MOCK_USER: User = {
  id: DEV_MOCK_USER_ID,
  app_metadata: { provider: "google" },
  user_metadata: {
    full_name: "Ada Lovelace",
    name: "Ada Lovelace",
    avatar_url: null,
  },
  aud: "authenticated",
  confirmation_sent_at: "2026-01-01T00:00:00Z",
  confirmed_at: "2026-01-01T00:00:00Z",
  email: "ada@cih.org",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  phone: "",
  role: "authenticated",
  updated_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  identities: [],
  factors: [],
};

export const DEV_MOCK_SESSION: Session = {
  access_token: "mock-dev-access-token",
  refresh_token: "mock-dev-refresh-token",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: DEV_MOCK_USER,
};

export const DEV_MOCK_ADMISSION_STATUS: UserAdmissionStatus = {
  state: "admitted",
  user: DEV_MOCK_USER,
  profile: {
    username: "ada",
    displayName: "Ada Lovelace",
    avatarUrl: null,
  },
  organization: {
    id: DEV_MOCK_ORG_ID,
    name: "CIH Global",
    slug: "cih-global",
    role: "member",
  },
};

export const DEV_MOCK_DIRECTORY_MEMBERS: PublicMember[] = [
  {
    id: "00000000-0000-4000-d000-000000000002",
    username: "alan",
    displayName: "Alan Turing",
    avatarUrl: null,
  },
  {
    id: "00000000-0000-4000-d000-000000000003",
    username: "grace",
    displayName: "Grace Hopper",
    avatarUrl: null,
  },
  {
    id: "00000000-0000-4000-d000-000000000004",
    username: "charles",
    displayName: "Charles Babbage",
    avatarUrl: null,
  },
  {
    id: "00000000-0000-4000-d000-000000000005",
    username: "katherine",
    displayName: "Katherine Johnson",
    avatarUrl: null,
  },
];

export const DEV_MOCK_PROFILE_SETTINGS: ProfileSettingsData = {
  profile: {
    id: DEV_MOCK_USER_ID,
    username: "ada",
    displayName: "Ada Lovelace",
    avatarUrl: null,
    bio: "Analytical engine pioneer & computing visionary. Previewing in local dev mode.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  account: {
    email: "ada@cih.org",
    provider: "Mock Dev Auth",
    userId: DEV_MOCK_USER_ID,
    organizationId: DEV_MOCK_ORG_ID,
    organizationName: "CIH Global",
    organizationSlug: "cih-global",
    role: "member",
    membershipStatus: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
};

// 32-byte Base64 encoded test X25519 public key (44 chars)
export const DEV_MOCK_PUBLIC_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

export const DEV_MOCK_PUBLIC_KEY_RECORD: PublicKeyRecord = {
  id: "00000000-0000-4000-c000-000000000001",
  userId: DEV_MOCK_USER_ID,
  publicKey: DEV_MOCK_PUBLIC_KEY,
  algorithm: "x25519-xsalsa20poly1305",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const DEV_MOCK_KEY_STATUS: UserKeyStatus = {
  hasActiveKey: true,
  activeKeyId: "00000000-0000-4000-c000-000000000001",
  activePublicKey: DEV_MOCK_PUBLIC_KEY,
  createdAt: "2026-01-01T00:00:00.000Z",
  keyCount: 1,
};
