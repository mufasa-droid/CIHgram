import { redirect } from "next/navigation";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { Container } from "@/components/ui/container";
import { Surface } from "@/components/ui/surface";
import { OnboardingForm } from "./onboarding-form";

export const instant = false;

export const metadata = {
  title: "Complete Your Profile — CIH Messenger",
  description: "Set up your public profile handle and display name.",
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
            <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b] dark:text-[#8f8f8a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0070e0]" aria-hidden="true" />
              <span>Workspace Profile</span>
            </div>
            <h1 className="text-2xl font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
              {status.eligibleOrganization.name}
            </h1>
            <p className="text-sm text-[#6b6b6b] dark:text-[#8f8f8a]">
              Connected as <span className="font-medium text-[#111111] dark:text-[#f4f4f2]">{status.email}</span>. Confirm your public profile to enter the workspace directory.
            </p>
          </div>

          <OnboardingForm
            initialUsername={status.suggestedUsername}
            initialDisplayName={status.suggestedDisplayName}
            organizationName={status.eligibleOrganization.name}
          />

          <div className="pt-2 text-center border-t border-[#ebebeb] dark:border-white/[0.08]">
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
              Your email address is never disclosed to message recipients.
            </p>
          </div>
        </Surface>
      </Container>
    </div>
  );
}
