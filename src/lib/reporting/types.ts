/**
 * Abuse Reporting Domain Types & DTOs (Prompt 010C)
 *
 * Scoped strictly to Phase 2: User-submitted abuse reports.
 * Does NOT include moderation dashboard, sanctioning, or admin action workflows.
 */

export type ReportCategory =
  | "harassment"
  | "threats"
  | "spam"
  | "inappropriate_content"
  | "impersonation"
  | "other";

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, { label: string; description: string }> = {
  harassment: {
    label: "Harassment or Bullying",
    description: "Repeated, targeted, or hostile conduct aimed at intimidating or degrading someone.",
  },
  threats: {
    label: "Threats or Violence",
    description: "Direct or implied statements suggesting harm, violence, or dangerous acts.",
  },
  spam: {
    label: "Spam or Advertising",
    description: "Unsolicited promotional material, phishing links, or mass noise.",
  },
  inappropriate_content: {
    label: "Inappropriate Content",
    description: "Explicit, deeply offensive, or non-workplace compliant language.",
  },
  impersonation: {
    label: "Impersonation or False Identity",
    description: "Pretending to be another colleague, executive, or organization entity.",
  },
  other: {
    label: "Other Safety Concern",
    description: "An issue that violates workplace community guidelines but is not listed above.",
  },
};

export interface ReportInput {
  messageId: string;
  category: ReportCategory;
  details?: string | null;
  disclosePlaintext: boolean;
  disclosedPlaintext?: string | null;
}

export interface ReportResult {
  success: boolean;
  reportId?: string;
  error?: string;
}
