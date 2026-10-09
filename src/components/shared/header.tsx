import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#ebebeb] bg-white/85 backdrop-blur-md dark:border-white/[0.08] dark:bg-[#0a0a0b]/85 transition-colors">
      <Container size="lg">
        <div className="flex h-14 items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-[-0.01em] text-[#111111] hover:text-[#0070e0] dark:text-[#f4f4f2] dark:hover:text-[#4193f5] transition-colors"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[#0070e0] text-[11px] font-bold text-white shadow-xs">
              C
            </div>
            <span>CIH Messenger</span>
          </Link>

          <nav className="flex items-center gap-4 text-xs font-medium">
            <Link
              href="/login"
              className="text-[#6b6b6b] hover:text-[#111111] dark:text-[#8f8f8a] dark:hover:text-[#f4f4f2] transition-colors"
            >
              Sign In
            </Link>
            <Link href="/login">
              <Button variant="inverse" size="sm">
                Get Started
              </Button>
            </Link>
          </nav>
        </div>
      </Container>
    </header>
  );
}
