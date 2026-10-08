"use client";

import * as React from "react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { searchMembersAction } from "@/lib/directory/actions";
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
  const [error, setError] = React.useState<string | null>(null);

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


  return (
    <div className="space-y-6">
      {/* Directory Heading & Search Bar */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
            People
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Discover members in {organizationName} to send an anonymous message.
          </p>
        </div>

        <div className="relative">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or handle..."
            aria-label="Search organization members"
            className="pl-9 h-11 text-sm bg-white dark:bg-zinc-950/60"
          />
          <div className="pointer-events-none absolute left-3 top-3 text-zinc-400 dark:text-zinc-500">
            <svg
              className="h-5 w-5"
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
            <div className="absolute right-3 top-3.5 text-xs text-zinc-400 dark:text-zinc-500 animate-pulse">
              Searching...
            </div>
          )}
        </div>
      </div>

      {/* Recipient Selection Notice / Modal Boundary */}
      {selectedRecipient && (
        <Surface className="p-4 border-zinc-900/10 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
              {selectedRecipient.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-950 dark:text-zinc-50">
                Recipient selected: <span className="font-semibold">{selectedRecipient.displayName}</span> (@{selectedRecipient.username})
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Anonymous message composer will be available in the upcoming release.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedRecipient(null)}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Clear selection
          </Button>
        </Surface>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Member Directory List */}
      {members.length > 0 ? (
        <div role="list" className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80 border-t border-b border-zinc-200/80 dark:border-zinc-800/80">
          {members.map((member) => (
            <div
              key={member.id}
              role="listitem"
              className="py-3.5 px-1 flex items-center justify-between gap-4 group hover:bg-zinc-100/50 dark:hover:bg-zinc-900/30 rounded-sm transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                {member.avatarUrl ? (
                  <Image
                    src={member.avatarUrl}
                    alt=""
                    width={40}
                    height={40}
                    unoptimized
                    className="h-10 w-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-800"
                  />
                ) : (

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    {member.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                    {member.displayName}
                  </p>
                  <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 truncate">
                    @{member.username}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRecipient(member)}
                aria-label={`Send anonymous message to ${member.displayName}`}
                className="shrink-0 text-xs font-normal"
              >
                Send Message
              </Button>
            </div>
          ))}
        </div>
      ) : (
        /* Empty States */
        <div className="py-12 text-center space-y-2">
          {query.trim() ? (
            <>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No people found matching &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Try searching with a different name or username handle.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No other members found
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                As colleagues join {organizationName}, they will appear here.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
