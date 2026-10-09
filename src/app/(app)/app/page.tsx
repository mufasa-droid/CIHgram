import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { getDirectoryMembers } from "@/lib/directory/service";
import { getInboxUnreadCountAction } from "@/lib/messaging/actions";
import { MemberDirectory } from "@/components/directory/member-directory";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Container } from "@/components/ui/container";

export const instant = false;

export const metadata = {
  title: "People — CIH Messenger",
  description: "Discover organization members to send anonymous messages.",
};

export default async function AppPage() {
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

  // Load initial directory members for the caller's organization
  const { members } = await getDirectoryMembers();

  // Load unread count for inbox badge
  const unreadRes = await getInboxUnreadCountAction();
  const unreadCount = unreadRes.success ? unreadRes.unreadCount : 0;

  return (
    <div className="py-8 sm:py-12">
      <Container size="md" className="space-y-8">
        <WorkspaceHeader
          organizationName={status.organization.name}
          displayName={status.profile.displayName}
          username={status.profile.username}
          currentTab="people"
          unreadCount={unreadCount}
        />

        {/* Member Directory Discovery Component */}
        <MemberDirectory
          initialMembers={members}
          organizationName={status.organization.name}
          currentUsername={status.profile.username}
        />
      </Container>
    </div>
  );
}
