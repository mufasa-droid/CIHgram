"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { updateProfileAction } from "@/lib/profile/actions";
import type { UserProfile } from "@/lib/profile/types";
import { CheckCircle2, AlertCircle, Eye } from "lucide-react";

export interface ProfileFormProps {
  initialProfile: UserProfile;
  organizationName: string;
  onProfileUpdated?: (updated: UserProfile) => void;
}

export function ProfileForm({
  initialProfile,
  organizationName,
  onProfileUpdated,
}: ProfileFormProps) {
  const [displayName, setDisplayName] = React.useState(initialProfile.displayName);
  const [username, setUsername] = React.useState(initialProfile.username);
  const [bio, setBio] = React.useState(initialProfile.bio || "");
  const [avatarUrl, setAvatarUrl] = React.useState(initialProfile.avatarUrl || "");

  const [isSaving, setIsSaving] = React.useState(false);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = React.useState(false);

  // Check if form has unsaved modifications
  const isDirty =
    displayName !== initialProfile.displayName ||
    username !== initialProfile.username ||
    bio !== (initialProfile.bio || "") ||
    avatarUrl !== (initialProfile.avatarUrl || "");

  const handleAvatarUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAvatarUrl(e.target.value);
    setAvatarLoadError(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || !isDirty) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    try {
      const res = await updateProfileAction({
        displayName,
        username: username.toLowerCase().trim(),
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        return;
      }

      setSaveSuccess(true);
      if (onProfileUpdated) {
        onProfileUpdated(res.profile);
      }
    } catch {
      setErrorMessage("An unexpected network error occurred. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // User initials for directory preview avatar fallback
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (name[0] || "U").toUpperCase();
  };

  return (
    <div className="space-y-6">
      <Surface className="p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
            Public Profile
          </h2>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] mt-1 leading-relaxed">
            This information is visible to eligible members within {organizationName}.
            Your messages to others will always remain strictly anonymous.
          </p>
        </div>

        {/* Success Alert */}
        {saveSuccess && (
          <div
            className="rounded-[8px] border border-[#15b042]/20 bg-[#caface]/30 dark:bg-[#0e7a2f]/20 p-4 flex items-center gap-3 text-xs text-[#0e7a2f] dark:text-[#caface]"
            role="status"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="font-medium">Profile updated successfully.</p>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div
            className="rounded-[8px] border border-[#d92d20]/20 bg-[#ffe8e6] dark:bg-[#3a1512] p-4 flex items-center gap-3 text-xs text-[#b42318] dark:text-[#f97066]"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="font-medium">{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Display Name */}
          <Input
            id="displayName"
            name="displayName"
            label="Display Name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaveSuccess(false);
            }}
            required
            maxLength={50}
            placeholder="Jane Doe"
            helperText="Your full or preferred name (1 to 50 characters)."
            disabled={isSaving}
          />

          {/* Username Handle */}
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="block text-[13px] font-medium leading-4 text-[#333333] dark:text-[#d6d6d3]"
            >
              Username Handle
            </label>
            <div className="relative">
              <span
                className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-xs font-mono text-[#6b6b6b] dark:text-[#8f8f8a]"
                aria-hidden="true"
              >
                @
              </span>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase());
                  setSaveSuccess(false);
                }}
                required
                minLength={3}
                maxLength={30}
                placeholder="janedoe"
                className="flex w-full rounded-[8px] border border-[#8a8a8a] bg-white pl-7 pr-3 h-10 text-sm text-[#111111] placeholder:text-[#6b6b6b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0070e0] focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/40 dark:bg-[#111113] dark:text-[#f4f4f2] dark:placeholder:text-[#8f8f8a] transition-colors"
                disabled={isSaving}
              />
            </div>
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
              Unique identifier (3 to 30 lowercase letters, numbers, hyphens, and dots).
            </p>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="bio"
                className="block text-[13px] font-medium leading-4 text-[#333333] dark:text-[#d6d6d3]"
              >
                Bio
              </label>
              <span
                className="text-xs font-mono tabular-nums text-[#6b6b6b] dark:text-[#8f8f8a]"
                aria-live="polite"
              >
                {bio.length} / 250
              </span>
            </div>
            <textarea
              id="bio"
              name="bio"
              rows={3}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setSaveSuccess(false);
              }}
              maxLength={250}
              placeholder="Tell colleagues about your role, focus areas, or team..."
              className="flex w-full rounded-[8px] border border-[#8a8a8a] bg-white p-3 text-sm text-[#111111] placeholder:text-[#6b6b6b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0070e0] focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/40 dark:bg-[#111113] dark:text-[#f4f4f2] dark:placeholder:text-[#8f8f8a] transition-colors resize-none"
              disabled={isSaving}
            />
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
              Optional brief note visible when members search for you in the directory.
            </p>
          </div>

          {/* Avatar URL */}
          <Input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            label="Avatar Image URL"
            value={avatarUrl}
            onChange={handleAvatarUrlChange}
            placeholder="https://example.com/avatar.png"
            helperText="Optional direct link to a public JPG, PNG, or WebP avatar image."
            disabled={isSaving}
          />

          {/* Form Actions */}
          <div className="pt-2 flex items-center justify-between gap-4">
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
              {isDirty ? "You have unsaved changes." : "Profile is up to date."}
            </p>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSaving}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Surface>

      {/* Directory Preview Card */}
      <Surface className="p-6 bg-[#fafafa] dark:bg-[#111113]/50 border-dashed space-y-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[#6b6b6b] dark:text-[#8f8f8a]">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Directory Preview</span>
        </div>

        <div className="flex items-start gap-3.5 p-4 rounded-[10px] bg-white dark:bg-[#111113] border border-[#ebebeb] dark:border-white/[0.08]">
          {/* Avatar Icon / Image */}
          <div className="h-10 w-10 shrink-0 rounded-full bg-[#f4f4f5] dark:bg-[#1a1a1d] flex items-center justify-center overflow-hidden border border-[#ebebeb] dark:border-white/10 text-[#333333] dark:text-[#d6d6d3] font-medium text-xs">
            {avatarUrl && !avatarLoadError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={`${displayName}'s avatar`}
                className="h-full w-full object-cover"
                onError={() => setAvatarLoadError(true)}
              />
            ) : (
              <span>{getInitials(displayName || "User")}</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2] truncate">
                {displayName || "Your Name"}
              </span>
              <span className="text-xs font-mono text-[#6b6b6b] dark:text-[#8f8f8a]">
                @{username || "username"}
              </span>
            </div>
            {bio ? (
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed line-clamp-2">
                {bio}
              </p>
            ) : (
              <p className="text-xs text-[#8a8a8a] dark:text-[#6b6b6b] italic">
                No bio provided
              </p>
            )}
          </div>
        </div>
      </Surface>
    </div>
  );
}
