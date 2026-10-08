import Link from "next/link";
import { Container } from "@/components/ui/container";

export function Header() {
  return (
    <header className="w-full border-b border-zinc-200/60 bg-white/70 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-black/70">
      <Container size="lg">
        <div className="flex h-16 items-center justify-between">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-950 hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300 transition-colors"
          >
            CIH Messenger
          </Link>

          <nav className="flex items-center gap-6 text-xs font-medium tracking-tight">
            <Link
              href="/login"
              className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </Container>
    </header>
  );
}
