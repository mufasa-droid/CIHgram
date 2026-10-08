import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { getDirectoryMembers } from "@/lib/directory/service";
import { MemberDirectory } from "@/components/directory/member-directory";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="py-8 sm:py-12">
      <Container size="md" className="space-y-8">
        {/* Workspace banner */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Workspace
            </p>
            <h1 className="text-2xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
              {status.organization.name}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Signed in as <span className="font-medium text-zinc-800 dark:text-zinc-200">{status.profile.displayName}</span> (@{status.profile.username})
            </p>
          </div>

          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm" className="text-xs text-zinc-600 dark:text-zinc-400">
              Sign Out
            </Button>
          </form>
        </div>

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

