"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert,
  Filter,
  RefreshCw,
  FileText,
  CheckCircle,
  Clock,
  History,
} from "lucide-react";
import { getReportsAction, getModerationActionsAction } from "@/lib/moderation/actions";
import type {
  ReportSummary,
  ModerationAction,
  ReportStatus,
  ReportCategory,
} from "@/lib/moderation/types";
import { ReportDetailDialog } from "./report-detail-dialog";
import { AuditLogTable } from "./audit-log-table";

interface ModerationDashboardProps {
  initialReports: ReportSummary[];
}

export function ModerationDashboard({ initialReports }: ModerationDashboardProps) {
  const [reports, setReports] = React.useState<ReportSummary[]>(initialReports);
  const [auditActions, setAuditActions] = React.useState<ModerationAction[]>([]);
  const [activeTab, setActiveTab] = React.useState<"queue" | "audit">("queue");

  // Filters
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");

  // Loading & dialog state
  const [isLoadingReports, setIsLoadingReports] = React.useState(false);
  const [isLoadingAudit, setIsLoadingAudit] = React.useState(false);
  const [selectedReportId, setSelectedReportId] = React.useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);

  const loadReports = React.useCallback(async () => {
    setIsLoadingReports(true);
    try {
      const res = await getReportsAction({
        status: statusFilter === "all" ? undefined : (statusFilter as ReportStatus),
        category: categoryFilter === "all" ? undefined : (categoryFilter as ReportCategory),
      });
      if (res.success) {
        setReports(res.reports);
      }
    } catch {
      // Handled silently
    } finally {
      setIsLoadingReports(false);
    }
  }, [statusFilter, categoryFilter]);

  const loadAuditActions = React.useCallback(async () => {
    setIsLoadingAudit(true);
    try {
      const res = await getModerationActionsAction();
      if (res.success) {
        setAuditActions(res.actions);
      }
    } catch {
      // Handled silently
    } finally {
      setIsLoadingAudit(false);
    }
  }, []);

  const handleSelectAuditTab = () => {
    setActiveTab("audit");
    void loadAuditActions();
  };

  const handleSelectQueueTab = () => {
    setActiveTab("queue");
  };

  const handleOpenReport = (id: string) => {
    setSelectedReportId(id);
    setIsDetailOpen(true);
  };

  const handleCloseReport = () => {
    setIsDetailOpen(false);
    setSelectedReportId(null);
  };

  const handleActionCompleted = () => {
    void loadReports();
    if (activeTab === "audit") {
      void loadAuditActions();
    }
  };

  const pendingCount = reports.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Top Banner / Privacy Guarantee Notice */}
      <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40 text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
        <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
          <ShieldAlert className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>Restricted Moderation Console — Privacy & Evidence Safeguards</span>
        </div>
        <p className="leading-relaxed">
          Message contents remain strictly end-to-end encrypted across normal platform storage. Disclosed message plaintexts
          are visible strictly when reporters provided voluntary, explicit consent. All administrative actions and status updates
          are append-only and cryptographically auditable.
        </p>
      </div>

      {/* Main Tab Controls */}
      <div className="flex items-center justify-between border-b border-[#e5e5e5] dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSelectQueueTab}
            className={`inline-flex items-center gap-2 pb-1 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "queue"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Reports Queue</span>
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleSelectAuditTab}
            className={`inline-flex items-center gap-2 pb-1 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "audit"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
          >
            <History className="h-4 w-4" />
            <span>Audit History</span>
          </button>
        </div>

        {activeTab === "queue" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadReports}
            disabled={isLoadingReports}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingReports ? "animate-spin" : ""}`} />
            Refresh Queue
          </Button>
        )}
      </div>

      {/* Queue View */}
      {activeTab === "queue" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-[#e5e5e5] bg-white dark:border-zinc-800 dark:bg-zinc-950 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-500">
              <Filter className="h-3.5 w-3.5" />
              <span>Filters:</span>
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
              }}
              className="px-2 py-1 rounded-md border border-[#e5e5e5] bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-hidden"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
              }}
              className="px-2 py-1 rounded-md border border-[#e5e5e5] bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-hidden"
            >
              <option value="all">All Categories</option>
              <option value="harassment">Harassment</option>
              <option value="threats">Threats</option>
              <option value="spam">Spam</option>
              <option value="inappropriate_content">Inappropriate Content</option>
              <option value="impersonation">Impersonation</option>
              <option value="other">Other</option>
            </select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadReports}
              className="text-xs h-7 ml-auto"
            >
              Apply Filter
            </Button>
          </div>

          {/* Reports List */}
          {isLoadingReports ? (
            <div className="p-12 text-center text-xs text-zinc-500">
              <div className="h-5 w-5 mx-auto mb-2 border-2 border-zinc-400 border-t-zinc-900 rounded-full animate-spin dark:border-zinc-600 dark:border-t-zinc-100" />
              Loading reports queue...
            </div>
          ) : reports.length === 0 ? (
            <div className="p-12 rounded-xl border border-dashed border-[#e5e5e5] dark:border-zinc-800 text-center space-y-2">
              <CheckCircle className="h-6 w-6 mx-auto text-emerald-500" />
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                No reports matching the selected filters.
              </p>
              <p className="text-[11px] text-zinc-400">
                All reports in this organization have been reviewed or none have been submitted.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#e5e5e5] bg-white dark:border-zinc-800 dark:bg-zinc-950 divide-y divide-[#f0f0f0] dark:divide-zinc-800/80 overflow-hidden">
              {reports.map((rep) => (
                <div
                  key={rep.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                        {rep.category.replace("_", " ")}
                      </span>

                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                          rep.status === "pending"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : rep.status === "investigating"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                            : rep.status === "resolved"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {rep.status}
                      </span>

                      {rep.hasDisclosedPlaintext ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          Plaintext Evidence Included
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Metadata Only
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-zinc-700 dark:text-zinc-300">
                      Reported Account:{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        @{rep.reportedUser.username}
                      </span>{" "}
                      ({rep.reportedUser.displayName})
                      {rep.reportedUser.status === "suspended" && (
                        <span className="ml-2 text-[10px] font-mono text-red-600 dark:text-red-400 uppercase">
                          [Suspended]
                        </span>
                      )}
                    </div>

                    {rep.details && (
                      <p className="text-xs text-zinc-500 line-clamp-1 italic">
                        &ldquo;{rep.details}&rdquo;
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(rep.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenReport(rep.id)}
                    className="text-xs shrink-0 self-start sm:self-center"
                  >
                    Review Report
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audit History View */}
      {activeTab === "audit" && (
        <AuditLogTable
          actions={auditActions}
          isLoading={isLoadingAudit}
          onRefresh={loadAuditActions}
        />
      )}

      {/* Report Investigation Dialog */}
      <ReportDetailDialog
        reportId={selectedReportId}
        isOpen={isDetailOpen}
        onClose={handleCloseReport}
        onActionCompleted={handleActionCompleted}
      />
    </div>
  );
}
