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
          className="rounded-md border border-red-200 bg-red-50/50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400"
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
            helperText="How other members of the organization will see your name."
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
            helperText="3 to 30 characters. Lowercase letters, numbers, hyphens, dots, and underscores."
          />
        </div>
      </div>

      <div className="pt-2">
        <Button
          type="submit"
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
