/** @vitest-environment jsdom */
// The groups' calendars in Planear Jóvenes (PR D): what each button SENDS, which buttons each
// viewer gets, and that a failure keeps the editor open — never closes as success (CLAUDE.md:
// client mutation handlers). The server decides every write; these rows pin only that the client
// asks for the right one and stays honest about the answer.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { ReactNode } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import type { PlannerViewer } from "@/app/utils/jovenesPlannerModel";
import GroupCalendar from "../GroupCalendar";

// No MotionProvider: a dialog then unmounts the moment it closes, so «closed» is observable.
function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <CueDialogProvider>{children}</CueDialogProvider>
    </ToastProvider>
  );
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

installMotionTestEnv();

const TOKEN = "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const LEADER: PlannerViewer = { me: "l", isManager: false, led: ["otro-nivel"] };
const ADMIN: PlannerViewer = { me: "a", isManager: true, led: [] };

function ev(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: `ministryEvent.${TOKEN}`,
    rev: "rev-1",
    ministry: "jovenes",
    audience: { kind: "groups", groups: ["otro-nivel"] },
    kind: "group",
    date: "2026-11-12",
    time: "19:30",
    arrival: null,
    title: "Célula",
    notes: null,
    place: null,
    lesson: null,
    published: false,
    seats: [],
    program: [],
    createdById: "other",
    createdByName: "Hugo",
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

const renderCalendar = (events: MinistryEventView[], viewer: PlannerViewer = LEADER) =>
  render(
    <Providers>
      <GroupCalendar events={events} viewer={viewer} defaultDate="2026-11-10" />
    </Providers>,
  );

describe("GroupCalendar", () => {
  it("a leader creates a meeting for their group through POST, with a create token and no kind", async () => {
    renderCalendar([]);
    fireEvent.click(screen.getByRole("button", { name: "Nueva reunión de grupo" }));
    // Fecha and Hora are the same house field (`DateField`), one beside the other.
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).type).toBe("date");
    expect((screen.getByLabelText("Hora") as HTMLInputElement).type).toBe("time");
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByPlaceholderText("Reunión de grupo"), { target: { value: "Célula" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: "/api/ministries/jovenes/events",
        method: "POST",
        body: {
          token: TOKEN,
          audience: { kind: "groups", groups: ["otro-nivel"] },
          date: "2026-11-10",
          time: "19:00",
          title: "Célula",
          place: null,
          notes: null,
          published: false,
        },
      },
    ]);
  });

  it("shares a meeting with another group, which the editor explains", async () => {
    renderCalendar([]);
    fireEvent.click(screen.getByRole("button", { name: "Nueva reunión de grupo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Emprendedores" }));
    expect(screen.getByText(/Solo quien la creó y los admins pueden cambiarla/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0].body.audience).toEqual({ kind: "groups", groups: ["otro-nivel", "emprendedores"] });
  });

  // A malformed clock is pinned on the model (`groupEventProblem`): the native time field cannot
  // hold one. A half-typed one («19:--») it reports as "", so the editor asks the browser.
  it("refuses before sending: no group, a leader without their own group, a half-typed clock", async () => {
    renderCalendar([]);
    fireEvent.click(screen.getByRole("button", { name: "Nueva reunión de grupo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Otro Nivel" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Elige al menos un grupo.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Invencibles" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Incluye uno de los grupos que lideras.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Otro Nivel" }));
    Object.defineProperty(screen.getByLabelText("Hora"), "validity", { value: { badInput: true } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Completa la hora o bórrala.")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  // Per-group leadership (plan 2026-11-11 T9): leads Otro Nivel, is only IN Invencibles.
  it("a leader of one group sees no «Editar» on a published meeting of a group they are only in", () => {
    renderCalendar([
      ev({ _id: "ministryEvent.a", audience: { kind: "groups", groups: ["invencibles"] }, published: true, title: "Célula de Invencibles" }),
    ]);
    expect(screen.getByText("Célula de Invencibles")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    cleanup();
    renderCalendar([ev({ published: true })]);
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
  });

  it("shows a meeting's place, and sends an edited one", async () => {
    renderCalendar([ev({ place: "Casa Fam Varela" })]);
    expect(screen.getByText(/Casa Fam Varela/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByPlaceholderText(/Casa Fam Varela/), { target: { value: "Oasis Tlalpan" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0].body.place).toBe("Oasis Tlalpan");
  });

  it("edits through PATCH under the revision it read", async () => {
    renderCalendar([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({
      url: `/api/ministries/jovenes/events/${TOKEN}`,
      method: "PATCH",
      body: { _rev: "rev-1", published: true, audience: { kind: "groups", groups: ["otro-nivel"] }, time: "19:30" },
    });
  });

  it("warns a leader who would share a meeting someone else created", () => {
    renderCalendar([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.queryByText(/ya no podrás editarla/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Invencibles" }));
    expect(screen.getByText(/ya no podrás editarla/)).toBeTruthy();
  });

  it("buttons follow the rules: a leader edits neither another group's meeting nor someone else's joint one", () => {
    renderCalendar([
      ev({ _id: "ministryEvent.a", audience: { kind: "groups", groups: ["invencibles"] } }),
      ev({ _id: "ministryEvent.b", audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] }, kind: "joint" }),
    ]);
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.getByText("Creada por Hugo")).toBeTruthy();
    cleanup();
    renderCalendar([ev({ audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] }, kind: "joint", createdByName: null })], ADMIN);
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.getByText("Creada por alguien que ya no está")).toBeTruthy();
  });

  it("a pastor with no group to lead gets no «Nueva reunión de grupo»", () => {
    renderCalendar([], { me: "m", isManager: false, led: [] });
    expect(screen.queryByRole("button", { name: "Nueva reunión de grupo" })).toBeNull();
    expect(screen.getByText("No hay reuniones de grupo este mes.")).toBeTruthy();
  });

  it("a refusal keeps the editor open with the server's words, and refreshes nothing", async () => {
    answer = { status: 403, body: { error: "No puedes crear este evento." } };
    renderCalendar([]);
    fireEvent.click(screen.getByRole("button", { name: "Nueva reunión de grupo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No puedes crear este evento.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a stale save closes the editor with the reason and refreshes", async () => {
    answer = { status: 409, body: { error: "Alguien más cambió este evento; recarga." } };
    renderCalendar([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toHaveLength(1);
  });

  it("deletes only after the second tap, under the revision it read", async () => {
    renderCalendar([ev()]);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar reunión" }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([{ url: `/api/ministries/jovenes/events/${TOKEN}`, method: "DELETE", body: { _rev: "rev-1" } }]);
  });
});
