export type ModerationActionType =
  | "resolve_report"
  | "dismiss_report"
  | "investigate_report"
  | "warn_user"
  | "suspend_user"
  | "reactivate_user";

export type ReportStatus = "pending" | "investigating" | "resolved" | "dismissed";

export type ReportCategory =
  | "harassment"
  | "threats"
  | "spam"
  | "inappropriate_content"
  | "impersonation"
  | "other";

export interface ReportReportedUser {
  publicId: string;
  username: string;
  displayName: string;
  status: string;
}

export interface ReportSummary {
  id: string;
  organizationId: string;
  category: ReportCategory;
  details: string | null;
  status: ReportStatus;
  hasDisclosedPlaintext: boolean;
  disclosedPlaintextConsent: boolean;
  reportedUser: ReportReportedUser;
  messageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportActionItem {
  id: string;
  actionType: string;
  reason: string;
  createdAt: string;
  moderatorUsername: string;
  moderatorDisplayName: string;
}

export interface ReportDetails extends ReportSummary {
  disclosedPlaintext: string | null;
  actions: ReportActionItem[];
}

export interface ModerationAction {
  id: string;
  actionType: ModerationActionType;
  reason: string;
  createdAt: string;
  reportId: string | null;
  targetUser: {
    publicId: string | null;
    username: string | null;
    displayName: string | null;
  };
  moderator: {
    publicId: string;
    username: string;
    displayName: string;
  };
  metadata: Record<string, unknown>;
}

export interface ModerationFilters {
  status?: ReportStatus;
  category?: ReportCategory;
  limit?: number;
  offset?: number;
}
