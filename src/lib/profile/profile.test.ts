import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateProfileSchema, bioSchema, avatarUrlSchema } from "./validation";
import { getUserProfileAndAccount, updateUserProfile } from "./service";
import { updateProfileAction, getProfileSettingsAction } from "./actions";
import { AuthorizationError, ConflictError } from "@/lib/errors";
import type { User } from "@supabase/supabase-js";
import type { UpdateProfileInput } from "./types";

// Mock dependencies
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/onboarding", () => ({
  getUserAdmissionStatus: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";

describe("Prompt 009: Profile & Settings Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Validation & Input Constraints", () => {
    it("accepts valid profile inputs with normal values", () => {
      const input = {
        displayName: "Ada Lovelace",
        username: "ada_lovelace",
        bio: "Mathematician and computer programmer.",
        avatarUrl: "https://example.com/avatar.jpg",
      };

      const parsed = updateProfileSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.displayName).toBe("Ada Lovelace");
        expect(parsed.data.username).toBe("ada_lovelace");
        expect(parsed.data.bio).toBe("Mathematician and computer programmer.");
        expect(parsed.data.avatarUrl).toBe("https://example.com/avatar.jpg");
      }
    });

    it("sanitizes empty bio and avatarUrl to null", () => {
      const input = {
        displayName: "Grace Hopper",
        username: "ghopper",
        bio: "   ",
        avatarUrl: "",
      };

      const parsed = updateProfileSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.bio).toBeNull();
        expect(parsed.data.avatarUrl).toBeNull();
      }
    });

    it("rejects invalid display names (empty or too long)", () => {
      expect(updateProfileSchema.safeParse({ displayName: "", username: "validuser" }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "   ", username: "validuser" }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "a".repeat(51), username: "validuser" }).success).toBe(false);
    });

    it("rejects invalid usernames (< 3 chars, > 30 chars, or illegal characters)", () => {
      expect(updateProfileSchema.safeParse({ displayName: "Valid", username: "ab" }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "Valid", username: "a".repeat(31) }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "Valid", username: "invalid@name" }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "Valid", username: "-invalid" }).success).toBe(false);
      expect(updateProfileSchema.safeParse({ displayName: "Valid", username: "invalid-" }).success).toBe(false);
    });

    it("rejects bio longer than 250 characters", () => {
      const longBio = "a".repeat(251);
      const parsed = bioSchema.safeParse(longBio);
      expect(parsed.success).toBe(false);
    });

    it("rejects insecure or non-HTTP avatar URLs", () => {
      expect(avatarUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
      expect(avatarUrlSchema.safeParse("data:image/png;base64,1234").success).toBe(false);
      expect(avatarUrlSchema.safeParse("ftp://example.com/pic.png").success).toBe(false);
      expect(avatarUrlSchema.safeParse("not a url").success).toBe(false);
      expect(avatarUrlSchema.safeParse("https://valid.com/pic.jpg").success).toBe(true);
    });

    it("strips and ignores unpermitted protected fields", () => {
      const maliciousPayload = {
        displayName: "Legit Name",
        username: "legituser",
        role: "admin",
        id: "attacker-chosen-uuid",
        organization_id: "other-org-uuid",
        is_admin: true,
      };

      const parsed = updateProfileSchema.safeParse(maliciousPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as Record<string, unknown>).role).toBeUndefined();
        expect((parsed.data as Record<string, unknown>).id).toBeUndefined();
        expect((parsed.data as Record<string, unknown>).organization_id).toBeUndefined();
        expect((parsed.data as Record<string, unknown>).is_admin).toBeUndefined();
      }
    });
  });

  describe("2. Server Authorization & Identity Boundary", () => {
    it("rejects unauthenticated requests in getUserProfileAndAccount", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({ state: "unauthenticated" });

      await expect(getUserProfileAndAccount()).rejects.toThrow(AuthorizationError);
    });

    it("rejects unauthenticated requests in updateUserProfile", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({ state: "unauthenticated" });

      await expect(
        updateUserProfile({ displayName: "Test", username: "testuser" })
      ).rejects.toThrow(AuthorizationError);
    });

    it("rejects requests from ineligible / non-admitted users", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "ineligible",
        email: "intruder@external.com",
        domain: "external.com",
      });

      await expect(getUserProfileAndAccount()).rejects.toThrow(AuthorizationError);
      await expect(
        updateUserProfile({ displayName: "Test", username: "testuser" })
      ).rejects.toThrow(AuthorizationError);
    });

    it("retrieves own profile and account info strictly for authenticated caller", async () => {
      const mockUser = { id: "user-123", email: "alice@cih.org" };
      const mockProfile = {
        id: "user-123",
        username: "alice",
        display_name: "Alice Smith",
        avatar_url: null,
        bio: "Research engineer",
        created_at: "2026-10-08T00:00:00Z",
        updated_at: "2026-10-08T00:00:00Z",
      };
      const mockMember = {
        joined_at: "2026-10-08T00:00:00Z",
        role: "member",
        status: "active",
      };

      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "admitted",
        user: mockUser as unknown as User,
        profile: { username: "alice", displayName: "Alice Smith", avatarUrl: null },
        organization: { id: "org-1", name: "CIH Global", slug: "cih", role: "member" },
      });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn((col: string, val: string) => {
                expect(col).toBe("id");
                expect(val).toBe("user-123");
                return {
                  single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
                };
              }),
            };
          }
          if (table === "organization_members") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
            };
          }
          return {};
        }),
      };

      vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await getUserProfileAndAccount();

      expect(result.profile.id).toBe("user-123");
      expect(result.profile.displayName).toBe("Alice Smith");
      expect(result.profile.bio).toBe("Research engineer");
      expect(result.account.email).toBe("alice@cih.org");
      expect(result.account.organizationName).toBe("CIH Global");
      expect(result.account.role).toBe("member");
    });

    it("enforces session user ID binding during updates, preventing tampering", async () => {
      const mockUser = { id: "user-123", email: "alice@cih.org" };

      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "admitted",
        user: mockUser as unknown as User,
        profile: { username: "alice", displayName: "Alice Smith", avatarUrl: null },
        organization: { id: "org-1", name: "CIH Global", slug: "cih", role: "member" },
      });

      let updateQueryId: string | null = null;
      let updatedPayload: Record<string, unknown> | null = null;

      const mockSupabase = {
        from: vi.fn(() => ({
          update: vi.fn((payload: Record<string, unknown>) => {
            updatedPayload = payload;
            return {
              eq: vi.fn((col: string, val: string) => {
                updateQueryId = val;
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "user-123",
                      username: "alice",
                      display_name: payload.display_name,
                      avatar_url: payload.avatar_url,
                      bio: payload.bio,
                      created_at: "2026-10-08T00:00:00Z",
                      updated_at: "2026-10-09T00:00:00Z",
                    },
                    error: null,
                  }),
                };
              }),
            };
          }),
        })),
      };

      vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>);

      // Even if client passes a malicious ID, the server strictly uses session user ID
      const result = await updateUserProfile({
        displayName: "Alice New",
        username: "alice",
        bio: "Updated bio",
        avatarUrl: "https://example.com/avatar2.png",
        id: "attacker-target-uuid", // malicious extra field
      } as unknown as UpdateProfileInput);

      expect(updateQueryId).toBe("user-123");
      const capturedPayload = updatedPayload as Record<string, unknown> | null;
      expect(capturedPayload?.display_name).toBe("Alice New");
      expect(capturedPayload?.bio).toBe("Updated bio");
      expect(capturedPayload?.id).toBeUndefined(); // strictly stripped
      expect(result.displayName).toBe("Alice New");
    });

    it("prevents username collisions and returns ConflictError", async () => {
      const mockUser = { id: "user-123", email: "alice@cih.org" };

      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "admitted",
        user: mockUser as unknown as User,
        profile: { username: "alice", displayName: "Alice Smith", avatarUrl: null },
        organization: { id: "org-1", name: "CIH Global", slug: "cih", role: "member" },
      });

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "user-456" }, // another user owns 'bob'
            error: null,
          }),
        })),
      };

      vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>);

      await expect(
        updateUserProfile({ displayName: "Alice", username: "bob" })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("3. Server Actions Boundary", () => {
    it("updateProfileAction returns structured error on validation failure", async () => {
      const res = await updateProfileAction({
        displayName: "",
        username: "bad user",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBeDefined();
      }
    });

    it("getProfileSettingsAction handles authorization errors cleanly", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({ state: "unauthenticated" });

      const res = await getProfileSettingsAction();
      expect(res.success).toBe(false);
      expect(res.error).toContain("must be an active member");
    });
  });
});
