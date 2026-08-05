/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GridCell, GridColumn, GridRow } from "../plannerModel";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import type { ServiceRole } from "../serviceCardModel";

vi.mock("../PlannerGrid", () => ({
  default: ({
    columns,
    cells,
    onCellsChange,
    onStoredHeaderChange,
  }: {
    columns: GridColumn[];
    rows: GridRow[];
    cells: GridCell[];
    onCellsChange: (next: GridCell[]) => void;
    onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string }) => void;
  }) => (
    <div data-testid="stored-grid">
      {columns.map((column) => (
        <span key={column.columnId} data-testid="stored-column" data-column-id={column.columnId}>
          {column.columnId}
        </span>
      ))}
      <button
        type="button"
        onClick={() => onCellsChange(cells.map((cell) =>
          cell.columnId === "role-a" && cell.rowId === "lead"
            ? { ...cell, occupants: [{ memberId: "member-new" }] }
            : cell,
        ))}
      >
        Cambiar una celda
      </button>
      <button
        type="button"
        onClick={() => onCellsChange(cells.map((cell) =>
          cell.columnId === "role-a" && cell.rowId === "lead"
            ? { ...cell, occupants: [...cell.occupants].reverse() }
            : cell,
        ))}
      >
        Reordenar sin cambio
      </button>
      <button type="button" onClick={() => onStoredHeaderChange?.("role-a", { date: "2026-03-01" })}>
        Mover a marzo
      </button>
      <button type="button" onClick={() => onStoredHeaderChange?.("role-a", { serviceName: "" })}>
        Vaciar nombre especial
      </button>
    </div>
  ),
}));

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";

const members = [
  "lead-a",
  "lead-b",
  "bgv-a",
  "chorus-a",
  "instrument-a",
  "foh-a",
  "member-new",
].map((id) => ({ _id: id, member_name: id }));

function member(id: string, key: string) {
  return { _id: id, _key: key, member_name: id };
}

function role(overrides: Partial<ServiceRole> = {}): ServiceRole {
  return {
    _id: "role-a",
    _rev: "rev-a",
    _type: "sunday_role",
    date: "2026-02-01",
    published: false,
    leads: [member("lead-a", "lead-key-a")],
    bgvs: [member("bgv-a", "bgv-key-a")],
    chorus: [member("chorus-a", "chorus-key-a")],
    instruments: [{
      _key: "instrument-key-a",
      instrument: "Bajo",
      person: member("instrument-a", "ignored-instrument-person-key"),
    }],
    foh: [{
      _key: "foh-key-a",
      role: "Consola",
      person: member("foh-a", "ignored-foh-person-key"),
    }],
    ...overrides,
  };
}

function assignedRefs(value: ServiceRole): string[] {
  return [...new Set([
    ...value.leads.map((item) => item._id),
    ...value.bgvs.map((item) => item._id),
    ...value.chorus.map((item) => item._id),
    ...value.instruments.flatMap((item) => item.person ? [item.person._id] : []),
    ...value.foh.flatMap((item) => item.person ? [item.person._id] : []),
  ])];
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
      assignedRefs: assignedRefs(value),
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

function integrityFor(roles: ServiceRole[]): RoleDomainSummary {
  return { targets: roles.map(targetFor), recordIssues: [], lockIssues: [] };
}

function source(roles: ServiceRole[]) {
  return {
    roles,
    integrity: integrityFor(roles),
    rolesStatus: "ready" as const,
    integrityStatus: "ready" as const,
    rolesGeneration: 1,
    integrityGeneration: 1,
    reload: vi.fn(async () => true),
  };
}

function renderStored(roles: ServiceRole[], options: {
  openComposerInitially?: boolean;
  storedCapabilities?: ComponentProps<typeof MonthGenerator>["storedCapabilities"];
} = {}) {
  const storedSource = source(roles);
  const result = render(
    <MonthGenerator
      mode="stored"
      members={members}
      existingRoles={roles}
      allRoles={roles}
      initialMonth="2026-02"
      openComposerInitially={options.openComposerInitially}
      storedCapabilities={options.storedCapabilities}
      storedSource={storedSource}
      rules={readyRules()}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  return { ...result, storedSource };
}

function response(status = 200, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "stable-request-id") });
});

