//
// The saved-month card deletes services (admin parity phase 2, T5; plan
// docs/superpowers/plans/2026-10-24-owt-mcp-admin-parity-f2-deletes.md): «Borrar servicios…» or «Borrar este
// servicio» → the chat's own `check_service_deletes` → the card's confirmation → «Sí, borrar» calls the
// app-only `delete_services_app` with the check's list and token untouched — the REAL tools, over the
// fixture month. Fictitious people only (the repository is public).
//
// The DOM is set up by hand, in the node environment, as in `storedCardSave.test.tsx`.

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { checkServiceDeletesResult, deleteServicesResult } from "@/app/mcp/tools/serviceDeletes";
import { PRINCIPAL } from "@/app/mcp/tools/__tests__/monthToolFixtures";
import { MONTH, NOVEMBER, serviceWorld, type ServiceWorld } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import { deleteWorld, type DeleteWorld } from "@/app/mcp/tools/__tests__/serviceDeleteFixtures";
import { DELETE_ARGS_PREFIX, V3_STORED_EDITOR_LINES } from "@/app/components/admin/v3Copy";
import { Editor } from "@/mcp-app/proposal-card/Editor";
import { useStoredEditor } from "@/mcp-app/proposal-card/useStoredEditor";
import {
  CARD_DELETE,
  CARD_SAVE,
  DELETE_ARGS_LINE_PREFIX,
  MODEL_ONLY_DELETE_LINES,
  MODEL_ONLY_DELETE_TAILS,
  type StoredEdit,
} from "@/mcp-app/proposal-card/storedModel";

type Result = { content?: unknown; structuredContent?: unknown; isError?: boolean };
type Call = { name: string; arguments: Record<string, unknown> };
const D = V3_STORED_EDITOR_LINES.delete;

interface Host {
  app: App;
  calls: Call[];
  sendMessage: ReturnType<typeof vi.fn>;
  updateModelContext: ReturnType<typeof vi.fn>;
}

/** A host over the fixture world: the board's check, the delete check and the delete (scripted, else real). */
function host(w: ServiceWorld, d: DeleteWorld, opts: { deletes?: Array<() => Promise<Result>>; saves?: Array<() => Promise<Result>>; checksFailAfterDelete?: boolean } = {}): Host {
  const calls: Call[] = [];
  const sendMessage = vi.fn(async () => ({}));
  const updateModelContext = vi.fn(async () => ({}));
  const app = {
    callServerTool: vi.fn(async (params: Call, options?: { timeout?: number }) => {
      calls.push(params);
      if (params.name === "check_service_edits_app") {
        if (opts.checksFailAfterDelete && calls.some((c) => c.name === "delete_services_app")) throw new Error("lost");
        return checkServiceEditsAppResult(params.arguments as never, PRINCIPAL, w.deps);
      }
      if (params.name === "check_service_deletes") return checkServiceDeletesResult(params.arguments as never, PRINCIPAL, d.deps);
      if (params.name === "delete_services_app") {
        expect(options?.timeout).toBe(70_000);
        const next = opts.deletes?.shift();
        return next ? next() : deleteServicesResult(params.arguments as never, PRINCIPAL, d.deps, "delete_services_app");
      }
      if (params.name === "save_service_edits_app") {
        const next = opts.saves?.shift();
        return next ? next() : saveServiceEditsResult(params.arguments as never, PRINCIPAL, w.deps, "save_service_edits_app");
      }
      throw new Error(`unexpected tool ${params.name}`);
    }),
    sendMessage,
    updateModelContext,
    getHostCapabilities: () => ({ serverTools: {}, updateModelContext: { text: {} } }),
  } as unknown as App;
  return { app, calls, sendMessage, updateModelContext };
}

/** One array for every render: a fresh `[]` would restart the card on each render. */
const NO_EDITS: StoredEdit[] = [];

