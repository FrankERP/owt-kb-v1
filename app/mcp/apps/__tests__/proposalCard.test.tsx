// The proposal card (MCP Apps, S1): its view model against `solve_month`'s REAL result (so a
// change to the report's shape cannot leave the card silently empty), the presentational half,
// and the committed bundle — rebuilt here and compared byte for byte, self-contained (the
// host's CSP admits no other origin) and bounded in size.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

import { solveMonthResult } from "@/app/mcp/tools/solveMonth";
import { PRINCIPAL, solveDeps, textOf } from "@/app/mcp/tools/__tests__/monthToolFixtures";
import { cardViewOf, dayOf, expiryLabel, monthsTitle, type CardView } from "@/mcp-app/proposal-card/model";
import { ProposalCard } from "@/mcp-app/proposal-card/ProposalCard";
import { GENERATED_FILE, buildProposalCardHtml, generatedModule } from "@/mcp-app/build.mjs";
import { PROPOSAL_CARD_HTML } from "@/mcp-app/generated/proposalCardHtml";

describe("the view model", () => {
  it("reads solve_month's real result: title, stored status, services and seats by name", async () => {
    const out = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, solveDeps());
    const view = cardViewOf(out);
    if (view.kind !== "proposal") throw new Error(`expected a proposal, got ${view.kind}`);
    expect(view.title).toBe("Propuesta de noviembre de 2026");
    expect(view.stored).toBe(true);
    expect(view.status).toMatch(/^Guardada hasta el \d{1,2} de [a-z]+, \d{2}:\d{2}$/);
    expect(view.services.length).toBeGreaterThan(0);
    // The fixture's solver puts Ana in the first service's Lead: the card shows her by name.
    const lead = view.services[0]!.rows.find((r) => r.label === "Lead");
    expect(lead?.names).toEqual([expect.stringMatching(/Ana/)]);
    // Everything shown is server text: no service label the text answer does not also carry.
    for (const s of view.services) expect(textOf(out)).toContain(s.label);
  });

  it("a refusal shows the server's own lines", async () => {
    const out = await solveMonthResult({ month: "2026-11" }, null, solveDeps());
    expect(cardViewOf(out)).toEqual({ kind: "refused", lines: textOf(out).split("\n").filter((l) => l.trim()) });
  });

  it("no result yet is waiting; only isError is a refusal, anything else unreadable keeps the server's text", () => {
    expect(cardViewOf(undefined)).toEqual({ kind: "waiting" });
    expect(cardViewOf({ isError: true, content: [] })).toEqual({ kind: "refused", lines: ["No se pudo planear el mes."] });
    // A host that hands only `content` (no structuredContent) — maybe a stored proposal: no «No hay propuesta».
    expect(cardViewOf({ content: [{ type: "text", text: "Propuesta X (vence …)" }] })).toEqual({
      kind: "unreadable",
      lines: ["Propuesta X (vence …)"],
    });
  });

  it("carries every warning the text answer carries: stages, left-out services, refused specials, unavailability", async () => {
    const out = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, solveDeps());
    const view = cardViewOf(out);
    if (view.kind !== "proposal") throw new Error(`expected a proposal, got ${view.kind}`);
    expect(view.stages.length).toBeGreaterThan(0);
    for (const line of view.stages) expect(textOf(out)).toContain(line);
    const synthetic = cardViewOf({
      structuredContent: {
        ok: true,
        stored: false,
        months: ["2027-01"],
        services: [],
        leftOut: [{ service: "Dom 3 ene", reasons: ["ya existe"] }],
        refusedSpecials: [{ date: "2027-01-09", name: "Noche de alabanza", reason: "choca" }],
        unavailability: [{ name: "Ana", date: "2027-01-10", service: "Dom" }],
      },
    });
    expect(synthetic).toMatchObject({
      leftOut: [{ service: "Dom 3 ene", reasons: ["ya existe"] }],
      refusedSpecials: [{ name: "Noche de alabanza", day: "9 ene", reason: "choca" }],
      unavailability: [{ name: "Ana", service: "Dom", day: "10 ene" }],
    });
  });

  it("prints a service date as the text answer does (`dayLabel`), with no Date to shift the day", () => {
    expect(dayOf("2027-01-03")).toBe("3 ene");
    expect(dayOf("2026-12-31")).toBe("31 dic");
    expect(dayOf("not-a-date")).toBe("not-a-date");
  });

  it("a proposal that could not be stored, or has nothing to create, says so", () => {
    const base = { ok: true, months: ["2027-01"], services: [{ service: "Dom 3 ene", planned: true, seats: {} }] };
    expect(cardViewOf({ structuredContent: { ...base, stored: false } })).toMatchObject({
      stored: false,
      status: "No se pudo guardar esta propuesta; vuelve a pedir el mes.",
    });
    const none = { ...base, stored: false, services: [{ service: "Dom 3 ene", planned: false, seats: {} }] };
    expect(cardViewOf({ structuredContent: none })).toMatchObject({ status: "No hay nada que crear en este mes." });
  });

  it("titles one month, two in a year, and two across a year end", () => {
    expect(monthsTitle(["2027-01"])).toBe("Propuesta de enero de 2027");
    expect(monthsTitle(["2027-01", "2027-02"])).toBe("Propuesta de enero y febrero de 2027");
    expect(monthsTitle(["2026-12", "2027-01"])).toBe("Propuesta de diciembre de 2026 y enero de 2027");
    expect(monthsTitle(["nope"])).toBe("Propuesta");
  });

  it("formats the expiry in CDMX on a 24-hour clock", () => {
    // 21:04 UTC on 27 Oct 2026 is 15:04 in Mexico City (UTC−6, no DST since 2022).
    expect(expiryLabel("2026-10-27T21:04:00.000Z")).toBe("27 de octubre, 15:04");
    expect(expiryLabel("not a date")).toBe("");
  });
});

