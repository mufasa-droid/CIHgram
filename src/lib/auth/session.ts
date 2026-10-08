import { createClient } from "@/lib/supabase/server";
import { AuthenticationError } from "@/lib/errors";
import type { User, Session } from "@supabase/supabase-js";

/**
 * Retrieves the currently authenticated Supabase user on the server.
 * Uses auth.getUser() which validates the JWT with the Supabase Auth server.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

/**
 * Retrieves the current session on the server.
 * Useful when session metadata or expiry needs to be inspected.
 */
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Server-side guard requiring an authenticated user.
 * Throws AuthenticationError if session is invalid or missing.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationError("Authentication required to access this resource");
  }
  return user;
}
