/** @vitest-environment jsdom */
// Solver v3 C1 §6 — «Cuenta para equidad» wired through MonthGenerator, with the REAL
// PlannerGrid and MonthCalendar (no mocks), in both modes and in «+ Nuevo servicio».
//
// The clock is pinned with `vi.useFakeTimers({ toFake: ["Date"] })`: only `Date` is
// faked, so `waitFor` and every timer stay real. Unless a case moves it, "now" is
// 2026-02-15 in CDMX — February 2026 is the current month, January 2026 is past.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
} from "../fairnessToggleModel";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import type { ServiceRole } from "../serviceCardModel";
import { stubFetchWithHistory } from "./derivedHistoryHarness";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";

const FEB_15 = new Date("2026-02-15T18:00:00.000Z");

let uuid = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FEB_15);
  localStorage.clear();
  uuid = 0;
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `req-fairness-${++uuid}`) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

const sw = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};

function response(status = 200, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ─── Stored-mode harness (the storedMove pattern: real grid, coherent integrity) ──

const MEMBERS = ["ana", "beto"].map((id) => ({ _id: id, member_name: id }));

function member(id: string, key: string) {
  return { _id: id, _key: key, member_name: id };
}

function role(overrides: Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_rev" | "date">): ServiceRole {
  return {
    _type: "sunday_role",
    published: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...overrides,
  };
}

function targetFor(value: ServiceRole): RoleTarget {
  const isSpecial = value._type === "special_role";
  return {
    targetKey: isSpecial ? value._id : `${value._type}:${value.date}`,
    type: value._type,
    canonicalCount: 1,
    canonicalIds: [value._id],
    canonicalState: "single",
    publicState: "single",
    memberVisibleCount: value.published === false ? 0 : 1,
    draftIds: [],
    records: [{
      id: value._id,
      rev: value._rev,
      type: value._type,
      serviceDate: value.date,
      published: value.published !== false,
      assignedRefs: [...new Set(value.leads.map((item) => item._id))],
      members: [],
      danglingRefs: [],
    }],
    expectsLock: !isSpecial,
    lock: isSpecial ? null : {
      id: `roleTarget.${value._type}.${value.date}`,
      rev: `lock-${value._id}`,
      state: "claimed",
      roleId: value._id,
      generation: 1,
    },
    lockIssues: [],
  };
}

function source(roles: ServiceRole[], generation = 1) {
  const integrity: RoleDomainSummary = { targets: roles.map(targetFor), recordIssues: [], lockIssues: [] };
  return {
    roles,
    integrity,
    rolesStatus: "ready" as const,
    integrityStatus: "ready" as const,
    rolesGeneration: generation,
    integrityGeneration: generation,
    reload: vi.fn(async () => true),
  };
}

function renderStored(roles: ServiceRole[], options: { initialMonth?: string; openComposerInitially?: boolean } = {}) {
  const onCreated = vi.fn();
  const base = {
    mode: "stored" as const,
    members: MEMBERS,
    initialMonth: options.initialMonth ?? "2026-02",
    openComposerInitially: options.openComposerInitially,
    rules: readyRules(),
    onClose: vi.fn(),
    onCreated,
  };
  const first = source(roles);
  const view = render(
    <MonthGenerator {...base} existingRoles={roles} allRoles={roles} storedSource={first} />,
    { wrapper: AdminProviders },
  );
  return {
    ...view,
    onCreated,
    storedSource: first,
    /** Re-render with the same state — the clock may have moved in between. */
    rerenderSame: () =>
      view.rerender(<MonthGenerator {...base} existingRoles={roles} allRoles={roles} storedSource={first} />),
    /** A reload that answers with new server state, exactly as production does. */
    reloadWith: (next: ServiceRole[], generation: number) =>
      view.rerender(
        <MonthGenerator {...base} existingRoles={next} allRoles={next} storedSource={source(next, generation)} />,
      ),
  };
}

const SUN_FEB_01 = role({ _id: "role-sun", _rev: "rev-sun", date: "2026-02-01", leads: [member("ana", "k-ana")] });
const SAT_FEB_07_OFF = role({ _id: "role-sat", _rev: "rev-sat", _type: "saturday_role", date: "2026-02-07", countsForFairness: false });
const SP_FEB_11 = role({ _id: "role-sp", _rev: "rev-sp", _type: "special_role", date: "2026-02-11", service_name: "Vigilia" });

// ─── Stored mode (§6.4) ──────────────────────────────────────────────────────

describe("stored mode — the header switch (C1 §6.4, §6.1)", () => {
  it("shows each row's value; a row without the field reads as its type default", () => {
    stubFetchWithHistory(vi.fn());
    renderStored([SUN_FEB_01, SAT_FEB_07_OFF, SP_FEB_11]);
    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-02-07").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
  });

  it("a toggle-only change is one dirty service, and its PATCH carries the new value and the unchanged roster", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response(200));
    stubFetchWithHistory(fetchMock);
    renderStored([SUN_FEB_01]);

    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Guardar 1 servicio" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/roles/role-sun");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      rev: "rev-sun",
      date: "2026-02-01",
      countsForFairness: false,
      leads: ["ana"],
    });
  });

  it("toggling back to the stored value leaves nothing to save", () => {
    stubFetchWithHistory(vi.fn());
    renderStored([SUN_FEB_01]);
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a past month, opened as «Roles previos» → «Editar mes» opens it: every switch disabled at its stored value, with the reason", () => {
    stubFetchWithHistory(vi.fn());
    // ServicesPanel's «Editar mes» mounts exactly this: mode "stored", initialMonth = the past month.
    renderStored(
      [
        role({ _id: "role-jan", _rev: "rev-jan", date: "2026-01-04", countsForFairness: false }),
        role({ _id: "role-jan-sp", _rev: "rev-jan-sp", _type: "special_role", date: "2026-01-14", service_name: "Retiro", countsForFairness: true }),
      ],
      { initialMonth: "2026-01" },
    );
    const sunday = sw("Cuenta para equidad 2026-01-04");
    const special = sw("Cuenta para equidad 2026-01-14 · Retiro");
    for (const toggle of [sunday, special]) {
      expect(toggle.disabled).toBe(true);
      expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
    }
    expect(sunday.getAttribute("aria-checked")).toBe("false");
    expect(special.getAttribute("aria-checked")).toBe("true");
  });

  it("a held edit is offered before the month boundary and gone after it", () => {
    vi.setSystemTime(new Date("2026-02-28T18:00:00.000Z"));
    stubFetchWithHistory(vi.fn());
    const { rerenderSame } = renderStored([SUN_FEB_01]);
    fireEvent.click(sw("Cuenta para equidad 2026-02-01"));
    expect(screen.getByRole("button", { name: "Guardar 1 servicio" })).toBeTruthy();

    vi.setSystemTime(new Date("2026-03-01T18:00:00.000Z"));
    rerenderSame();
    const toggle = sw("Cuenta para equidad 2026-02-01");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── «+ Nuevo servicio» (§6.5) ───────────────────────────────────────────────

describe("«+ Nuevo servicio» — the composer switch (C1 §6.5)", () => {
  const composerSwitch = () => sw("Cuenta para equidad");
  const composer = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-fairness-composer]")!;

  it("follows the Tipo until touched, keeps the admin's value after, and «Cancelar» resets it", () => {
    stubFetchWithHistory(vi.fn());
    const { container } = renderStored([], { openComposerInitially: true });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true"); // Domingo
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "special_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    expect(within(composer(container)).getByText(FAIRNESS_SPECIAL_HELP)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "worship_night" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "saturday_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(within(composer(container)).getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);

    fireEvent.click(composerSwitch()); // touched: off
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "sunday_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo servicio" }));
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("keys the creation request on the value: the same value retries the same id, a flipped one mints a new one", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response(400, { error: "invalid_request" });
    });
    stubFetchWithHistory(fetchMock);
    renderStored([], { openComposerInitially: true });

    const create = () => screen.getByRole("button", { name: "Crear vacío" }) as HTMLButtonElement;
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(create().disabled).toBe(false));
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(2));
    await waitFor(() => expect(composerSwitch().disabled).toBe(false));
    fireEvent.click(composerSwitch());
    fireEvent.click(create());
    await waitFor(() => expect(bodies).toHaveLength(3));

    expect(bodies.map((body) => body.countsForFairness)).toEqual([true, true, false]);
    expect(bodies[1].creationRequestId).toBe(bodies[0].creationRequestId);
    expect(bodies[2].creationRequestId).not.toBe(bodies[0].creationRequestId);
  });

  it("verifies a create only when the reload shows the requested value", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { creationRequestId: string };
      return response(201, { _id: "role-new", creationRequestId: body.creationRequestId });
    });
    stubFetchWithHistory(fetchMock);
    const { onCreated, storedSource, reloadWith } = renderStored([], { openComposerInitially: true });

    fireEvent.click(composerSwitch()); // Domingo, created OFF
    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(storedSource.reload).toHaveBeenCalled());

    const created = role({ _id: "role-new", _rev: "rev-new", date: "2026-02-01", countsForFairness: true });
    reloadWith([created], 2);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verificando…" })).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();

    reloadWith([{ ...created, _rev: "rev-new-2", countsForFairness: false }], 3);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("in a past month: disabled at the Tipo's default with the reason, and the body carries that default", async () => {
    vi.setSystemTime(new Date("2026-03-10T18:00:00.000Z"));
    const bodies: Record<string, unknown>[] = [];
    stubFetchWithHistory(vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response(400, { error: "invalid_request" });
    }));
    renderStored([], { openComposerInitially: true });

    expect(composerSwitch().disabled).toBe(true);
    expect(composerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(describedText(composerSwitch())).toBe(FAIRNESS_PAST_REASON);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "special_role" } });
    expect(composerSwitch().getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByPlaceholderText("Nombre del servicio"), { target: { value: "Vigilia" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ _type: "special_role", countsForFairness: false });
  });
});

