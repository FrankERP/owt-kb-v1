/** @vitest-environment jsdom */
// T6 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — acceptance 9,
// end to end: a cross-service drag marks BOTH roles touched; a save then PATCHes
// both, and services untouched by the drag emit no PATCH and no notification.
//
// ─── Why this is a NEW file rather than a case in `MonthGenerator.stored.test.tsx`
//
// That file opens with `vi.mock("../PlannerGrid", …)`: the grid is a stub whose
// buttons hand `onCellsChange` a hand-built array. A third stub button building a
// two-column change would re-prove change tracking (already all-columns) and
// prove NOTHING about the move — a test unable to fail. Here the REAL
// `PlannerGrid` is rendered inside the REAL `MonthGenerator`, and the move is
// produced by a real `dragstart`/`dragover`/`drop` through the real gate
// (`moveGate`) and the real primitive (`moveOccupant`). Nothing between the
// pointer and `fetch` is stubbed except `fetch` itself.
//
// **ZERO remote writes.** `fetch` is stubbed in every test; `dev-owt-backstage`
// builds against the PRODUCTION Sanity dataset, so a "real save on preview" would
// move a live person between two live services and email the whole team — the
// exact harm acceptance 9 exists to prevent.
//
// The mutations these tests are written to catch, each named at its assertion:
//   • the move dropping its source removal (one PATCH instead of two);
//   • a service nobody dragged into being PATCHed anyway;
//   • the drop skipping the gate, so a refused move still dirties a column;
//   • a partially failed save presenting as success and losing the retry.
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import type { ServiceRole } from "../serviceCardModel";
import type { SolverConfig } from "../plannerModel";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * NO RULES, on purpose. Every constraint the gate can raise (C2/C3/C4) is
 * already pinned in `moveGate.test.ts` and `plannerGridDrag.test.tsx`; what this
 * file is about is what a PERMITTED move writes. An empty rule set keeps that
 * subject stable if `DEFAULT_SOLVER_CONFIG`'s named people ever change.
 */
const NO_RULES: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [],
};

const MEMBERS = [
  { _id: "ana", member_name: "Ana", memberType: ["voz"] },
  { _id: "beto", member_name: "Beto", memberType: ["voz"] },
  { _id: "caro", member_name: "Caro", memberType: ["voz"] },
  { _id: "dani", member_name: "Dani", memberType: ["instrumento"] },
  { _id: "eva", member_name: "Eva", memberType: ["foh"] },
];

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

function assignedRefs(value: ServiceRole): string[] {
  return [...new Set([
    ...value.leads.map((item) => item._id),
    ...value.bgvs.map((item) => item._id),
    ...value.chorus.map((item) => item._id),
    ...value.instruments.flatMap((item) => item.person ? [item.person._id] : []),
    ...value.foh.flatMap((item) => item.person ? [item.person._id] : []),
  ])];
}

/**
 * The integrity observation that makes a role EDITABLE (`admission: "approved"`):
 * one canonical record, a claimed lock, no issues. `danglingRefs` is the one
 * knob the readOnly test turns — it yields `assignment_mismatch` for that role
 * alone, leaving the inventory coherent and every other column approved.
 */
function targetFor(value: ServiceRole, options: { danglingRefs?: string[] } = {}): RoleTarget {
  return {
    targetKey: `${value._type}:${value.date}`,
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
      danglingRefs: options.danglingRefs ?? [],
    }],
    expectsLock: true,
    lock: {
      id: `roleTarget.${value._type}.${value.date}`,
      rev: `lock-${value._id}`,
      state: "claimed",
      roleId: value._id,
      generation: 1,
    },
    lockIssues: [],
  };
}

function integrityFor(entries: { role: ServiceRole; danglingRefs?: string[] }[]): RoleDomainSummary {
  return {
    targets: entries.map((entry) => targetFor(entry.role, { danglingRefs: entry.danglingRefs })),
    recordIssues: [],
    lockIssues: [],
  };
}

function source(entries: { role: ServiceRole; danglingRefs?: string[] }[], generation = 1) {
  return {
    roles: entries.map((entry) => entry.role),
    integrity: integrityFor(entries),
    rolesStatus: "ready" as const,
    integrityStatus: "ready" as const,
    rolesGeneration: generation,
    integrityGeneration: generation,
    reload: vi.fn(async () => true),
  };
}

