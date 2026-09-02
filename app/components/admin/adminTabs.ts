// The admin tab catalog, and how a `?tab=` param resolves to one.
//
// This module has NO "use client" on purpose. Both sides need it: the /admin
// Server Component reads `searchParams` and resolves the tab there, and the
// client panel renders the bar from the same catalog. A helper exported from
// the client panel and called on the server is the shape that took the home
// page down on 2026-09-02 — see ADR-0028.

import type { AdminTabId } from "./proposalHandoff";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

/** Every tab, in bar order, with the roles allowed to see it. */
export const TAB_CATALOG: ReadonlyArray<{ id: AdminTabId; label: string; roles: OWTRole[] }> = [
  { id: "members",      label: "Miembros",       roles: ["super-admin"] },
  { id: "services",     label: "Servicios",      roles: ["super-admin", "admin"] },
  { id: "proposals",    label: "Propuestas",     roles: ["super-admin", "admin"] },
  { id: "availability", label: "Disponibilidad", roles: ["super-admin", "admin"] },
  { id: "activity",     label: "Actividad",      roles: ["super-admin", "admin"] },
  { id: "content",      label: "Contenido",      roles: ["super-admin", "admin", "content-editor"] },
];

/** The tabs this role may open, in bar order. */
export function visibleAdminTabs(role: OWTRole): ReadonlyArray<{ id: AdminTabId; label: string }> {
  return TAB_CATALOG.filter((t) => t.roles.includes(role));
}

/**
 * Which tab a URL should open.
 *
 * The role filter is the point, not a formality: `?tab=members` is a link an
 * admin can be handed or can keep from their own history, and Miembros is
 * super-admin only. An unknown, absent, or not-permitted value falls back to
 * the first tab this role can see — never to a tab they cannot.
 *
 * A repeated param (`?tab=a&tab=b`) arrives as an array; take neither, since
 * which one was meant is a guess.
 */
export function resolveAdminTab(param: string | string[] | undefined, role: OWTRole): AdminTabId {
  const visible = visibleAdminTabs(role);
  const fallback = visible[0]?.id ?? "content";
  if (typeof param !== "string") return fallback;
  return visible.some((t) => t.id === param) ? (param as AdminTabId) : fallback;
}
