"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { reportMessageAction } from "@/lib/reporting/actions";
import {
  type ReportCategory,
  REPORT_CATEGORY_LABELS,
} from "@/lib/reporting/types";
import { REPORT_CATEGORIES } from "@/lib/reporting/validation";
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from "lucide-react";

export interface ReportMessageDialogProps {
  messageId: string;
  decryptedPlaintext?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onReportSubmitted?: (messageId: string) => void;
}

const MAX_DETAILS_LENGTH = 1000;

export function ReportMessageDialog({
  messageId,
  decryptedPlaintext,
  isOpen,
  onClose,
  onReportSubmitted,
}: ReportMessageDialogProps) {
  const [category, setCategory] = React.useState<ReportCategory>("harassment");
  const [details, setDetails] = React.useState("");
  const [disclosePlaintext, setDisclosePlaintext] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const dialogRef = React.useRef<HTMLDivElement>(null);

  const handleClose = React.useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  // Handle escape key
  React.useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await reportMessageAction({
        messageId,
        category,
        details: details.trim() || null,
        disclosePlaintext,
        disclosedPlaintext: disclosePlaintext ? decryptedPlaintext || null : null,
      });

      if (res.success) {
        setIsSuccess(true);
        onReportSubmitted?.(messageId);
      } else {
        setError(res.error || "Failed to submit abuse report.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-zinc-950/40 dark:bg-black/60 backdrop-blur-sm transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        aria-describedby="report-dialog-desc"
        className="w-full max-w-lg bg-white dark:bg-[#111113] rounded-2xl border border-[#ebebeb] dark:border-white/[0.08] shadow-2xl overflow-hidden flex flex-col motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-150 max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-[#ebebeb] dark:border-white/[0.08] flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-[8px] bg-[#ffe8e6] text-[#b42318] dark:bg-[#3a1512] dark:text-[#f97066]">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="report-dialog-title"
                className="text-base font-medium text-[#111111] dark:text-[#f4f4f2]"
              >
                Report Anonymous Message
              </h2>
              <p
                id="report-dialog-desc"
                className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]"
              >
                Submit this message for review by workspace moderators.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close report dialog"
            className="p-1.5 rounded-[8px] text-[#6b6b6b] hover:text-[#111111] dark:hover:text-[#f4f4f2] hover:bg-[#f4f4f5] dark:hover:bg-[#1a1a1d] transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {isSuccess ? (
            <div className="py-8 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f5e9] text-[#1b5e20] dark:bg-[#102a14] dark:text-[#81c784]">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-medium text-[#111111] dark:text-[#f4f4f2]">
                  Report Submitted
                </h3>
                <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] max-w-sm mx-auto leading-relaxed">
                  Thank you for keeping our community safe. Your report has been submitted to authorized organization moderators for review.
                </p>
              </div>
              <div className="pt-2">
                <Button variant="primary" size="md" onClick={handleClose} autoFocus>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div
                  role="alert"
                  className="rounded-[8px] bg-[#ffe8e6] dark:bg-[#3a1512] p-3 text-xs text-[#b42318] dark:text-[#f97066] border border-[#f97066]/30 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 text-[#d92d20] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              {/* Category selection */}
              <div className="space-y-2">
                <label
                  htmlFor="report-category"
                  className="block text-xs font-medium text-[#111111] dark:text-[#f4f4f2]"
                >
                  Reason for reporting <span className="text-[#b42318]">*</span>
                </label>
                <select
                  id="report-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReportCategory)}
                  disabled={isSubmitting}
                  className="w-full text-xs rounded-[8px] border border-[#ebebeb] dark:border-white/[0.08] bg-white dark:bg-[#1a1a1d] px-3 py-2 text-[#111111] dark:text-[#f4f4f2] focus:outline-none focus:ring-2 focus:ring-[#0070e0] transition-colors"
                >
                  {REPORT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {REPORT_CATEGORY_LABELS[cat].label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
                  {REPORT_CATEGORY_LABELS[category].description}
                </p>
              </div>

              {/* Additional Details */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="report-details"
                    className="block text-xs font-medium text-[#111111] dark:text-[#f4f4f2]"
                  >
                    Additional context (optional)
                  </label>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      details.length > MAX_DETAILS_LENGTH
                        ? "text-[#b42318] font-semibold"
                        : "text-[#6b6b6b] dark:text-[#8f8f8a]"
                    }`}
                  >
                    {details.length}/{MAX_DETAILS_LENGTH}
                  </span>
                </div>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Provide any relevant context that will assist moderators..."
                  rows={3}
                  maxLength={MAX_DETAILS_LENGTH}
                  className="w-full text-xs rounded-[8px] border border-[#ebebeb] dark:border-white/[0.08] bg-white dark:bg-[#1a1a1d] p-3 text-[#111111] dark:text-[#f4f4f2] placeholder:text-[#8f8f8a] focus:outline-none focus:ring-2 focus:ring-[#0070e0] resize-none"
                />
              </div>

              {/* Explicit Plaintext Disclosure Consent (Unchecked by default) */}
              <div className="rounded-[8px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#1a1a1d]/60 p-3.5 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    id="disclose-plaintext-checkbox"
                    checked={disclosePlaintext}
                    onChange={(e) => setDisclosePlaintext(e.target.checked)}
                    disabled={isSubmitting || !decryptedPlaintext}
                    className="mt-0.5 h-4 w-4 rounded border-[#ebebeb] text-[#0070e0] focus:ring-[#0070e0] cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="text-xs space-y-1">
                    <span className="font-medium text-[#111111] dark:text-[#f4f4f2] block">
                      Include the decrypted message text to help moderators investigate.
                    </span>
                    <span className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a] block leading-relaxed">
                      If you choose this option, the text will be shared with authorized moderators of your organization as part of your report. The sender is not notified.
                    </span>
                  </div>
                </label>

                {!decryptedPlaintext && (
                  <p className="text-[11px] text-[#8a4b00] dark:text-[#f59e0b] pt-1">
                    Note: Plaintext is unavailable on this device (message not yet decrypted). Only report metadata will be shared.
                  </p>
                )}
              </div>

              {/* Editorial Disclaimer */}
              <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
                Submitting a report does not automatically prove misconduct or guarantee a specific moderation outcome. Your identity is kept confidential.
              </p>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#ebebeb] dark:border-white/[0.08]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  disabled={isSubmitting || details.length > MAX_DETAILS_LENGTH}
                >
                  {isSubmitting ? "Submitting..." : "Submit Report"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
