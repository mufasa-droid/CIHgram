"use client";

import * as React from "react";
import { useActionState } from "react";
import { submitOnboardingAction, type OnboardingActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface OnboardingFormProps {
  initialUsername: string;
  initialDisplayName: string;
  organizationName: string;
}

export function OnboardingForm({
  initialUsername,
  initialDisplayName,
  organizationName,
}: OnboardingFormProps) {
  const [state, formAction, isPending] = useActionState<OnboardingActionState, FormData>(
    submitOnboardingAction,
    {}
  );

  const [username, setUsername] = React.useState(initialUsername);
  const [displayName, setDisplayName] = React.useState(initialDisplayName);

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <div
          className="rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] p-3 text-xs text-[#b42318] dark:text-[#f97066]"
          role="alert"
        >
          {state.error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Input
            id="displayName"
            name="displayName"
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="e.g. Jane Doe"
            helperText="How other members will see your name across the directory."
          />
        </div>

        <div>
          <Input
            id="username"
            name="username"
            label="Username Handle"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            required
            placeholder="e.g. jdoe"
            helperText="3 to 30 characters. Lowercase letters, numbers, hyphens, and dots."
          />
        </div>
      </div>

      <div className="pt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isPending}
          className="w-full justify-center"
        >
          Join {organizationName}
        </Button>
      </div>
    </form>
  );
}
