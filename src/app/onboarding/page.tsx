import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { Container } from "@/components/ui/container";
import { Surface } from "@/components/ui/surface";
import { OnboardingForm } from "./onboarding-form";

export const metadata = {
  title: "Complete Your Profile — CIH Messenger",
  description: "Set up your public organization profile.",
};

export default async function OnboardingPage() {
  const status = await getUserAdmissionStatus();

  if (status.state === "unauthenticated") {
    redirect("/login");
  }

  if (status.state === "ineligible") {
    redirect("/unauthorized");
  }

  if (status.state === "admitted") {
    redirect("/app");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center py-16">
      <Container size="sm">
        <Surface className="p-8 sm:p-10 space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Verified Organization
            </p>
            <h1 className="text-2xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
              {status.eligibleOrganization.name}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Connected as <span className="font-medium text-zinc-900 dark:text-zinc-200">{status.email}</span>. Confirm your public profile to enter the workspace directory.
            </p>
          </div>

          <OnboardingForm
            initialUsername={status.suggestedUsername}
            initialDisplayName={status.suggestedDisplayName}
            organizationName={status.eligibleOrganization.name}
          />

          <div className="pt-2 text-center">
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Your email is never shared with message recipients.
            </p>
          </div>
        </Surface>
      </Container>
    </div>
  );
}
