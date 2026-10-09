"use client";

import * as React from "react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageComposer } from "@/components/composer";
import { searchMembersAction } from "@/lib/directory/actions";
import { blockUserAction } from "@/lib/blocking/actions";
import type { PublicMember } from "@/lib/directory/types";

export interface MemberDirectoryProps {
  initialMembers: PublicMember[];
  organizationName: string;
  currentUsername: string;
}

export function MemberDirectory({
  initialMembers,
  organizationName,
}: MemberDirectoryProps) {
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<PublicMember[] | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedRecipient, setSelectedRecipient] = React.useState<PublicMember | null>(null);
  const [isComposerOpen, setIsComposerOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Blocking dialog states
  const [blockingMember, setBlockingMember] = React.useState<PublicMember | null>(null);
  const [isBlockingSubmitting, setIsBlockingSubmitting] = React.useState(false);
  const [blockError, setBlockError] = React.useState<string | null>(null);
  const [blockNotification, setBlockNotification] = React.useState<string | null>(null);

  const members = query.trim() ? (searchResults ?? []) : initialMembers;

  // Debounced search effect
  React.useEffect(() => {
    if (!query.trim()) {
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      const res = await searchMembersAction(query);
      if (res.success) {
        setSearchResults(res.members);
      } else {
        setError(res.error || "Unable to search directory");
        setSearchResults([]);
      }
      setIsLoading(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Close block dialog on Escape key
  React.useEffect(() => {
    if (!blockingMember) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isBlockingSubmitting) {
        setBlockingMember(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blockingMember, isBlockingSubmitting]);

  return (
    <div className="space-y-6">
      {/* Directory Heading & Search Bar */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
            People
          </h2>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            Discover peers in {organizationName} to send an anonymous sealed message.
          </p>
        </div>

        <div className="relative">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or handle..."
            aria-label="Search organization members"
            inputSize="sm"
            className="pl-9 h-9 text-xs bg-white dark:bg-[#111113]"
          />
          <div className="pointer-events-none absolute left-3 top-2.5 text-[#6b6b6b] dark:text-[#8f8f8a]">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </div>
          {isLoading && (
            <div className="absolute right-3 top-2.5 text-xs text-[#6b6b6b] dark:text-[#8f8f8a] animate-pulse">
              Searching...
            </div>
          )}
        </div>
      </div>

      {/* Transient Anonymous Message Composer */}
      <MessageComposer
        recipient={selectedRecipient}
        isOpen={isComposerOpen}
        onClose={() => {
          setIsComposerOpen(false);
          setSelectedRecipient(null);
        }}
      />

      {/* Notification banner */}
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

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] p-3 text-xs text-[#b42318] dark:text-[#f97066]"
        >
          {error}
        </div>
      )}

      {/* 71UI Member Directory List Rows */}
      {members.length > 0 ? (
        <div
          role="list"
          className="divide-y divide-[#ebebeb] dark:divide-white/[0.08] border-t border-b border-[#ebebeb] dark:border-white/[0.08]"
        >
          {members.map((member) => (
            <div
              key={member.id}
              role="listitem"
              className="py-2.5 px-3 flex items-center justify-between gap-4 group hover:bg-[#f4f4f5] dark:hover:bg-[#1a1a1d] rounded-[8px] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {member.avatarUrl ? (
                  <Image
                    src={member.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className="h-9 w-9 rounded-full object-cover border border-[#ebebeb] dark:border-white/[0.08]"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2] border border-[#ebebeb] dark:border-white/[0.08]">
                    {member.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2] truncate">
                    {member.displayName}
                  </p>
                  <p className="text-xs font-mono text-[#6b6b6b] dark:text-[#8f8f8a] truncate">
                    @{member.username}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelectedRecipient(member);
                    setIsComposerOpen(true);
                  }}
                  aria-label={`Send anonymous message to ${member.displayName}`}
                >
                  Send Message
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBlockError(null);
                    setBlockingMember(member);
                  }}
                  aria-label={`Block ${member.displayName}`}
                  className="text-xs text-[#6b6b6b] hover:text-[#b42318] dark:text-[#8f8f8a] dark:hover:text-[#f97066]"
                >
                  Block
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 71UI Empty States */
        <div className="py-16 text-center space-y-2 rounded-2xl border border-dashed border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa]/50 dark:bg-[#111113]/50">
          {query.trim() ? (
            <>
              <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2]">
                No people found matching &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
                Try searching with a different name or username handle.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2]">
                No other members found
              </p>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
                As colleagues join {organizationName}, they will appear in this directory.
              </p>
            </>
          )}
        </div>
      )}

      {/* Block Confirmation Dialog */}
      {blockingMember && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-zinc-950/40 dark:bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isBlockingSubmitting) {
              setBlockingMember(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-member-title"
            aria-describedby="block-member-desc"
            className="w-full max-w-md bg-white dark:bg-[#111113] rounded-2xl border border-[#ebebeb] dark:border-white/[0.08] shadow-2xl p-6 space-y-4"
          >
            <div className="space-y-1">
              <h3
                id="block-member-title"
                className="text-base font-medium text-[#111111] dark:text-[#f4f4f2]"
              >
                Block {blockingMember.displayName}?
              </h3>
              <p
                id="block-member-desc"
                className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed"
              >
                Neither you nor <strong className="text-[#111111] dark:text-[#f4f4f2]">@{blockingMember.username}</strong> will be able to send new anonymous messages to each other. Existing messages in your inbox will not be affected. You can unblock this member at any time in Settings.
              </p>
            </div>

            {blockError && (
              <div
                role="alert"
                className="p-3 rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] text-xs text-[#b42318] dark:text-[#f97066]"
              >
                {blockError}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBlockingMember(null)}
                disabled={isBlockingSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={async () => {
                  setIsBlockingSubmitting(true);
                  setBlockError(null);
                  try {
                    const res = await blockUserAction(blockingMember.id);
                    if (res.success) {
                      setBlockNotification(
                        res.alreadyBlocked
                          ? `@${blockingMember.username} is already blocked.`
                          : `@${blockingMember.username} has been blocked.`
                      );
                      setBlockingMember(null);
                    } else {
                      setBlockError(res.error || "Failed to block member.");
                    }
                  } catch {
                    setBlockError("An unexpected error occurred. Please try again.");
                  } finally {
                    setIsBlockingSubmitting(false);
                  }
                }}
                disabled={isBlockingSubmitting}
              >
                {isBlockingSubmitting ? "Blocking..." : "Block Member"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
