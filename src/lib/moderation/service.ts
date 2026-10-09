import { createClient } from "@/lib/supabase/server";
import { isDevMockAuthEnabled, DEV_MOCK_MODERATION_REPORTS, DEV_MOCK_MODERATION_ACTIONS, DEV_MOCK_PUBLIC_ID } from "@/lib/auth/dev-mock";
import { AppError, AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import type {
  ReportSummary,
  ReportDetails,
  ModerationAction,
  ModerationFilters,
  ReportStatus,
  ReportCategory,
} from "./types";

/**
 * Retrieves organization reports queue for active moderators/admins.
 * Omits disclosed plaintext from bulk listing to protect privacy.
 */
export async function getOrganizationReports(
  filters: ModerationFilters = {}
): Promise<ReportSummary[]> {
  if (isDevMockAuthEnabled()) {
    let list = [...DEV_MOCK_MODERATION_REPORTS];
    if (filters.status) {
      list = list.filter((r) => r.status === filters.status);
    }
    if (filters.category) {
      list = list.filter((r) => r.category === filters.category);
    }
    return list.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      category: r.category,
      details: r.details,
      status: r.status,
      hasDisclosedPlaintext: !!r.disclosedPlaintext && r.disclosedPlaintextConsent,
      disclosedPlaintextConsent: r.disclosedPlaintextConsent,
      reportedUser: r.reportedUser,
      messageId: r.messageId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_reports", {
    p_status: filters.status || null,
    p_category: filters.category || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0,
  });

  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      throw new AuthorizationError("You do not have moderator or administrator privileges");
    }
    throw new AppError(`Failed to fetch organization reports: ${error.message}`);
  }

  if (!data) return [];

  return data.map((item) => ({
    id: item.id,
    organizationId: item.organization_id,
    category: item.category as ReportCategory,
    details: item.details,
    status: item.status as ReportStatus,
    hasDisclosedPlaintext: item.has_disclosed_plaintext,
    disclosedPlaintextConsent: item.disclosed_plaintext_consent,
    reportedUser: {
      publicId: item.reported_user_public_id,
      username: item.reported_username,
      displayName: item.reported_display_name,
      status: item.reported_user_status,
    },
    messageId: item.message_id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
}

/**
 * Retrieves full details for a single report including disclosed plaintext
 * (strictly if user consented) and previous audit actions.
 */
export async function getReportDetails(reportId: string): Promise<ReportDetails> {
  if (isDevMockAuthEnabled()) {
    const found = DEV_MOCK_MODERATION_REPORTS.find((r) => r.id === reportId);
    if (!found) {
      throw new NotFoundError("Report not found");
    }
    return {
      id: found.id,
      organizationId: found.organizationId,
      category: found.category,
      details: found.details,
      status: found.status,
      hasDisclosedPlaintext: !!found.disclosedPlaintext && found.disclosedPlaintextConsent,
      disclosedPlaintextConsent: found.disclosedPlaintextConsent,
      reportedUser: found.reportedUser,
      messageId: found.messageId,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      disclosedPlaintext: found.disclosedPlaintextConsent ? found.disclosedPlaintext : null,
      actions: found.actions,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_report_details", {
    p_report_id: reportId,
  });

  if (error) {
    if (error.message.includes("REPORT_NOT_FOUND")) {
      throw new NotFoundError("Report not found or access denied");
    }
    if (error.message.includes("FORBIDDEN")) {
      throw new AuthorizationError("You do not have moderator privileges");
    }
    throw new AppError(`Failed to fetch report details: ${error.message}`);
  }

  const raw = data as Record<string, unknown>;
  const reportedUser = (raw.reported_user || {}) as Record<string, string>;

  return {
    id: raw.id as string,
    organizationId: raw.organization_id as string,
    category: raw.category as ReportCategory,
    details: (raw.details as string) || null,
    status: raw.status as ReportStatus,
    hasDisclosedPlaintext: !!raw.disclosed_plaintext && Boolean(raw.disclosed_plaintext_consent),
    disclosedPlaintextConsent: Boolean(raw.disclosed_plaintext_consent),
    reportedUser: {
      publicId: reportedUser.public_id || "",
      username: reportedUser.username || "",
      displayName: reportedUser.display_name || "",
      status: reportedUser.status || "active",
    },
    messageId: raw.message_id as string,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
    disclosedPlaintext: (raw.disclosed_plaintext as string) || null,
    actions: ((raw.actions as Array<Record<string, string>>) || []).map((a) => ({
      id: a.id,
      actionType: a.action_type,
      reason: a.reason,
      createdAt: a.created_at,
      moderatorUsername: a.moderator_username,
      moderatorDisplayName: a.moderator_display_name,
    })),
  };
}

/**
 * Transitions report status and records an auditable moderation action.
 */
export async function resolveReport(params: {
  reportId: string;
  newStatus: ReportStatus;
  reason: string;
}): Promise<{
  success: boolean;
  reportId: string;
  newStatus: string;
  actionId: string;
}> {
  if (isDevMockAuthEnabled()) {
    const report = DEV_MOCK_MODERATION_REPORTS.find((r) => r.id === params.reportId);
    if (!report) {
      throw new NotFoundError("Report not found");
    }
    report.status = params.newStatus;
    report.updatedAt = new Date().toISOString();

    const actionId = "00000000-0000-4000-f000-" + Math.random().toString(36).substring(2, 14).padEnd(12, "0");
    const actionType =
      params.newStatus === "investigating"
        ? "investigate_report"
        : params.newStatus === "resolved"
        ? "resolve_report"
        : "dismiss_report";

    report.actions.push({
      id: actionId,
      actionType,
      reason: params.reason,
      createdAt: new Date().toISOString(),
      moderatorUsername: "ada",
      moderatorDisplayName: "Ada Lovelace",
    });

    DEV_MOCK_MODERATION_ACTIONS.unshift({
      id: actionId,
      actionType,
      reason: params.reason,
      createdAt: new Date().toISOString(),
      reportId: params.reportId,
      targetUser: {
        publicId: report.reportedUser.publicId,
        username: report.reportedUser.username,
        displayName: report.reportedUser.displayName,
      },
      moderator: {
        publicId: DEV_MOCK_PUBLIC_ID,
        username: "ada",
        displayName: "Ada Lovelace",
      },
      metadata: { previous_status: "pending", new_status: params.newStatus },
    });

    return {
      success: true,
      reportId: params.reportId,
      newStatus: params.newStatus,
      actionId,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_report", {
    p_report_id: params.reportId,
    p_new_status: params.newStatus,
    p_reason: params.reason,
  });

  if (error) {
    if (error.message.includes("NOOP_STATUS")) {
      throw new ValidationError(`Report is already in status ${params.newStatus}`);
    }
    if (error.message.includes("FORBIDDEN")) {
      throw new AuthorizationError("You do not have moderator privileges for this report");
    }
    if (error.message.includes("REPORT_NOT_FOUND")) {
      throw new NotFoundError("Report not found");
    }
    throw new AppError(`Failed to resolve report: ${error.message}`);
  }

  const res = data as Record<string, unknown>;
  return {
    success: true,
    reportId: res.report_id as string,
    newStatus: res.new_status as string,
    actionId: res.action_id as string,
  };
}

/**
 * Applies a sanction (warn, suspend, reactivate) against a user and records an audit log.
 */
export async function applyModerationAction(params: {
  targetPublicId: string;
  actionType: "warn_user" | "suspend_user" | "reactivate_user";
  reason: string;
  reportId?: string;
}): Promise<{
  success: boolean;
  actionId: string;
  actionType: string;
  targetPublicId: string;
}> {
  if (isDevMockAuthEnabled()) {
    const actionId = "00000000-0000-4000-f000-" + Math.random().toString(36).substring(2, 14).padEnd(12, "0");

    if (params.reportId) {
      const report = DEV_MOCK_MODERATION_REPORTS.find((r) => r.id === params.reportId);
      if (report) {
        report.status = "resolved";
        report.updatedAt = new Date().toISOString();
        report.actions.push({
          id: actionId,
          actionType: params.actionType,
          reason: params.reason,
          createdAt: new Date().toISOString(),
          moderatorUsername: "ada",
          moderatorDisplayName: "Ada Lovelace",
        });
      }
    }

    DEV_MOCK_MODERATION_ACTIONS.unshift({
      id: actionId,
      actionType: params.actionType,
      reason: params.reason,
      createdAt: new Date().toISOString(),
      reportId: params.reportId || null,
      targetUser: {
        publicId: params.targetPublicId,
        username: "target_user",
        displayName: "Target User",
      },
      moderator: {
        publicId: DEV_MOCK_PUBLIC_ID,
        username: "ada",
        displayName: "Ada Lovelace",
      },
      metadata: { target_public_id: params.targetPublicId },
    });

    return {
      success: true,
      actionId,
      actionType: params.actionType,
      targetPublicId: params.targetPublicId,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_moderation_action", {
    p_target_public_id: params.targetPublicId,
    p_action_type: params.actionType,
    p_reason: params.reason,
    p_report_id: params.reportId || null,
  });

  if (error) {
    if (error.message.includes("CANNOT_MODERATE_SELF")) {
      throw new ValidationError("Moderators cannot apply moderation actions to their own account");
    }
    if (error.message.includes("INSUFFICIENT_PRIVILEGES")) {
      throw new AuthorizationError("Only administrators can take action against organization administrators");
    }
    if (error.message.includes("ALREADY_SUSPENDED")) {
      throw new ValidationError("Target user is already suspended");
    }
    if (error.message.includes("ALREADY_ACTIVE")) {
      throw new ValidationError("Target user is already active");
    }
    if (error.message.includes("FORBIDDEN")) {
      throw new AuthorizationError("You do not have moderator privileges");
    }
    if (error.message.includes("USER_NOT_FOUND")) {
      throw new NotFoundError("Target user not found");
    }
    throw new AppError(`Failed to apply moderation action: ${error.message}`);
  }

  const res = data as Record<string, unknown>;
  return {
    success: true,
    actionId: res.action_id as string,
    actionType: res.action_type as string,
    targetPublicId: res.target_public_id as string,
  };
}

/**
 * Retrieves auditable moderation action history for the organization.
 */
export async function getModerationActions(
  limit: number = 50,
  offset: number = 0
): Promise<ModerationAction[]> {
  if (isDevMockAuthEnabled()) {
    return DEV_MOCK_MODERATION_ACTIONS.slice(offset, offset + limit);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_moderation_actions", {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      throw new AuthorizationError("You do not have moderator privileges");
    }
    throw new AppError(`Failed to fetch moderation actions: ${error.message}`);
  }

  if (!data) return [];

  return data.map((item) => ({
    id: item.id,
    actionType: item.action_type as ModerationAction["actionType"],
    reason: item.reason,
    createdAt: item.created_at,
    reportId: item.report_id,
    targetUser: {
      publicId: item.target_public_id,
      username: item.target_username,
      displayName: item.target_display_name,
    },
    moderator: {
      publicId: item.moderator_public_id,
      username: item.moderator_username,
      displayName: item.moderator_display_name,
    },
    metadata: (item.metadata || {}) as Record<string, unknown>,
  }));
}
