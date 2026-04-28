"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!session?.user || pathname?.startsWith("/auth") || pathname?.startsWith("/studio")) {
    return null;
  }

  const isAdmin = session.user.role === "super-admin" || session.user.role === "admin";

  const tabs = [
    { href: "/schedule", label: "Calendario", icon: <CalendarIcon /> },
    { href: "/tag",      label: "Tags",        icon: <MusicIcon /> },
    { href: "/me",       label: "Yo",         icon: <UserIcon /> },
  ];

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <>
      {/* Backdrop */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More sheet — slides up from above the bar */}
      <div
        className={`fixed inset-x-0 bottom-16 z-50 lg:hidden transition-all duration-300 ease-out ${
          moreOpen ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
        <div className="mx-3 bg-[#0a1929] border border-[#00bfff]/20 rounded-2xl overflow-hidden shadow-2xl">
          {/* User info */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#00bfff]/10">
            {session.user.image ? (
              <Image
                src={session.user.image}
                alt=""
                width={40}
                height={40}
                className="rounded-full shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#003572] flex items-center justify-center shrink-0">
                <span className="font-label text-sm text-[#00bfff]">
                  {session.user.name?.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <p className="font-body text-sm font-semibold truncate">{session.user.name}</p>
              <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 truncate">
                {session.user.email}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="divide-y divide-[#00bfff]/10">
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 px-5 py-4 text-gray-400 hover:text-[#00bfff] hover:bg-[#00bfff]/5 transition-colors"
              >
                <ShieldIcon />
                <span className="font-label text-xs uppercase tracking-widest">Admin</span>
              </Link>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="w-full flex items-center gap-3 px-5 py-4 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <SignOutIcon />
              <span className="font-label text-xs uppercase tracking-widest">Salir</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <nav className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-[#010b17]/90 backdrop-blur-sm border-t border-[#00bfff]/15"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-stretch h-16 max-w-7xl mx-auto">
          {tabs.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => setMoreOpen(false)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive(tab.href)
                  ? "text-[#00bfff]"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.icon}
              <span className="font-label text-[9px] uppercase tracking-widest">{tab.label}</span>
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
              moreOpen ? "text-[#00bfff]" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <MoreIcon />
            <span className="font-label text-[9px] uppercase tracking-widest">Más</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
