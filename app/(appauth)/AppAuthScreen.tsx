// The one frame of the native-app sign-in pages: a centred card with a title.
// Presentational, imports nothing that reads anything.

import type { ReactNode } from "react";

export default function AppAuthScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="font-display text-xl uppercase tracking-wide">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function AppAuthMessage({ children }: { children: ReactNode }) {
  return <p className="font-body text-base text-ink-dim">{children}</p>;
}
