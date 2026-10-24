//
// The saved-month card saves by itself (ADR-0066 addendum, 2026-10-23; plan
// docs/superpowers/plans/2026-10-23-owt-mcp-card-saves.md): «Guardar» asks in the card, «Sí, guardar» calls the
// app-only `save_service_edits_app` — the REAL save, over the fixture month — and after a save starts the edit
// list is never replayed (S2.3): it stays frozen for a repeat, or the card reads the month from an empty list.
// Fictitious people only (the repository is public).
//
// The DOM is set up by hand, in the node environment: the server tools import `server-only`, which
// `vi.mock` stubs only in node's transform mode (the jsdom environment fails to resolve it).

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom ships no types here; only its constructor and `window` are used.
const { JSDOM } = (await import("jsdom" as string)) as { JSDOM: new (html: string, options: object) => { window: Window } };
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { configurable: true, get: () => (dom.window as unknown as Record<string, unknown>)[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

import type { App } from "@modelcontextprotocol/ext-apps";
import { checkServiceEditsAppResult, saveServiceEditsResult } from "@/app/mcp/tools/serviceEditor";
import { PRINCIPAL } from "@/app/mcp/tools/__tests__/monthToolFixtures";
import { MONTH, serviceWorld, type ServiceWorld } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import { V3_STORED_EDITOR_LINES } from "@/app/components/admin/v3Copy";
import { Editor } from "@/mcp-app/proposal-card/Editor";
import { useStoredEditor } from "@/mcp-app/proposal-card/useStoredEditor";
import { SERVICE_EDITOR_COPY } from "@/app/mcp/tools/serviceEditor";
import { CARD_SAVE, CONTEXT_HEAD, MODEL_ONLY_SAVE_LINES, MODEL_ONLY_SAVE_TAILS, storedSaveViewOf, type StoredEdit } from "@/mcp-app/proposal-card/storedModel";

type Result = { content?: unknown; structuredContent?: unknown; isError?: boolean };
type Call = { name: string; arguments: Record<string, unknown> };

interface Host {
  app: App;
  calls: Call[];
  /** Index in `calls` of the first save. */
  firstSave: () => number;
  sendMessage: ReturnType<typeof vi.fn>;
  updateModelContext: ReturnType<typeof vi.fn>;
}

/**
 * A host whose server is the fixture world. `saves` scripts the card's saves one by one (a function runs
 * the real save, or throws); past the script, the real save runs. `split` makes every check answer save in
 * parts of one service (`maxGroup: 1`), so two independent changes are two parts.
 */
function host(w: ServiceWorld, saves: Array<(args: Record<string, unknown>) => Promise<Result>> = [], split = false, checksFailAfterSave = false): Host {
  const calls: Call[] = [];
  const sendMessage = vi.fn(async () => ({}));
  const updateModelContext = vi.fn(async () => ({}));
  const realSave = (args: Record<string, unknown>) => saveServiceEditsResult(args as never, PRINCIPAL, w.deps, "save_service_edits_app");
  const app = {
    callServerTool: vi.fn(async (params: Call, options?: { timeout?: number }) => {
      calls.push(params);
      if (params.name === "check_service_edits_app") {
        if (checksFailAfterSave && calls.some((c) => c.name === "save_service_edits_app")) throw new Error("lost");
        const out = await checkServiceEditsAppResult(params.arguments as never, PRINCIPAL, w.deps);
        if (!split) return out;
        return { ...out, structuredContent: { ...(out.structuredContent as object), maxGroup: 1 } };
      }
      if (params.name === "save_service_edits_app") {
        expect(options?.timeout).toBe(70_000);
        const next = saves.shift();
        return next ? next(params.arguments) : realSave(params.arguments);
      }
      throw new Error(`unexpected tool ${params.name}`);
    }),
    sendMessage,
    updateModelContext,
    getHostCapabilities: () => ({ serverTools: {}, updateModelContext: { text: {} } }),
  } as unknown as App;
  return { app, calls, firstSave: () => calls.findIndex((c) => c.name === "save_service_edits_app"), sendMessage, updateModelContext };
}

function Card({ app, edits, reopen }: { app: App; edits: StoredEdit[]; reopen?: number }) {
  const stored = useStoredEditor(app);
  const { start } = stored;
  useEffect(() => start(MONTH, edits, null), [start, edits, reopen]);
  return stored.props ? <Editor {...stored.props} /> : <p>{stored.opening.notice ?? "Abriendo"}</p>;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** Whether every button with that name is disabled (the board repeats seat buttons per service). */
const allDisabled = (name: string) => screen.getAllByRole("button", { name }).every((b) => (b as HTMLButtonElement).disabled);
const checksAfterFirstSave = (h: Host) => h.calls.slice(h.firstSave()).filter((c) => c.name === "check_service_edits_app");

/** Every check the card sends after its first save reads the month from an empty list (S2.3). */
function expectNoReplay(h: Host) {
  expect(h.firstSave()).toBeGreaterThanOrEqual(0);
  for (const c of checksAfterFirstSave(h)) expect(c.arguments.edits).toEqual([]);
}

const PLACE_CARLA = (w: ServiceWorld): StoredEdit[] => [{ op: "place", service: "sun15", row: "bgv", member: w.tok("m-carla") }];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("«Guardar» saves from the card", () => {
  it("asks first; «Cancelar» calls nothing; «Sí, guardar» saves the part untouched, never through the chat", async () => {
    const w = serviceWorld();
    const h = host(w);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    const checkedChange = (h.calls.at(-1) && (await checkServiceEditsAppResult({ month: MONTH, edits: PLACE_CARLA(w) } as never, PRINCIPAL, w.deps)).structuredContent) as { changes: unknown[] };

    fireEvent.click(button("Guardar"));
    expect(screen.getByRole("alertdialog", { name: CARD_SAVE.confirmHead }).textContent).toContain("domingo 15 nov · BGV: entra Carla");
    expect(screen.getByText(CARD_SAVE.confirmNote)).toBeTruthy();
    // The board is held while the question is open.
    expect(allDisabled("Agregar en Lead")).toBe(true);
    fireEvent.click(button(CARD_SAVE.no));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.firstSave()).toBe(-1);

    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    const saves = h.calls.filter((c) => c.name === "save_service_edits_app");
    expect(saves).toHaveLength(1);
    expect(saves[0]!.arguments).toEqual({ month: MONTH, changes: checkedChange.changes });
    expect(h.sendMessage).not.toHaveBeenCalled();
    // The month is read as stored, and the save's report stays on screen after that read.
    expectNoReplay(h);
    expect(screen.getByRole("status").textContent).toContain("Resultado del guardado:");
    expect(w.store.get("sun15")!.bgvs.map((s) => s._id)).toEqual(["m-carla"]);
    // Claude is told it is saved, so it never saves these again from an older line.
    const context = String((h.updateModelContext.mock.calls.at(-1)?.[0] as { content: Array<{ text: string }> }).content[0]!.text);
    expect(context).toContain("guardó desde la tarjeta");
    expect(context).not.toContain(CONTEXT_HEAD);
  });

  it("an unknown outcome keeps the list frozen: «Guardar de nuevo» repeats the same part, «Mandar al chat» is the old way", async () => {
    const w = serviceWorld();
    const h = host(w, [
      async () => {
        throw new Error("timeout");
      },
    ]);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText(CARD_SAVE.unknown);
    // Frozen: no gesture extends the list.
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect(allDisabled("Quitar a Carla")).toBe(true);
    expect(checksAfterFirstSave(h)).toHaveLength(0);

    // «Mandar al chat»: only this part's line goes into the model's context.
    await act(async () => fireEvent.click(button(CARD_SAVE.toChat)));
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    const context = String((h.updateModelContext.mock.calls.at(-1)?.[0] as { content: Array<{ text: string }> }).content[0]!.text);
    expect(context.split("\n")).toHaveLength(2);
    expect(context.startsWith(CONTEXT_HEAD)).toBe(true);

    // «Guardar de nuevo» asks again and saves the SAME part (the real save this time).
    fireEvent.click(button(CARD_SAVE.again));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    const saves = h.calls.filter((c) => c.name === "save_service_edits_app");
    expect(saves).toHaveLength(2);
    expect(saves[1]!.arguments).toEqual(saves[0]!.arguments);
    expectNoReplay(h);
  });

  it("`repeat_same_call` and an answer without structure are unknown too: no re-check, «Guardar de nuevo»", async () => {
    for (const answer of [
      async (): Promise<Result> => ({ isError: true, content: [{ type: "text", text: "Resultado del guardado:" }, { type: "text", text: V3_STORED_EDITOR_LINES.repeatSame }], structuredContent: { ok: false, month: MONTH, services: [], next: "repeat_same_call" } }),
      async (): Promise<Result> => ({ isError: true, content: [{ type: "text", text: "No se pudo confirmar si el cambio se guardó." }] }),
    ]) {
      const w = serviceWorld();
      const h = host(w, [answer]);
      render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
      await screen.findAllByText(/1 servicio cambia/);
      fireEvent.click(button("Guardar"));
      await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
      await waitFor(() => expect(button(CARD_SAVE.again)).toBeTruthy());
      expect(screen.getByRole("status").textContent).toContain(CARD_SAVE.repeat);
      // Claude's own instruction never shows on the card.
      expect(screen.getByRole("status").textContent).not.toContain(V3_STORED_EDITOR_LINES.repeatSame);
      expect(checksAfterFirstSave(h)).toHaveLength(0);
      expect(allDisabled("Quitar a Carla")).toBe(true);
      cleanup();
    }
  });

  it("a refusal reads the month from the empty list, says what was not saved, and unfreezes", async () => {
    const w = serviceWorld();
    const h = host(w);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    // Someone edits sun15 in /admin meanwhile: the save refuses it as «cambió», before any write.
    w.store.set("sun15", { ...w.store.get("sun15")!, _rev: "sun15-r9" });
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    expectNoReplay(h);
    const notice = screen.getByRole("status").textContent ?? "";
    expect(notice).toContain(CARD_SAVE.reread);
    expect(notice).not.toContain("check_service_edits");
    expect(allDisabled("Agregar en Lead")).toBe(false);
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("an unknown outcome, then a refusal on the repeat: still read from the empty list, never the list", async () => {
    const w = serviceWorld();
    const h = host(w, [
      async () => {
        throw new Error("lost");
      },
    ]);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText(CARD_SAVE.unknown);
    w.store.set("sun15", { ...w.store.get("sun15")!, _rev: "sun15-r9" });
    fireEvent.click(button(CARD_SAVE.again));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    expectNoReplay(h);
  });

  it("two parts: part 1 saved freezes the board; «Descartar» keeps the report; part 2 ends with the empty list", async () => {
    const w = serviceWorld();
    const h = host(w, [], true);
    const edits: StoredEdit[] = [...PLACE_CARLA(w), { op: "clear", service: "sat7", row: "bgv", member: w.tok("m-ana") }];
    render(<Card app={h.app} edits={edits} />);
    await screen.findAllByText(/2 servicios cambian/);
    fireEvent.click(button("Guardar parte 1 de 2"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Parte 1 guardada");
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect(button("Guardar parte 2 de 2")).toHaveProperty("disabled", false);
    expect(checksAfterFirstSave(h)).toHaveLength(0);

    fireEvent.click(button("Guardar parte 2 de 2"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    expectNoReplay(h);
    expect(w.store.get("sat7")!.bgvs).toEqual([]);
  });

  it("«Descartar» after a saved part reads the month and keeps the save's report", async () => {
    const w = serviceWorld();
    const h = host(w, [], true);
    const edits: StoredEdit[] = [...PLACE_CARLA(w), { op: "clear", service: "sat7", row: "bgv", member: w.tok("m-ana") }];
    render(<Card app={h.app} edits={edits} />);
    await screen.findAllByText(/2 servicios cambian/);
    fireEvent.click(button("Guardar parte 1 de 2"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Parte 1 guardada");
    await act(async () => fireEvent.click(button("Descartar cambios")));
    await screen.findByText("Sin cambios");
    expect(screen.getByRole("status").textContent).toContain("Resultado del guardado:");
    expectNoReplay(h);
  });

  it("reopening the month after a save opens what is stored, not the chat's edits", async () => {
    const w = serviceWorld();
    const h = host(w);
    const edits = PLACE_CARLA(w);
    const { rerender } = render(<Card app={h.app} edits={edits} reopen={0} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    rerender(<Card app={h.app} edits={edits} reopen={1} />);
    await waitFor(() => expect(checksAfterFirstSave(h).length).toBeGreaterThanOrEqual(2));
    expectNoReplay(h);
  });
});

describe("while and after a save", () => {
  it("every button is held while the save runs (no second save can start)", async () => {
    const w = serviceWorld();
    let finish: (r: Result) => void = () => {};
    const h = host(w, [() => new Promise<Result>((resolve) => (finish = resolve))]);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    expect(button("Guardar")).toHaveProperty("disabled", true);
    expect(button("Descartar cambios")).toHaveProperty("disabled", true);
    expect(button("Cerrar")).toHaveProperty("disabled", true);
    await act(async () => finish(await saveServiceEditsResult({ month: MONTH, changes: (h.calls.at(-1)!.arguments as { changes: never }).changes }, PRINCIPAL, w.deps)));
    await screen.findByText("Sin cambios");
    expect(h.calls.filter((c) => c.name === "save_service_edits_app")).toHaveLength(1);
  });

  it("`check_again` reads the month from the empty list and says what was not saved", async () => {
    const w = serviceWorld();
    const h = host(w, [
      async () => ({ isError: true, content: [{ type: "text", text: "Resultado del guardado:" }], structuredContent: { ok: false, month: MONTH, services: [], next: "check_again" } }),
    ]);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByText("Sin cambios");
    expectNoReplay(h);
    expect(screen.getByRole("status").textContent).toContain(CARD_SAVE.reread);
    expect(allDisabled("Agregar en Lead")).toBe(false);
  });

  it("a failed read of the month after a save keeps the list frozen and says so", async () => {
    const w = serviceWorld();
    const h = host(w, [], false, true);
    render(<Card app={h.app} edits={PLACE_CARLA(w)} />);
    await screen.findAllByText(/1 servicio cambia/);
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(CARD_SAVE.rereadFailed));
    expect(screen.getByRole("status").textContent).toContain("Resultado del guardado:");
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect(button("Descartar cambios")).toHaveProperty("disabled", false);
    expectNoReplay(h);
  });
});

describe("the save's answer on the card", () => {
  it("drops and trims what is written for Claude; mirrors v3Copy's lines", () => {
    expect([...MODEL_ONLY_SAVE_LINES]).toEqual([V3_STORED_EDITOR_LINES.repeatSame, V3_STORED_EDITOR_LINES.recheck, V3_STORED_EDITOR_LINES.needsCard]);
    const view = storedSaveViewOf({
      isError: true,
      content: [{ type: "text", text: [V3_STORED_EDITOR_LINES.changed(["domingo 15 nov"]), V3_STORED_EDITOR_LINES.recheck].join("\n") }],
      structuredContent: { refused: true, code: "stale_revision" },
    });
    expect(view).toMatchObject({ structured: true, ok: false, refused: true, next: null });
    expect(view.lines.join(" ")).not.toContain("check_service_edits");
    expect(view.lines.join(" ")).toContain("domingo 15 nov cambió");
    expect(storedSaveViewOf({ isError: true, content: [{ type: "text", text: "x" }] })).toMatchObject({ structured: false, ok: false });
    // Every tail is a real tail of the server's copy, so a rewording there fails here.
    const sources = [
      V3_STORED_EDITOR_LINES.changed(["x"]),
      V3_STORED_EDITOR_LINES.notTheChecked("x"),
      V3_STORED_EDITOR_LINES.unitIncomplete(["x"]),
      V3_STORED_EDITOR_LINES.status.notSavedRepeat,
      SERVICE_EDITOR_COPY.domain,
    ];
    for (const tail of MODEL_ONLY_SAVE_TAILS) expect(sources.some((s) => s.includes(tail)), tail).toBe(true);
    expect(storedSaveViewOf({ isError: true, content: [{ type: "text", text: SERVICE_EDITOR_COPY.domain }] }).lines).toEqual(["No pude confirmar qué se guardó."]);
  });
});