function Card({ app, edits = NO_EDITS }: { app: App; edits?: StoredEdit[] }) {
  const stored = useStoredEditor(app);
  const { start } = stored;
  useEffect(() => start(MONTH, edits, null), [start, edits]);
  return stored.props ? <Editor {...stored.props} /> : <p>{stored.opening.notice ?? "Abriendo"}</p>;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const allDisabled = (name: string) => screen.getAllByRole("button", { name }).every((b) => (b as HTMLButtonElement).disabled);
const deletesOf = (h: Host) => h.calls.filter((c) => c.name === "delete_services_app");
const lastCheckOf = (h: Host) => [...h.calls].reverse().find((c) => c.name === "check_service_deletes");

/** November with two drafts (the Saturday and the special); the rest published. */
const withDrafts = () => NOVEMBER().map((r) => (r._id === "sat7" || r._id === "esp18" ? { ...r, published: false } : r));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openConfirm(h: Host, scope: "drafts" | "all" = "drafts") {
  render(<Card app={h.app} />);
  await screen.findByText("Sin cambios");
  fireEvent.click(button(CARD_DELETE.month));
  expect(screen.getByRole("alertdialog", { name: CARD_DELETE.sheetHead(MONTH) })).toBeTruthy();
  await act(async () => fireEvent.click(button(scope === "drafts" ? CARD_DELETE.drafts : CARD_DELETE.all)));
  await screen.findByRole("alertdialog", { name: CARD_DELETE.confirmHead });
}

describe("«Borrar servicios…» deletes from the card", () => {
  it("asks the scope, shows the check's lines; «Cancelar» deletes nothing; «Sí, borrar» sends the list and token untouched", async () => {
    const w = serviceWorld({ rows: withDrafts() });
    const d = deleteWorld(w);
    const h = host(w, d);
    await openConfirm(h);
    const dialog = screen.getByRole("alertdialog", { name: CARD_DELETE.confirmHead });
    expect(dialog.textContent).toContain("sábado 7 nov · borrador");
    expect(dialog.textContent).toContain("Noche de alabanza 18 nov · especial · borrador");
    expect(dialog.textContent).toContain(CARD_DELETE.irreversible);
    expect(dialog.textContent).toContain(CARD_DELETE.publishedSkipped(3));
    // The model's lines never reach the card.
    expect(document.body.textContent).not.toContain(DELETE_ARGS_PREFIX);
    expect(document.body.textContent).not.toContain("delete_services");
    // The board is held while the question is open.
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect(lastCheckOf(h)!.arguments).toEqual({ month: MONTH, include: "drafts" });

    fireEvent.click(button(CARD_DELETE.no));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deletesOf(h)).toHaveLength(0);

    fireEvent.click(button(CARD_DELETE.month));
    await act(async () => fireEvent.click(button(CARD_DELETE.drafts)));
    await screen.findByRole("alertdialog", { name: CARD_DELETE.confirmHead });
    const checked = (await checkServiceDeletesResult({ month: MONTH, include: "drafts" }, PRINCIPAL, d.deps)).structuredContent as { deletes: unknown; token: string };
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Resultado del borrado:"));
    expect(deletesOf(h)).toHaveLength(1);
    expect(deletesOf(h)[0]!.arguments).toEqual({ month: MONTH, deletes: checked.deletes, token: checked.token });
    expect(w.store.has("sat7")).toBe(false);
    expect(w.store.has("esp18")).toBe(false);
    expect(h.sendMessage).not.toHaveBeenCalled();
    // The month is read again from the empty list, and the board unlocks.
    const after = h.calls.slice(h.calls.indexOf(deletesOf(h)[0]!));
    expect(after.some((c) => c.name === "check_service_edits_app" && Array.isArray(c.arguments.edits) && c.arguments.edits.length === 0)).toBe(true);
    await waitFor(() => expect(allDisabled("Agregar en Lead")).toBe(false));
    // Claude is told what was deleted.
    const context = String((h.updateModelContext.mock.calls.at(-1)?.[0] as { content: Array<{ text: string }> }).content[0]!.text);
    expect(context).toContain("borró desde la tarjeta");
  });

  it("«Borrar este servicio» checks that one service, published included, and deletes it", async () => {
    const w = serviceWorld();
    const d = deleteWorld(w);
    const h = host(w, d);
    render(<Card app={h.app} />);
    await screen.findByText("Sin cambios");
    const buttons = screen.getAllByRole("button", { name: CARD_DELETE.one });
    // sun15 is the fourth editable service of the fixture month.
    await act(async () => fireEvent.click(buttons[3]!));
    const dialog = await screen.findByRole("alertdialog", { name: CARD_DELETE.confirmHead });
    expect(lastCheckOf(h)!.arguments).toEqual({ month: MONTH, services: ["sun15"] });
    expect(dialog.textContent).toContain("domingo 15 nov · publicado: se avisa a hasta 1 persona");
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await waitFor(() => expect(w.store.has("sun15")).toBe(false));
  });

  it("is disabled while the card has unsaved edits, and after a save started", async () => {
    const w = serviceWorld();
    const d = deleteWorld(w);
    const h = host(w, d, { saves: [async () => { throw new Error("lost"); }] });
    const edits: StoredEdit[] = [{ op: "place", service: "sun15", row: "bgv", member: w.tok("m-carla") }];
    render(<Card app={h.app} edits={edits} />);
    await screen.findAllByText(/1 servicio cambia/);
    expect((button(CARD_DELETE.month) as HTMLButtonElement).disabled).toBe(true);
    expect(allDisabled(CARD_DELETE.one)).toBe(true);
    expect(screen.getByText(CARD_DELETE.editsFirst)).toBeTruthy();
    fireEvent.click(button("Guardar"));
    await act(async () => fireEvent.click(button(CARD_SAVE.yes)));
    await screen.findByRole("button", { name: CARD_SAVE.again });
    expect((button(CARD_DELETE.month) as HTMLButtonElement).disabled).toBe(true);
    expect(allDisabled(CARD_DELETE.one)).toBe(true);
    expect(h.calls.some((c) => c.name === "check_service_deletes")).toBe(false);
  });

  it("an unknown outcome keeps the list: «Borrar de nuevo» repeats the identical call, «Mandar al chat» hands it to Claude", async () => {
    const w = serviceWorld({ rows: withDrafts() });
    const d = deleteWorld(w);
    const h = host(w, d, { deletes: [async () => { throw new Error("lost"); }] });
    await openConfirm(h);
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await screen.findByRole("button", { name: CARD_DELETE.again });
    expect(screen.getByRole("status").textContent).toContain(CARD_DELETE.unknown);
    // Locked: no gesture, no other delete.
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect(allDisabled(CARD_DELETE.one)).toBe(true);

    await act(async () => fireEvent.click(button(CARD_DELETE.toChat)));
    const message = String((h.sendMessage.mock.calls[0]?.[0] as { content: Array<{ text: string }> }).content[0]!.text);
    expect(message).toContain("- sábado 7 nov · borrador");
    expect(message).toContain(JSON.stringify(deletesOf(h)[0]!.arguments));

    await act(async () => fireEvent.click(button(CARD_DELETE.again)));
    await waitFor(() => expect(deletesOf(h)).toHaveLength(2));
    expect(deletesOf(h)[1]!.arguments).toEqual(deletesOf(h)[0]!.arguments);
    await waitFor(() => expect(w.store.has("sat7")).toBe(false));
  });

  it("a refusal shows the server's words without its lines for Claude, and reads the month from the empty list", async () => {
    const w = serviceWorld({ rows: withDrafts() });
    const d = deleteWorld(w);
    const h = host(w, d);
    await openConfirm(h);
    w.store.set("sat7", { ...w.store.get("sat7")!, _rev: "sat7-r9" });
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("sábado 7 nov cambió desde que lo revisaste"));
    expect(screen.getByRole("status").textContent).not.toContain("check_service_deletes");
    expect(w.store.has("esp18")).toBe(true);
    const after = h.calls.slice(h.calls.indexOf(deletesOf(h)[0]!));
    expect(after.some((c) => c.name === "check_service_edits_app" && (c.arguments.edits as unknown[]).length === 0)).toBe(true);
    expect(screen.queryByRole("button", { name: CARD_DELETE.again })).toBeNull();
  });

  it("a failed re-read keeps the board locked and says so; «Volver a leer el mes» unlocks it", async () => {
    const w = serviceWorld({ rows: withDrafts() });
    const d = deleteWorld(w);
    const h = host(w, d, { checksFailAfterDelete: true });
    await openConfirm(h);
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(CARD_DELETE.rereadFailed));
    expect(allDisabled("Agregar en Lead")).toBe(true);
    expect((button(CARD_DELETE.month) as HTMLButtonElement).disabled).toBe(true);
    expect(button(CARD_DELETE.rereadButton)).toBeTruthy();
  });

  it("a repeated contention gets ONE «Borrar de nuevo», then only a re-read", async () => {
    const w = serviceWorld({ rows: withDrafts() });
    const d = deleteWorld(w);
    const stale = async () => ({ ok: false, status: 409, body: { error: "stale_revision" } });
    d.scripted.set("sat7", [stale, stale]);
    const h = host(w, d);
    await openConfirm(h);
    await act(async () => fireEvent.click(button(CARD_DELETE.yes)));
    await screen.findByRole("button", { name: CARD_DELETE.again });
    expect(screen.getByRole("status").textContent).not.toContain("repite la misma llamada");
    await act(async () => fireEvent.click(button(CARD_DELETE.again)));
    await waitFor(() => expect(deletesOf(h)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: CARD_DELETE.again })).toBeNull());
    const after = h.calls.slice(h.calls.indexOf(deletesOf(h)[1]!));
    expect(after.some((c) => c.name === "check_service_edits_app")).toBe(true);
  });
});

describe("the card's copy mirrors the server's", () => {
  it("the model-only lines and tails are the server's own strings", () => {
    expect(DELETE_ARGS_LINE_PREFIX).toBe(DELETE_ARGS_PREFIX);
    expect([...MODEL_ONLY_DELETE_LINES]).toEqual([D.repeatSame, D.recheck]);
    const server = [D.notTheChecked, D.changed(["x"]), D.lineChanged("x"), D.status.notDeletedRepeat, D.status.deletedNotNotified("x")].join("\n");
    for (const tail of MODEL_ONLY_DELETE_TAILS.slice(0, 3)) expect(server, tail).toContain(tail);
    // The runner's own text after a domain throw.
    expect("No pude confirmar qué se borró. Repite exactamente la misma llamada: lo que ya se borró contesta «ya no existe».").toContain(MODEL_ONLY_DELETE_TAILS[3]);
  });
});
