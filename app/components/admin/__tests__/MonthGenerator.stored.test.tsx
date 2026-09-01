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
    rows,
    cells,
    onCellsChange,
    onRowsChange,
    onStoredHeaderChange,
    mutationLocked,
  }: {
    columns: GridColumn[];
    rows: GridRow[];
    cells: GridCell[];
    onCellsChange: (next: GridCell[]) => void;
    onRowsChange: (next: GridRow[]) => void;
    onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string }) => void;
    mutationLocked?: boolean;
  }) => (
    <div data-testid="stored-grid">
      <span data-testid="stored-row-count">{rows.length}</span>
      {columns.map((column) => (
        <span key={column.columnId} data-testid="stored-column" data-column-id={column.columnId}>
          {column.columnId}
        </span>
      ))}
      <button
        type="button"
        disabled={mutationLocked}
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
        disabled={mutationLocked}
        onClick={() => onCellsChange(cells.map((cell) =>
          cell.columnId === "role-a" && cell.rowId === "lead"
            ? { ...cell, occupants: [...cell.occupants].reverse() }
            : cell,
        ))}
      >
        Reordenar sin cambio
      </button>
      <button type="button" disabled={mutationLocked} onClick={() => onStoredHeaderChange?.("role-a", { date: "2026-03-01" })}>
        Mover a marzo
      </button>
      <button type="button" disabled={mutationLocked} onClick={() => onStoredHeaderChange?.("role-a", { serviceName: "" })}>
        Vaciar nombre especial
      </button>
      <button type="button" disabled={mutationLocked} onClick={() => onRowsChange([...rows, { id: "instrumento:Nuevo", label: "Nuevo", category: "instrumento", target: 1 }])}>
        Añadir fila simulada
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
  "bgv-b",
  "bgv-c",
  "bgv-d",
  "instrument-b",
  "instrument-c",
  "foh-b",
  "foh-c",
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
  initialMonth?: string;
  storedCapabilities?: ComponentProps<typeof MonthGenerator>["storedCapabilities"];
  onCleared?: ComponentProps<typeof MonthGenerator>["onCleared"];
} = {}) {
  const storedSource = source(roles);
  const onClose = vi.fn();
  const result = render(
    <MonthGenerator
      mode="stored"
      members={members}
      existingRoles={roles}
      allRoles={roles}
      initialMonth={options.initialMonth ?? "2026-02"}
      openComposerInitially={options.openComposerInitially}
      storedCapabilities={options.storedCapabilities}
      storedSource={storedSource}
      rules={readyRules()}
      onClose={onClose}
      onCreated={vi.fn()}
      onCleared={options.onCleared}
    />,
  );
  return { ...result, storedSource, onClose };
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

  it("marks the WHOLE role touched on ANY cell change, surfacing pre-existing invalid data only then", () => {
    // A Saturday role carrying Chorus is invalid from CREATION (a Saturday has
    // no Coro row — `hidden_saturday_chorus`, `plannerSaveModel.ts`), before any
    // admin interaction — untouched, `invalidStoredColumns`
    // (`MonthGenerator.tsx:1730-1731`) must stay silent about it: a legacy data
    // error the admin never asked to fix must not nag on first paint.
    // "Cambiar una celda" only rewrites this role's `lead` row, never its
    // Chorus — if only ROWS were marked touched instead of the whole
    // `columnId` (`role._id`, `storedRoleReadModel.ts:114`), this would still
    // say nothing.
    renderStored([role({ _type: "saturday_role" })]);
    expect(screen.queryByText(/Corrige los datos inválidos/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar una celda" }));

    expect(screen.getByText(/Corrige los datos inválidos/)).toBeTruthy();
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

  it("treats a 500 with a pre-write-looking create code as unknown", async () => {
    const fetchMock = vi.fn(async () => response(500, { error: "invalid_request" }));
    vi.stubGlobal("fetch", fetchMock);
    const { storedSource } = renderStored([], { openComposerInitially: true });

    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));

    await waitFor(() => expect(storedSource.reload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Reintentar misma solicitud" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact create retry disabled until unknown-outcome reload reconciliation finishes", async () => {
    let finishReload: ((value: boolean) => void) | undefined;
    const fetchMock = vi.fn(async () => { throw new Error("connection lost"); });
    vi.stubGlobal("fetch", fetchMock);
    const { storedSource } = renderStored([], { openComposerInitially: true });
    storedSource.reload.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishReload = resolve; }));

    fireEvent.click(screen.getByRole("button", { name: "Crear vacío" }));
    await waitFor(() => expect(screen.getByText(/Resultado de creación desconocido/)).toBeTruthy());
    const inFlight = screen.getByRole("button", { name: "Creando…" }) as HTMLButtonElement;
    expect(inFlight.disabled).toBe(true);
    fireEvent.click(inFlight);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishReload?.(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "Reintentar misma solicitud" }) as HTMLButtonElement).disabled).toBe(false));
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

  it("sends the Aug 2/Aug 9 BGV section request and removes the old per-person action", async () => {
    const second = role({
      _id: "role-b",
      _rev: "rev-b",
      date: "2026-08-09",
      bgvs: [member("bgv-b", "bgv-key-b")],
    });
    const first = role({ date: "2026-08-02" });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    renderStored([first, second], { initialMonth: "2026-08" });

    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "BGVs" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/roles/swap");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "section",
      path: "BGVs",
      roles: [
        { id: "role-a", rev: "rev-a" },
        { id: "role-b", rev: "rev-b" },
      ],
    });
    expect(screen.queryByRole("button", { name: "Intercambiar puestos" })).toBeNull();
  });

  it("verifies the Aug 2/Aug 9 BGV swap against the positive canonical readback", async () => {
    const first = role({ date: "2026-08-02", bgvs: [member("bgv-a", "bgv-key-a")] });
    const second = role({
      _id: "role-b",
      _rev: "rev-b",
      date: "2026-08-09",
      bgvs: [member("bgv-b", "bgv-key-b")],
    });
    const firstSource = source([first, second]);
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const common = {
      mode: "stored" as const,
      members,
      initialMonth: "2026-08",
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(
      <MonthGenerator {...common} existingRoles={[first, second]} allRoles={[first, second]} storedSource={firstSource} />,
    );
    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "BGVs" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));
    await waitFor(() => expect(firstSource.reload).toHaveBeenCalledTimes(1));

    const refreshedFirst = role({ date: "2026-08-02", bgvs: [member("bgv-b", "bgv-key-b")] });
    const refreshedSecond = role({
      _id: "role-b",
      _rev: "rev-b-2",
      date: "2026-08-09",
      bgvs: [member("bgv-a", "bgv-key-a")],
    });
    const refreshedSource = source([refreshedFirst, refreshedSecond]);
    refreshedSource.rolesGeneration = 2;
    refreshedSource.integrityGeneration = 2;
    rerender(
      <MonthGenerator {...common} existingRoles={[refreshedFirst, refreshedSecond]} allRoles={[refreshedFirst, refreshedSecond]} storedSource={refreshedSource} />,
    );

    await waitFor(() => expect(screen.getByText("Intercambio guardado y verificado.")).toBeTruthy());
  });

  it("keeps empty sections selectable and disambiguates same-date special services", () => {
    const roles = [
      role({
        _id: "special-a",
        _rev: "special-rev-a",
        _type: "special_role",
        date: "2026-02-14",
        service_name: "Bodas",
        instruments: [],
      }),
      role({
        _id: "special-b",
        _rev: "special-rev-b",
        _type: "special_role",
        date: "2026-02-14",
        service_name: "Vigilia",
        instruments: [],
      }),
    ];
    renderStored(roles);

    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "instruments" } });
    const first = screen.getByLabelText("Primer servicio") as HTMLSelectElement;
    expect([...first.options].map((option) => option.value)).toEqual(["", "special-a", "special-b"]);
    expect([...first.options].map((option) => option.text)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Especial · Bodas/),
      expect.stringMatching(/Especial · Vigilia/),
    ]));
  });

  it.each([
    {
      sectionLabel: "Instrumentos",
      path: "instruments",
      firstPatch: {
        instruments: [
          { _key: "bass-a", instrument: "Bajo", person: member("instrument-a", "ignored-a") },
          { _key: "keys-a", instrument: "Teclados", person: member("instrument-b", "ignored-b") },
        ],
      },
      secondPatch: {
        instruments: [
          { _key: "guitar-b", instrument: "Guitarra", person: member("instrument-c", "ignored-c") },
        ],
      },
    },
    {
      sectionLabel: "FOH",
      path: "foh_team",
      firstPatch: {
        foh: [
          { _key: "console-a", role: "Consola", person: member("foh-a", "ignored-a") },
          { _key: "audio-a", role: "Audio", person: member("foh-b", "ignored-b") },
        ],
      },
      secondPatch: {
        foh: [
          { _key: "slides-b", role: "Letras", person: member("foh-c", "ignored-c") },
        ],
      },
    },
  ])("exchanges every $sectionLabel row, including source-only labels and unequal cardinality", async ({ path, firstPatch, secondPatch }) => {
    const first = role({ date: "2026-08-02", ...firstPatch });
    const second = role({ _id: "role-b", _rev: "rev-b", date: "2026-08-09", ...secondPatch });
    const firstSource = source([first, second]);
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const common = {
      mode: "stored" as const,
      members,
      initialMonth: "2026-08",
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(
      <MonthGenerator {...common} existingRoles={[first, second]} allRoles={[first, second]} storedSource={firstSource} />,
    );

    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: path } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));
    await waitFor(() => expect(firstSource.reload).toHaveBeenCalledTimes(1));

    const refreshedFirst = role({ date: "2026-08-02", ...secondPatch });
    const refreshedSecond = role({ _id: "role-b", _rev: "rev-b-2", date: "2026-08-09", ...firstPatch });
    const refreshedSource = source([refreshedFirst, refreshedSecond]);
    refreshedSource.rolesGeneration = 2;
    refreshedSource.integrityGeneration = 2;
    rerender(
      <MonthGenerator {...common} existingRoles={[refreshedFirst, refreshedSecond]} allRoles={[refreshedFirst, refreshedSecond]} storedSource={refreshedSource} />,
    );

    await waitFor(() => expect(screen.getByText("Intercambio guardado y verificado.")).toBeTruthy());
  });

  it("keeps an equal-member readback pending when ordered keys do not match, without retrying", async () => {
    const first = role({
      date: "2026-08-02",
      bgvs: [member("bgv-a", "a-1"), member("bgv-b", "a-2")],
    });
    const second = role({
      _id: "role-b",
      _rev: "rev-b",
      date: "2026-08-09",
      bgvs: [member("bgv-c", "b-1"), member("bgv-d", "b-2")],
    });
    const firstSource = source([first, second]);
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const common = {
      mode: "stored" as const,
      members,
      initialMonth: "2026-08",
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(
      <MonthGenerator {...common} existingRoles={[first, second]} allRoles={[first, second]} storedSource={firstSource} />,
    );
    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "BGVs" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));
    await waitFor(() => expect(firstSource.reload).toHaveBeenCalledTimes(1));

    const wrongFirst = role({
      date: "2026-08-02",
      bgvs: [member("bgv-c", "b-2"), member("bgv-d", "b-1")],
    });
    const correctSecond = role({
      _id: "role-b",
      _rev: "rev-b-2",
      date: "2026-08-09",
      bgvs: [member("bgv-a", "a-1"), member("bgv-b", "a-2")],
    });
    const refreshedSource = source([wrongFirst, correctSecond]);
    refreshedSource.rolesGeneration = 2;
    refreshedSource.integrityGeneration = 2;
    rerender(
      <MonthGenerator {...common} existingRoles={[wrongFirst, correctSecond]} allRoles={[wrongFirst, correctSecond]} storedSource={refreshedSource} />,
    );

    await waitFor(() => expect(screen.getByText(/no coincide con el intercambio solicitado/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    {
      mismatch: "the exact stored label changes only by whitespace",
      observed: [
        { _key: "guitar-b", instrument: " Guitarra ", person: member("instrument-b", "ignored-b") },
        { _key: "keys-b", instrument: "Teclados", person: member("instrument-c", "ignored-c") },
      ],
    },
    {
      mismatch: "the intact key/member/label pairs arrive in the wrong order",
      observed: [
        { _key: "keys-b", instrument: "Teclados", person: member("instrument-c", "ignored-c") },
        { _key: "guitar-b", instrument: "Guitarra", person: member("instrument-b", "ignored-b") },
      ],
    },
  ])("keeps an otherwise semantic instrument readback pending when $mismatch", async ({ observed }) => {
    const firstInstruments = [
      { _key: "bass-a", instrument: "Bajo", person: member("instrument-a", "ignored-a") },
    ];
    const secondInstruments = [
      { _key: "guitar-b", instrument: "Guitarra", person: member("instrument-b", "ignored-b") },
      { _key: "keys-b", instrument: "Teclados", person: member("instrument-c", "ignored-c") },
    ];
    const first = role({ date: "2026-08-02", instruments: firstInstruments });
    const second = role({
      _id: "role-b",
      _rev: "rev-b",
      date: "2026-08-09",
      instruments: secondInstruments,
    });
    const firstSource = source([first, second]);
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const common = {
      mode: "stored" as const,
      members,
      initialMonth: "2026-08",
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(
      <MonthGenerator {...common} existingRoles={[first, second]} allRoles={[first, second]} storedSource={firstSource} />,
    );
    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "instruments" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));
    await waitFor(() => expect(firstSource.reload).toHaveBeenCalledTimes(1));

    const wrongFirst = role({ date: "2026-08-02", instruments: observed });
    const correctSecond = role({
      _id: "role-b",
      _rev: "rev-b-2",
      date: "2026-08-09",
      instruments: firstInstruments,
    });
    const refreshedSource = source([wrongFirst, correctSecond]);
    refreshedSource.rolesGeneration = 2;
    refreshedSource.integrityGeneration = 2;
    rerender(
      <MonthGenerator {...common} existingRoles={[wrongFirst, correctSecond]} allRoles={[wrongFirst, correctSecond]} storedSource={refreshedSource} />,
    );

    await waitFor(() => expect(screen.getByText(/no coincide con el intercambio solicitado/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains section selections after a proven refusal", async () => {
    const second = role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" });
    vi.stubGlobal("fetch", vi.fn(async () => response(400, { error: "invalid_request" })));
    renderStored([role(), second]);
    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "BGVs" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));

    await waitFor(() => expect(screen.getByText(/No se intercambiaron las secciones/)).toBeTruthy());
    expect((screen.getByLabelText("Primer servicio") as HTMLSelectElement).value).toBe("role-a");
    expect((screen.getByLabelText("Segundo servicio") as HTMLSelectElement).value).toBe("role-b");
  });

  it("treats a 500 with a pre-write-looking swap code as unknown", async () => {
    const second = role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" });
    const fetchMock = vi.fn(async () => response(500, { error: "invalid_request" }));
    vi.stubGlobal("fetch", fetchMock);
    const { storedSource } = renderStored([role(), second]);
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));

    await waitFor(() => expect(storedSource.reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/resultado no verificable/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains section selections after an unknown transport outcome", async () => {
    const second = role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" });
    const fetchMock = vi.fn(async () => { throw new Error("connection lost"); });
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role(), second]);
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));

    await waitFor(() => expect(screen.getByText(/Resultado desconocido/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Primer servicio") as HTMLSelectElement).value).toBe("role-a");
    expect((screen.getByLabelText("Segundo servicio") as HTMLSelectElement).value).toBe("role-b");
  });

  it("disables a section swap when both service choices are the same role", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role()]);
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-a" } });

    const action = screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks cell, header, row, team, create, and section mutations while the section request is in flight", async () => {
    const second = role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" });
    let finishRequest: ((value: ReturnType<typeof response>) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<ReturnType<typeof response>>((resolve) => { finishRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, storedSource, onClose } = renderStored([role(), second]);
    const initialRowCount = screen.getByTestId("stored-row-count").textContent;
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar sección" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    for (const name of ["Cambiar una celda", "Mover a marzo", "Añadir fila simulada", "+ Nuevo servicio", "Intercambiar sección"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const teamButtons = container.querySelectorAll<HTMLButtonElement>("[data-swap-date]");
    expect([...teamButtons].every((button) => button.disabled)).toBe(true);
    teamButtons.forEach((button) => fireEvent.click(button));
    expect((screen.getByLabelText("Sección") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Primer servicio") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("stored-row-count").textContent).toBe(initialRowCount);
    expect((screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Cerrar" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishRequest?.(response());
    await waitFor(() => expect(storedSource.reload).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Primer servicio") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Segundo servicio") as HTMLSelectElement).value).toBe("");
  });

  it("disables section swaps while local grid changes are dirty", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role(), role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" })]);

    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar una celda" }));

    expect((screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a stored write behind an open discard confirmation", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role()]);

    fireEvent.click(screen.getByRole("button", { name: "Cambiar una celda" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" })[0]!);

    expect(screen.getByRole("button", { name: "Cerrar de todos modos" })).toBeTruthy();
    const save = screen.getByRole("button", { name: "Guardar 1 servicio" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an added empty row as unresolved work before a swap", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderStored([role(), role({ _id: "role-b", _rev: "rev-b", date: "2026-02-08" })]);

    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir fila simulada" }));

    expect((screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement).disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-swap-date]")].every((button) => button.disabled)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an added empty row across an unrelated source reload", async () => {
    const storedRole = role();
    const firstSource = source([storedRole]);
    const common = {
      mode: "stored" as const,
      members,
      existingRoles: [storedRole],
      allRoles: [storedRole],
      initialMonth: "2026-02",
      rules: readyRules(),
      onClose: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(<MonthGenerator {...common} storedSource={firstSource} />);
    const initialCount = Number(screen.getByTestId("stored-row-count").textContent);

    fireEvent.click(screen.getByRole("button", { name: "Añadir fila simulada" }));
    expect(Number(screen.getByTestId("stored-row-count").textContent)).toBe(initialCount + 1);

    const refreshedRole = role({ _rev: "rev-a-2" });
    const refreshedSource = source([refreshedRole]);
    refreshedSource.rolesGeneration = 2;
    refreshedSource.integrityGeneration = 2;
    rerender(
      <MonthGenerator
        {...common}
        existingRoles={[refreshedRole]}
        allRoles={[refreshedRole]}
        storedSource={refreshedSource}
      />,
    );

    await waitFor(() => expect(Number(screen.getByTestId("stored-row-count").textContent)).toBe(initialCount + 1));
  });

  it("disables Chorus when either selected service is Saturday", () => {
    const saturday = role({
      _id: "role-sat",
      _rev: "rev-sat",
      _type: "saturday_role",
      date: "2026-02-07",
      chorus: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role(), saturday]);
    fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "Chorus" } });
    fireEvent.change(screen.getByLabelText("Primer servicio"), { target: { value: "role-a" } });
    fireEvent.change(screen.getByLabelText("Segundo servicio"), { target: { value: "role-sat" } });

    const action = screen.getByRole("button", { name: "Intercambiar sección" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("Coro no está disponible en servicios de sábado.");
    fireEvent.click(action);
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

describe("MonthGenerator — «Limpiar mes»", () => {
  const clearGate = {
    edit: { enabled: true, reason: null },
    create: { enabled: true, reason: null },
    swap: { enabled: true, reason: null },
    changeDate: { enabled: true, reason: null },
    clear: { enabled: true, reason: null },
  };

  it("does not offer the button at all without a clear gate", () => {
    renderStored([role()]);
    expect(screen.queryByRole("button", { name: "Limpiar mes" })).toBeNull();
  });

  it("deletes the month's DRAFTS one by one with their observed revisions, then reports and closes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
    vi.stubGlobal("fetch", fetchMock);
    const onCleared = vi.fn();
    const roles = [
      role({ _id: "draft-b", _rev: "rev-b", date: "2026-02-08" }),
      role({ _id: "draft-a", _rev: "rev-a", date: "2026-02-01" }),
      role({ _id: "pub-c", _rev: "rev-c", date: "2026-02-15", published: true }),
      role({ _id: "other-month", _rev: "rev-m", date: "2026-03-01" }),
    ];
    const { onClose } = renderStored(roles, { storedCapabilities: clearGate, onCleared });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar mes" }));
    expect(screen.getByText(/Eliminar 2 servicios de Febrero 2026 \(2 borradores\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Incluir 1 servicio publicado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar 2" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))])).toEqual([
      ["/api/admin/roles/draft-a", "DELETE", { rev: "rev-a" }],
      ["/api/admin/roles/draft-b", "DELETE", { rev: "rev-b" }],
    ]);
    expect(onCleared).toHaveBeenCalledWith({
      attempted: 2,
      deleted: 2,
      failures: [],
      message: "Febrero 2026: 2 servicios eliminados.",
    });
  });

  it("includes published services only when opted in, and keeps going past a refused delete", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/draft-a")
        ? response(409, { error: "role_has_dependencies", details: { dependencies: [{ type: "setlist" }] } })
        : response(),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onCleared = vi.fn();
    const roles = [
      role({ _id: "draft-a", _rev: "rev-a", date: "2026-02-01" }),
      role({ _id: "pub-c", _rev: "rev-c", date: "2026-02-15", published: true }),
    ];
    const { onClose } = renderStored(roles, { storedCapabilities: clearGate, onCleared });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar mes" }));
    fireEvent.click(screen.getByLabelText(/Incluir 1 servicio publicado/));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar 2" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/roles/draft-a",
      "/api/admin/roles/pub-c",
    ]);
    expect(onCleared).toHaveBeenCalledWith({
      attempted: 2,
      deleted: 1,
      failures: ["01/02 · Domingo: Hay 1 registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada."],
      message: "Febrero 2026: eliminados 1 de 2. No se pudieron eliminar 1.",
    });
  });

  it("offers nothing to delete for a published-only month until published are included, and Cancelar backs out", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderStored([role({ published: true })], { storedCapabilities: clearGate });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar mes" }));
    expect((screen.getByRole("button", { name: "Eliminar 0" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No hay borradores en este mes/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Incluir 1 servicio publicado/));
    expect((screen.getByRole("button", { name: "Eliminar 1" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Confirmar limpiar mes" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the button with the gate's reason and for an empty month", () => {
    renderStored([role()], { storedCapabilities: { ...clearGate, clear: { enabled: false, reason: "Faltan datos." } } });
    const gated = screen.getByRole("button", { name: "Limpiar mes" }) as HTMLButtonElement;
    expect(gated.disabled).toBe(true);
    expect(gated.title).toBe("Faltan datos.");
    cleanup();

    renderStored([], { storedCapabilities: clearGate });
    const empty = screen.getByRole("button", { name: "Limpiar mes" }) as HTMLButtonElement;
    expect(empty.disabled).toBe(true);
    expect(empty.title).toBe("No hay servicios guardados en este mes.");
  });
});
