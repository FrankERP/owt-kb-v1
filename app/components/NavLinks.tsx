"use client";

// The desktop nav row (spec §19.1, M1 Shell), rendered as real links at lg
// and above with a shared SlidingIndicator underline on the active one.
// One ministry at a time: both nav surfaces (BottomNav on phones, NavLinks at
// lg+) take the section and its links from `navSections.ts`. «Yo» lives in
// the avatar menu (NavMenu) only — /me has one home (M1 follow-up F2).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import SlidingIndicator, { useActiveIntoView } from "./ui/SlidingIndicator";
import Menu, { MenuItem } from "./ui/Menu";
import { ChevronDownIcon } from "./ui/icons";
import { SECTION_LABEL, availableSections, currentSection, navAccess, sectionHome, type NavAccess, type NavSection } from "./navSections";

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

/**
 * The switcher between the ministries this person is in, ahead of the links —
 * only when there is more than one. A `Menu`, so it costs one word of the row.
 */
function SectionSwitcher({ current, sections, access }: { current: NavSection; sections: NavSection[]; access: NavAccess }) {
  return (
    <Menu
      label="Cambiar de ministerio"
      align="start"
      trigger={
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-2 font-label text-[11px] uppercase tracking-widest text-ink transition-colors duration-fast ease-out-brand hover:text-accent"
        >
          {SECTION_LABEL[current]}
          <ChevronDownIcon size={14} aria-hidden />
        </button>
      }
    >
      {sections.map((s) => (
        <MenuItem key={s} href={sectionHome(s, access)} selected={s === current}>
          {SECTION_LABEL[s]}
        </MenuItem>
      ))}
    </Menu>
  );
}

export default function NavLinks() {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? "/";
  const user = session?.user;
  if (status === "loading" || !user) return null;
  const access = navAccess(user);
  const sections = availableSections(access);
  const section = currentSection(pathname, access);
  // One ministry at a time (Frank, 2026-10-29): Admin is worship's admin and sits
  // with worship; Planear Kids sits with Kids. Super admin is in the avatar menu.
  const links = section === "worship"
    ? [
        { href: "/schedule", label: "Calendario", active: pathname.startsWith("/schedule") },
        { href: "/biblioteca", label: "Biblioteca", active: /^\/(biblioteca|posts)/.test(pathname) },
        ...(access.isAdmin ? [{ href: "/admin", label: "Admin", active: pathname.startsWith("/admin") }] : []),
      ]
    : section === "kids"
    ? [
        ...(access.inKids ? [{ href: "/kids", label: "Kids", active: pathname.startsWith("/kids") && !pathname.startsWith("/kids/admin") }] : []),
        ...(access.managesKids ? [{ href: "/kids/admin", label: "Planear Kids", active: pathname.startsWith("/kids/admin") }] : []),
      ]
    : [];
  return (
    <div role="group" className="hidden lg:flex items-center gap-1 pointer-events-auto" aria-label="Secciones">
      {section && sections.length > 1 && <SectionSwitcher current={section} sections={sections} access={access} />}
      {links.map((l) => <NavLink key={l.href} {...l} />)}
    </div>
  );
}
