import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { getUserProfileAndAccount } from "@/lib/profile/service";
import { getInboxUnreadCountAction } from "@/lib/messaging/actions";
import { getUserKeyStatusAction } from "@/lib/crypto/actions";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Container } from "@/components/ui/container";
import {
  ProfileForm,
  AccountSection,
  EncryptionStatusCard,
  BlockedAccountsCard,
  SignOutCard,
} from "@/components/profile";

export const instant = false;

export const metadata = {
  title: "Profile & Settings — CIH Messenger",
  description: "Manage your profile, organization details, and end-to-end encryption keys.",
};

export default async function SettingsPage() {
  const status = await getUserAdmissionStatus();

  if (status.state === "unauthenticated") {
    redirect("/login");
  }

  if (status.state === "ineligible") {
    redirect("/unauthorized");
  }

  if (status.state === "needs_onboarding") {
    redirect("/onboarding");
  }

  // Fetch full profile and account details
  const settingsData = await getUserProfileAndAccount();

  // Fetch unread count for header badge
  const unreadRes = await getInboxUnreadCountAction();
  const unreadCount = unreadRes.success ? unreadRes.unreadCount : 0;

  // Fetch server cryptographic key registration status
  const keyStatusRes = await getUserKeyStatusAction();
  const serverKeyStatus = keyStatusRes.success ? keyStatusRes.status : undefined;

  return (
    <div className="py-8 sm:py-12">
      <Container size="md" className="space-y-8">
        <WorkspaceHeader
          organizationName={status.organization.name}
          displayName={settingsData.profile.displayName}
          username={settingsData.profile.username}
          currentTab="settings"
          unreadCount={unreadCount}
        />

        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
              Settings & Profile
            </h1>
            <p className="text-sm text-[#6b6b6b] dark:text-[#8f8f8a] mt-1">
              Manage your directory presence, workspace identity, and end-to-end encryption keys.
            </p>
          </div>

          {/* 1. Public Profile Management */}
          <ProfileForm
            initialProfile={settingsData.profile}
            organizationName={status.organization.name}
          />

          {/* 2. Authentication & Organization Read-Only Details */}
          <AccountSection account={settingsData.account} />

          {/* 3. End-to-End Encryption Key Security */}
          <EncryptionStatusCard serverKeyStatus={serverKeyStatus} />

          {/* 4. Blocked Accounts Management */}
          <BlockedAccountsCard />

          {/* 5. Session Management & Sign Out */}
          <SignOutCard />
        </div>
      </Container>
    </div>
  );
}
