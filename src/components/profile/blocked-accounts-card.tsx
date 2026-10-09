"use client";

import * as React from "react";
import Image from "next/image";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { getBlockedUsersAction, unblockUserAction } from "@/lib/blocking/actions";
import type { BlockedUser } from "@/lib/blocking/types";
import { UserX, ShieldCheck, AlertCircle, RotateCw } from "lucide-react";

export function BlockedAccountsCard() {
  const [blockedUsers, setBlockedUsers] = React.useState<BlockedUser[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [confirmingUser, setConfirmingUser] = React.useState<BlockedUser | null>(
    null
  );
  const [isUnblocking, setIsUnblocking] = React.useState(false);

  const loadBlockedUsers = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getBlockedUsersAction();
      if (res.success && res.blockedUsers) {
        setBlockedUsers(res.blockedUsers);
      } else {
        setError(res.error || "Failed to load blocked accounts");
      }
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let isCancelled = false;

    getBlockedUsersAction()
      .then((res) => {
        if (isCancelled) return;
        if (res.success && res.blockedUsers) {
          setBlockedUsers(res.blockedUsers);
        } else {
          setError(res.error || "Failed to load blocked accounts");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError("Unable to connect to the server. Please try again.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleConfirmUnblock() {
    if (!confirmingUser) return;

    setIsUnblocking(true);
    setFeedback(null);
    try {
      const res = await unblockUserAction(confirmingUser.publicId);
      if (res.success) {
        setBlockedUsers((prev) =>
          prev.filter((u) => u.publicId !== confirmingUser.publicId)
        );
        setFeedback({
          type: "success",
          message: `Unblocked @${confirmingUser.username}. You can now send and receive messages with each other.`,
        });
        setConfirmingUser(null);
      } else {
        setFeedback({
          type: "error",
          message: res.error || "Failed to unblock member",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "An unexpected error occurred while unblocking.",
      });
    } finally {
      setIsUnblocking(false);
    }
  }

  return (
    <Surface className="p-6 sm:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserX className="h-4 w-4 text-[#6b6b6b] dark:text-[#8f8f8a]" aria-hidden="true" />
            <h2 className="text-lg font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
              Blocked Accounts
            </h2>
          </div>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] mt-1 leading-relaxed">
            Members you have blocked from sending or receiving anonymous messages with you.
            Blocking is bidirectional and prospective.
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={loadBlockedUsers}
          disabled={isLoading}
          className="text-xs shrink-0"
          title="Refresh blocked accounts"
          aria-label="Refresh blocked accounts"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`p-3 rounded-[8px] text-xs flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-[#e8f5e9] text-[#1b5e20] dark:bg-[#102a14] dark:text-[#81c784]"
              : "bg-[#ffe8e6] text-[#b42318] dark:bg-[#3a1512] dark:text-[#f97066]"
          }`}
        >
          {feedback.type === "success" ? (
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3 rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] text-xs text-[#b42318] dark:text-[#f97066] flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadBlockedUsers}
            className="h-6 text-xs"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-xs text-[#6b6b6b] dark:text-[#8f8f8a] flex items-center justify-center gap-2">
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading blocked accounts...</span>
        </div>
      ) : blockedUsers.length === 0 ? (
        <div className="py-8 text-center space-y-1 rounded-[10px] border border-dashed border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa]/50 dark:bg-[#111113]/50">
          <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2]">
            No blocked accounts
          </p>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            You have not blocked any members in your organization.
          </p>
        </div>
      ) : (
        <div
          role="list"
          className="divide-y divide-[#ebebeb] dark:divide-white/[0.08] border-t border-b border-[#ebebeb] dark:border-white/[0.08]"
        >
          {blockedUsers.map((user) => {
            const isTargetConfirming = confirmingUser?.publicId === user.publicId;

            return (
              <div
                key={user.publicId}
                role="listitem"
                className="py-3 px-1 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {user.avatarUrl ? (
                      <Image
                        src={user.avatarUrl}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                        className="h-8 w-8 rounded-full object-cover border border-[#ebebeb] dark:border-white/[0.08]"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2] border border-[#ebebeb] dark:border-white/[0.08]">
                        {user.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2] truncate">
                        {user.displayName}
                      </p>
                      <p className="text-xs font-mono text-[#6b6b6b] dark:text-[#8f8f8a] truncate">
                        @{user.username}
                      </p>
                    </div>
                  </div>

                  {!isTargetConfirming && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFeedback(null);
                        setConfirmingUser(user);
                      }}
                      className="text-xs shrink-0"
                      aria-label={`Unblock ${user.displayName}`}
                    >
                      Unblock
                    </Button>
                  )}
                </div>

                {isTargetConfirming && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="p-3 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] border border-[#ebebeb] dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-[#111111] dark:text-[#f4f4f2]">
                      Unblock <strong>@{user.username}</strong>? You will both be able to send messages again.
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmingUser(null)}
                        disabled={isUnblocking}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleConfirmUnblock}
                        disabled={isUnblocking}
                        className="h-7 text-xs"
                      >
                        {isUnblocking ? "Unblocking..." : "Confirm Unblock"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
