import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import {
  getInboxMessagesAction,
  getInboxUnreadCountAction,
} from "@/lib/messaging/actions";
import { RecipientInbox } from "@/components/inbox/recipient-inbox";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Container } from "@/components/ui/container";

export const instant = false;

export const metadata = {
  title: "Inbox — CIH Messenger",
  description: "Read and manage your end-to-end encrypted anonymous messages.",
};

export default async function InboxPage() {
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

  // Load initial batch of inbox messages (ciphertext envelopes only)
  const inboxRes = await getInboxMessagesAction({ limit: 20 });
  const messages = inboxRes.success ? inboxRes.messages : [];
  const hasMore = inboxRes.success ? inboxRes.hasMore : false;
  const nextCursor = inboxRes.success ? inboxRes.nextCursor : null;

  // Load unread count
  const unreadRes = await getInboxUnreadCountAction();
  const unreadCount = unreadRes.success ? unreadRes.unreadCount : 0;

  return (
    <div className="py-8 sm:py-12">
      <Container size="md" className="space-y-8">
        <WorkspaceHeader
          organizationName={status.organization.name}
          displayName={status.profile.displayName}
          username={status.profile.username}
          currentTab="inbox"
          unreadCount={unreadCount}
        />

        {/* Recipient Inbox Component with Client-Side Decryption */}
        <RecipientInbox
          initialMessages={messages}
          initialHasMore={hasMore}
          initialNextCursor={nextCursor}
          initialUnreadCount={unreadCount}
        />
      </Container>
    </div>
  );
}
