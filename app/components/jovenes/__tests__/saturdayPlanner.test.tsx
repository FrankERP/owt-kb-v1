/** @vitest-environment jsdom */
// Planear Jóvenes' client half: what each button SENDS (the route, the method, the body the
// commit module expects), and that a failure keeps the editor open with the server's words —
// never closes as success (CLAUDE.md: client mutation handlers). The server decides every write;
// these rows pin only that the client asks for the right one.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { ReactNode } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { saturdayRows } from "@/app/utils/jovenesPlannerModel";
import SaturdayPlanner from "../SaturdayPlanner";
import ProgramEditor from "../ProgramEditor";
import { writeMessage } from "../eventWrite";

// No MotionProvider: a dialog then unmounts the moment it closes (no exit animation to wait out
// in jsdom), so «closed» is observable — the membersPanelMenu tests do the same.
function AdminProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <CueDialogProvider>{children}</CueDialogProvider>
    </ToastProvider>
  );
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

installMotionTestEnv();

const TOKEN = "0f8e6a52-1c1b-4d7e-9a43-6a2b1c0d9e11";
const people = [
  { id: "m1", name: "Ana" },
  { id: "m2", name: "Beto" },
];

function ev(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: `ministryEvent.${TOKEN}`,
    rev: "rev-1",
    ministry: "jovenes",
    audience: { kind: "ministry" },
    kind: "saturday",
    date: "2026-11-07",
    time: "18:10",
    arrival: "17:30",
    title: null,
    notes: null,
    published: false,
    seats: [{ _key: "k1", role: "encargado", memberId: "m1", name: "Ana", mine: false }],
    program: [],
    createdById: null,
    createdByName: null,
    ...over,
  };
}

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, id: "x", rev: "rev-2" } };

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { ok: true, id: "x", rev: "rev-2" } };
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => TOKEN });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPlanner = (events: MinistryEventView[], canEdit = true) =>
  render(
    <AdminProviders>
      <SaturdayPlanner month="2026-11" rows={saturdayRows("2026-11", events)} people={people} canEdit={canEdit} />
    </AdminProviders>,
  );