function renderStored(entries: { role: ServiceRole; danglingRefs?: string[] }[]) {
  const storedSource = source(entries);
  const roles = entries.map((entry) => entry.role);
  const props = {
    mode: "stored" as const,
    members: MEMBERS,
    existingRoles: roles,
    allRoles: roles,
    initialMonth: "2026-02",
    rules: readyRules(NO_RULES),
    onClose: vi.fn(),
    onCreated: vi.fn(),
  };
  const view = render(<MonthGenerator {...props} storedSource={storedSource} />);
  return {
    ...view,
    storedSource,
    /** A reload that answers with new server state, exactly as production does. */
    reloadWith: (next: { role: ServiceRole; danglingRefs?: string[] }[]) => {
      const refreshed = source(next, 2);
      view.rerender(
        <MonthGenerator
          {...props}
          existingRoles={next.map((entry) => entry.role)}
          allRoles={next.map((entry) => entry.role)}
          storedSource={refreshed}
        />,
      );
      return refreshed;
    },
  };
}

/** February 2026: role-a and role-b are the drag's two ends, role-c the control. */
const ROLE_A = role({
  _id: "role-a",
  _rev: "rev-a",
  date: "2026-02-01",
  leads: [member("ana", "k-ana")],
  bgvs: [member("beto", "k-beto")],
  chorus: [member("caro", "k-caro")],
  instruments: [{ _key: "k-bajo", instrument: "Bajo", person: member("dani", "k-dani") }],
  foh: [{ _key: "k-consola", role: "Consola", person: member("eva", "k-eva") }],
});
const ROLE_B = role({
  _id: "role-b",
  _rev: "rev-b",
  date: "2026-02-08",
  leads: [member("caro", "k-caro-b")],
});
const ROLE_C = role({
  _id: "role-c",
  _rev: "rev-c",
  date: "2026-02-15",
  leads: [member("beto", "k-beto-c")],
});

// ─── DOM helpers — the real grid, the real drag ──────────────────────────────

