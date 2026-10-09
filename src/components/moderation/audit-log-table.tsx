"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Shield, RefreshCw, Calendar } from "lucide-react";
import type { ModerationAction } from "@/lib/moderation/types";

interface AuditLogTableProps {
  actions: ModerationAction[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function AuditLogTable({
  actions,
  isLoading,
  onRefresh,
}: AuditLogTableProps) {
  const getActionBadgeClass = (actionType: string) => {
    switch (actionType) {
      case "suspend_user":
        return "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-900";
      case "reactivate_user":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900";
      case "warn_user":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900";
      case "resolve_report":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-900";
      case "dismiss_report":
        return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700";
      case "investigate_report":
        return "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-900";
      default:
        return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#111111] dark:text-[#f4f4f2]">
            Auditable Moderation History
          </h3>
          <p className="text-xs text-zinc-500">
            Append-only record of all sanctions, status transitions, and administrative decisions.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Audit Trail
        </Button>
      </div>

      {isLoading && actions.length === 0 ? (
        <div className="p-12 text-center text-xs text-zinc-500">
          <div className="h-5 w-5 mx-auto mb-2 border-2 border-zinc-400 border-t-zinc-900 rounded-full animate-spin dark:border-zinc-600 dark:border-t-zinc-100" />
          Loading audit trail...
        </div>
      ) : actions.length === 0 ? (
        <div className="p-12 rounded-xl border border-dashed border-[#e5e5e5] dark:border-zinc-800 text-center space-y-2">
          <Shield className="h-6 w-6 mx-auto text-zinc-400" />
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            No moderation actions recorded yet.
          </p>
          <p className="text-[11px] text-zinc-400">
            When moderators resolve reports or apply account sanctions, audit records will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#e5e5e5] bg-white dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden divide-y divide-[#f0f0f0] dark:divide-zinc-800/80">
          {actions.map((act) => (
            <div key={act.id} className="p-4 space-y-2 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border ${getActionBadgeClass(
                      act.actionType
                    )}`}
                  >
                    {act.actionType.replace("_", " ")}
                  </span>
                  {act.targetUser.username && (
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      Target: <span className="font-semibold text-zinc-900 dark:text-zinc-100">@{act.targetUser.username}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                  <Calendar className="h-3 w-3" />
                  <span>{new Date(act.createdAt).toLocaleString()}</span>
                </div>
              </div>

              <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed">
                {act.reason}
              </p>

              <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-400">
                <span>
                  Moderator: <span className="font-medium text-zinc-600 dark:text-zinc-400">{act.moderator.displayName}</span> (@{act.moderator.username})
                </span>
                {act.reportId && (
                  <span className="font-mono text-[10px]">
                    Report ID: {act.reportId.slice(0, 8)}...
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
