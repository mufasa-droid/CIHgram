"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Users, Inbox, Settings, Shield } from "lucide-react";
import { clearLocalIdentity } from "@/lib/crypto/keystore";

export interface WorkspaceHeaderProps {
  organizationName: string;
  displayName: string;
  username: string;
  currentTab: "people" | "inbox" | "settings" | "moderation";
  unreadCount?: number;
  isModerator?: boolean;
}

export function WorkspaceHeader({
  organizationName,
  displayName,
  username,
  currentTab,
  unreadCount = 0,
  isModerator = false,
}: WorkspaceHeaderProps) {
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleSignOut = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSigningOut) return;
    setIsSigningOut(true);

    const form = e.currentTarget;

    try {
      // Clear sensitive private key from IndexedDB and zeroize memory before logout
      await clearLocalIdentity();
    } catch {
      // Non-blocking fallback
    }

    // Submit the native signout form
    if (form) {
      HTMLFormElement.prototype.submit.call(form);
    }
  };

  return (
    <div className="space-y-6 pb-6 border-b border-[#ebebeb] dark:border-white/[0.08]">
      {/* Workspace & account summary row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b] dark:text-[#8f8f8a]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#15b042]" aria-hidden="true" />
            <span>Active Workspace</span>
          </div>
          <h1 className="text-2xl font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
            {organizationName}
          </h1>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            Signed in as{" "}
            <span className="font-medium text-[#111111] dark:text-[#f4f4f2]">
              {displayName}
            </span>{" "}
            (@{username})
          </p>
        </div>

        <form action="/auth/signout" method="POST" onSubmit={handleSignOut}>
          <Button variant="ghost" size="sm" className="text-xs" disabled={isSigningOut}>
            {isSigningOut ? "Signing out..." : "Sign Out"}
          </Button>
        </form>
      </div>

      {/* Navigation tabs */}
      <nav
        aria-label="Workspace navigation"
        className="flex items-center gap-2 border-b border-transparent"
      >
        <Link
          href="/app"
          className={`inline-flex items-center gap-2 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
            currentTab === "people"
              ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
              : "text-[#6b6b6b] hover:text-[#111111] hover:bg-[#fafafa] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] dark:hover:bg-[#111113]"
          }`}
          aria-current={currentTab === "people" ? "page" : undefined}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          <span>People</span>
        </Link>

        <Link
          href="/inbox"
          className={`inline-flex items-center gap-2 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
            currentTab === "inbox"
              ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
              : "text-[#6b6b6b] hover:text-[#111111] hover:bg-[#fafafa] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] dark:hover:bg-[#111113]"
          }`}
          aria-current={currentTab === "inbox" ? "page" : undefined}
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Inbox</span>
          {unreadCount > 0 && (
            <span
              className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-[#0070e0] text-white text-[10px] font-mono tabular-nums leading-none"
              aria-label={`${unreadCount} unread messages`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <Link
          href="/settings"
          className={`inline-flex items-center gap-2 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
            currentTab === "settings"
              ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
              : "text-[#6b6b6b] hover:text-[#111111] hover:bg-[#fafafa] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] dark:hover:bg-[#111113]"
          }`}
          aria-current={currentTab === "settings" ? "page" : undefined}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Settings</span>
        </Link>

        {isModerator && (
          <Link
            href="/moderation"
            className={`inline-flex items-center gap-2 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${
              currentTab === "moderation"
                ? "bg-[#f4f4f5] text-[#111111] dark:bg-[#1a1a1d] dark:text-[#f4f4f2]"
                : "text-[#6b6b6b] hover:text-[#111111] hover:bg-[#fafafa] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] dark:hover:bg-[#111113]"
            }`}
            aria-current={currentTab === "moderation" ? "page" : undefined}
          >
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Moderation</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
