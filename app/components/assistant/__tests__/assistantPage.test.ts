// What the bubble says the admin is looking at (ADR-0060): a page's own description wins only on
// its own path, everything else is named from the path alone.

import { describe, expect, it } from "vitest";

import { currentPage, describePath, suggestionsFor } from "../assistantPage";

describe("describePath", () => {
  it.each([
    ["/", "Inicio"],
    ["/schedule", "Calendario de servicios"],
    ["/biblioteca", "Biblioteca de canciones"],
    ["/posts/way-maker", "Página de una canción"],
    ["/me", "Mi semana"],
    ["/me/disponibilidad", "Mi disponibilidad"],
    ["/me/ajustes", "Mis ajustes"],
    ["/me/propose/2026-11-01", "Propuesta de setlist"],
    ["/admin", "Panel de admin"],
    ["/kids/admin", "Planear Kids"],
    ["/kids", "Kids"],
    ["/algo-nuevo", "Backstage"],
  ])("%s → %s", (path, label) => {
    expect(describePath(path)).toBe(label);
  });
});

describe("currentPage", () => {
  const own = { path: "/posts/way-maker", label: "Canción: Way Maker", refs: [{ kind: "song" as const, id: "abc", label: "Way Maker" }] };

  it("uses the page's own description on its path", () => {
    expect(currentPage("/posts/way-maker", own)).toEqual(own);
  });

  it("ignores a description left over from another path", () => {
    expect(currentPage("/biblioteca", own)).toEqual({ path: "/biblioteca", label: "Biblioteca de canciones", refs: [] });
  });
});

describe("suggestionsFor", () => {
  it("fits the starter questions to a song on screen", () => {
    expect(suggestionsFor({ path: "/posts/x", label: "x", refs: [{ kind: "song", id: "x", label: "x" }] })[0]).toBe(
      "¿De qué habla esta canción?",
    );
  });

  it("offers schedule questions on the admin panel and the calendar", () => {
    for (const path of ["/admin", "/schedule"]) {
      expect(suggestionsFor({ path, label: "x", refs: [] })[0]).toBe("¿Quién sirve este domingo y qué vamos a cantar?");
    }
  });

  it("falls back to general questions", () => {
    expect(suggestionsFor({ path: "/me", label: "x", refs: [] })).toHaveLength(3);
  });
});
