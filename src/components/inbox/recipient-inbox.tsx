"use client";

import * as React from "react";
import Link from "next/link";
import {
  Star,
  Trash2,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  RotateCw,
  Inbox as InboxIcon,
  Users,
  ShieldOff,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  decryptInboxMessages,
  type InboxKeyState,
} from "@/lib/messaging/inbox-service";
import {
  getInboxMessagesAction,
  markMessageReadAction,
  setMessageStarredAction,
  deleteMessageAction,
} from "@/lib/messaging/actions";
import { blockMessageSenderAction } from "@/lib/blocking/actions";
import { ReportMessageDialog } from "./report-message-dialog";
import { restoreIdentity } from "@/lib/crypto/identity";
import type {
  RecipientInboxMessage,
  DecryptedInboxMessage,
} from "@/lib/messaging/types";

export interface RecipientInboxProps {
  initialMessages?: RecipientInboxMessage[];
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialUnreadCount?: number;
}

export function RecipientInbox({
  initialMessages = [],
  initialHasMore = false,
  initialNextCursor = null,
  initialUnreadCount = 0,
}: RecipientInboxProps) {
  // Raw messages fetched from server (ciphertext only)
  const [rawMessages, setRawMessages] = React.useState<RecipientInboxMessage[]>(initialMessages);
  // Decrypted messages in ephemeral memory
  const [decryptedMessages, setDecryptedMessages] = React.useState<DecryptedInboxMessage[]>([]);
  const [isDecrypting, setIsDecrypting] = React.useState<boolean>(true);
  const [keyState, setKeyState] = React.useState<InboxKeyState>("ready");
  const [serverKeyRegistered, setServerKeyRegistered] = React.useState<boolean>(false);

  // Filter state
  const [activeTab, setActiveTab] = React.useState<"all" | "starred">("all");
  const [unreadCount, setUnreadCount] = React.useState<number>(initialUnreadCount);

  // Pagination state
  const [hasMore, setHasMore] = React.useState<boolean>(initialHasMore);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = React.useState<boolean>(false);

  // Action in-flight & confirmation states
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = React.useState<string | null>(null);
  const [isStarringId, setIsStarringId] = React.useState<string | null>(null);
  const [blockConfirmId, setBlockConfirmId] = React.useState<string | null>(null);
  const [isBlockingId, setIsBlockingId] = React.useState<string | null>(null);
  const [blockNotification, setBlockNotification] = React.useState<string | null>(null);
  const [reportingMessage, setReportingMessage] = React.useState<DecryptedInboxMessage | null>(null);

  // Recovery phrase input state
  const [recoveryPhrase, setRecoveryPhrase] = React.useState<string>("");
  const [isRestoringKey, setIsRestoringKey] = React.useState<boolean>(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);

  // Decrypt whenever rawMessages change
  const runDecryption = React.useCallback(async (messagesToDecrypt: RecipientInboxMessage[]) => {
    setIsDecrypting(true);
    setActionError(null);

    try {
      const result = await decryptInboxMessages(messagesToDecrypt);
      setDecryptedMessages(result.items);
      setKeyState(result.keyState);
      if (result.serverKeyRegistered !== undefined) {
        setServerKeyRegistered(result.serverKeyRegistered);
      }
    } catch {
      setActionError("Failed to decrypt messages on your device.");
    } finally {
      setIsDecrypting(false);
    }
  }, []);

  React.useEffect(() => {
    let isCancelled = false;

    decryptInboxMessages(rawMessages)
      .then((result) => {
        if (!isCancelled) {
          setDecryptedMessages(result.items);
          setKeyState(result.keyState);
          if (result.serverKeyRegistered !== undefined) {
            setServerKeyRegistered(result.serverKeyRegistered);
          }
          setIsDecrypting(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setActionError("Failed to decrypt messages on your device.");
          setIsDecrypting(false);
        }
      });

    return () => {
      isCancelled = true;
      setDecryptedMessages([]);
    };
  }, [rawMessages]);

  // Handle Mark as Read
  const handleMarkRead = async (messageId: string) => {
    const target = decryptedMessages.find((m) => m.id === messageId);
    if (!target || target.isRead) return;

    // Optimistic update
    setDecryptedMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isRead: true } : m))
    );
    setRawMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isRead: true } : m))
    );
    setUnreadCount((c) => Math.max(0, c - 1));

    try {
      const res = await markMessageReadAction(messageId);
      if (!res.success) {
        // Rollback
        setDecryptedMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isRead: false } : m))
        );
        setRawMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isRead: false } : m))
        );
        setUnreadCount((c) => c + 1);
        setActionError(res.error || "Failed to mark message as read.");
      }
    } catch {
      // Rollback
      setDecryptedMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isRead: false } : m))
      );
      setRawMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isRead: false } : m))
      );
      setUnreadCount((c) => c + 1);
      setActionError("An unexpected error occurred.");
    }
  };

  // Handle Star / Unstar
  const handleToggleStar = async (messageId: string, currentStarred: boolean) => {
    const nextStarred = !currentStarred;
    setIsStarringId(messageId);
    setActionError(null);

    // Optimistic update
    setDecryptedMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isStarred: nextStarred } : m))
    );
    setRawMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isStarred: nextStarred } : m))
    );

    try {
      const res = await setMessageStarredAction(messageId, nextStarred);
      if (!res.success) {
        // Rollback
        setDecryptedMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isStarred: currentStarred } : m))
        );
        setRawMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isStarred: currentStarred } : m))
        );
        setActionError(res.error || "Failed to update star state.");
      }
    } catch {
      // Rollback
      setDecryptedMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isStarred: currentStarred } : m))
      );
      setRawMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isStarred: currentStarred } : m))
      );
      setActionError("An unexpected error occurred.");
    } finally {
      setIsStarringId(null);
    }
  };

  // Handle Delete Confirmation & Mutation
  const handleDeleteMessage = async (messageId: string) => {
    setIsDeletingId(messageId);
    setActionError(null);

    try {
      const res = await deleteMessageAction(messageId);
      if (res.success) {
        const deletedMsg = decryptedMessages.find((m) => m.id === messageId);
        if (deletedMsg && !deletedMsg.isRead) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }

        setDecryptedMessages((prev) => prev.filter((m) => m.id !== messageId));
        setRawMessages((prev) => prev.filter((m) => m.id !== messageId));
        setDeleteConfirmId(null);
      } else {
        setActionError(res.error || "Failed to delete message.");
      }
    } catch {
      setActionError("An unexpected error occurred while deleting the message.");
    } finally {
      setIsDeletingId(null);
    }
  };

  // Handle Block Sender Confirmation & Mutation
  const handleBlockSender = async (messageId: string) => {
    setIsBlockingId(messageId);
    setActionError(null);

    try {
      const res = await blockMessageSenderAction(messageId);
      if (res.success) {
        setBlockNotification(
          res.alreadyBlocked
            ? "The sender of this message is already blocked."
            : "The anonymous sender has been blocked. They cannot send you future messages."
        );
        setBlockConfirmId(null);
      } else {
        setActionError(res.error || "Failed to block sender.");
      }
    } catch {
      setActionError("An unexpected error occurred while blocking the sender.");
    } finally {
      setIsBlockingId(null);
    }
  };

  // Handle Load More Pagination
  const handleLoadMore = async () => {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    setActionError(null);

    try {
      const res = await getInboxMessagesAction({
        cursor: nextCursor || undefined,
        limit: 20,
      });

      if (res.success) {
        const newRawMessages = [...rawMessages, ...res.messages];
        setRawMessages(newRawMessages);
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
      } else {
        setActionError(res.error || "Failed to load older messages.");
      }
    } catch {
      setActionError("Failed to load older messages.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Handle Key Recovery via Recovery Phrase
  const handleRestoreKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryPhrase.trim()) return;

    setIsRestoringKey(true);
    setRestoreError(null);

    try {
      await restoreIdentity(recoveryPhrase.trim());
      setRecoveryPhrase("");
      // Re-trigger decryption with freshly restored key
      await runDecryption(rawMessages);
    } catch (err: unknown) {
      setRestoreError(
        err instanceof Error
          ? err.message
          : "Invalid recovery phrase or mismatched encryption key."
      );
    } finally {
      setIsRestoringKey(false);
    }
  };

  // Filter items based on activeTab
  const visibleMessages = React.useMemo(() => {
    if (activeTab === "starred") {
      return decryptedMessages.filter((m) => m.isStarred);
    }
    return decryptedMessages;
  }, [decryptedMessages, activeTab]);

  const starredCount = React.useMemo(
    () => decryptedMessages.filter((m) => m.isStarred).length,
    [decryptedMessages]
  );

  return (
    <div className="space-y-6">
      {/* Action / Network error alert */}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-3 text-xs rounded-[10px] bg-[#ffe8e6] text-[#b42318] dark:bg-[#3a1512] dark:text-[#f97066]"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-medium underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Missing local key recovery banner */}
      {keyState === "missing_key" && (
        <div className="rounded-[12px] border border-[#d4d4d8] dark:border-white/[0.14] bg-[#fafafa] dark:bg-[#111113] p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] text-[#111111] dark:text-[#f4f4f2]">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-medium text-[#111111] dark:text-[#f4f4f2]">
                Encryption key not found on this device
              </h2>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed max-w-xl">
                {serverKeyRegistered
                  ? "Your incoming messages are encrypted with your registered key. Enter your 256-bit recovery phrase to restore access and decrypt your messages on this device."
                  : "You do not currently have a local private key stored in this browser. Enter your recovery phrase to restore your key."}
              </p>
            </div>
          </div>

          <form onSubmit={handleRestoreKey} className="space-y-3 max-w-md">
            <div>
              <label
                htmlFor="recovery-phrase-input"
                className="block text-[13px] font-medium text-[#333333] dark:text-[#d6d6d3] mb-1.5"
              >
                Recovery Phrase (64-character hex or Base64)
              </label>
              <Input
                id="recovery-phrase-input"
                type="text"
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                className="font-mono text-xs"
                disabled={isRestoringKey}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {restoreError && (
              <p className="text-xs text-[#b42318] dark:text-[#f97066]" role="alert">
                {restoreError}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isRestoringKey || !recoveryPhrase.trim()}
            >
              {isRestoringKey ? "Verifying key..." : "Restore Key & Decrypt"}
            </Button>
          </form>
        </div>
      )}

      {/* Filter tabs & unread summary bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Inbox filters">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "all"}
            onClick={() => setActiveTab("all")}
            className={`h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
              activeTab === "all"
                ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
                : "text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2]"
            }`}
          >
            All Messages ({decryptedMessages.length})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "starred"}
            onClick={() => setActiveTab("starred")}
            className={`h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
              activeTab === "starred"
                ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
                : "text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2]"
            }`}
          >
            Starred ({starredCount})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#0070e0] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0070e0]" aria-hidden="true" />
              <span>{unreadCount} unread</span>
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => runDecryption(rawMessages)}
            disabled={isDecrypting}
            className="text-xs h-7 gap-1.5 text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a]"
            aria-label="Refresh decryption"
          >
            <RotateCw className={`h-3 w-3 ${isDecrypting ? "animate-spin" : ""}`} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Notification & Action Banners */}
      {blockNotification && (
        <div
          role="status"
          className="p-3 rounded-[8px] bg-[#e8f5e9] text-[#1b5e20] dark:bg-[#102a14] dark:text-[#81c784] text-xs flex items-center justify-between"
        >
          <span>{blockNotification}</span>
          <button
            type="button"
            onClick={() => setBlockNotification(null)}
            className="underline hover:no-underline font-medium ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="p-3 rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] text-xs text-[#b42318] dark:text-[#f97066] flex items-center justify-between"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="underline hover:no-underline font-medium ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Message List Views */}
      {isDecrypting && decryptedMessages.length === 0 ? (
        // Restrained Skeleton loading state
        <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-[12px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] p-5 animate-pulse space-y-3"
            >
              <div className="h-3 w-32 bg-[#ebebeb] dark:bg-white/[0.08] rounded-[4px]" />
              <div className="h-4 w-3/4 bg-[#ebebeb] dark:bg-white/[0.08] rounded-[4px]" />
              <div className="h-3 w-1/2 bg-[#ebebeb] dark:bg-white/[0.08] rounded-[4px]" />
            </div>
          ))}
        </div>
      ) : visibleMessages.length === 0 ? (
        // Calm Editorial Empty State
        <div className="rounded-[12px] border border-[#ebebeb] dark:border-white/[0.08] bg-white dark:bg-[#0a0a0b] p-12 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fafafa] dark:bg-[#111113] text-[#6b6b6b] dark:text-[#8f8f8a]">
            <InboxIcon className="h-6 w-6" aria-hidden="true" />
          </div>

          <div className="space-y-1.5 max-w-sm mx-auto">
            <h3 className="text-base font-medium text-[#111111] dark:text-[#f4f4f2]">
              {activeTab === "starred" ? "No starred messages" : "Your inbox is empty"}
            </h3>
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
              {activeTab === "starred"
                ? "You haven't starred any messages yet. Click the star icon on any message to keep it handy."
                : "When colleagues send you anonymous messages, they will arrive here and decrypt locally on your device."}
            </p>
          </div>

          {activeTab === "all" && (
            <div className="pt-2">
              <Link href="/app">
                <Button variant="secondary" size="sm" className="gap-1.5">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Browse People</span>
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        // Populated Message List
        <div className="space-y-3" role="list" aria-label="Inbox messages">
          {visibleMessages.map((message) => {
            const isDeleting = isDeletingId === message.id;
            const isStarring = isStarringId === message.id;
            const isConfirmingDelete = deleteConfirmId === message.id;

            return (
              <article
                key={message.id}
                onClick={() => {
                  if (!message.isRead) {
                    handleMarkRead(message.id);
                  }
                }}
                className={`relative rounded-[12px] border transition-all p-5 space-y-3 ${
                  !message.isRead
                    ? "border-[#0070e0]/40 bg-[#f4f4f5]/40 dark:border-[#0070e0]/40 dark:bg-[#1a1a1d]/30"
                    : "border-[#ebebeb] bg-white dark:border-white/[0.08] dark:bg-[#0a0a0b]"
                }`}
              >
                {/* Header row: Status + Timestamp + Action controls */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {!message.isRead && (
                      <span
                        className="h-2 w-2 rounded-full bg-[#0070e0]"
                        title="Unread message"
                        aria-label="Unread message"
                      />
                    )}

                    <time
                      dateTime={message.createdAt}
                      className="font-mono text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a] tabular-nums"
                    >
                      {formatMessageDate(message.createdAt)}
                    </time>

                    {!message.isRead && (
                      <span className="text-[10px] font-mono uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-[4px] bg-[#e6f0ff] text-[#0058b0] dark:bg-[#0e2440] dark:text-[#6aaeff]">
                        New
                      </span>
                    )}
                  </div>

                  {/* Message Action Controls */}
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {/* Mark read button (if unread) */}
                    {!message.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(message.id)}
                        className="p-1 rounded-[6px] text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] transition-colors"
                        title="Mark as read"
                        aria-label="Mark as read"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}

                    {/* Star / Unstar button */}
                    <button
                      type="button"
                      onClick={() => handleToggleStar(message.id, message.isStarred)}
                      disabled={isStarring}
                      className={`p-1 rounded-[6px] transition-colors ${
                        message.isStarred
                          ? "text-[#d97706] hover:text-[#b45309]"
                          : "text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2]"
                      }`}
                      title={message.isStarred ? "Unstar message" : "Star message"}
                      aria-label={message.isStarred ? "Unstar message" : "Star message"}
                    >
                      <Star
                        className={`h-4 w-4 ${message.isStarred ? "fill-current" : ""}`}
                        aria-hidden="true"
                      />
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirmId(message.id);
                        setBlockConfirmId(null);
                      }}
                      disabled={isDeleting}
                      className="p-1 rounded-[6px] text-[#6b6b6b] hover:text-[#b42318] dark:text-[#8f8f8a] dark:hover:text-[#f97066] transition-colors"
                      title="Delete from inbox"
                      aria-label="Delete message from inbox"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>

                    {/* Block anonymous sender button */}
                    <button
                      type="button"
                      onClick={() => {
                        setBlockConfirmId(message.id);
                        setDeleteConfirmId(null);
                      }}
                      disabled={isBlockingId === message.id}
                      className="p-1 rounded-[6px] text-[#6b6b6b] hover:text-[#b42318] dark:text-[#8f8f8a] dark:hover:text-[#f97066] transition-colors"
                      title="Block anonymous sender"
                      aria-label="Block anonymous sender"
                    >
                      <ShieldOff className="h-4 w-4" aria-hidden="true" />
                    </button>

                    {/* Report message button */}
                    <button
                      type="button"
                      onClick={() => {
                        setBlockConfirmId(null);
                        setDeleteConfirmId(null);
                        setReportingMessage(message);
                      }}
                      className="p-1 rounded-[6px] text-[#6b6b6b] hover:text-[#b42318] dark:text-[#8f8f8a] dark:hover:text-[#f97066] transition-colors"
                      title="Report message"
                      aria-label="Report message to moderators"
                    >
                      <Flag className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Inline Delete Confirmation Prompt */}
                {isConfirmingDelete && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="p-3 rounded-[8px] bg-[#ffe8e6] dark:bg-[#3a1512] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[#b42318] dark:text-[#f97066] font-medium">
                      Remove this message from your inbox?
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmId(null)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteMessage(message.id)}
                        disabled={isDeleting}
                        className="h-7 text-xs"
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Inline Block Confirmation Prompt */}
                {blockConfirmId === message.id && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="p-3 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] border border-[#ebebeb] dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="space-y-0.5">
                      <span className="text-[#111111] dark:text-[#f4f4f2] font-medium block">
                        Block this anonymous sender?
                      </span>
                      <span className="text-[#6b6b6b] dark:text-[#8f8f8a] block">
                        Neither of you will be able to send new messages to each other. Existing messages remain in your inbox.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBlockConfirmId(null)}
                        disabled={isBlockingId === message.id}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => handleBlockSender(message.id)}
                        disabled={isBlockingId === message.id}
                        className="h-7 text-xs"
                      >
                        {isBlockingId === message.id ? "Blocking..." : "Block Sender"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Message Content: Plaintext or Calm Error State */}
                <div className="pt-1">
                  {message.decryptionStatus === "decrypted" && message.plaintext ? (
                    <p className="text-sm text-[#111111] dark:text-[#f4f4f2] leading-relaxed whitespace-pre-wrap break-words">
                      {message.plaintext}
                    </p>
                  ) : message.decryptionStatus === "missing_key" ? (
                    <div className="p-3 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] text-xs text-[#6b6b6b] dark:text-[#8f8f8a] flex items-center justify-between gap-2">
                      <span>Encryption key missing on this device.</span>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById("recovery-phrase-input");
                          el?.focus();
                        }}
                        className="text-[#0070e0] font-medium underline hover:no-underline"
                      >
                        Restore Key
                      </button>
                    </div>
                  ) : (
                    // Decryption Failure State (Honest & calm; NEVER renders ciphertext)
                    <div
                      role="alert"
                      className="p-3 rounded-[8px] bg-[#fafafa] dark:bg-[#111113] border border-[#ebebeb] dark:border-white/[0.08] text-xs text-[#6b6b6b] dark:text-[#8f8f8a] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-[#8a4b00] shrink-0" aria-hidden="true" />
                        <span>{message.error || "Unable to decrypt with current key."}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => runDecryption(rawMessages)}
                        className="text-xs text-[#0070e0] font-medium hover:underline shrink-0"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {/* Bounded Pagination: Load More Button */}
          {hasMore && (
            <div className="pt-4 text-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-2 text-xs"
              >
                {isLoadingMore ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span>Loading older messages...</span>
                  </>
                ) : (
                  <span>Load older messages</span>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Report Message Dialog */}
      {reportingMessage && (
        <ReportMessageDialog
          messageId={reportingMessage.id}
          decryptedPlaintext={
            reportingMessage.decryptionStatus === "decrypted"
              ? reportingMessage.plaintext
              : null
          }
          isOpen={Boolean(reportingMessage)}
          onClose={() => setReportingMessage(null)}
          onReportSubmitted={() => {
            setBlockNotification("Your report has been submitted to organization moderators for review.");
          }}
        />
      )}
    </div>
  );
}

/**
 * Formats ISO timestamp to quiet editorial display (e.g. "Oct 9, 2026, 10:15 AM")
 */
function formatMessageDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Recently";

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return "Recently";
  }
}