describe("SaturdayPlanner", () => {
  it("creates a Saturday through POST with a create token, the usual times and the ministry audience", async () => {
    renderPlanner([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Crear" })[0]);
    fireEvent.change(screen.getByLabelText("Apoyo"), { target: { value: "m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: "/api/ministries/jovenes/events",
        method: "POST",
        body: {
          token: TOKEN,
          audience: { kind: "ministry" },
          kind: "saturday",
          date: "2026-11-07",
          time: "18:10",
          arrival: "17:30",
          title: null,
          notes: null,
          published: false,
          seats: [{ role: "apoyo", member: "m2" }],
        },
      },
    ]);
  });

  it("edits through PATCH under the revision it read, keeping the seat's key", async () => {
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({
      url: `/api/ministries/jovenes/events/${TOKEN}`,
      method: "PATCH",
      body: { _rev: "rev-1", published: true, seats: [{ _key: "k1", role: "encargado", member: "m1" }] },
    });
  });

  // The clocks are the house time field (`DateField kind="time"`), not free text: a phone's
  // digits-only keyboard has no «:», and the native control cannot hold a malformed value at all.
  // What a malformed one would be told is pinned on the model (`saturdayProblem`).
  it("the clocks are the house time field, and a changed one is what gets sent", async () => {
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const hora = screen.getByLabelText("Hora") as HTMLInputElement;
    const llegada = screen.getByLabelText("Llegada") as HTMLInputElement;
    expect([hora.type, hora.value, llegada.type, llegada.value]).toEqual(["time", "18:10", "time", "17:30"]);
    fireEvent.change(hora, { target: { value: "19:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0].body).toMatchObject({ time: "19:00", arrival: "17:30" });
  });

  it("refuses a clock that is not HH:mm, or one left half typed, before sending anything", async () => {
    // A value the native field cannot hold (it reached the form another way): the model's check.
    renderPlanner([ev({ time: "6pm" })]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("La hora debe ser HH:mm (por ejemplo 18:10).")).toBeTruthy();
    expect(calls).toEqual([]);
    cleanup();
    // «18:--»: the field reports "" and only the browser knows it is not empty (`badInput`).
    // Saving it as «no time» would silently drop the clock.
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    Object.defineProperty(screen.getByLabelText("Llegada"), "validity", { value: { badInput: true } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Completa la hora o bórrala.")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("says the state of every row, published or not, and a failure in the dialog's own status", async () => {
    answer = { status: 403, body: { error: "No puedes editar este evento." } };
    renderPlanner([ev(), ev({ _id: "ministryEvent.b", date: "2026-11-14", published: true })]);
    expect(screen.getByText("Borrador")).toBeTruthy();
    expect(screen.getByText("Publicada")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    // The sheet's title is the house one (an `h2`), with the date in words under it.
    expect(screen.getByRole("heading", { name: "Editar reunión" })).toBeTruthy();
    expect(screen.getByText(/Sábado 7 de noviembre/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    // `CueDialogStatus` announces it: the refusal sits in an alert, not in a loose red line.
    expect((await screen.findByText("No puedes editar este evento.")).closest('[role="alert"]')).toBeTruthy();
  });

  it("a refusal keeps the editor open with the server's words, and refreshes nothing", async () => {
    answer = { status: 403, body: { error: "No puedes editar este evento." } };
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No puedes editar este evento.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  // Review finding (PR C): a stale editor that stayed open saved over the newer meeting on the
  // second «Guardar». A 409 now closes it, says why, and refreshes.
  it("a stale save closes the editor with the reason and refreshes — no second save from the snapshot", async () => {
    answer = { status: 409, body: { error: "Alguien más cambió este evento; recarga." } };
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText(/Alguien más cambió este evento; recarga\. Ábrela de nuevo/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toHaveLength(1);
  });

  it("deletes only after the second tap, under the revision it read", async () => {
    renderPlanner([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar reunión" }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([{ url: `/api/ministries/jovenes/events/${TOKEN}`, method: "DELETE", body: { _rev: "rev-1" } }]);
  });

  it("a leader sees the table and can copy it, but gets no edit buttons", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPlanner([ev()], false);
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copiar para WhatsApp" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("Encargado: Ana");
  });
});

describe("ProgramEditor", () => {
  it("sends ONLY the program, under the revision it read, to the program route", async () => {
    render(
      <AdminProviders>
        <ProgramEditor event={ev()} people={people} />
      </AdminProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar programa" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    fireEvent.change(screen.getByPlaceholderText("Oración, dinámica, alabanza…"), { target: { value: "Oración" } });
    fireEvent.change(screen.getByLabelText("Quién — línea 1"), { target: { value: "m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar programa" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: `/api/ministries/jovenes/events/${TOKEN}/program`,
        method: "PATCH",
        body: { _rev: "rev-1", program: [{ label: "Oración", member: "m2" }] },
      },
    ]);
  });
});

describe("ProgramEditor after a stale save", () => {
  it("closes, and the next open sends the NEW revision with the refreshed lines", async () => {
    answer = { status: 409, body: { error: "Alguien más cambió este evento; recarga." } };
    const view = (e: MinistryEventView) => (
      <AdminProviders>
        <ProgramEditor event={e} people={people} />
      </AdminProviders>
    );
    const { rerender } = render(view(ev()));
    fireEvent.click(screen.getByRole("button", { name: "Editar programa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar programa" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Closed for real: the dialog's body is gone, not just its button busy.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The refresh brings the other person's line under a new revision.
    answer = { status: 200, body: { ok: true, id: "x", rev: "rev-3" } };
    rerender(view(ev({ rev: "rev-2", program: [{ _key: "l9", label: "Dinámica", memberId: null, name: null, mine: false, note: null }] })));
    fireEvent.click(await screen.findByRole("button", { name: "Editar programa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Guardar programa" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ _rev: "rev-2", program: [{ _key: "l9", label: "Dinámica" }] });
  });
});

describe("writeMessage", () => {
  it("shows the server's Spanish refusal, maps a code, and never shows a raw code", () => {
    expect(writeMessage(403, { error: "No puedes editar este evento." })).toBe("No puedes editar este evento.");
    expect(writeMessage(400, { error: "invalid_member" })).toContain("ya no está en Jóvenes");
    expect(writeMessage(400, { error: "invalid_kind" })).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(writeMessage(400, { error: "toString" })).toBe("No se pudo guardar. Intenta de nuevo.");
    expect(writeMessage(401, null)).toBe("Tu sesión terminó; vuelve a entrar.");
  });
});