describe("the presentational card", () => {
  const view: CardView = {
    kind: "proposal",
    title: "Propuesta de enero de 2027",
    status: "Guardada hasta el 27 de octubre, 15:04",
    stored: true,
    services: [
      { label: "Dom 3 ene", planned: true, rows: [{ label: "Lead", names: ["Ana"] }] },
      { label: "Sáb 9 ene", planned: false, rows: [] },
    ],
    unfilled: [{ service: "Dom 3 ene", seat: "Bajo" }],
    notices: [],
    stages: ["Todas las etapas quedaron probadas."],
    leftOut: [{ service: "Sáb 2 ene", reasons: ["ya existe"] }],
    refusedSpecials: [],
    unavailability: [],
    fairness: [{ name: "Ana", tabs: [{ tab: "Dom Lead", enEstePlan: 2, queda: "al corriente" }] }],
  };
  const html = (v: CardView, canExpand = false) =>
    renderToStaticMarkup(<ProposalCard view={v} canExpand={canExpand} onExpand={() => {}} />);

  it("opens the planned services, marks the ones that will not be created, and lists unfilled seats", () => {
    const out = html(view);
    expect(out).toMatch(/<details class="service" open=""><summary><span class="service-label">Dom 3 ene/);
    expect(out).toMatch(/<details class="service"><summary><span class="service-label">Sáb 9 ene<\/span><span class="tag">No se creará/);
    expect(out).toContain("<li>Dom 3 ene: Bajo</li>");
    expect(out).toContain("al corriente");
    expect(out).toContain("<li>Todas las etapas quedaron probadas.</li>");
    expect(out).toContain("<li>Sáb 2 ene: ya existe</li>");
  });

  it("offers «Ver en grande» only when the host can go fullscreen", () => {
    expect(html(view)).not.toContain("Ver en grande");
    expect(html(view, true)).toContain("Ver en grande");
  });

  it("never offers a button that acts on the proposal (read-only until S4)", () => {
    expect(html(view, true).match(/<button/g)).toHaveLength(1);
  });
});

describe("the committed bundle", () => {
  it("is what `node mcp-app/build.mjs` builds now (run it after changing mcp-app/proposal-card/)", async () => {
    const fresh = generatedModule(await buildProposalCardHtml());
    expect(readFileSync(GENERATED_FILE, "utf8") === fresh).toBe(true);
  }, 30_000);

  it("is one self-contained document: no script, stylesheet, font or image from any origin", () => {
    expect(PROPOSAL_CARD_HTML.startsWith("<!doctype html>")).toBe(true);
    expect(PROPOSAL_CARD_HTML).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(PROPOSAL_CARD_HTML).not.toMatch(/<link\b/i);
    expect(PROPOSAL_CARD_HTML).not.toMatch(/<img\b/i);
    // The stylesheet fetches nothing either (the script's own strings are not CSS).
    const css = /<style>([\s\S]*?)<\/style>/.exec(PROPOSAL_CARD_HTML)?.[1] ?? "";
    expect(css).toContain("--color-background-primary");
    expect(css).not.toMatch(/@import|url\(/i);
    // One inline script: the bundle's own `</script` are escaped by the build, so the only
    // closing tag is the real one, right before </body>.
    expect(PROPOSAL_CARD_HTML.match(/<\/script/gi)).toHaveLength(1);
    expect(PROPOSAL_CARD_HTML.trimEnd().endsWith("</script>\n</body>\n</html>")).toBe(true);
  });

  it("stays under 800 000 characters (it is ~600 000: React, the MCP Apps client and zod)", () => {
    expect(PROPOSAL_CARD_HTML.length).toBeLessThan(800_000);
  });
});
