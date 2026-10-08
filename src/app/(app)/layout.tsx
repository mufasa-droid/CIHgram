import * as React from "react";
import { Header } from "@/components/shared/header";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/50 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <Header />
      <main className="flex-1">{children}</main>
    </div>
  );
}
