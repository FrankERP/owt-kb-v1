/** @vitest-environment jsdom */
//
// Design pass, item 12 (2026-10-22): the proposal editor's controls are the
// house `Button`, keys are SHOWN as «B♭» while stored as «Bb», and the song
// search is a `CueDialog` sheet that stays open after an add.
//
// What each test pins, and why it would fail on the old editor:
// - the search opened as a floating box over the list (no `role="dialog"`), and
//   closed itself after every add, so a four-song set was four trips;
// - keys were printed as stored («Bb», «Tonos anteriores: Bb · Ab»);
// - the save bar's two buttons were hand-drawn <button>s with no busy state.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, within, waitFor, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import ProposalEditor from "../ProposalEditor";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";

// jsdom does no layout; the trap's visibility filter needs an offsetParent.
let originalOffsetParent: PropertyDescriptor | undefined;
beforeAll(() => {
  originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});
afterAll(() => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2099-08-16",
  service_type: "sunday" as const,
  service_date: "2099-08-16",
};

const proposal = {
  _id: "proposal-1",
  _rev: "rev-1",
  status: "draft" as const,
  songs: [
    { song_id: "song-1", title: "Sublime gracia", author: "Newton", key: "Bb", play_key: "Bb" },
  ],
};

const catalogue = [
  { _id: "song-1", title: "Sublime gracia", author: "Newton", key: "Bb", previous_keys: ["Bb", "Ab"] },
  { _id: "song-2", title: "Cuán grande es Él", author: "Boberg", key: "F#", previous_keys: [] },
  { _id: "song-3", title: "Al que está sentado", author: "Marcos Witt", key: "D", previous_keys: ["Eb"] },
];

/** The song search answers with the catalogue; the proposal writer is never hit here. */
function mockSongs() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/me/songs") ? catalogue : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

function renderEditor(p: typeof proposal | null = proposal) {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <ProposalEditor roleDoc={roleDoc} proposal={p} currentUserId="member-1" />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

describe("proposal editor — design pass (item 12)", () => {
  it("shows the stored «Bb» as «B♭» on the row and in its history, and keeps «Bb» as the value", () => {
    mockSongs();
    renderEditor();
    // The row's key button names the song and the formatted key.
    const keyButton = screen.getByRole("button", { name: "Tono de Sublime gracia: B♭" });
    expect(keyButton.textContent).toBe("B♭");
    expect(screen.queryByText("Bb")).toBeNull();
    // The picker's pills are formatted too, and the stored spelling is what is pressed.
    fireEvent.click(keyButton);
    const group = screen.getByRole("group", { name: /elegir tono de sublime gracia/i });
    const pressed = within(group).getAllByRole("button").filter(b => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map(b => b.textContent)).toEqual(["B♭"]);
    expect(within(group).getByRole("button", { name: "F♯m" })).toBeTruthy();
  });

  it("opens the search as a dialog, lists the catalogue in it, and stays open after an add", async () => {
    mockSongs();
    renderEditor();
    expect(screen.queryByRole("dialog")).toBeNull();

    const opener = screen.getByRole("button", { name: /agregar canción/i });
    expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("searchbox", { name: /buscar canción/i });
    // Focus lands on the search box, not on the sheet's close button.
    expect(document.activeElement).toBe(input);

    // The catalogue was fetched on mount, so the results are there at once.
    const list = await within(dialog).findByRole("list", { name: /resultados/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // The song already in the set is marked, not addable; its history is formatted.
    expect(within(list).getByRole("button", { name: "Sublime gracia — en lista" }).hasAttribute("disabled")).toBe(true);
    expect(within(list).getByText("B♭ · A♭")).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: "Agregar Cuán grande es Él" }));
    // Still open, the row now reads «En lista», and the footer counts two.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(list).getByRole("button", { name: "Cuán grande es Él — en lista" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByText("2 en la lista")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /^listo$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The set has the song, in the catalogue's key.
    expect(screen.getByRole("button", { name: "Tono de Cuán grande es Él: F♯" })).toBeTruthy();
  });

  it("swaps only the pressed save button's label while that save is in flight", async () => {
    let release: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/me/proposals")) {
        await new Promise<void>(r => { release = r; });
        return new Response(JSON.stringify({ _id: "proposal-1", status: "draft", _rev: "rev-2" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    const busy = await screen.findByRole("button", { name: /guardando…/i });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    // The other button is disabled, not relabelled.
    const submit = screen.getByRole("button", { name: /enviar propuesta/i });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(submit.textContent).toBe("Enviar propuesta");

    release?.();
    await screen.findByRole("button", { name: /guardar borrador/i });
  });

  it("offers the song's own stored spelling in the picker when the list lacks it", () => {
    mockSongs();
    renderEditor({
      ...proposal,
      songs: [{ song_id: "song-9", title: "Vine a adorarte", author: "Hughes", key: "Db", play_key: "Db" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Tono de Vine a adorarte: D♭" }));
    const group = screen.getByRole("group", { name: /elegir tono de vine a adorarte/i });
    const pressed = within(group).getAllByRole("button").filter(b => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map(b => b.textContent)).toEqual(["D♭"]);
  });

  it("keeps the list the lead is looking at when an earlier, slower search answers late", async () => {
    // Fake timers drive the debounce; every query below is a `getBy`, since
    // `findBy` polls on the real clock and would hang here.
    vi.useFakeTimers();
    {
      const pending: Array<{ q: string; resolve: (body: unknown) => void }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
        const q = new URL(String(input), "http://x").searchParams.get("q") ?? "";
        return new Promise<Response>(resolve => {
          pending.push({ q, resolve: body => resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })) });
        });
      });
      renderEditor();
      await act(async () => { vi.advanceTimersByTime(300); });
      fireEvent.click(screen.getByRole("button", { name: /agregar canción/i }));
      const input = screen.getByRole("searchbox", { name: /buscar canción/i });

      fireEvent.change(input, { target: { value: "Su" } });
      await act(async () => { vi.advanceTimersByTime(300); });
      fireEvent.change(input, { target: { value: "Sub" } });
      await act(async () => { vi.advanceTimersByTime(300); });
      const a = pending.find(p => p.q === "Su")!;
      const b = pending.find(p => p.q === "Sub")!;

      // The newer answer lands first, then the stale one.
      await act(async () => { b.resolve([catalogue[0]]); });
      await act(async () => { a.resolve([catalogue[0], catalogue[1], catalogue[2]]); });
      const list = screen.getByRole("list", { name: /resultados/i });
      expect(within(list).getAllByRole("listitem")).toHaveLength(1);
      expect(list.getAttribute("aria-busy")).toBeNull();
    }
  });

  it("says when the catalogue could not be read instead of showing an empty one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /agregar canción/i }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("alert");
    expect(within(dialog).queryByText("Sin resultados")).toBeNull();
  });

  it("names the row actions after the song, so a screen reader hears which one moves or goes", () => {
    mockSongs();
    renderEditor();
    expect(screen.getByRole("button", { name: "Quitar Sublime gracia" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mover arriba: Sublime gracia" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Mover abajo: Sublime gracia" }).hasAttribute("disabled")).toBe(true);
  });
});
