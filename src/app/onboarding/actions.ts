"use server";

import { completeOnboarding } from "@/lib/auth/onboarding";
import { AppError } from "@/lib/errors";
import { redirect } from "next/navigation";

export type OnboardingActionState = {
  error?: string;
  success?: boolean;
};

export async function submitOnboardingAction(
  _prevState: OnboardingActionState | null,
  formData: FormData
): Promise<OnboardingActionState> {
  const username = formData.get("username")?.toString() || "";
  const displayName = formData.get("displayName")?.toString() || "";

  try {
    await completeOnboarding({
      username,
      displayName,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : "Failed to complete onboarding";
    return { error: message };
  }

  // Redirect to application on success
  redirect("/app");
}
