/** @vitest-environment jsdom */
//
// «Disponibilidad › Conflictos» — the availability proposals (ADR-0079). The server judges and
// this card only shows: these tests pin what the card SENDS (the exact replacement set the server
// proposed, the record's revision on «Deshacer»), that a 409 reloads with «El servicio cambió»
// instead of retrying, and that a read it cannot use falls back to the parent's own list — a
// failure here never reads as «sin conflictos».

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AvailabilityProposals from "../AvailabilityProposals";
import type { PanelConflict, PanelRead } from "@/app/utils/availabilityFixCommit";

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const CONFLICT: PanelConflict = {
  recordId: "availabilityConflict.abc",
  recordRev: null,
  roleId: "role-nov29",
  roleRev: "rev-7",
  memberId: "tony",
  date: "2026-11-29",
  serviceKind: "sunday_role",
  published: true,
  service: "dom 29 nov",
  person: "Tony",
  options: [
    { seats: [{ rowId: "chorus", seat: "Coro", to: "ana", toName: "Ana" }] },
    { seats: [{ rowId: "chorus", seat: "Coro", to: "vale", toName: "Vale" }] },
  ],
};

const read = (over: Partial<PanelRead> = {}): PanelRead => ({ ok: true, blocked: null, open: [], applied: [], kept: [], ...over });

/** Routes the panel's GET and records every POST body by path. */
function serve(get: () => unknown, post: (path: string, body: unknown) => ReturnType<typeof ok> = () => ok({ ok: true })) {
  const posts: Array<{ path: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      posts.push({ path: url, body });
      return post(url, body);
    }
    return ok(get());
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, fetchMock };
}

const FALLBACK = <p>lista del cliente</p>;

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("AvailabilityProposals", () => {
  it("shows the proposal and «Aplicar» sends exactly its replacement set and the role revision", async () => {
    const onChanged = vi.fn();
    const { posts } = serve(() => read({ open: [CONFLICT] }));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByText("Coro → Ana")).not.toBeNull());
    expect(screen.getByText(/no puede el dom 29 nov/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/api/admin/availability-conflicts/apply",
      body: { roleId: "role-nov29", rev: "rev-7", memberId: "tony", replacements: [{ rowId: "chorus", to: "ana" }] },
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Aplicado: Coro → Ana/));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a 409 reloads with «El servicio cambió» and reports nothing as saved", async () => {
    const onChanged = vi.fn();
    const { fetchMock } = serve(() => read({ open: [CONFLICT] }), () => ok({ error: "stale_revision" }, 409));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar" })).not.toBeNull());
    const readsBefore = fetchMock.mock.calls.filter(([, init]) => !init?.method).length;
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/El servicio cambió; vuelve a revisar/));
    expect(onChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init?.method).length).toBe(readsBefore + 1));
  });

  it("says why there is no proposal, and offers no «Aplicar»", async () => {
    serve(() => read({ open: [{ ...CONFLICT, options: [], none: { reason: "no_candidate", seats: [{ rowId: "bass", seat: "Bajo" }] } }] }));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Nadie disponible pasa las reglas/)).not.toBeNull());
    expect(screen.getByText(/Bajo:/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
  });

  it("falls back to the parent's list when the read fails — never an all-clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ error: "unavailable" }, 503)));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No se pudo revisar/));
    expect(screen.getByText("lista del cliente")).not.toBeNull();
    expect(screen.queryByText(/Nadie asignado tiene marcada/)).toBeNull();
  });

  it("falls back too when the server answers that it cannot judge (blocked)", async () => {
    serve(() => read({ blocked: "incoherent" }));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/duplicados o incompletos/));
    expect(screen.getByText("lista del cliente")).not.toBeNull();
  });

  it("«Deshacer» on a kept conflict sends kept: false under the record's revision", async () => {
    const { posts } = serve(() => read({
      kept: [{ recordId: "availabilityConflict.k", recordRev: "rk-3", roleId: "role-dec27", memberId: "mkz", date: "2026-12-27", serviceKind: "sunday_role", published: false, person: "Mkz", service: "dom 27 dic" }],
    }));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Deshacer" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/api/admin/availability-conflicts/keep",
      body: { roleId: "role-dec27", memberId: "mkz", date: "2026-12-27", serviceKind: "sunday_role", published: false, kept: false, rev: "rk-3" },
    });
  });

  it("«Revisar ahora» says when it ran dry (outside production)", async () => {
    const { posts } = serve(() => read(), () => ok({ ok: true, mode: "dry", proposed: [], none: [], kept: [], gone: [], skipped: [], emailed: 0 }));
    render(<AvailabilityProposals fallback={FALLBACK} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Revisar ahora" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Revisar ahora" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Fuera de producción/));
    expect(posts[0].path).toBe("/api/admin/availability-conflicts/sweep");
  });
});