describe("MonthGenerator — stored mode", () => {
  it("renders same-date stored services as distinct role-ID columns", () => {
    const roles = [
      role({
        _id: "special-a",
        _rev: "special-rev-a",
        _type: "special_role",
        date: "2026-02-14",
        service_name: "Bodas",
      }),
      role({
        _id: "special-b",
        _rev: "special-rev-b",
        _type: "special_role",
        date: "2026-02-14",
        service_name: "Vigilia",
      }),
    ];

    renderStored(roles);

    expect(screen.getAllByTestId("stored-column").map((node) => node.getAttribute("data-column-id")))
      .toEqual(["special-a", "special-b"]);
  });

  it("enables explicit save after one cell changes and PATCHes complete five-field arrays", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role()]);

    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar una celda" }));
    const save = screen.getByRole("button", { name: "Guardar 1 servicio" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/roles/role-a");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(init?.body))).toEqual({
      _type: "sunday_role",
      bgvs: ["bgv-a"],
      chorus: ["chorus-a"],
      date: "2026-02-01",
      foh: [{ personId: "foh-a", role: "Consola" }],
      instruments: [{ instrument: "Bajo", personId: "instrument-a" }],
      leads: ["member-new"],
      lockRev: "lock-role-a",
      rev: "rev-a",
    });
  });

  it("treats a semantically identical reorder as a no-op and sends no PATCH", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role({
      leads: [member("lead-a", "lead-key-a"), member("lead-b", "lead-key-b")],
    })]);

    fireEvent.click(screen.getByRole("button", { name: "Reordenar sin cambio" }));

    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates one empty unpublished role and reuses its request ID after an unknown result", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) throw new Error("connection lost");
      return response();
    });
    vi.stubGlobal("fetch", fetchMock);
    const { storedSource } = renderStored([], { openComposerInitially: true });

    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(storedSource.reload).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar misma solicitud" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toEqual({
      creationRequestId: "stable-request-id",
      _type: "sunday_role",
      date: "2026-02-01",
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
      published: false,
    });
    expect(bodies[1].creationRequestId).toBe(bodies[0].creationRequestId);
  });

  it("gates create with its own capability even when stored editing is allowed", () => {
    renderStored([], {
      openComposerInitially: true,
      storedCapabilities: {
        edit: { enabled: true, reason: null },
        create: { enabled: false, reason: "Faltan propuestas." },
        swap: { enabled: true, reason: null },
        changeDate: { enabled: true, reason: null },
      },
    });

    const create = screen.getByRole("button", { name: "Crear vacío" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toBe("Faltan propuestas.");
  });

  it("does not verify a lost create from an unrelated empty role at the same target", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("lost"); }));
    const onCreated = vi.fn();
    const firstSource = source([]);
    const common = {
      mode: "stored" as const,
      members,
      existingRoles: [] as ServiceRole[],
      allRoles: [] as ServiceRole[],
      initialMonth: "2026-02",
      openComposerInitially: true,
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated,
    };
    const { rerender } = render(<MonthGenerator {...common} storedSource={firstSource} />);
    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(firstSource.reload).toHaveBeenCalledTimes(1));

    const unrelated = role({
      _id: "someone-elses-role",
      leads: [], bgvs: [], chorus: [], instruments: [], foh: [],
    });
    const secondSource = source([unrelated]);
    secondSource.rolesGeneration = 2;
    secondSource.integrityGeneration = 2;
    rerender(<MonthGenerator {...common} existingRoles={[unrelated]} allRoles={[unrelated]} storedSource={secondSource} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Reintentar misma solicitud" })).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps a cross-month date move on the source role ID and PATCHes the destination date", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role()]);

    fireEvent.click(screen.getByRole("button", { name: "Mover a marzo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar 1 servicio" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      rev: "rev-a",
      date: "2026-03-01",
    });
  });

  it("treats an invalid special-name edit as unsaved work and refuses Save", () => {
    renderStored([role({ _type: "special_role", service_name: "Bodas" })]);

    fireEvent.click(screen.getByRole("button", { name: "Vaciar nombre especial" }));

    expect(screen.getByText(/Corrige los datos inválidos/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" })[0]!);
    expect(screen.getByText(/Cerrar descarta 1 servicio con cambios/)).toBeTruthy();
  });

  it("sends a seat swap using only stored role, revision, path, and item key", async () => {
    const second = role({
      _id: "role-b",
      _rev: "rev-b",
      date: "2026-02-08",
      leads: [member("lead-b", "lead-key-b")],
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role(), second]);

    fireEvent.change(screen.getByLabelText("Primera asignación"), {
      target: { value: "role-a:Lead:lead-key-a" },
    });
    fireEvent.change(screen.getByLabelText("Segunda asignación"), {
      target: { value: "role-b:Lead:lead-key-b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar puestos" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/roles/swap");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "seat",
      source: { roleId: "role-a", rev: "rev-a", path: "Lead", itemKey: "lead-key-a" },
      target: { roleId: "role-b", rev: "rev-b", path: "Lead", itemKey: "lead-key-b" },
    });
  });

  it("refuses seat swaps while local grid changes are dirty", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role()]);

    fireEvent.change(screen.getByLabelText("Primera asignación"), {
      target: { value: "role-a:Lead:lead-key-a" },
    });
    fireEvent.change(screen.getByLabelText("Segunda asignación"), {
      target: { value: "role-a:BGVs:bgv-key-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar una celda" }));

    expect((screen.getByRole("button", { name: "Intercambiar puestos" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a whole-team swap between Saturday and non-Saturday topology", () => {
    const saturday = role({
      _id: "role-sat",
      _rev: "rev-sat",
      _type: "saturday_role",
      date: "2026-02-07",
      chorus: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderStored([role(), saturday]);
    const swapButtons = container.querySelectorAll<HTMLButtonElement>("[data-swap-date]");

    fireEvent.click(swapButtons[0]!);
    fireEvent.click(swapButtons[1]!);

    expect(screen.getByText("Los equipos de sábado solo se intercambian con otro sábado.")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
