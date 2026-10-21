// The card over a SAVED month (admin parity phase 1, S4; ADR-0066): its model read against the REAL
// saved-month tools' answers — the chat's check opened in the card, a forced rule, «Guardar»'s chat
// message passed verbatim to `save_service_edits` — plus the splitting rule and the screen.
// Fictitious people only (the repository is public).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

import { checkServiceEditsAppResult, checkServiceEditsResult, saveServiceEditsResult } from "@/app/mcp/tools/serviceEditor";
import { PRINCIPAL } from "@/app/mcp/tools/__tests__/monthToolFixtures";
import { MONTH, serviceWorld, type ServiceWorld } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import { Editor, type StoredEditorProps } from "@/mcp-app/proposal-card/Editor";
import { cardViewOf } from "@/mcp-app/proposal-card/model";
import { storedSeatOf } from "@/mcp-app/proposal-card/useStoredEditor";
import {
  afterStoredRefusal,
  forceStoredLast,
  saveMessage,
  saveParts,
  storedCheckViewOf,
  type StoredChange,
  type StoredEdit,
} from "@/mcp-app/proposal-card/storedModel";

const appCheck = (w: ServiceWorld, edits: StoredEdit[], seat?: { service: string; row: string }) =>
  checkServiceEditsAppResult({ month: MONTH, edits, ...(seat ? { seat } : {}) } as never, PRINCIPAL, w.deps).then(storedCheckViewOf);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the saved-month model against the real tools", () => {
  it("the chat's check opens in the card: its services, its lines, and its edits as tokens", async () => {
    const w = serviceWorld();
    const out = await checkServiceEditsResult({ month: MONTH, edits: [{ op: "place", service: "2026-11-15", seat: "BGV", member: "Carla" }] }, PRINCIPAL, w.deps);
    const view = cardViewOf(out);
    expect(view.kind).toBe("storedMonth");
    if (view.kind !== "storedMonth") return;
    expect(view.title).toBe("Servicios de noviembre de 2026");
    expect(view.month).toBe(MONTH);
    expect(view.changed).toBe(1);
    expect(view.edits).toEqual([{ op: "place", service: "sun15", row: "bgv", member: w.tok("m-carla") }]);
    expect(view.services.find((s) => s.label === "domingo 15 nov")?.rows).toEqual([
      { label: "Lead", names: ["Bruno"] },
      { label: "BGV", names: ["Carla"] },
    ]);
    // The card continues from exactly that list.
    const again = await appCheck(w, view.edits);
    expect(again.ok).toBe(true);
    expect(again.changes.map((c) => c.service)).toEqual(["sun15"]);
  });

  it("the whole screen: a forced rule asks, forcing it mints the waiver, «Guardar»'s message saves as is", async () => {
    const w = serviceWorld();
    // Ana into sun1's BGV, where Dani sings: their pair rule, forcible.
    const edits: StoredEdit[] = [{ op: "place", service: "sun1", row: "bgv", member: w.tok("m-ana") }];
    const refused = await appCheck(w, edits);
    const after = afterStoredRefusal(edits, refused);
    expect(after.askForce).toBe(true);
    expect(storedSeatOf(edits[0])).toEqual({ service: "sun1", row: "bgv" });
    expect(refused.prompt?.[0]?.where).toBe("domingo 1 nov · BGV");
    const forced = await appCheck(w, forceStoredLast(after.edits));
    expect(forced.ok).toBe(true);
    const [part] = saveParts(forced.changes, forced.maxGroup);
    const message = saveMessage(MONTH, part!, 0, 1);
    expect(message.split("\n")[0]).toBe("Guarda estos cambios de noviembre de 2026 con save_service_edits:");
    expect(message).toContain("asignado de todos modos");
    const args = JSON.parse(message.split("\n").at(-1)!);
    const saved = await saveServiceEditsResult(args, PRINCIPAL, w.deps);
    expect(saved.structuredContent).toMatchObject({ ok: true, services: [{ service: "sun1", status: "saved" }] });
  });

  it("a refusal that is not forcible drops the edit; candidates come by token", async () => {
    const w = serviceWorld();
    // Tomás has no voice Tipo.
    const edits: StoredEdit[] = [{ op: "place", service: "sun15", row: "bgv", member: w.tok("m-tomas") }];
    const view = await appCheck(w, edits);
    expect(afterStoredRefusal(edits, view)).toEqual({ edits: [], askForce: false });
    const seat = await appCheck(w, [], { service: "sun15", row: "bgv" });
    expect(seat.candidates?.length).toBeGreaterThan(0);
  });

  it("a revise_proposal or solve_month answer is never read as a saved month", () => {
    const proposal = cardViewOf({ structuredContent: { ok: true, proposal: "h1", revision: 2, board: [], changes: [], month: MONTH }, content: [] });
    expect(proposal.kind).toBe("proposal");
  });
});

describe("splitting «Guardar»", () => {
  const ch = (service: string, unit: string[] = [service]): StoredChange => ({ service, unit, lines: [`${service} · BGV: entra Ana`] });
  it("one part when every unit fits; whole units packed together", () => {
    const changes = [ch("a", ["a", "b"]), ch("b", ["a", "b"]), ch("c")];
    expect(saveParts(changes, null).map((p) => p.map((c) => c.service))).toEqual([["a", "b", "c"]]);
  });

  it("a group past the server's limit goes by its signed units; small units fill the gaps; a unit is never cut", () => {
    const big = ["a", "b", "c", "d", "e", "f"];
    const changes = [...big.map((id) => ch(id, big)), ch("g"), ch("h")];
    const parts = saveParts(changes, 6);
    expect(parts.map((p) => p.map((c) => c.service))).toEqual([["a", "b", "c", "d", "e", "f"], ["g", "h"]]);
    expect(saveMessage(MONTH, parts[1]!, 1, 2).split("\n")[0]).toBe("Guarda la parte 2 de 2 de los cambios de noviembre de 2026 con save_service_edits:");
    // The unit travels in the message untouched: the save checks it against its MAC.
    expect(saveMessage(MONTH, parts[0]!, 0, 2)).toContain('"unit":["a","b","c","d","e","f"]');
  });
});

describe("the saved-month screen", () => {
  const noop = () => {};
  const props: StoredEditorProps = {
    mode: "stored",
    heading: "Servicios de noviembre de 2026",
    subtitle: "Un servicio cambia",
    footer: <button type="button">Guardar</button>,
    board: [
      { service: "sun8", label: "domingo 8 nov", date: "2026-11-08", type: "sunday", editable: true, seats: [{ row: "bgv", label: "BGV", target: 3, members: [{ token: "t1", name: "Ana" }] }] },
      { service: "sat14", label: "sábado 14 nov", date: "2026-11-14", type: "saturday", editable: false, seats: [] },
    ],
    lines: ["domingo 8 nov · BGV: entra Ana"],
    pending: 1,
    busy: false,
    notice: null,
    sheet: null,
    ask: null,
    exchanging: null,
    onOpenSeat: noop, onPick: noop, onCloseSheet: noop, onClear: noop, onExchange: noop, onForce: noop, onDiscard: noop, onClose: noop,
  };

  it("shows its own heading and actions, tags a service only /admin can edit, and offers no «Cargar»", () => {
    const out = renderToStaticMarkup(<Editor {...props} />);
    expect(out).toContain("Servicios de noviembre de 2026");
    expect(out).toContain("Un servicio cambia · 1 cambio sin guardar");
    expect(out).toContain("Solo en /admin");
    expect(out).toContain(">Guardar</button>");
    expect(out).not.toContain("Cargar");
    expect(out).not.toContain("Versión");
  });
});
