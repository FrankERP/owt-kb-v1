"use client";

import { useState, useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

interface NavMenuProps {
  showSchedule?: boolean;
  showTags?: boolean;
}

// Cache the badge count briefly so it isn't refetched on every navigation.
const NOTIF_KEY = "owt_notif_count";
const NOTIF_TTL = 60 * 1000;

function useNotifCount(authed: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!authed) { setCount(0); return; }
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(NOTIF_KEY);
      if (raw) {
        const { c, t } = JSON.parse(raw);
        if (Date.now() - t < NOTIF_TTL) { setCount(c); return; }
      }
    } catch { /* ignore */ }
    fetch("/api/notifications/count")
      .then(r => (r.ok ? r.json() : { count: 0 }))
      .then(({ count: c }) => {
        if (cancelled) return;
        setCount(c ?? 0);
        try { sessionStorage.setItem(NOTIF_KEY, JSON.stringify({ c: c ?? 0, t: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authed]);
  return count;
}

function MenuItem({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls =
    "w-full text-left flex items-center gap-3 px-4 py-2.5 font-label text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] hover:bg-[#003572]/10 dark:hover:bg-[#00bfff]/10 transition-colors";
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}

export default function NavMenu({ showSchedule, showTags }: NavMenuProps) {
  const { data: session, status } = useSession();
  const user = session?.user ?? null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const notifCount = useNotifCount(!!user);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const isAdmin =
    user?.role === "super-admin" ||
    user?.role === "admin" ||
    user?.role === "content-editor";

  // While the session resolves on the client, reserve the avatar's space to
  // avoid layout shift and a flash of the sign-in link for logged-in users.
  if (status === "loading") {
    return <div className="w-9 h-9 rounded-full bg-[#003572]/15 dark:bg-[#00bfff]/10 animate-pulse" />;
  }

  if (!user) {
    return (
      <Link
        href="/auth/signin"
        className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors"
      >
        Iniciar sesión
      </Link>
    );
  }

  const initials = user.name?.slice(0, 2).toUpperCase() ?? "??";
  const firstName = user.name?.split(" ")[0];

  return (
    <div ref={ref} className="relative">
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#010b17] group"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          notifCount > 0
            ? `Menú de usuario, ${notifCount} ${notifCount === 1 ? "notificación" : "notificaciones"}`
            : "Menú de usuario"
        }
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? ""}
            width={36}
            height={36}
            // unoptimized: serve the original JPEG/PNG, not Next's WebP — the iOS
            // WKWebView (Capacitor wrap) fails to decode the optimized WebP avatar.
            unoptimized
            className="rounded-full ring-2 ring-transparent group-hover:ring-[#00bfff]/40 transition-all"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[#003572] dark:bg-[#00bfff]/20 flex items-center justify-center ring-2 ring-transparent group-hover:ring-[#00bfff]/40 transition-all">
            <span className="font-label text-xs text-[#00bfff]">{initials}</span>
          </div>
        )}
        {notifCount > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-[#C8D8EB] dark:border-[#010b17] flex items-center justify-center">
            <span className="font-label text-[8px] text-white leading-none">{notifCount > 9 ? "9+" : notifCount}</span>
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/15 bg-[#C8D8EB] dark:bg-[#0a1929] shadow-2xl overflow-hidden z-50"
          onClick={() => setOpen(false)}
        >
          {/* User identity */}
          <div className="px-4 py-3 border-b border-[#003572]/15 dark:border-[#00bfff]/10">
            {user.image ? (
              <div className="flex items-center gap-2.5 mb-0">
                <Image src={user.image} alt={user.name ?? ""} width={28} height={28} unoptimized className="rounded-full shrink-0" />
                <span className="font-label text-xs uppercase tracking-widest text-gray-400 min-w-0 truncate">{firstName}</span>
              </div>
            ) : (
              <span className="font-label text-xs uppercase tracking-widest text-gray-400">{firstName}</span>
            )}
          </div>

          {/* Navigation links */}
          <div className="py-1">
            <MenuItem href="/me">Mi perfil</MenuItem>
            {showSchedule && <MenuItem href="/schedule">Calendario</MenuItem>}
            {showTags && <MenuItem href="/tag">#Tags</MenuItem>}
            {isAdmin && <MenuItem href="/admin">Admin</MenuItem>}
          </div>

          {/* Sign out */}
          <div className="border-t border-[#003572]/15 dark:border-[#00bfff]/10 py-1">
            <MenuItem onClick={() => signOut({ callbackUrl: "/" })}>
              Cerrar sesión
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}
