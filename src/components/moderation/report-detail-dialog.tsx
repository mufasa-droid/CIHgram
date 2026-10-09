"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  User,
  X,
  CheckCircle,
  XCircle,
  Search,
  UserX,
  UserCheck,
} from "lucide-react";
import {
  getReportDetailsAction,
  resolveReportAction,
  applyModerationActionAction,
} from "@/lib/moderation/actions";
import type { ReportDetails, ReportStatus } from "@/lib/moderation/types";

interface ReportDetailDialogProps {
  reportId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onActionCompleted: () => void;
}

export function ReportDetailDialog({
  reportId,
  isOpen,
  onClose,
  onActionCompleted,
}: ReportDetailDialogProps) {
  const [report, setReport] = React.useState<ReportDetails | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  // Form states
  const [actionReason, setActionReason] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"evidence" | "resolution" | "sanction" | "history">("evidence");

  const handleClose = React.useCallback(() => {
    setReport(null);
    setError(null);
    setSuccessMessage(null);
    setActionReason("");
    setActiveTab("evidence");
    setIsLoading(true);
    onClose();
  }, [onClose]);

  // Load report details when dialog opens
  React.useEffect(() => {
    if (!isOpen || !reportId) return;

    let isMounted = true;

    getReportDetailsAction(reportId)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setReport(res.report);
        } else {
          setError(res.error);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load report");
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, reportId]);

  // Keyboard navigation: Escape closes dialog
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, handleClose]);

  if (!isOpen) return null;

  const handleStatusTransition = async (newStatus: ReportStatus) => {
    if (!report) return;
    if (actionReason.trim().length < 3) {
      setError("Please provide a reason of at least 3 characters for this resolution");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await resolveReportAction({
        reportId: report.id,
        newStatus: newStatus as "investigating" | "resolved" | "dismissed",
        reason: actionReason.trim(),
      });

      if (res.success) {
        setSuccessMessage(`Report successfully marked as ${newStatus}`);
        setActionReason("");
        // Reload details
        const refreshed = await getReportDetailsAction(report.id);
        if (refreshed.success) {
          setReport(refreshed.report);
        }
        onActionCompleted();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve report");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplySanction = async (actionType: "warn_user" | "suspend_user" | "reactivate_user") => {
    if (!report) return;
    if (actionReason.trim().length < 3) {
      setError("Please provide an administrative justification of at least 3 characters");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await applyModerationActionAction({
        targetPublicId: report.reportedUser.publicId,
        actionType,
        reason: actionReason.trim(),
        reportId: report.id,
      });

      if (res.success) {
        const actionLabel =
          actionType === "suspend_user"
            ? "suspended"
            : actionType === "reactivate_user"
            ? "reactivated"
            : "warned";
        setSuccessMessage(`Account successfully ${actionLabel}`);
        setActionReason("");
        // Reload details
        const refreshed = await getReportDetailsAction(report.id);
        if (refreshed.success) {
          setReport(refreshed.report);
        }
        onActionCompleted();
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply sanction");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[#e5e5e5] bg-white text-[#111111] shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#f0f0f0] dark:border-zinc-800/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-[#666666] dark:text-zinc-400">
                Report Investigation
              </span>
              {report && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide ${
                    report.status === "pending"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      : report.status === "investigating"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                      : report.status === "resolved"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {report.status}
                </span>
              )}
            </div>
            <h2 id="report-detail-title" className="text-lg font-semibold tracking-tight">
              {report ? `Category: ${report.category.replace("_", " ")}` : "Report Details"}
            </h2>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 rounded-md text-[#666666] hover:text-[#111111] hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-zinc-500">
              <div className="h-6 w-6 border-2 border-zinc-400 border-t-zinc-900 rounded-full animate-spin dark:border-zinc-600 dark:border-t-zinc-100" />
              <p className="text-sm">Loading report details...</p>
            </div>
          )}

          {error && (
            <div className="p-3 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="p-3 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300">
              {successMessage}
            </div>
          )}

          {!isLoading && report && (
            <>
              {/* Reported Account Card */}
              <div className="p-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa] dark:border-zinc-800 dark:bg-zinc-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-zinc-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      Reported Account
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-mono uppercase px-2 py-0.5 rounded ${
                      report.reportedUser.status === "active"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-400"
                    }`}
                  >
                    Status: {report.reportedUser.status}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{report.reportedUser.displayName}</p>
                    <p className="text-xs text-zinc-500 font-mono">@{report.reportedUser.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-zinc-500 font-mono">
                      Reported at: {new Date(report.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation Sub-Tabs */}
              <div className="flex border-b border-[#e5e5e5] dark:border-zinc-800 gap-4 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab("evidence")}
                  className={`pb-2 border-b-2 transition-colors ${
                    activeTab === "evidence"
                      ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                  }`}
                >
                  Evidence & Context
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("resolution")}
                  className={`pb-2 border-b-2 transition-colors ${
                    activeTab === "resolution"
                      ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                  }`}
                >
                  Report Resolution
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("sanction")}
                  className={`pb-2 border-b-2 transition-colors ${
                    activeTab === "sanction"
                      ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                  }`}
                >
                  Account Sanctions
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className={`pb-2 border-b-2 transition-colors ${
                    activeTab === "history"
                      ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                  }`}
                >
                  Audit History ({report.actions.length})
                </button>
              </div>

              {/* Tab 1: Evidence & Context */}
              {activeTab === "evidence" && (
                <div className="space-y-4">
                  {/* Reporter context */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Reporter Provided Explanation
                    </label>
                    <div className="p-3 rounded-lg border border-[#e5e5e5] bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {report.details ? report.details : <span className="italic text-zinc-400">No additional notes provided by reporter.</span>}
                    </div>
                  </div>

                  {/* Voluntary Plaintext Evidence */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Disclosed Message Plaintext Evidence
                      </label>
                      {report.disclosedPlaintextConsent ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          Consented Plaintext Included
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          Metadata Only (No Plaintext)
                        </span>
                      )}
                    </div>

                    {report.disclosedPlaintext ? (
                      <div className="space-y-2">
                        <div className="p-3 text-[11px] rounded-lg border border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 leading-normal">
                          <p className="font-semibold mb-0.5">Voluntary Recipient-Disclosed Plaintext Evidence:</p>
                          <p>
                            This decrypted content was voluntarily submitted by the recipient for administrative review.
                            Sealed-box encryption provides recipient anonymity and does not cryptographically sign plaintext.
                            This content serves as corroborating context rather than mathematically proven authorship.
                          </p>
                        </div>
                        <div className="p-3.5 rounded-lg border border-[#e5e5e5] bg-white font-mono text-xs dark:border-zinc-800 dark:bg-black text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words leading-relaxed">
                          {report.disclosedPlaintext}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg border border-dashed border-[#e5e5e5] dark:border-zinc-800 text-center text-xs text-zinc-500">
                        The reporter did not consent to share decrypted message plaintext. Only the message metadata, timestamp, and reporter explanation are available.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 2: Report Resolution */}
              {activeTab === "resolution" && (
                <div className="space-y-4">
                  <div className="p-3 text-xs rounded-lg border border-blue-200 bg-blue-50/60 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                    Update the workflow status of this report. All status transitions require an administrative reason and will be permanently appended to the organization audit log.
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="resolution-reason" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Reason / Administrative Notes <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="resolution-reason"
                      rows={3}
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder="Explain the rationale for this status decision (e.g., 'Reviewed disclosed text; violates harassment policy', 'False report: no evidence of misconduct')..."
                      disabled={isSubmitting}
                      className="w-full p-2.5 text-xs rounded-lg border border-[#e5e5e5] bg-white dark:border-zinc-800 dark:bg-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                    />
                    <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                      <span>Minimum 3 characters</span>
                      <span>{actionReason.length} / 1000</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {report.status !== "investigating" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSubmitting || actionReason.trim().length < 3}
                        onClick={() => handleStatusTransition("investigating")}
                        className="gap-1.5"
                      >
                        <Search className="h-3.5 w-3.5" />
                        Mark Investigating
                      </Button>
                    )}

                    {report.status !== "resolved" && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={isSubmitting || actionReason.trim().length < 3}
                        onClick={() => handleStatusTransition("resolved")}
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Resolve Report
                      </Button>
                    )}

                    {report.status !== "dismissed" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSubmitting || actionReason.trim().length < 3}
                        onClick={() => handleStatusTransition("dismissed")}
                        className="gap-1.5 text-zinc-600 dark:text-zinc-400"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Dismiss Report
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Account Sanctions */}
              {activeTab === "sanction" && (
                <div className="space-y-4">
                  <div className="p-3 text-xs rounded-lg border border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                    Apply administrative sanctions to <strong>@{report.reportedUser.username}</strong>. Account suspensions immediately revoke message sending, inbox reading, and key access across the platform.
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="sanction-reason" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Sanction Justification <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="sanction-reason"
                      rows={3}
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder="Specify formal policy violation, evidence considered, or conditions for reactivation..."
                      disabled={isSubmitting}
                      className="w-full p-2.5 text-xs rounded-lg border border-[#e5e5e5] bg-white dark:border-zinc-800 dark:bg-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                    />
                    <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                      <span>Minimum 3 characters</span>
                      <span>{actionReason.length} / 1000</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isSubmitting || actionReason.trim().length < 3}
                      onClick={() => handleApplySanction("warn_user")}
                      className="gap-1.5"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      Issue Official Warning
                    </Button>

                    {report.reportedUser.status === "active" ? (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isSubmitting || actionReason.trim().length < 3}
                        onClick={() => handleApplySanction("suspend_user")}
                        className="gap-1.5"
                      >
                        <UserX className="h-3.5 w-3.5" />
                        Suspend Member Account
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={isSubmitting || actionReason.trim().length < 3}
                        onClick={() => handleApplySanction("reactivate_user")}
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Reactivate Member Account
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 4: Audit History */}
              {activeTab === "history" && (
                <div className="space-y-3">
                  {report.actions.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-500">
                      No moderation actions have been recorded for this report yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {report.actions.map((act) => (
                        <div
                          key={act.id}
                          className="p-3 rounded-lg border border-[#e5e5e5] bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold uppercase text-zinc-700 dark:text-zinc-300">
                              {act.actionType.replace("_", " ")}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {new Date(act.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-zinc-800 dark:text-zinc-200">{act.reason}</p>
                          <p className="text-[11px] text-zinc-500">
                            By moderator: <span className="font-medium">{act.moderatorDisplayName}</span> (@{act.moderatorUsername})
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#f0f0f0] dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
          <span className="font-mono text-[11px]">Organization Isolated — Zero Server Plaintext Storage</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
