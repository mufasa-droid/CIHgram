import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserAdmissionStatus } from "@/lib/auth/onboarding";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        logger.error("oauth_exchange_error", { error: error.message });
        const errorUrl = new URL("/login?error=auth_failed", requestUrl.origin);
        return NextResponse.redirect(errorUrl);
      }

      // Determine user organization and onboarding status
      const status = await getUserAdmissionStatus();

      if (status.state === "admitted") {
        const target = next && next.startsWith("/") && next !== "/login" && next !== "/unauthorized"
          ? next
          : "/app";
        return NextResponse.redirect(new URL(target, requestUrl.origin));
      }

      if (status.state === "needs_onboarding") {
        return NextResponse.redirect(new URL("/onboarding", requestUrl.origin));
      }

      if (status.state === "ineligible") {
        return NextResponse.redirect(new URL("/unauthorized", requestUrl.origin));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown_error";
      logger.error("auth_callback_exception", { error: message });
      const errorUrl = new URL("/login?error=server_error", requestUrl.origin);
      return NextResponse.redirect(errorUrl);
    }
  }

  // Redirect to login if code missing or invalid
  const errorUrl = new URL("/login?error=invalid_request", requestUrl.origin);
  return NextResponse.redirect(errorUrl);
}
