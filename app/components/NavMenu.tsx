"use client";

import { useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";
import Link from "next/link";
import Image from "next/image";
import Menu, { MenuHeader, MenuItem, MenuSeparator } from "@/app/components/ui/Menu";

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

export default function NavMenu({ showSchedule, showTags }: NavMenuProps) {
  const { data: session, status } = useSession();
  const user = session?.user ?? null;
  const notifCount = useNotifCount(!!user);

  const isAdmin =
    user?.role === "super-admin" ||
    user?.role === "admin" ||
    user?.role === "content-editor";

  // Ministry filtering is COSMETIC — the pages and APIs carry the enforcement.
  // Without it, though, a dual-ministry member has no route to /kids and a
  // kids-only member sees worship links that only bounce.
  const isSuper = user?.role === "super-admin";
  const ministries = user?.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const managesKids = isSuper || (user?.managesMinistries ?? []).includes("kids");

  // While the session resolves on the client, reserve the avatar's space to
  // avoid layout shift and a flash of the sign-in link for logged-in users.
  if (status === "loading") {
    return <div className="w-9 h-9 rounded-full bg-edge-accent-subtle animate-pulse" />;
  }

  if (!user) {
    return (
      <Link
        href="/auth/signin"
        className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-accent transition-colors"
      >
        Iniciar sesión
      </Link>
    );
  }

  const initials = user.name?.slice(0, 2).toUpperCase() ?? "??";
  const firstName = user.name?.split(" ")[0];

  return (
    <Menu
      label="Menú de cuenta"
      align="end"
      trigger={
        <button
          type="button"
          className="relative flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base group"
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
              className="rounded-full ring-2 ring-transparent group-hover:ring-accent/40 transition-all"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-surface-accent-solid text-on-fill flex items-center justify-center ring-2 ring-transparent group-hover:ring-accent/40 transition-all">
              <span className="font-label text-xs text-on-fill">{initials}</span>
            </div>
          )}
          {notifCount > 0 && (
            <span aria-hidden className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-negative-strong border-2 border-surface-base flex items-center justify-center">
              <span className="font-label text-[10px] text-white leading-none">{notifCount > 9 ? "9+" : notifCount}</span>
            </span>
          )}
        </button>
      }
    >
      {/* A real menu now: Menu supplies arrow-key navigation, so role=menu is honest. */}
      <MenuHeader>
        {user.image ? (
          <div className="flex items-center gap-2.5 mb-0">
            <Image src={user.image} alt={user.name ?? ""} width={28} height={28} unoptimized className="rounded-full shrink-0" />
            <span className="font-label text-xs uppercase tracking-widest text-mono-400 min-w-0 truncate">{firstName}</span>
          </div>
        ) : (
          <span className="font-label text-xs uppercase tracking-widest text-mono-400">{firstName}</span>
        )}
      </MenuHeader>
      {/* /me is ministry-neutral, so it stays unconditional. */}
      <MenuItem href="/me">Mi perfil</MenuItem>
      {showSchedule && inWorship && <MenuItem href="/schedule">Calendario</MenuItem>}
      {showTags && inWorship && <MenuItem href="/tag">#Tags</MenuItem>}
      {inKids && <MenuItem href="/kids">Oasis Kids</MenuItem>}
      {managesKids && <MenuItem href="/kids/admin">Planear Kids</MenuItem>}
      {/* No `&& inWorship` here on purpose: the three manager roles are
          worship-scoped by definition (requireActiveManager is role-only),
          so the extra clause would be dead code or imply a non-worship
          admin. Nav must agree with the page guard, not invent a rule. */}
      {isAdmin && <MenuItem href="/admin">Admin</MenuItem>}
      <MenuSeparator />
      <MenuItem onSelect={() => { clearThemeMirror(); signOut({ callbackUrl: "/" }); }}>
        Cerrar sesión
      </MenuItem>
    </Menu>
  );
}
