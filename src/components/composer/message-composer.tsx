"use client";

import * as React from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { sendAnonymousMessage } from "@/lib/messaging/send-service";
import type { PublicMember } from "@/lib/directory/types";

export interface MessageComposerProps {
  recipient: PublicMember | null;
  isOpen: boolean;
  onClose: () => void;
  onSentSuccess?: (messageId: string) => void;
}

const MAX_CHARACTERS = 2000;

interface MessageComposerDialogProps {
  recipient: PublicMember;
  onClose: () => void;
  onSentSuccess?: (messageId: string) => void;
}

function MessageComposerDialog({
  recipient,
  onClose,
  onSentSuccess,
}: MessageComposerDialogProps) {
  const [text, setText] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = React.useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_CHARACTERS || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await sendAnonymousMessage({
      recipientId: recipient.id,
      plaintext: trimmed,
    });

    setIsSubmitting(false);

    if (result.success && result.messageId) {
      setIsSuccess(true);
      setText(""); // Immediately clear plaintext draft from memory
      onSentSuccess?.(result.messageId);
    } else {
      setError(result.error || "Failed to deliver message. Please try again.");
    }
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter or Ctrl+Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  const charCount = text.length;
  const isOverLimit = charCount > MAX_CHARACTERS;
  const canSend = text.trim().length > 0 && !isOverLimit && !isSubmitting;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-zinc-950/40 dark:bg-black/60 backdrop-blur-sm transition-opacity motion-reduce:transition-none"
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
        aria-labelledby="composer-title"
        aria-describedby="composer-desc"
        className="w-full max-w-lg bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 shadow-2xl shadow-zinc-950/10 overflow-hidden flex flex-col motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-150"
      >
        {/* Composer Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-100 dark:border-zinc-800/80 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {recipient.avatarUrl ? (
              <Image
                src={recipient.avatarUrl}
                alt=""
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                {recipient.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2
                id="composer-title"
                className="text-base font-semibold text-zinc-950 dark:text-zinc-50 truncate"
              >
                Send to {recipient.displayName}
              </h2>
              <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 truncate">
                @{recipient.username}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close message composer"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4">
          {/* Subtle Privacy Explanation */}
          <div
            id="composer-desc"
            className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 p-3 border border-zinc-200/60 dark:border-zinc-800/60 flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400"
          >
            <svg
              className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
            <div>
              <span className="font-medium text-zinc-900 dark:text-zinc-200">
                End-to-end encrypted & anonymous.
              </span>{" "}
              Your identity is withheld from {recipient.displayName}. The note is sealed locally on your device.
            </div>
          </div>

          {/* Success State */}
          {isSuccess ? (
            <div className="py-8 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-medium text-zinc-950 dark:text-zinc-50">
                  Message Delivered
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
                  Your encrypted message was saved anonymously. The composer draft has been cleared.
                </p>
              </div>
              <div className="pt-2">
                <Button variant="primary" size="md" onClick={handleClose} autoFocus>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Error Message */}
              {error && (
                <div
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200/80 dark:border-red-900/40 flex items-start gap-2"
                >
                  <svg
                    className="w-4 h-4 text-red-500 shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 7.5h.008v.008H12v-.008Z"
                    />
                  </svg>
                  <span className="flex-1">{error}</span>
                </div>
              )}

              {/* Textarea Area */}
              <div className="space-y-2">
                <label htmlFor="message-text" className="sr-only">
                  Write anonymous message
                </label>
                <textarea
                  id="message-text"
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleTextKeyDown}
                  placeholder={`Write a thoughtful, honest note to ${recipient.displayName}...`}
                  rows={6}
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors resize-none disabled:opacity-50"
                />

                {/* Character Count & Shortcuts */}
                <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500 px-0.5">
                  <span className="hidden sm:inline">Press ⌘+Enter to send</span>
                  <span
                    className={`font-mono tabular-nums ${
                      isOverLimit ? "text-red-600 font-semibold" : ""
                    }`}
                  >
                    {charCount.toLocaleString()} / {MAX_CHARACTERS.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Composer Actions */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={handleClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleSend}
                  disabled={!canSend}
                  isLoading={isSubmitting}
                >
                  {isSubmitting ? "Encrypting & sending..." : "Send anonymously"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * MessageComposer Dialog
 *
 * Implements a focused, quiet editorial transient composer for anonymous messages.
 *
 * 71UI Standards Applied:
 * - Surface: Clean white canvas with hairline border and soft elevation
 * - Spacing: 4px system (p-6, gap-4, space-y-4)
 * - Typography: Inter font, 16px medium title, 13px medium labels, 14px body
 * - Interaction: Autofocus, Esc-to-close, Cmd/Ctrl+Enter to send, Tabular character count
 * - Transient Lifecycle: Zero draft persistence; resets completely upon close/send.
 */
export function MessageComposer(props: MessageComposerProps) {
  if (!props.isOpen || !props.recipient) {
    return null;
  }

  return (
    <MessageComposerDialog
      key={`${props.recipient.id}-${props.isOpen}`}
      recipient={props.recipient}
      onClose={props.onClose}
      onSentSuccess={props.onSentSuccess}
    />
  );
}
