// The ministry SECTIONS of the navigation (ADR-0075; Frank, 2026-10-29: «no me
// gusta estar en lo de Worship y ver lo de Kids»). The nav shows one ministry at
// a time — the one the current page belongs to — and a switcher to the others
// the person belongs to or manages. Both nav surfaces (NavLinks at lg+,
// BottomNav on phones) take the SECTION from here, so they always agree on which
// ministry is showing; each still builds its own row of links (the phone keeps a
// Kids tab for a Kids manager outside Kids, so Planear Kids is never a lone tab).
//
// No "use client": pure functions over the session user and the path, testable
// on their own (ADR-0028's neutral-module rule). COSMETIC like every nav filter —
// the pages and routes enforce access (ADR-0020).

import { MINISTRIES } from "@/app/ministries";

export type NavSection = "worship" | "kids";

export type NavUser = {
  role?: string | null;
  ministries?: string[] | null;
  managesMinistries?: string[] | null;
};

export type NavAccess = {
  isSuper: boolean;
  /** Worship's admin roles — the /admin entry. */
  isAdmin: boolean;
  inWorship: boolean;
  inKids: boolean;
  managesKids: boolean;
};

/** The session copy reads `ministries` absent as worship, as it always has. */
export function navAccess(user: NavUser): NavAccess {
  const isSuper = user.role === "super-admin";
  const ministries = user.ministries ?? ["worship"];
  return {
    isSuper,
    isAdmin: isSuper || user.role === "admin" || user.role === "content-editor",
    inWorship: isSuper || ministries.includes("worship"),
    inKids: isSuper || ministries.includes("kids"),
    managesKids: isSuper || (user.managesMinistries ?? []).includes("kids"),
  };
}

/** The sections this person can switch between, worship first. Jóvenes has no
 *  screens yet, so it is no section yet. */
export function availableSections(a: NavAccess): NavSection[] {
  return [
    ...(a.inWorship ? (["worship"] as const) : []),
    ...(a.inKids || a.managesKids ? (["kids"] as const) : []),
  ];
}

/**
 * The section the current page belongs to: `/kids…` is Kids, anything else is
 * worship. A page that belongs to no ministry (`/me`, `/super-admin`) shows the
 * person's first section. `null` when they have none.
 */
export function currentSection(pathname: string, a: NavAccess): NavSection | null {
  const sections = availableSections(a);
  if (/^\/kids(\/|$)/.test(pathname) && sections.includes("kids")) return "kids";
  return sections[0] ?? null;
}

export const SECTION_LABEL: Record<NavSection, string> = {
  worship: MINISTRIES.worship.name,
  kids: MINISTRIES.kids.name,
};

/** Where switching to a section lands: its home, or the planner for a Kids
 *  manager who is not a Kids member (management never implies membership). */
export function sectionHome(section: NavSection, a: NavAccess): string {
  if (section === "worship") return "/";
  return a.inKids ? "/kids" : "/kids/admin";
}
