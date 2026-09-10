"use client";

// The desktop nav row (spec §19.1, M1 Shell), rendered as real links at lg
// and above with a shared SlidingIndicator underline on the active one.
// Ministry filtering mirrors BottomNav's derivation for consistency across
// the two nav surfaces: BottomNav on phones, NavLinks at lg+. «Yo» lives in
// the avatar menu (NavMenu) only — /me has one home (M1 follow-up F2).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import SlidingIndicator, { useActiveIntoView } from "./ui/SlidingIndicator";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative px-3 py-2 font-label text-[11px] uppercase tracking-widest transition-colors duration-fast ease-out-brand ${active ? "text-accent" : "text-mono-500 hover:text-accent"}`}
    >
      {label}
      {active && <SlidingIndicator id="nav-links" variant="underline" />}
    </Link>
  );
}

export default function NavLinks({ schedule = false, tags = false }: { schedule?: boolean; tags?: boolean }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? "/";
  const user = session?.user;
  if (status === "loading" || !user) return null;
  const isSuper = user.role === "super-admin";
  const isAdmin = isSuper || user.role === "admin" || user.role === "content-editor";
  const ministries = user.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const managesKids = isSuper || (user.managesMinistries ?? []).includes("kids");
  const links = [
    ...(schedule && inWorship ? [{ href: "/schedule", label: "Calendario", active: pathname.startsWith("/schedule") }] : []),
    ...(tags && inWorship ? [{ href: "/tag", label: "Biblioteca", active: /^\/(tag|posts|author)/.test(pathname) }] : []),
    ...(inKids ? [{ href: "/kids", label: "Kids", active: pathname.startsWith("/kids") && !pathname.startsWith("/kids/admin") }] : []),
    ...(managesKids ? [{ href: "/kids/admin", label: "Planear Kids", active: pathname.startsWith("/kids/admin") }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin", active: pathname.startsWith("/admin") }] : []),
  ];
  return (
    <div role="group" className="hidden lg:flex items-center gap-1 pointer-events-auto" aria-label="Secciones">
      {links.map((l) => <NavLink key={l.href} {...l} />)}
    </div>
  );
}
