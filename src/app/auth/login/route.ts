import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const origin = request.nextUrl.origin;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error || !data.url) {
      logger.error("oauth_signin_failure", { error: error?.message });
      return NextResponse.redirect(new URL("/login?error=oauth_init_failed", origin));
    }

    return NextResponse.redirect(data.url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    logger.error("oauth_signin_exception", { error: message });
    return NextResponse.redirect(new URL("/login?error=server_error", request.nextUrl.origin));
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