function cellAt(container: HTMLElement, rowId: string, columnId: string): HTMLElement {
  const el = container.querySelector(`[data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (!el) throw new Error(`no cell for ${rowId}@${columnId}`);
  return el as HTMLElement;
}

function chipIn(container: HTMLElement, rowId: string, columnId: string, memberId: string): HTMLElement {
  const el = cellAt(container, rowId, columnId).querySelector(`[data-occupant="${memberId}"]`);
  if (!el) throw new Error(`no chip for ${memberId} in ${rowId}@${columnId}`);
  return el as HTMLElement;
}

function occupantsAt(container: HTMLElement, rowId: string, columnId: string): string[] {
  return [...cellAt(container, rowId, columnId).querySelectorAll("[data-occupant]")]
    .map((el) => el.getAttribute("data-occupant")!);
}

/** One drag, in the three events the browser fires. jsdom has no `DataTransfer`. */
function drag(chip: HTMLElement, target: HTMLElement) {
  const dataTransfer = { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" };
  fireEvent(chip, createEvent.dragStart(chip, { dataTransfer }));
  const over = createEvent.dragOver(target, { dataTransfer });
  fireEvent(target, over);
  fireEvent(target, createEvent.drop(target, { dataTransfer }));
  return { droppable: over.defaultPrevented };
}

function response(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function patchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "stable-request-id") });
});

// ─── Acceptance 9 ────────────────────────────────────────────────────────────

describe("MonthGenerator — a cross-service drag, saved (acceptance 9)", () => {
  it("PATCHes exactly the two services the drag touched, and nothing else", async () => {
    const fetchMock = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderStored([{ role: ROLE_A }, { role: ROLE_B }, { role: ROLE_C }]);

    // Ana, Feb 1's Lead, dragged onto Feb 8's BGV row — one gesture, two
    // services. Nothing here hand-builds a `cells` array: the change is whatever
    // `moveGate` permits and `moveOccupant` produces.
    const { droppable } = drag(
      chipIn(container, "lead", "role-a", "ana"),
      cellAt(container, "bgv", "role-b"),
    );
    expect(droppable).toBe(true);
    expect(occupantsAt(container, "lead", "role-a")).toEqual([]);
    expect(occupantsAt(container, "bgv", "role-b")).toEqual(["ana"]);

    // `dirtyStoredColumns` — the semantic diff that decides what is PATCHed, and
    // the only thing this counter renders. TWO, because a move is a removal AND
    // an addition: if the source removal were dropped this would say 1.
    const save = screen.getByRole("button", { name: "Guardar 2 servicios" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const calls = patchCalls(fetchMock);
    // role-c is a fully valid, saveable service that nobody dragged into. It
    // emits no PATCH — and therefore no `notifyRoleAssignments`/`queueRoleNotices`
    // to its members (`app/api/admin/roles/[id]/route.ts`).
    expect(calls.map((call) => call.url)).toEqual([
      "/api/admin/roles/role-a",
      "/api/admin/roles/role-b",
    ]);
    // Complete five-field arrays, both ends, in one save.
    expect(calls[0]!.body).toEqual({
      rev: "rev-a",
      lockRev: "lock-role-a",
      _type: "sunday_role",
      date: "2026-02-01",
      leads: [],
      bgvs: ["beto"],
      chorus: ["caro"],
      instruments: [{ instrument: "Bajo", personId: "dani" }],
      foh: [{ role: "Consola", personId: "eva" }],
    });
    expect(calls[1]!.body).toEqual({
      rev: "rev-b",
      lockRev: "lock-role-b",
      _type: "sunday_role",
      date: "2026-02-08",
      leads: ["caro"],
      bgvs: ["ana"],
      chorus: [],
      instruments: [],
      foh: [],
    });
  });

  it("writes nothing at all when the gate refuses the drop", async () => {
    const fetchMock = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetchMock);
    // role-b carries a dangling reference, so its integrity observation is
    // `assignment_mismatch` → `admission: "readOnly"` → `serializeStoredColumn`
    // refuses it → P2. The inventory stays coherent, so role-a and role-c remain
    // ordinary saveable services.
    const { container } = renderStored([
      { role: ROLE_A },
      { role: ROLE_B, danglingRefs: ["ghost"] },
      { role: ROLE_C },
    ]);

    const { droppable } = drag(
      chipIn(container, "lead", "role-a", "ana"),
      cellAt(container, "bgv", "role-b"),
    );

    expect(droppable).toBe(false);
    // The refusal wrote no cells, so no column was marked touched and there is
    // nothing to save — the no-op precedent of `MonthGenerator.stored.test.tsx`,
    // reached here through a real refused drag rather than an identical reorder.
    // Asserted BEFORE the notice: a drop that says "no" and writes anyway is the
    // mutation that matters, and `applyMove` clears the notice on its way past.
    expect(occupantsAt(container, "lead", "role-a")).toEqual(["ana"]);
    expect(occupantsAt(container, "bgv", "role-b")).toEqual([]);
    expect(container.querySelector("[data-drag-notice='refusal']")?.textContent)
      .toBe("No se puede editar este servicio.");
    const save = screen.getByRole("button", { name: "Guardar 0 servicios" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * PARTIAL FAILURE — the exposure this plan does not remove, pinned so it
   * cannot regress into a silent one.
   *
   * The save loop PATCHes sequentially and `continue`s past a proven failure, so
   * a cross-service move whose SOURCE commits and whose TARGET is rejected leaves
   * the member seated nowhere on the server. The pre-drag two-edit workflow has
   * the identical exposure and stays visible and retryable, which is why this is
   * a verification requirement rather than a new guarantee to build.
   *
   * **Its notification consequence, verbatim for T7's ADR:** each PATCH
   * independently fires `notifyRoleAssignments`/`queueRoleNotices`
   * (`app/api/admin/roles/[id]/route.ts`), so source-committed + target-failed
   * emails the member a removal with no matching addition. The exposure is
   * unchanged, but the drag makes it ONE GESTURE THE ADMIN PERCEIVES AS ATOMIC
   * where two edits made both steps visible.
   */
  it("keeps a half-committed cross-service move visible and retryable", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/admin/roles/role-b"
        ? response(409, { error: "stale_revision" })
        : response(200));
    vi.stubGlobal("fetch", fetchMock);
    const { container, storedSource, reloadWith } = renderStored([{ role: ROLE_A }, { role: ROLE_B }]);

    drag(chipIn(container, "lead", "role-a", "ana"), cellAt(container, "bgv", "role-b"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar 2 servicios" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // The rejection is REPORTED, not swallowed, while the committed half proceeds.
    await waitFor(() => expect(screen.getByText(
      "El servidor rechazó 2026-02-08 (stale_revision); los demás cambios seguros continuaron.",
    )).toBeTruthy());
    await waitFor(() => expect(storedSource.reload).toHaveBeenCalledTimes(1));

    // The server now holds the committed half only: Ana left Feb 1 and never
    // reached Feb 8. This is exactly the state that emailed her a removal with no
    // matching addition.
    reloadWith([
      { role: role({ ...ROLE_A, _rev: "rev-a-2", leads: [] }) },
      { role: ROLE_B },
    ]);

    await waitFor(() => expect(screen.getByText(
      "Cambios guardados y verificados. 1 servicio fue rechazado y conserva sus cambios.",
    )).toBeTruthy());
    // The failed half is still dirty, still on screen, and still saveable — the
    // admin can retry it without redoing the drag.
    const retry = screen.getByRole("button", { name: "Guardar 1 servicio" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(occupantsAt(container, "bgv", "role-b")).toEqual(["ana"]);
    expect(occupantsAt(container, "lead", "role-a")).toEqual([]);

    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    // The retry re-PATCHes ONLY the failed service — the committed one is
    // baselined and silent.
    expect(patchCalls(fetchMock)[2]!.url).toBe("/api/admin/roles/role-b");
  });
});
