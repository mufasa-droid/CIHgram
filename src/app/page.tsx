import Link from "next/link";
import { Header } from "@/components/shared/header";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-[#333333] dark:bg-[#0a0a0b] dark:text-[#d6d6d3] transition-colors">
      <Header />

      <main className="flex-1 flex flex-col justify-center py-20 sm:py-28 lg:py-36">
        <Container size="md" className="space-y-12">
          {/* Hero Section */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#ebebeb] bg-[#fafafa] px-3 py-1 text-xs text-[#6b6b6b] dark:border-white/[0.08] dark:bg-[#111113] dark:text-[#8f8f8a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#15b042]" aria-hidden="true" />
              <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                Zero-Knowledge Anonymous Messaging
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-medium tracking-[-0.035em] text-[#111111] dark:text-[#f4f4f2] leading-[1.08] max-w-2xl">
              Send someone a message without revealing your identity to them.
            </h1>

            <p className="max-w-xl text-base sm:text-lg text-[#6b6b6b] dark:text-[#8f8f8a] font-normal leading-relaxed">
              A private, one-way messaging platform for organizations and communities. Discover peers, send end-to-end encrypted messages, and communicate candidly with complete recipient-side anonymity.
            </p>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            <Link href="/login">
              <Button variant="inverse" size="xl" className="w-full sm:w-auto">
                Start Messaging
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" size="xl" className="w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>

          {/* Feature Bento Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-10 border-t border-[#ebebeb] dark:border-white/[0.08]">
            <div className="rounded-2xl border border-[#ebebeb] bg-[#fafafa] p-6 space-y-2 dark:border-white/[0.08] dark:bg-[#111113]">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b] dark:text-[#8f8f8a]">
                Security · Curve25519
              </p>
              <h2 className="text-sm font-medium tracking-[-0.01em] text-[#111111] dark:text-[#f4f4f2]">
                End-to-End Encrypted
              </h2>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
                Messages are sealed in your browser via Libsodium. Plaintext and private keys never touch the server.
              </p>
            </div>

            <div className="rounded-2xl border border-[#ebebeb] bg-[#fafafa] p-6 space-y-2 dark:border-white/[0.08] dark:bg-[#111113]">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b] dark:text-[#8f8f8a]">
                Privacy · Cryptographic Barrier
              </p>
              <h2 className="text-sm font-medium tracking-[-0.01em] text-[#111111] dark:text-[#f4f4f2]">
                Recipient Anonymity
              </h2>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
                Recipients receive sealed ciphertexts without any sender metadata. Direct queries are revoked by database RLS.
              </p>
            </div>

            <div className="rounded-2xl border border-[#ebebeb] bg-[#fafafa] p-6 space-y-2 dark:border-white/[0.08] dark:bg-[#111113]">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b6b] dark:text-[#8f8f8a]">
                Directory · Organization Scope
              </p>
              <h2 className="text-sm font-medium tracking-[-0.01em] text-[#111111] dark:text-[#f4f4f2]">
                Peer Discovery
              </h2>
              <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
                Easily search for colleagues by name or username to initiate transient one-way anonymous dispatches.
              </p>
            </div>
          </div>
        </Container>
      </main>

      {/* 71UI Footer */}
      <footer className="w-full border-t border-[#ebebeb] py-8 text-xs text-[#6b6b6b] dark:border-white/[0.08] dark:text-[#8f8f8a]">
        <Container size="md">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© 2026 CIH Messaging Platform. Private by design.</p>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#15b042]" />
              <span>All cryptographic systems operational</span>
            </div>
          </div>
        </Container>
      </footer>
    </div>
  );
}
