import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { getInboxUnreadCountAction } from "@/lib/messaging/actions";
import { getReportsAction } from "@/lib/moderation/actions";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Container } from "@/components/ui/container";
import { ModerationDashboard } from "@/components/moderation";

export const instant = false;

export const metadata = {
  title: "Moderation — CIH Messenger",
  description: "Review reports, audit moderation actions, and manage organization safety.",
};

export default async function ModerationPage() {
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

  // Authorize strictly for admins and moderators
  const isModeratorOrAdmin =
    status.organization.role === "admin" || status.organization.role === "moderator";

  if (!isModeratorOrAdmin) {
    redirect("/app");
  }

  // Fetch unread count for header badge
  const unreadRes = await getInboxUnreadCountAction();
  const unreadCount = unreadRes.success ? unreadRes.unreadCount : 0;

  // Fetch initial queue of reports
  const reportsRes = await getReportsAction();
  const initialReports = reportsRes.success ? reportsRes.reports : [];

  return (
    <div className="py-8 sm:py-12">
      <Container size="md" className="space-y-8">
        <WorkspaceHeader
          organizationName={status.organization.name}
          displayName={status.profile.displayName}
          username={status.profile.username}
          currentTab="moderation"
          unreadCount={unreadCount}
          isModerator={true}
        />

        <ModerationDashboard initialReports={initialReports} />
      </Container>
    </div>
  );
}
