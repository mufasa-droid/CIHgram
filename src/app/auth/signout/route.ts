import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Graceful fallback when local or mock dev environment has no live Supabase connection
  }
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
}

export async function GET(request: NextRequest) {
  return POST(request);
}
