/** @vitest-environment jsdom */
//
// «Pantalla completa» on the Servicios board (`ServicesOverview`).
//
// What this pins:
//  1. The read model lays the services out like the month editor: date order,
//     the editor's default seat rows plus any stored extra seat, no Coro on a
//     Saturday, a month band per month, «Borrador» on an unpublished service.
//  2. It shows EXACTLY what the month filter shows — «Próximos», one month or
//     several — because the filter is the board's, not a second one.
//  3. It is read only: opening, reading and closing it issues no request that
//     is not a GET.
//  4. It is a real full-screen layer: Escape and the visible button close it,
//     and focus returns to the button that opened it.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServicesPanel from "../ServicesPanel";
import { ToastProvider } from "../../ui/Toast";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { SOURCE_ENDPOINTS } from "../serviceSourceState";
import { buildServicesOverview } from "../servicesOverviewModel";
import type { MemberOption, ServiceRole, ServiceType } from "../serviceCardModel";

const m = (id: string, member_name: string, alias?: string): MemberOption => ({
  _id: id,
  member_name,
  ...(alias ? { alias } : {}),
});

function role(id: string, type: ServiceType, date: string, extra: Partial<ServiceRole> = {}): ServiceRole {
  return {
    _id: id,
    _rev: `rev-${id}`,
    _type: type,
    date,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    songs: [],
    ...extra,
  };
}

describe("buildServicesOverview", () => {
  it("orders the services by date, then Saturday, Sunday, specials by time", () => {
    const model = buildServicesOverview([
      role("sun", "sunday_role", "2026-11-08"),
      role("sp-late", "special_role", "2026-11-07", { service_name: "Retiro", time: "20:00" }),
      role("sat", "saturday_role", "2026-11-07"),
      role("sp-early", "special_role", "2026-11-07", { service_name: "Ayuno", time: "09:00" }),
    ]);
    expect(model.columns.map((c) => c.id)).toEqual(["sat", "sp-early", "sp-late", "sun"]);
    expect(model.columns[1]).toMatchObject({ typeLabel: "Especial", serviceName: "Ayuno", time: "09:00" });
  });

  it("seats people by alias, in the editor's rows, and gives a Saturday no Coro", () => {
    const model = buildServicesOverview([
      role("sun", "sunday_role", "2026-11-08", {
        leads: [m("a", "Ana López", "Anita")],
        bgvs: [m("b", "Beto"), m("c", "Caro")],
        chorus: [m("d", "Dani")],
        instruments: [
          { _key: "k1", instrument: "bass", person: m("e", "Emi") },
          { _key: "k2", instrument: "Sax", person: m("f", "Fer") },
          { _key: "k3", instrument: "Keys", person: null },
        ],
        foh: [{ _key: "k4", role: "Console", person: m("g", "Gus") }],
      }),
      role("sat", "saturday_role", "2026-11-14"),
    ]);
    expect(model.rows.map((r) => r.label)).toEqual(["Lead", "BGV", "Coro", "Bass", "Keys", "Drums", "EG", "AG", "Console", "Sax"]);
    expect(model.names("sun", "lead")).toEqual(["Anita"]);
    expect(model.names("sun", "bgv")).toEqual(["Beto", "Caro"]);
    // A lower-case stored label lands on the canonical row, not a second «bass».
    expect(model.names("sun", "instrumento:Bass")).toEqual(["Emi"]);
    expect(model.names("sun", "instrumento:Sax")).toEqual(["Fer"]);
    // An empty instrument seat is «Sin asignar», never a blank name.
    expect(model.names("sun", "instrumento:Keys")).toEqual([]);
    expect(model.names("sun", "foh:Console")).toEqual(["Gus"]);
    expect(model.names("sat", "coro")).toBeNull();
    expect(model.names("sat", "lead")).toEqual([]);
  });

  it("bands the columns by month and marks a draft", () => {
    const model = buildServicesOverview([
      role("n1", "sunday_role", "2026-11-29", { published: true }),
      role("d1", "sunday_role", "2026-12-06", { published: false }),
      role("d2", "sunday_role", "2026-12-13"),
    ]);
    expect(model.months).toEqual([
      { month: "2026-11", span: 1 },
      { month: "2026-12", span: 2 },
    ]);
    expect(model.columns.map((c) => c.draft)).toEqual([false, true, false]);
  });

  it("names a worship night as such", () => {
    const model = buildServicesOverview([
      role("wn", "special_role", "2026-11-20", { service_name: "Noche", format: "worship_night" }),
    ]);
    expect(model.columns[0].typeLabel).toBe("Noche de alabanza");
  });
});

// ── In the panel ─────────────────────────────────────────────────────────────

const YEAR = new Date().getFullYear() + 1;
const MONTH_A = `${YEAR}-03`;
const MONTH_B = `${YEAR}-04`;
const MONTH_C = `${YEAR}-05`;

const ROLES = [
  role("role-a", "sunday_role", `${MONTH_A}-01`, { leads: [m("x", "Xime")] }),
  role("role-b", "sunday_role", `${MONTH_B}-05`, { published: false }),
  role("role-c", "sunday_role", `${MONTH_C}-03`),
];

const PAYLOAD: Record<string, unknown> = {
  [SOURCE_ENDPOINTS.roles]: ROLES,
  [SOURCE_ENDPOINTS.members]: [],
  [SOURCE_ENDPOINTS.roleTargets]: { targets: [], recordIssues: [], lockIssues: [] },
  [SOURCE_ENDPOINTS.setlistTargets]: { targets: [], recordIssues: [] },
  [SOURCE_ENDPOINTS.proposals]: {
    records: [],
    serviceRefConflicts: [],
    targetKeyConflicts: [],
    recordIssues: [],
    draftIds: [],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => PAYLOAD[url] ?? {} }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <ServicesPanel />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

const monthPill = (ym: string) =>
  screen.getByRole("button", {
    name: new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
  });

const overviewColumns = () =>
  Array.from(document.querySelectorAll("[data-overview-column]")).map((el) => el.getAttribute("data-overview-column"));

describe("«Pantalla completa» on the Servicios board", () => {
  it("shows every upcoming service under «Próximos», read only", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    const dialog = screen.getByRole("dialog", { name: /Servicios en pantalla completa · Próximos/ });
    expect(overviewColumns()).toEqual(["role-a", "role-b", "role-c"]);
    expect(within(dialog).getByText("Xime")).toBeTruthy();
    expect(dialog.querySelectorAll("[data-overview-draft]").length).toBe(1);
    expect(dialog.querySelectorAll("[data-month-band]").length).toBe(3);
    // Nothing in it is a control except the way out.
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["Salir de pantalla completa (Esc)"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /Salir/ }));
    expect(screen.queryByRole("dialog", { name: /pantalla completa/ })).toBeNull();

    const writes = fetchMock.mock.calls.filter(([, init]) => init && (init as RequestInit).method && (init as RequestInit).method !== "GET");
    expect(writes).toEqual([]);
  });

  it("shows exactly the months the filter has pressed — two of three here", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(3));

    fireEvent.click(monthPill(MONTH_B));
    fireEvent.click(monthPill(MONTH_C));
    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    screen.getByRole("dialog", { name: /2 meses/ });
    expect(overviewColumns()).toEqual(["role-b", "role-c"]);
  });

  it("closes on Escape and hands focus back to its button", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(3));

    const opener = screen.getByRole("button", { name: /Pantalla completa/ });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: /pantalla completa/ })).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /pantalla completa/ })).toBeNull());
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Pantalla completa/ }));
  });
});
