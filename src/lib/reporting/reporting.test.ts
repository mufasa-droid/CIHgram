import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createReportSchema,
  reportCategorySchema,
  reportDetailsSchema,
} from "./validation";
import { createMessageReport } from "./service";
import { reportMessageAction } from "./actions";
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
  DEV_MOCK_REPORTS: [],
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
const MOCK_ORG_ID = "44444444-4444-4444-a444-444444444444";
const MOCK_MESSAGE_ID = "55555555-5555-4555-a555-555555555555";

const MOCK_ADMITTED_STATUS = {
  state: "admitted" as const,
  user: {
    id: MOCK_CALLER_USER_ID,
    email: "recipient@cih.org",
  },
  profile: {
    username: "recipient",
    displayName: "Recipient User",
    avatarUrl: null,
  },
  organization: {
    id: MOCK_ORG_ID,
    name: "CIH Global",
    slug: "cih-global",
    role: "member" as const,
  },
};

describe("Prompt 010C: Abuse Reporting and Plaintext Evidence Disclosure Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDevMockAuthEnabled).mockReturnValue(false);
  });

  describe("1. Validation & Schema Constraints", () => {
    it("accepts valid categories and rejects invalid ones", () => {
      expect(reportCategorySchema.safeParse("harassment").success).toBe(true);
      expect(reportCategorySchema.safeParse("threats").success).toBe(true);
      expect(reportCategorySchema.safeParse("spam").success).toBe(true);
      expect(reportCategorySchema.safeParse("inappropriate_content").success).toBe(true);
      expect(reportCategorySchema.safeParse("impersonation").success).toBe(true);
      expect(reportCategorySchema.safeParse("other").success).toBe(true);

      expect(reportCategorySchema.safeParse("invalid_category").success).toBe(false);
      expect(reportCategorySchema.safeParse("").success).toBe(false);
    });

    it("accepts valid details up to 1000 characters and transforms empty to null", () => {
      expect(reportDetailsSchema.safeParse("Harassing message received.").data).toBe(
        "Harassing message received."
      );
      expect(reportDetailsSchema.safeParse("").data).toBeNull();
      expect(reportDetailsSchema.safeParse("   ").data).toBeNull();
      expect(reportDetailsSchema.safeParse(null).data).toBeNull();
      expect(reportDetailsSchema.safeParse("a".repeat(1001)).success).toBe(false);
    });

    it("requires plaintext when disclosePlaintext is true", () => {
      const invalidConsent = {
        messageId: MOCK_MESSAGE_ID,
        category: "harassment" as const,
        details: "Some context",
        disclosePlaintext: true,
        disclosedPlaintext: "",
      };
      const res = createReportSchema.safeParse(invalidConsent);
      expect(res.success).toBe(false);
    });

    it("allows omitting plaintext when disclosePlaintext is false", () => {
      const validNoConsent = {
        messageId: MOCK_MESSAGE_ID,
        category: "spam" as const,
        details: "Unwanted spam",
        disclosePlaintext: false,
        disclosedPlaintext: null,
      };
      const res = createReportSchema.safeParse(validNoConsent);
      expect(res.success).toBe(true);
    });
  });

  describe("2. Admission & Authorization Boundary", () => {
    it("rejects unauthenticated users from reporting messages", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "unauthenticated",
      });

      await expect(
        createMessageReport({
          messageId: MOCK_MESSAGE_ID,
          category: "harassment",
          disclosePlaintext: false,
        })
      ).rejects.toThrow(AuthorizationError);
    });

    it("rejects ineligible users from reporting messages", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "ineligible",
        email: "ineligible@external.com",
        domain: "external.com",
      });

      await expect(
        createMessageReport({
          messageId: MOCK_MESSAGE_ID,
          category: "threats",
          disclosePlaintext: false,
        })
      ).rejects.toThrow(AuthorizationError);
    });

    it("rejects users needing onboarding from reporting messages", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue({
        state: "needs_onboarding",
      } as unknown as never);

      await expect(
        createMessageReport({
          messageId: MOCK_MESSAGE_ID,
          category: "spam",
          disclosePlaintext: false,
        })
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe("3. Service Layer: createMessageReport", () => {
    it("submits report with explicit plaintext disclosure when consented", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, report_id: "report-uuid-123" },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "harassment",
        details: "Offensive repeated note",
        disclosePlaintext: true,
        disclosedPlaintext: "Decrypted harassment content",
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toBe("report-uuid-123");
      expect(mockRpc).toHaveBeenCalledWith("create_message_report", {
        p_message_id: MOCK_MESSAGE_ID,
        p_category: "harassment",
        p_details: "Offensive repeated note",
        p_disclose_plaintext: true,
        p_disclosed_plaintext: "Decrypted harassment content",
      });
    });

    it("strictly discards plaintext when disclosePlaintext is false", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, report_id: "report-uuid-456" },
        error: null,
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "spam",
        details: "Spammy note",
        disclosePlaintext: false,
        disclosedPlaintext: null,
      });

      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("create_message_report", {
        p_message_id: MOCK_MESSAGE_ID,
        p_category: "spam",
        p_details: "Spammy note",
        p_disclose_plaintext: false,
        p_disclosed_plaintext: null,
      });
    });

    it("handles DUPLICATE_REPORT database error cleanly", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "DUPLICATE_REPORT: You have already submitted a report for this message." },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "harassment",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("You have already submitted a report for this message.");
    });

    it("handles RATE_LIMITED database error cleanly", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "RATE_LIMITED: You have submitted too many reports recently." },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "spam",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("submitted too many reports");
    });

    it("handles MESSAGE_NOT_FOUND when non-recipient attempts to report message", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "MESSAGE_NOT_FOUND: Message not found or caller is not authorized recipient" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "other",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Message not found or you are not authorized to report it.");
    });

    it("handles CANNOT_REPORT_SELF error", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "CANNOT_REPORT_SELF: You cannot report your own message" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "other",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("You cannot report your own message.");
    });

    it("handles FORBIDDEN cross-organization error", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "FORBIDDEN: Message does not belong to caller active organization" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await createMessageReport({
        messageId: MOCK_MESSAGE_ID,
        category: "other",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("You can only report messages within your active organization.");
    });
  });

  describe("4. Server Action: reportMessageAction", () => {
    it("returns error result on invalid input without crashing", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const result = await reportMessageAction({
        messageId: "not-a-uuid",
        category: "spam",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns clean error message on unexpected exception", async () => {
      vi.mocked(getUserAdmissionStatus).mockResolvedValue(MOCK_ADMITTED_STATUS as never);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "UNEXPECTED_INTERNAL_ERROR" },
      });
      vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as never);

      const result = await reportMessageAction({
        messageId: MOCK_MESSAGE_ID,
        category: "spam",
        disclosePlaintext: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unable to submit report. Please try again later.");
    });
  });
});
