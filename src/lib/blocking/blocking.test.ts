import { describe, it, expect, vi, beforeEach } from "vitest";
import { publicIdSchema, messageIdSchema } from "./validation";
import {
  blockUser,
  blockMessageSender,
  unblockUser,
  getBlockedUsers,
} from "./service";
import {
  blockUserAction,
  blockMessageSenderAction,
  unblockUserAction,
  getBlockedUsersAction,
} from "./actions";
import { AuthorizationError } from "@/lib/errors";

// Mock dependencies
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/onboarding", () => ({
  getUserAdmissionStatus: vi.fn(),
}));

vi.mock("@/lib/auth/dev-mock", () => ({
  isDevMockAuthEnabled: vi.fn().mockReturnValue(false),
  DEV_MOCK_USER_ID: "00000000-0000-4000-a000-000000000001",
  DEV_MOCK_PUBLIC_ID: "00000000-0000-4000-d000-000000000001",
  DEV_MOCK_BLOCKED_USERS: [],
  DEV_MOCK_DIRECTORY_MEMBERS: [],
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
import { isDevMockAuthEnabled } from "@/lib/auth/dev-mock";

const MOCK_CALLER_USER_ID = "11111111-1111-4111-a111-111111111111";
const MOCK_CALLER_PUBLIC_ID = "11111111-1111-4111-d111-111111111111";
const MOCK_TARGET_PUBLIC_ID = "22222222-2222-4222-d222-222222222222";
const MOCK_MESSAGE_ID = "33333333-3333-4333-d333-333333333333";
const MOCK_ORG_ID = "44444444-4444-4444-a444-444444444444";

const MOCK_ADMITTED_STATUS = {
  state: "admitted" as const,
  user: {
    id: MOCK_CALLER_USER_ID,
    email: "caller@cih.org",
  },
  profile: {
    username: "caller",
    displayName: "Caller User",
    avatarUrl: null,
  },
  organization: {
    id: MOCK_ORG_ID,
    name: "CIH Global",
    slug: "cih-global",
    role: "member" as const,
  },
};

describe("Prompt 010B: User and Sender Blocking Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDevMockAuthEnabled).mockReturnValue(false);
  });

  describe("1. Validation & Input Constraints", () => {
    it("accepts valid UUIDs for publicIdSchema and messageIdSchema", () => {
      expect(publicIdSchema.safeParse(MOCK_TARGET_PUBLIC_ID).success).toBe(true);
      expect(messageIdSchema.safeParse(MOCK_MESSAGE_ID).success).toBe(true);
    });

    it("rejects non-UUID strings for publicIdSchema", () => {
      expect(publicIdSchema.safeParse("not-a-uuid").success).toBe(false);
      expect(publicIdSchema.safeParse("").success).toBe(false);
      expect(publicIdSchema.safeParse(12345).success).toBe(false);
    });

    it("rejects non-UUID strings for messageIdSchema", () => {
      expect(messageIdSchema.safeParse("invalid-message-id").success).toBe(false);
      expect(messageIdSchema.safeParse("").success).toBe(false);
    });
  });

  describe("2. Admission & Authorization Boundary", () => {
    it("rejects unauthenticated users from blocking a user", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "unauthenticated",
      });

      await expect(blockUser(MOCK_TARGET_PUBLIC_ID)).rejects.toThrow(
        AuthorizationError
      );
    });

    it("rejects ineligible users from blocking a sender", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "ineligible",
        email: "ineligible@external.com",
        domain: "external.com",
      });

      await expect(blockMessageSender(MOCK_MESSAGE_ID)).rejects.toThrow(
        AuthorizationError
      );
    });

    it("rejects users needing onboarding from unblocking a user", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "needs_onboarding",
      } as unknown as never);

      await expect(unblockUser(MOCK_TARGET_PUBLIC_ID)).rejects.toThrow(
        AuthorizationError
      );
    });

    it("rejects non-admitted users from viewing blocked accounts", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "unauthenticated",
      });

      await expect(getBlockedUsers()).rejects.toThrow(AuthorizationError);
    });
  });

  describe("3. Service Layer: blockUser", () => {
    it("calls block_user RPC with target public ID and succeeds", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, already_blocked: false },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockUser(MOCK_TARGET_PUBLIC_ID);
      expect(result.success).toBe(true);
      expect(result.alreadyBlocked).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith("block_user", {
        p_target_public_id: MOCK_TARGET_PUBLIC_ID,
      });
    });

    it("returns alreadyBlocked true idempotently when duplicate block occurs", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, already_blocked: true },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockUser(MOCK_TARGET_PUBLIC_ID);
      expect(result.success).toBe(true);
      expect(result.alreadyBlocked).toBe(true);
    });

    it("handles CANNOT_BLOCK_SELF error from database gracefully", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "CANNOT_BLOCK_SELF: A user cannot block themselves" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockUser(MOCK_CALLER_PUBLIC_ID);
      expect(result.success).toBe(false);
      expect(result.error).toBe("You cannot block yourself.");
    });

    it("handles cross-organization FORBIDDEN error cleanly", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "FORBIDDEN: Target user is not an active member in the caller's organization" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockUser(MOCK_TARGET_PUBLIC_ID);
      expect(result.success).toBe(false);
      expect(result.error).toBe("You can only block members within your active organization.");
    });

    it("handles USER_NOT_FOUND error cleanly", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "USER_NOT_FOUND: Target public ID not found" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockUser(MOCK_TARGET_PUBLIC_ID);
      expect(result.success).toBe(false);
      expect(result.error).toBe("The selected member could not be found.");
    });
  });

  describe("4. Service Layer: blockMessageSender", () => {
    it("calls block_message_sender RPC without exposing sender UUID to caller", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, already_blocked: false },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockMessageSender(MOCK_MESSAGE_ID);
      expect(result.success).toBe(true);
      expect(result.alreadyBlocked).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith("block_message_sender", {
        p_message_id: MOCK_MESSAGE_ID,
      });
      // Ensure result contains NO sender UUID or internal identifiers
      expect((result as unknown as Record<string, unknown>).senderId).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).userId).toBeUndefined();
    });

    it("handles MESSAGE_NOT_FOUND when unauthorized caller attempts to block sender", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "MESSAGE_NOT_FOUND: Message not found or caller is not authorized recipient" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await blockMessageSender(MOCK_MESSAGE_ID);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Message not found or you are not authorized to block its sender.");
    });
  });

  describe("5. Service Layer: unblockUser", () => {
    it("calls unblock_user RPC and removes caller's block", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, unblocked: true },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await unblockUser(MOCK_TARGET_PUBLIC_ID);
      expect(result.success).toBe(true);
      expect(result.unblocked).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("unblock_user", {
        p_target_public_id: MOCK_TARGET_PUBLIC_ID,
      });
    });
  });

  describe("6. Service Layer: getBlockedUsers (Privacy Shield)", () => {
    it("returns safe public projection and shields internal auth UUIDs", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            public_id: MOCK_TARGET_PUBLIC_ID,
            username: "blocked_peer",
            display_name: "Blocked Peer",
            avatar_url: null,
            blocked_at: "2026-10-09T12:00:00Z",
          },
        ],
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const users = await getBlockedUsers();
      expect(users).toHaveLength(1);
      expect(users[0]).toEqual({
        publicId: MOCK_TARGET_PUBLIC_ID,
        username: "blocked_peer",
        displayName: "Blocked Peer",
        avatarUrl: null,
        blockedAt: "2026-10-09T12:00:00Z",
      });

      // Strict security invariants: No internal auth UUIDs or emails
      expect((users[0] as unknown as Record<string, unknown>).id).toBeUndefined();
      expect((users[0] as unknown as Record<string, unknown>).email).toBeUndefined();
      expect((users[0] as unknown as Record<string, unknown>).blocker_id).toBeUndefined();
      expect((users[0] as unknown as Record<string, unknown>).blocked_id).toBeUndefined();
    });
  });

  describe("7. Server Actions Error & Exception Safety", () => {
    it("blockUserAction returns clean failure on invalid input", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const result = await blockUserAction("invalid-id");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("blockMessageSenderAction returns clean failure on invalid input", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const result = await blockMessageSenderAction("invalid-id");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("unblockUserAction returns clean failure on invalid input", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const result = await unblockUserAction("invalid-id");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("getBlockedUsersAction returns error object on service failure", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "DB_CONNECTION_ERROR" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await getBlockedUsersAction();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unable to load blocked accounts");
    });
  });
});
