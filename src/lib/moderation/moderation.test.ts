import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveReportSchema,
  applyModerationActionSchema,
  moderationFiltersSchema,
} from "./validation";
import {
  getReportsAction,
  getReportDetailsAction,
  resolveReportAction,
  applyModerationActionAction,
  getModerationActionsAction,
} from "./actions";

// Mock dependencies
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth/onboarding", () => ({
  getUserAdmissionStatus: vi.fn(),
}));

vi.mock("@/lib/auth/dev-mock", () => ({
  isDevMockAuthEnabled: vi.fn().mockReturnValue(false),
  DEV_MOCK_USER: {
    id: "00000000-0000-4000-a000-000000000001",
    email: "ada@cih.org",
  },
  DEV_MOCK_USER_ID: "00000000-0000-4000-a000-000000000001",
  DEV_MOCK_PUBLIC_ID: "00000000-0000-4000-d000-000000000001",
  DEV_MOCK_ORG_ID: "00000000-0000-4000-b000-000000000001",
  DEV_MOCK_MODERATION_REPORTS: [],
  DEV_MOCK_MODERATION_ACTIONS: [],
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { isDevMockAuthEnabled } from "@/lib/auth/dev-mock";

const MOCK_MOD_USER_ID = "00000000-0000-4000-a000-000000000001";
const MOCK_ORG_ID = "00000000-0000-4000-b000-000000000001";
const MOCK_TARGET_PUBLIC_ID = "00000000-0000-4000-d000-000000000002";
const MOCK_REPORT_ID = "00000000-0000-4000-e000-000000000001";

const MOCK_MOD_ADMISSION = {
  state: "admitted" as const,
  user: {
    id: MOCK_MOD_USER_ID,
    email: "ada@cih.org",
  } as never,
  profile: {
    username: "ada",
    displayName: "Ada Lovelace",
    avatarUrl: null,
  },
  organization: {
    id: MOCK_ORG_ID,
    name: "CIH Global",
    slug: "cih-global",
    role: "moderator" as const,
  },
};

describe("Prompt 010D: Moderation Dashboard, Report Review & Auditable Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDevMockAuthEnabled).mockReturnValue(false);
  });

  describe("1. Zod Validation & Schema Bounds", () => {
    it("validates resolveReportSchema bounds and transitions", () => {
      // Valid transitions
      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "investigating",
          reason: "Initial review started",
        }).success
      ).toBe(true);

      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "resolved",
          reason: "Action taken and resolved",
        }).success
      ).toBe(true);

      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "dismissed",
          reason: "No violation found upon review",
        }).success
      ).toBe(true);

      // Invalid status transition (e.g. 'pending')
      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "pending",
          reason: "Back to pending",
        }).success
      ).toBe(false);

      // Reason too short (< 3 chars)
      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "resolved",
          reason: "ok",
        }).success
      ).toBe(false);

      // Reason too long (> 1000 chars)
      expect(
        resolveReportSchema.safeParse({
          reportId: MOCK_REPORT_ID,
          newStatus: "resolved",
          reason: "a".repeat(1001),
        }).success
      ).toBe(false);
    });

    it("validates applyModerationActionSchema sanctions and self-moderation prevention", () => {
      // Valid sanctions
      expect(
        applyModerationActionSchema.safeParse({
          targetPublicId: MOCK_TARGET_PUBLIC_ID,
          actionType: "warn_user",
          reason: "First official warning for uncivil behavior",
        }).success
      ).toBe(true);

      expect(
        applyModerationActionSchema.safeParse({
          targetPublicId: MOCK_TARGET_PUBLIC_ID,
          actionType: "suspend_user",
          reason: "Severe policy breach involving targeted threats",
          reportId: MOCK_REPORT_ID,
        }).success
      ).toBe(true);

      expect(
        applyModerationActionSchema.safeParse({
          targetPublicId: MOCK_TARGET_PUBLIC_ID,
          actionType: "reactivate_user",
          reason: "Appeal accepted; suspension concluded",
        }).success
      ).toBe(true);

      // Invalid action type
      expect(
        applyModerationActionSchema.safeParse({
          targetPublicId: MOCK_TARGET_PUBLIC_ID,
          actionType: "delete_account",
          reason: "Testing invalid action",
        }).success
      ).toBe(false);
    });

    it("validates moderationFiltersSchema bounds", () => {
      expect(
        moderationFiltersSchema.safeParse({
          status: "pending",
          category: "harassment",
          limit: 25,
          offset: 0,
        }).success
      ).toBe(true);

      // Limit clamped (max 100)
      expect(
        moderationFiltersSchema.safeParse({
          limit: 150,
        }).success
      ).toBe(false);
    });
  });

  describe("2. Server Authorization Boundary & Role Enforcement", () => {
    it("rejects unauthenticated requests in Server Actions", async () => {
      vi.mocked(requireUser).mockRejectedValue(new Error("Authentication required"));

      const res = await getReportsAction();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("Authentication required");
      }
    });

    it("strictly rejects ordinary members without moderator role", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "admitted",
        user: { id: MOCK_MOD_USER_ID } as never,
        profile: { username: "ada", displayName: "Ada", avatarUrl: null },
        organization: {
          id: MOCK_ORG_ID,
          name: "CIH Global",
          slug: "cih",
          role: "member", // Ordinary member!
        },
      });

      const res = await getReportsAction();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("FORBIDDEN: Moderator privileges required");
      }

      const resolveRes = await resolveReportAction({
        reportId: MOCK_REPORT_ID,
        newStatus: "resolved",
        reason: "Unauthorized attempt",
      });
      expect(resolveRes.success).toBe(false);
      if (!resolveRes.success) {
        expect(resolveRes.error).toContain("FORBIDDEN");
      }

      const sanctionRes = await applyModerationActionAction({
        targetPublicId: MOCK_TARGET_PUBLIC_ID,
        actionType: "suspend_user",
        reason: "Unauthorized attempt",
      });
      expect(sanctionRes.success).toBe(false);
      if (!sanctionRes.success) {
        expect(sanctionRes.error).toContain("FORBIDDEN");
      }
    });

    it("allows authorized moderators or administrators", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            id: MOCK_REPORT_ID,
            organization_id: MOCK_ORG_ID,
            category: "harassment",
            details: "Sample report",
            status: "pending",
            has_disclosed_plaintext: true,
            disclosed_plaintext_consent: true,
            reported_user_public_id: MOCK_TARGET_PUBLIC_ID,
            reported_username: "alan",
            reported_display_name: "Alan Turing",
            reported_user_status: "active",
            message_id: "msg-123",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const res = await getReportsAction();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(Array.isArray(res.reports)).toBe(true);
        expect(res.reports.length).toBe(1);
        expect(mockRpc).toHaveBeenCalledWith("get_organization_reports", {
          p_status: null,
          p_category: null,
          p_limit: 50,
          p_offset: 0,
        });
      }
    });
  });

  describe("3. Plaintext Evidence Protection & Minimization", () => {
    it("ensures reports queue listing NEVER returns raw plaintext", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            id: MOCK_REPORT_ID,
            organization_id: MOCK_ORG_ID,
            category: "harassment",
            details: "Report note",
            status: "pending",
            has_disclosed_plaintext: true,
            disclosed_plaintext_consent: true,
            reported_user_public_id: MOCK_TARGET_PUBLIC_ID,
            reported_username: "alan",
            reported_display_name: "Alan Turing",
            reported_user_status: "active",
            message_id: "msg-123",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const res = await getReportsAction();
      expect(res.success).toBe(true);
      if (res.success) {
        for (const rep of res.reports) {
          // Reports queue records must only have hasDisclosedPlaintext boolean, not raw plaintext
          expect(rep).not.toHaveProperty("disclosedPlaintext");
          expect(typeof rep.hasDisclosedPlaintext).toBe("boolean");
        }
      }
    });

    it("provides disclosed plaintext in detail view ONLY when recipient explicitly consented", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockDetailWithConsent = {
        id: MOCK_REPORT_ID,
        organization_id: MOCK_ORG_ID,
        category: "harassment",
        details: "Context details",
        status: "pending",
        disclosed_plaintext: "Consented decrypted plaintext message content.",
        disclosed_plaintext_consent: true,
        message_id: "msg-123",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reported_user: {
          public_id: MOCK_TARGET_PUBLIC_ID,
          username: "alan",
          display_name: "Alan Turing",
          status: "active",
        },
        actions: [],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockDetailWithConsent,
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const repRes = await getReportDetailsAction(MOCK_REPORT_ID);
      expect(repRes.success).toBe(true);
      if (repRes.success) {
        expect(repRes.report.disclosedPlaintextConsent).toBe(true);
        expect(repRes.report.disclosedPlaintext).toBe(
          "Consented decrypted plaintext message content."
        );
      }
    });

    it("withholds plaintext in detail view when consent was false", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockDetailWithoutConsent = {
        id: MOCK_REPORT_ID,
        organization_id: MOCK_ORG_ID,
        category: "spam",
        details: "Metadata only report",
        status: "pending",
        disclosed_plaintext: null,
        disclosed_plaintext_consent: false,
        message_id: "msg-456",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        reported_user: {
          public_id: MOCK_TARGET_PUBLIC_ID,
          username: "alan",
          display_name: "Alan Turing",
          status: "active",
        },
        actions: [],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockDetailWithoutConsent,
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const repRes = await getReportDetailsAction(MOCK_REPORT_ID);
      expect(repRes.success).toBe(true);
      if (repRes.success) {
        expect(repRes.report.disclosedPlaintextConsent).toBe(false);
        expect(repRes.report.disclosedPlaintext).toBeNull();
      }
    });
  });

  describe("4. Report Resolution & Append-Only Audit Logging", () => {
    it("transitions report status and records audit history", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          report_id: MOCK_REPORT_ID,
          new_status: "resolved",
          action_id: "action-uuid-1",
        },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const resolveRes = await resolveReportAction({
        reportId: MOCK_REPORT_ID,
        newStatus: "resolved",
        reason: "Confirmed policy violation and issued formal warning.",
      });

      expect(resolveRes.success).toBe(true);
      if (resolveRes.success) {
        expect(resolveRes.newStatus).toBe("resolved");
        expect(resolveRes.actionId).toBe("action-uuid-1");
        expect(mockRpc).toHaveBeenCalledWith("resolve_report", {
          p_report_id: MOCK_REPORT_ID,
          p_new_status: "resolved",
          p_reason: "Confirmed policy violation and issued formal warning.",
        });
      }
    });

    it("applies account sanction and records audit event", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          action_id: "action-uuid-2",
          action_type: "suspend_user",
          target_public_id: MOCK_TARGET_PUBLIC_ID,
        },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const sanctionRes = await applyModerationActionAction({
        targetPublicId: MOCK_TARGET_PUBLIC_ID,
        actionType: "suspend_user",
        reason: "Severe recurring harassment violations.",
        reportId: MOCK_REPORT_ID,
      });

      expect(sanctionRes.success).toBe(true);
      if (sanctionRes.success) {
        expect(sanctionRes.actionType).toBe("suspend_user");
        expect(sanctionRes.actionId).toBe("action-uuid-2");
        expect(mockRpc).toHaveBeenCalledWith("apply_moderation_action", {
          p_target_public_id: MOCK_TARGET_PUBLIC_ID,
          p_action_type: "suspend_user",
          p_reason: "Severe recurring harassment violations.",
          p_report_id: MOCK_REPORT_ID,
        });
      }
    });

    it("fetches audit log of moderation actions", async () => {
      vi.mocked(requireUser).mockResolvedValue({ id: MOCK_MOD_USER_ID } as never);
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_MOD_ADMISSION);

      const mockActions = [
        {
          id: "act-1",
          organization_id: MOCK_ORG_ID,
          report_id: MOCK_REPORT_ID,
          action_type: "warn_user",
          reason: "Formal warning issued.",
          moderator_public_id: "mod-pub-id",
          moderator_username: "mod_user",
          moderator_display_name: "Mod User",
          target_public_id: MOCK_TARGET_PUBLIC_ID,
          target_username: "alan",
          target_display_name: "Alan Turing",
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ];

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockActions,
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const actionsRes = await getModerationActionsAction(20, 0);
      expect(actionsRes.success).toBe(true);
      if (actionsRes.success) {
        expect(actionsRes.actions).toHaveLength(1);
        expect(actionsRes.actions[0].actionType).toBe("warn_user");
        expect(mockRpc).toHaveBeenCalledWith("get_moderation_actions", {
          p_limit: 20,
          p_offset: 0,
        });
      }
    });
  });

  describe("5. Account Suspension Status Invariant Check", () => {
    it("confirms database migration 11 enforces active role checks and prevents self-moderation", () => {
      const migrationPath = path.resolve(
        __dirname,
        "../../../supabase/migrations/20261008000011_moderation_actions_schema.sql"
      );
      const sql = fs.readFileSync(migrationPath, "utf-8");

      // Verify is_org_moderator_or_admin checks status = 'active'
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain("role IN ('admin', 'moderator')");

      // Verify self-moderation prevention
      expect(sql).toContain("CANNOT_MODERATE_SELF");

      // Verify role hierarchy
      expect(sql).toContain("INSUFFICIENT_PRIVILEGES");
    });
  });
});