// ─── Create mode (§6.1, §6.2) ────────────────────────────────────────────────

function Gen(props: Omit<React.ComponentProps<typeof MonthGenerator>, "rules">) {
  return (
    <AdminProviders>
      <MonthGenerator {...props} rules={readyRules()} />
    </AdminProviders>
  );
}

function setMonthYear(container: HTMLElement, month: number, year: number) {
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: String(month) } });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: String(year) } });
}

function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) => el.getAttribute("data-date"));
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

/** Records every create body; answers the history read and anything else with a 200. */
function stubCreates() {
  const bodies: Record<string, unknown>[] = [];
  stubFetchWithHistory(vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/roles") bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response(200);
  }));
  return bodies;
}

describe("create mode — columns, drafts and bodies (C1 §6.1, §6.2)", () => {
  it("columns enter at their defaults; a header edit and the composer's choice reach the create bodies", async () => {
    const bodies = stubCreates();
    const { container } = render(<Gen members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-02-11"]')!);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Vigilia" } });
    fireEvent.click(sw("Cuenta para equidad"));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    expect(sw("Cuenta para equidad 2026-02-01").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw("Cuenta para equidad 2026-02-08"));
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));
    await waitFor(() => expect(bodies).toHaveLength(5));
    expect(Object.fromEntries(bodies.map((body) => [body.date, body.countsForFairness]))).toEqual({
      "2026-02-01": true,
      "2026-02-08": false,
      "2026-02-11": true,
      "2026-02-15": true,
      "2026-02-22": true,
    });
  });

  it("holds a header edit across «Omitir», Auto and «← Volver»; deselecting the date discards it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/solve") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
            total_counts: { Ana: 1 },
            role_counts: { Ana: { "Sun.Lead": 1 } },
            unfilled_seats: [],
          }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    stubFetchWithHistory(fetchMock);
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] }];
    const { container } = render(<Gen members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Ana"));
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    fireEvent.click(sw("Cuenta para equidad 2026-02-08"));

    fireEvent.click(screen.getByLabelText("Omitir 2026-02-08"));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-02-08").disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Omitir 2026-02-08"));

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));
    await waitFor(() => expect(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"] [data-occupant]')).toBeTruthy());
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(screen.getByRole("button", { name: /Volver de todos modos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(container.querySelector('[data-date="2026-02-08"]')!); // deselect
    fireEvent.click(container.querySelector('[data-date="2026-02-08"]')!); // select again
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    expect(sw("Cuenta para equidad 2026-02-08").getAttribute("aria-checked")).toBe("true");
  });

  it("a past month's create columns are disabled at the type default, and the bodies carry it", async () => {
    vi.setSystemTime(new Date("2026-03-10T18:00:00.000Z"));
    const bodies = stubCreates();
    const { container } = render(<Gen members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(container, 2, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-02-11"]')!);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Vigilia" } });
    expect(sw("Cuenta para equidad").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    const sunday = sw("Cuenta para equidad 2026-02-08");
    expect(sunday.disabled).toBe(true);
    expect(sunday.getAttribute("aria-checked")).toBe("true");
    expect(describedText(sunday)).toBe(FAIRNESS_PAST_REASON);
    expect(sw("Cuenta para equidad 2026-02-11 · Vigilia").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));
    await waitFor(() => expect(bodies).toHaveLength(5));
    for (const body of bodies) {
      expect(body.countsForFairness, String(body.date)).toBe(
        countsForFairnessDefault(body._type as "sunday_role" | "special_role"),
      );
    }
  });
});
