"use server";

import { requireUser } from "@/lib/auth/session";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { logger } from "@/lib/logger";
import {
  resolveReportSchema,
  applyModerationActionSchema,
  moderationFiltersSchema,
  type ResolveReportInput,
  type ApplyModerationActionInput,
} from "./validation";
import {
  getOrganizationReports,
  getReportDetails,
  resolveReport,
  applyModerationAction,
  getModerationActions,
} from "./service";
import type {
  ReportSummary,
  ReportDetails,
  ModerationAction,
  ModerationFilters,
} from "./types";

/**
 * Server Action: Fetches moderation reports queue.
 * Strictly gated to organization moderators and administrators.
 */
export async function getReportsAction(
  filters: ModerationFilters = {}
): Promise<{ success: true; reports: ReportSummary[] } | { success: false; error: string }> {
  try {
    await requireUser();
    const admission = await getUserAdmissionStatus();

    if (
      admission.state !== "admitted" ||
      (admission.organization.role !== "admin" && admission.organization.role !== "moderator")
    ) {
      return { success: false, error: "FORBIDDEN: Moderator privileges required" };
    }

    const validatedFilters = moderationFiltersSchema.parse(filters);
    const reports = await getOrganizationReports(validatedFilters);

    logger.info("moderation_reports_retrieved", {
      count: reports.length,
      status: validatedFilters.status || "all",
      category: validatedFilters.category || "all",
    });

    return { success: true, reports };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch moderation reports";
    logger.warn("moderation_reports_fetch_failed", { reason: message });
    return { success: false, error: message };
  }
}

/**
 * Server Action: Fetches full detail for a report including consented plaintext evidence.
 */
export async function getReportDetailsAction(
  reportId: string
): Promise<{ success: true; report: ReportDetails } | { success: false; error: string }> {
  try {
    await requireUser();
    const admission = await getUserAdmissionStatus();

    if (
      admission.state !== "admitted" ||
      (admission.organization.role !== "admin" && admission.organization.role !== "moderator")
    ) {
      return { success: false, error: "FORBIDDEN: Moderator privileges required" };
    }

    if (!reportId || typeof reportId !== "string") {
      return { success: false, error: "Invalid report ID" };
    }

    const report = await getReportDetails(reportId);

    logger.info("moderation_report_details_retrieved", {
      reportId,
      hasPlaintext: !!report.disclosedPlaintext,
    });

    return { success: true, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch report details";
    logger.warn("moderation_report_details_fetch_failed", { reportId, reason: message });
    return { success: false, error: message };
  }
}

/**
 * Server Action: Resolves or dismisses a report with mandatory justification.
 */
export async function resolveReportAction(
  input: ResolveReportInput
): Promise<
  | { success: true; reportId: string; newStatus: string; actionId: string }
  | { success: false; error: string }
> {
  try {
    await requireUser();
    const admission = await getUserAdmissionStatus();

    if (
      admission.state !== "admitted" ||
      (admission.organization.role !== "admin" && admission.organization.role !== "moderator")
    ) {
      return { success: false, error: "FORBIDDEN: Moderator privileges required" };
    }

    const validated = resolveReportSchema.parse(input);
    const result = await resolveReport(validated);

    logger.info("moderation_report_resolved", {
      reportId: validated.reportId,
      newStatus: validated.newStatus,
      actionId: result.actionId,
    });

    return {
      success: true,
      reportId: result.reportId,
      newStatus: result.newStatus,
      actionId: result.actionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve report";
    logger.warn("moderation_resolve_report_failed", { reason: message });
    return { success: false, error: message };
  }
}

/**
 * Server Action: Applies a moderation sanction (warn, suspend, reactivate) against a user.
 */
export async function applyModerationActionAction(
  input: ApplyModerationActionInput
): Promise<
  | { success: true; actionId: string; actionType: string; targetPublicId: string }
  | { success: false; error: string }
> {
  try {
    await requireUser();
    const admission = await getUserAdmissionStatus();

    if (
      admission.state !== "admitted" ||
      (admission.organization.role !== "admin" && admission.organization.role !== "moderator")
    ) {
      return { success: false, error: "FORBIDDEN: Moderator privileges required" };
    }

    const validated = applyModerationActionSchema.parse(input);
    const result = await applyModerationAction(validated);

    logger.info("moderation_action_applied", {
      actionType: validated.actionType,
      targetPublicId: validated.targetPublicId,
      reportId: validated.reportId,
      actionId: result.actionId,
    });

    return {
      success: true,
      actionId: result.actionId,
      actionType: result.actionType,
      targetPublicId: result.targetPublicId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply moderation action";
    logger.warn("moderation_action_apply_failed", { reason: message });
    return { success: false, error: message };
  }
}

/**
 * Server Action: Fetches auditable history of moderation actions in the organization.
 */
export async function getModerationActionsAction(
  limit: number = 50,
  offset: number = 0
): Promise<{ success: true; actions: ModerationAction[] } | { success: false; error: string }> {
  try {
    await requireUser();
    const admission = await getUserAdmissionStatus();

    if (
      admission.state !== "admitted" ||
      (admission.organization.role !== "admin" && admission.organization.role !== "moderator")
    ) {
      return { success: false, error: "FORBIDDEN: Moderator privileges required" };
    }

    const actions = await getModerationActions(limit, offset);

    logger.info("moderation_audit_log_retrieved", {
      count: actions.length,
      offset,
    });

    return { success: true, actions };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch moderation actions";
    logger.warn("moderation_actions_fetch_failed", { reason: message });
    return { success: false, error: message };
  }
}
