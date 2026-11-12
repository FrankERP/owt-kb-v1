/** @vitest-environment jsdom */
// «Clases del grupo» (plan 2026-11-12 §4): what each action SENDS, and that a failure is never a
// success. The writer decides every write (`ministryEventLessons.test.ts`); these rows pin that the
// client asks for the right one.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { ReactNode } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import type { PlannerViewer } from "@/app/utils/jovenesPlannerModel";
import type { LessonTrack } from "@/app/utils/ministryLesson";
import GroupClasses from "../GroupClasses";

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

const LEADER: PlannerViewer = { me: "jacob", isManager: false, led: ["otro-nivel"] };
const ADMIN: PlannerViewer = { me: "a", isManager: true, led: [] };
const PEOPLE = [
  { id: "rebe", name: "Rebe", groups: ["otro-nivel", "invencibles"] },
  { id: "hugo", name: "Hugo", groups: ["emprendedores"] },
];

let n = 0;
const tok = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function cls(date: string, title: string, over: { track?: LessonTrack; done?: boolean; who?: string } = {}): MinistryEventView {
  return {
    _id: `ministryEvent.${tok()}`,
    rev: `rev-${date}`,
    ministry: "jovenes",
    audience: { kind: "groups", groups: ["otro-nivel"] },
    kind: "group",
    date,
    time: "11:40",
    arrival: null,
    title,
    notes: null,
    place: "Oasis Tepepan",
    lesson: { series: "El Caos Dentro de Mi", track: over.track ?? "libro", done: over.done ?? false },
    published: true,
    seats: over.who ? [{ _key: "k1", role: "encargado", memberId: over.who, name: over.who, mine: false }] : [],
    program: [],
    createdById: null,
    createdByName: null,
  };
}

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let answers: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  calls = [];
  answers = [];
  refresh.mockReset();
  let uuid = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    const a = answers.shift() ?? { status: 200, body: { ok: true, id: "x", rev: "r2" } };
    return { ok: a.status < 300, status: a.status, json: async () => a.body } as Response;
  }));
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `11111111-1111-4111-8111-${String(++uuid).padStart(12, "0")}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (events: MinistryEventView[], viewer: PlannerViewer = LEADER) =>
  render(
    <Providers>
      <GroupClasses events={events} viewer={viewer} people={PEOPLE} today="2026-11-12" />
    </Providers>,
  );

describe("GroupClasses", () => {
  it("shows the roster with its count, a leader only their group, and an empty group's hint", () => {
    show([cls("2026-11-08", "Cap 4", { done: true }), cls("2026-11-15", "Cap 5", { who: "Rebe" })]);
    expect(screen.getByText("El Caos Dentro de Mi")).toBeTruthy();
    expect(screen.getByText("1 de 2 clases hechas")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Grupo" })).toBeNull();
    cleanup();
    show([], ADMIN);
    expect(within(screen.getByRole("group", { name: "Grupo" })).getAllByRole("button")).toHaveLength(5);
    expect(screen.getByText(/todavía no tiene clases/)).toBeTruthy();
  });

  it("«Hecho» sends the whole lesson with done flipped, under the class's revision", async () => {
    const c = cls("2026-11-15", "Cap 5");
    show([c]);
    fireEvent.click(screen.getByLabelText(/Hecho: Cap 5/));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: `/api/ministries/jovenes/events/${c._id.slice(14)}`,
        method: "PATCH",
        body: { _rev: c.rev, lesson: { series: "El Caos Dentro de Mi", track: "libro", done: true } },
      },
    ]);
  });

  it("«Nuevo libro» creates one class per chapter with its own token, and a retry resends only what is missing with the SAME tokens", async () => {
    show([]);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo libro/ }));
    fireEvent.change(screen.getByPlaceholderText("Por ejemplo, El Caos Dentro de Mi"), { target: { value: "El Caos Dentro de Mi" } });
    fireEvent.change(screen.getByLabelText("Desde el capítulo"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Cuántas clases"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Primera clase"), { target: { value: "2026-11-15" } });
    answers = [{ status: 200, body: { ok: true } }, { status: 500, body: { error: "boom" } }];
    fireEvent.click(screen.getByRole("button", { name: "Crear clases" }));
    await waitFor(() => expect(screen.getByText(/Se crearon 1 de 3/)).toBeTruthy());
    expect(calls.map((c) => [c.body.title, c.body.date, c.body.token])).toEqual([
      ["Cap 5", "2026-11-15", "11111111-1111-4111-8111-000000000001"],
      ["Cap 6", "2026-11-22", "11111111-1111-4111-8111-000000000002"],
    ]);
    expect(calls[0].body).toMatchObject({
      audience: { kind: "groups", groups: ["otro-nivel"] },
      time: "11:40",
      place: "Oasis Tepepan",
      lesson: { series: "El Caos Dentro de Mi", track: "libro", done: false },
      published: false,
    });
    expect(refresh).not.toHaveBeenCalled();
    // The form is frozen; the retry continues with the tokens it minted (a 409 «already created» counts as done).
    answers = [{ status: 409, body: { error: "already_created" } }];
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls.slice(2).map((c) => [c.body.title, c.body.token])).toEqual([
      ["Cap 6", "11111111-1111-4111-8111-000000000002"],
      ["Cap 7", "11111111-1111-4111-8111-000000000003"],
    ]);
  });

  it("«Recorrer» sends the anchor's revision, a marker token and the ids of every later class (not the «No hubo clase» rows)", async () => {
    const c5 = cls("2026-11-15", "Cap 5");
    const c6 = cls("2026-11-22", "Cap 6");
    const camp = cls("2026-11-29", "Campamento", { track: "sin_clase" });
    const c7 = cls("2026-12-06", "Cap 7");
    show([c5, c6, camp, c7]);
    const card = screen.getByRole("heading", { name: /Cap 6/ }).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /Opciones de Cap 6/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "No hubo clase: recorrer" }));
    expect(screen.getByText(/estas 2 clases se mueven/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recorrer" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: `/api/ministries/jovenes/events/${c6._id.slice(14)}/shift`,
        method: "POST",
        body: { _rev: c6.rev, token: "11111111-1111-4111-8111-000000000001", ids: [c6._id, c7._id] },
      },
    ]);
  });

  it("a refused «Recorrer» stays open with the server's words", async () => {
    const c6 = cls("2026-11-22", "Cap 6");
    show([c6]);
    fireEvent.click(screen.getByRole("button", { name: /Opciones de Cap 6/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "No hubo clase: recorrer" }));
    answers = [{ status: 400, body: { error: "No puedes editar este evento." } }];
    fireEvent.click(screen.getByRole("button", { name: "Recorrer" }));
    await waitFor(() => expect(screen.getByText("No puedes editar este evento.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("«Cambiar con…» sends both revisions", async () => {
    const a = cls("2026-11-15", "Cap 5", { who: "Rebe" });
    const b = cls("2026-11-22", "Cap 6");
    show([a, b]);
    fireEvent.click(screen.getByRole("button", { name: /Opciones de Cap 5/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cambiar con…" }));
    fireEvent.change(screen.getByLabelText("Clase con la que cambia"), { target: { value: b._id } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: `/api/ministries/jovenes/events/${a._id.slice(14)}/swap`,
        method: "POST",
        body: { _rev: a.rev, with: { token: b._id.slice(14), _rev: b.rev } },
      },
    ]);
  });

  it("a class's responsable is picked from the group's members only", async () => {
    show([cls("2026-11-15", "Cap 5")]);
    fireEvent.click(screen.getByRole("button", { name: /Nueva clase/ }));
    const select = screen.getByLabelText("Responsable") as HTMLSelectElement;
    const names = [...select.options].map((o) => o.textContent);
    expect(names).toContain("Rebe");
    expect(names).not.toContain("Hugo");
  });
});
