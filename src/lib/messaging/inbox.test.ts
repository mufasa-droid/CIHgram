import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInboxMessagesAction,
  markMessageReadAction,
  setMessageStarredAction,
  deleteMessageAction,
  getInboxUnreadCountAction,
} from "./actions";
import * as authSession from "@/lib/auth/session";
import * as supabaseServer from "@/lib/supabase/server";

describe("Prompt 008: Recipient Inbox Server Actions & Boundary Tests", () => {
  const mockUser = {
    id: "recip-0000-0000-0000-000000000001",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. getInboxMessagesAction", () => {
    it("rejects unauthenticated requests", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await getInboxMessagesAction();

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be signed in");
      expect(result.messages).toHaveLength(0);
    });

    it("rejects invalid cursor format", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const result = await getInboxMessagesAction({
        cursor: "not-a-valid-date",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid cursor timestamp");
    });

    it("retrieves messages safely and NEVER includes sender_id in returned records", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            success: true,
            messages: [
              {
                id: "msg-0000-0000-0000-000000000001",
                ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
                key_id: "key-0000-0000-0000-000000000001",
                protocol_version: 1,
                created_at: "2026-10-09T08:00:00.000Z",
                is_read: false,
                is_starred: true,
              },
            ],
            has_more: false,
            next_cursor: null,
          },
          error: null,
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await getInboxMessagesAction({ limit: 10 });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);

      const msg = result.messages[0];
      expect(msg.id).toBe("msg-0000-0000-0000-000000000001");
      expect(msg.ciphertext).toBe("dGVzdC1jaXBoZXJ0ZXh0");
      expect(msg.keyId).toBe("key-0000-0000-0000-000000000001");
      expect(msg.protocolVersion).toBe(1);
      expect(msg.isRead).toBe(false);
      expect(msg.isStarred).toBe(true);

      // CRITICAL ANONYMITY ASSERTIONS:
      expect((msg as unknown as Record<string, unknown>).sender_id).toBeUndefined();
      expect((msg as unknown as Record<string, unknown>).senderId).toBeUndefined();
      expect((msg as unknown as Record<string, unknown>).organization_id).toBeUndefined();
      expect((msg as unknown as Record<string, unknown>).organizationId).toBeUndefined();

      expect(mockSupabase.rpc).toHaveBeenCalledWith("get_recipient_inbox", {
        p_cursor: null,
        p_limit: 10,
      });
    });

    it("handles database errors gracefully without leaking SQL internals", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "connection timeout / fatal database failure" },
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await getInboxMessagesAction();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unable to load inbox messages at this time. Please try again.");
      expect(result.error).not.toContain("fatal");
      expect(result.error).not.toContain("database failure");
    });
  });

  describe("2. markMessageReadAction", () => {
    it("rejects unauthenticated requests", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await markMessageReadAction("11111111-1111-1111-1111-111111111111");

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be signed in");
    });

    it("rejects non-UUID message IDs", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const result = await markMessageReadAction("invalid-id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid message identifier");
    });

    it("marks message read idempotently via RPC", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: { success: true, updated: true },
          error: null,
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await markMessageReadAction("11111111-1111-1111-1111-111111111111");

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("mark_message_read", {
        p_message_id: "11111111-1111-1111-1111-111111111111",
      });
    });
  });

  describe("3. setMessageStarredAction", () => {
    it("rejects unauthenticated requests", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await setMessageStarredAction("11111111-1111-1111-1111-111111111111", true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be signed in");
    });

    it("updates star state via RPC", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: { success: true, is_starred: true },
          error: null,
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await setMessageStarredAction("11111111-1111-1111-1111-111111111111", true);

      expect(result.success).toBe(true);
      expect(result.isStarred).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("set_message_starred", {
        p_message_id: "11111111-1111-1111-1111-111111111111",
        p_is_starred: true,
      });
    });
  });

  describe("4. deleteMessageAction", () => {
    it("rejects unauthenticated requests", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await deleteMessageAction("11111111-1111-1111-1111-111111111111");

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be signed in");
    });

    it("soft-deletes message via RPC", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: { success: true, deleted: true },
          error: null,
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await deleteMessageAction("11111111-1111-1111-1111-111111111111");

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("delete_message_for_recipient", {
        p_message_id: "11111111-1111-1111-1111-111111111111",
      });
    });
  });

  describe("5. getInboxUnreadCountAction", () => {
    it("returns zero for unauthenticated user", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(null);

      const result = await getInboxUnreadCountAction();

      expect(result.success).toBe(false);
      expect(result.unreadCount).toBe(0);
    });

    it("retrieves unread count for authenticated user", async () => {
      vi.spyOn(authSession, "getCurrentUser").mockResolvedValue(mockUser);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: 4,
          error: null,
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(
        mockSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.createClient>>
      );

      const result = await getInboxUnreadCountAction();

      expect(result.success).toBe(true);
      expect(result.unreadCount).toBe(4);
    });
  });
});
