import { Container } from "@/components/ui/container";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";

export const instant = false;

export const metadata = {
  title: "Access Restricted — CIH Messenger",
  description: "Account domain not authorized for this workspace.",
};



export default async function UnauthorizedPage() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <Container size="sm">
        <Surface className="p-8 sm:p-10 space-y-6 text-center">
          <div className="space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
              Access Restricted
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
              {user?.email ? (
                <>
                  Your account (<span className="font-medium text-zinc-900 dark:text-zinc-200">{user.email}</span>) does not belong to an authorized organization domain.
                </>
              ) : (
                "Your Google account domain is not authorized for this platform."
              )}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500 max-w-xs mx-auto">
              Please sign in with your verified organization Google account or contact your administrator.
            </p>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <form action="/auth/signout" method="POST">
              <Button type="submit" variant="outline" size="md">
                Sign Out
              </Button>
            </form>
          </div>
        </Surface>
      </Container>
    </div>
  );
}
