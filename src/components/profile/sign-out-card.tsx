"use client";

import * as React from "react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { clearLocalIdentity } from "@/lib/crypto/keystore";
import { LogOut } from "lucide-react";

export function SignOutCard() {
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleSignOut = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      // Clear sensitive private key from IndexedDB and zeroize memory before logout
      await clearLocalIdentity();
    } catch {
      // Fallback: proceed to logout
    }

    // Submit the native signout form to clear server session cookies
    e.currentTarget.submit();
  };

  return (
    <Surface className="p-6 sm:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
            Session Management
          </h2>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] mt-1 leading-relaxed">
            Manage your authenticated session and local cryptographic state on this device.
          </p>
        </div>
        <div className="p-2 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] text-[#6b6b6b] dark:text-[#8f8f8a] shrink-0">
          <LogOut className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="rounded-[8px] bg-[#f4f4f5]/60 dark:bg-[#1a1a1d]/60 border border-[#ebebeb] dark:border-white/[0.06] p-4 text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
        Signing out terminates your authenticated session and securely purges your local
        private encryption keys from this browser&apos;s IndexedDB and memory.
        Ensure you retain your 256-bit recovery phrase if you plan to sign in from another
        device or browser.
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
          Ready to sign out of this device?
        </span>

        <form action="/auth/signout" method="POST" onSubmit={handleSignOut}>
          <Button
            type="submit"
            variant="outline"
            size="md"
            disabled={isSigningOut}
            className="text-xs gap-1.5"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isSigningOut ? "Signing out..." : "Sign Out"}</span>
          </Button>
        </form>
      </div>
    </Surface>
  );
}
