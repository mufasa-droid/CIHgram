import * as React from "react";
import { Surface } from "@/components/ui/surface";
import type { AccountInfo } from "@/lib/profile/types";
import { ShieldCheck, Building2, UserCheck, Key } from "lucide-react";

export interface AccountSectionProps {
  account: AccountInfo;
}

export function AccountSection({ account }: AccountSectionProps) {
  const formattedJoinedDate = React.useMemo(() => {
    try {
      return new Date(account.joinedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return account.joinedAt;
    }
  }, [account.joinedAt]);

  return (
    <Surface className="p-6 sm:p-8 space-y-6">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
          Authentication & Organization
        </h2>
        <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] mt-1 leading-relaxed">
          Account identity and workspace admission details verified by your organization.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Email Address */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#15b042]" aria-hidden="true" />
            <span>Verified Email</span>
          </div>
          <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2] truncate">
            {account.email || "No email available"}
          </p>
          <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
            Authenticated via {account.provider}
          </p>
        </div>

        {/* Organization Details */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            <Building2 className="h-3.5 w-3.5 text-[#0070e0]" aria-hidden="true" />
            <span>Organization</span>
          </div>
          <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2] truncate">
            {account.organizationName}
          </p>
          <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
            Workspace Slug: <span className="font-mono">{account.organizationSlug}</span>
          </p>
        </div>

        {/* Membership Role & Status */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            <UserCheck className="h-3.5 w-3.5 text-[#15b042]" aria-hidden="true" />
            <span>Membership Role</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize text-[#111111] dark:text-[#f4f4f2]">
              {account.role}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#caface]/50 text-[#0e7a2f] dark:bg-[#0e7a2f]/30 dark:text-[#caface]">
              <span className="h-1 w-1 rounded-full bg-[#15b042]" aria-hidden="true" />
              {account.membershipStatus}
            </span>
          </div>
          <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
            Member since {formattedJoinedDate}
          </p>
        </div>

        {/* Account Identifier */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            <Key className="h-3.5 w-3.5 text-[#6b6b6b] dark:text-[#8f8f8a]" aria-hidden="true" />
            <span>Account Reference</span>
          </div>
          <p className="text-xs font-mono text-[#333333] dark:text-[#d6d6d3] truncate">
            {account.userId}
          </p>
          <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
            Immutable platform identifier
          </p>
        </div>
      </div>

      {/* Security notice regarding OAuth & credentials */}
      <div className="rounded-[8px] bg-[#f4f4f5]/60 dark:bg-[#1a1a1d]/60 border border-[#ebebeb] dark:border-white/[0.06] p-4 text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
        Password credentials and two-factor authentication are managed through your Google account.
        Organization membership is server-enforced based on your verified corporate email domain.
        Self-service changes to email addresses or organization roles are not permitted.
      </div>
    </Surface>
  );
}
