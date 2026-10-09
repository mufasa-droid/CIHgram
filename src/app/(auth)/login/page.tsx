import { Container } from "@/components/ui/container";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

export const instant = false;

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_init_failed:
    "Unable to connect to authentication service. Please verify your Supabase URL and Google provider setup.",
  auth_failed: "Authentication with Google was cancelled or failed. Please try again.",
  server_error: "An internal authentication error occurred. Please try again.",
  invalid_request: "Invalid authentication request.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "Authentication error." : null;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-16">
      <Container size="sm">
        <Surface className="p-8 sm:p-10 space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
              Sign In
            </h1>
            <p className="text-sm text-[#6b6b6b] dark:text-[#8f8f8a] max-w-xs mx-auto">
              Connect with your Google account to discover peers and access encrypted messages.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-[8px] border border-[#f97066]/30 bg-[#ffe8e6] dark:bg-[#3a1512] p-3 text-xs text-[#b42318] dark:text-[#f97066] leading-relaxed"
            >
              {errorMessage}
            </div>
          )}

          <div className="pt-2">
            <form action="/auth/login" method="POST">
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="w-full justify-center gap-3 font-normal"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </Button>
            </form>
          </div>

          <div className="pt-2 text-center border-t border-[#ebebeb] dark:border-white/[0.08]">
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
              Your email address is never shared with message recipients.
            </p>
          </div>
        </Surface>
      </Container>
    </div>
  );
}
