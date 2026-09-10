"use client";

// The desktop nav row (spec §19.1, M1 Shell): the same destinations NavMenu
// already lists in its dropdown, rendered as real links at lg and above with
// a shared SlidingIndicator underline on the active one. Ministry filtering
// mirrors BottomNav's derivation for consistency across the three nav
// surfaces (BottomNav, NavMenu, NavLinks).

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
  const links = [
    ...(schedule && inWorship ? [{ href: "/schedule", label: "Calendario", active: pathname.startsWith("/schedule") }] : []),
    ...(tags && inWorship ? [{ href: "/tag", label: "Biblioteca", active: /^\/(tag|posts|author)/.test(pathname) }] : []),
    ...(inKids ? [{ href: "/kids", label: "Kids", active: pathname.startsWith("/kids") }] : []),
    { href: "/me", label: "Yo", active: pathname.startsWith("/me") },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", active: pathname.startsWith("/admin") }] : []),
  ];
  return (
    <div className="hidden lg:flex items-center gap-1 ml-6" aria-label="Secciones">
      {links.map((l) => <NavLink key={l.href} {...l} />)}
    </div>
  );
}
