// What the admin is looking at, for the assistant bubble (ADR-0060). Pure and neutral apart from a
// tiny module-level store: a page that knows more than its path (a song page knows the song) mounts
// `<AssistantPageContext>`, which writes here; the bubble reads it when a question is sent. Every
// other page is described from its path alone (`describePath`).

import { useSyncExternalStore } from "react";
import type { AdminChatPage, AdminChatPageRef } from "@/app/utils/adminChat";

/** A page's own description, valid only while the admin is still on `path`. */
export interface PageOverride {
  path: string;
  label: string;
  refs: AdminChatPageRef[];
}

let override: PageOverride | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Registers a page's description; the returned function removes it (only if it is still this one). */
export function setPageOverride(next: PageOverride): () => void {
  override = next;
  emit();
  return () => {
    if (override === next) {
      override = null;
      emit();
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageOverride(): PageOverride | null {
  return useSyncExternalStore(
    subscribe,
    () => override,
    () => null,
  );
}

const PATH_LABELS: Array<[RegExp, string]> = [
  [/^\/$/, "Inicio"],
  [/^\/schedule(\/|$)/, "Calendario de servicios"],
  [/^\/biblioteca(\/|$)/, "Biblioteca de canciones"],
  [/^\/posts\/[^/]+$/, "Página de una canción"],
  [/^\/me\/disponibilidad(\/|$)/, "Mi disponibilidad"],
  [/^\/me\/ajustes(\/|$)/, "Mis ajustes"],
  [/^\/me\/propose\//, "Propuesta de setlist"],
  [/^\/me(\/|$)/, "Mi semana"],
  [/^\/admin(\/|$)/, "Panel de admin"],
  [/^\/kids\/admin(\/|$)/, "Planear Kids"],
  [/^\/kids(\/|$)/, "Kids"],
];

/** A page's label from its path alone. */
export function describePath(pathname: string): string {
  for (const [pattern, label] of PATH_LABELS) if (pattern.test(pathname)) return label;
  return "Backstage";
}

/** What goes with a question: the page's own description when it is for this path, else the path's. */
export function currentPage(pathname: string, own: PageOverride | null): AdminChatPage {
  if (own && own.path === pathname) return { path: pathname, label: own.label, refs: own.refs };
  return { path: pathname, label: describePath(pathname), refs: [] };
}

const GENERAL = [
  "¿Qué significa Isaías 40:31 y qué canción nuestra encaja con ese pasaje?",
  "¿Qué vamos a cantar el próximo domingo y en qué tonos?",
  "Explícame por qué funciona la progresión I–V–vi–IV.",
];

/** Starter questions for an empty conversation, fitted to what is on screen. */
export function suggestionsFor(page: AdminChatPage): string[] {
  if (page.refs.some((r) => r.kind === "song")) {
    return [
      "¿De qué habla esta canción?",
      "¿Qué pasajes de la Biblia se relacionan con esta letra?",
      "¿Qué otras canciones nuestras combinan con esta en un setlist?",
    ];
  }
  if (page.path.startsWith("/admin") || page.path.startsWith("/schedule")) {
    return [
      "¿Quién sirve este domingo y qué vamos a cantar?",
      "¿Qué servicios de este mes siguen sin setlist?",
      "Explícame por qué funciona la progresión I–V–vi–IV.",
    ];
  }
  return GENERAL;
}
