import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { isDevMockAuthEnabled, DEV_MOCK_REPORTS } from "@/lib/auth/dev-mock";
import { createReportSchema } from "./validation";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ReportInput, ReportResult } from "./types";

/**
 * Submits an abuse report for a received message.
 *
 * CRITICAL PRIVACY & SECURITY INVARIANTS:
 * - Caller must be the active recipient of the message (enforced in PostgreSQL).
 * - Sender identity is NEVER exposed to the reporter.
 * - Disclosed plaintext is accepted ONLY when explicit consent is provided.
 * - Duplicate reports for the same message are rejected at the database level.
 * - Rate limits (10/hour) are enforced at the database level.
 */
export async function createMessageReport(
  input: ReportInput
): Promise<ReportResult> {
  const status = await getUserAdmissionStatus();
  if (status.state !== "admitted") {
    throw new AuthorizationError(
      "You must be an active member to report messages."
    );
  }

  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message || "Invalid report submission data."
    );
  }

  const data = parsed.data;

  if (isDevMockAuthEnabled()) {
    const existing = DEV_MOCK_REPORTS.find((r) => r.messageId === data.messageId);
    if (existing) {
      return {
        success: false,
        error: "You have already submitted a report for this message.",
      };
    }

    const reportId = "00000000-0000-4000-e000-" + String(DEV_MOCK_REPORTS.length + 1).padStart(12, "0");
    DEV_MOCK_REPORTS.push({
      id: reportId,
      messageId: data.messageId,
      category: data.category,
      details: data.details || null,
      disclosedPlaintext: data.disclosePlaintext ? data.disclosedPlaintext || null : null,
    });

    return {
      success: true,
      reportId,
    };
  }

  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("create_message_report", {
    p_message_id: data.messageId,
    p_category: data.category,
    p_details: data.details || null,
    p_disclose_plaintext: data.disclosePlaintext,
    p_disclosed_plaintext: data.disclosePlaintext ? data.disclosedPlaintext || null : null,
  });

  if (error) {
    const msg = error.message || "Failed to submit report";

    // Structured logging with zero plaintext or sender identity
    logger.warn("message_report_rejected", {
      actorId: status.user.id,
      messageId: data.messageId,
      category: data.category,
      disclosePlaintext: data.disclosePlaintext,
      reason: msg,
    });

    if (msg.includes("DUPLICATE_REPORT")) {
      return {
        success: false,
        error: "You have already submitted a report for this message.",
      };
    }
    if (msg.includes("RATE_LIMITED")) {
      return {
        success: false,
        error: "You have submitted too many reports recently. Please wait before submitting another.",
      };
    }
    if (msg.includes("MESSAGE_NOT_FOUND")) {
      return {
        success: false,
        error: "Message not found or you are not authorized to report it.",
      };
    }
    if (msg.includes("CANNOT_REPORT_SELF")) {
      return {
        success: false,
        error: "You cannot report your own message.",
      };
    }
    if (msg.includes("FORBIDDEN")) {
      return {
        success: false,
        error: "You can only report messages within your active organization.",
      };
    }

    throw new Error("Unable to submit report. Please try again later.");
  }

  const res = result as { success: boolean; report_id: string };
  return {
    success: true,
    reportId: res.report_id,
  };
}
