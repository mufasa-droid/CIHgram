import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { Container } from "@/components/ui/container";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

export const instant = false;

export const metadata = {
  title: "Workspace — CIH Messenger",
  description: "Anonymous Messaging Platform Workspace",
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

  return (
    <div className="py-12 sm:py-16">
      <Container size="md" className="space-y-8">
        {/* Workspace banner */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Workspace
            </p>
            <h1 className="text-2xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
              {status.organization.name}
            </h1>
          </div>

          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm">
              Sign Out
            </Button>
          </form>
        </div>

        {/* User identity surface */}
        <Surface className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
              {status.profile.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-medium text-zinc-950 dark:text-zinc-50">
                {status.profile.displayName}
              </h2>
              <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                @{status.profile.username} · {status.organization.role}
              </p>
            </div>
          </div>

          <div className="rounded-md bg-zinc-50 p-4 dark:bg-zinc-900/50">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Your account is successfully admitted into the organization network. Member discovery and one-way end-to-end encrypted messaging will be enabled in upcoming releases.
            </p>
          </div>
        </Surface>
      </Container>
    </div>
  );
}
