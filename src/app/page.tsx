import Link from "next/link";
import { Header } from "@/components/shared/header";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/50 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <Header />

      <main className="flex-1 flex flex-col justify-center py-24 sm:py-32">
        <Container size="md" className="space-y-12 text-center sm:text-left">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Organization Messaging Platform
            </p>
            <h1 className="text-4xl sm:text-5xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 leading-[1.15]">
              Send someone a message without revealing your identity to them.
            </h1>
            <p className="max-w-xl text-base sm:text-lg text-zinc-600 dark:text-zinc-400 font-normal leading-relaxed pt-2">
              A private, one-way messaging platform for organizations. Discover members of your network, send encrypted messages, and communicate candidly with complete recipient-side anonymity.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
            <Link href="/login">
              <Button size="lg" className="w-full sm:w-auto px-8">
                Get Started
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="w-full sm:w-auto px-8">
                Sign In
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pt-12 border-t border-zinc-200/60 dark:border-zinc-800/60">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                End-to-End Encrypted
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Message contents are encrypted in your browser. The server never stores or views plaintext.
              </p>
            </div>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Recipient Anonymity
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Recipients read messages without ever learning the sender&apos;s identity.
              </p>
            </div>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Network Discovery
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Easily find and contact eligible peers within your verified organization domain.
              </p>
            </div>
          </div>
        </Container>
      </main>

      <footer className="w-full border-t border-zinc-200/60 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-500">
        <Container size="md">
          <p>© 2026 CIH Messaging Platform. Private by design.</p>
        </Container>
      </footer>
    </div>
  );
}
