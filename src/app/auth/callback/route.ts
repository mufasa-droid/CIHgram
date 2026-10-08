import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Safe relative redirect
      const redirectUrl = new URL(next.startsWith("/") ? next : "/", requestUrl.origin);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Redirect to login or error state if auth code exchange failed
  const errorUrl = new URL("/login?error=auth_failed", requestUrl.origin);
  return NextResponse.redirect(errorUrl);
}
