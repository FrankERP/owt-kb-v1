/** @vitest-environment jsdom */
// «Mensaje antes de la propuesta» (ADR-0064): the admin writes about a service
// whose leads have not created a proposal yet.
//
// Two decisions are pinned here because both look like details and are not:
//   • the list is fetched LAZILY, on first open — a plain visit to Propuestas must
//     cost no extra Sanity read (free plan), and the panel suites stub one endpoint;
//   • a post patches its ONE row in place from the response, never reloads the
//     list — a reload would reset the picker under the admin.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServiceThreadsSection, { serviceThreadOption, type ServiceThreadRow } from "../ServiceThreadsSection";

afterEach(cleanup);

const FUTURE = "2099-03-08";

function svc(over: Partial<ServiceThreadRow> = {}): ServiceThreadRow {
  return {
    _id: "role-1",
    _type: "sunday_role",
    service_date: FUTURE,
    published: true,
    leads: [{ id: "lead-1", name: "Ana" }],
    messages: [],
    ...over,
  };
}

let calls: Array<{ url: string; method: string; body?: string }> = [];

function stub(list: ServiceThreadRow[], postMessages: unknown[] | null = []) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ ok: true, messages: postMessages }) };
      return { ok: true, status: 200, json: async () => list.map((r) => ({ ...r })) };
    }),
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe("ServiceThreadsSection", () => {
  it("fetches nothing until it is opened", async () => {
    stub([svc()]);
    render(<ServiceThreadsSection viewerId="admin-1" />);
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByText("Mensaje antes de la propuesta"));
    await waitFor(() => expect(screen.queryByText("Líderes: Ana")).not.toBeNull());
    expect(calls).toEqual([{ url: "/api/admin/service-threads", method: "GET", body: undefined }]);
  });

  it("posts to the selected service and patches its row in place", async () => {
    stub(
      [svc(), svc({ _id: "role-2", _type: "special_role", service_name: "Noche de alabanza", leads: [{ id: "l2", name: "Beto" }] })],
      [{ _key: "m1", author: "admin-1", author_role: "admin", body: "Tema: gracia", at: "2099-03-01T10:00:00.000Z" }],
    );
    render(<ServiceThreadsSection viewerId="admin-1" />);
    fireEvent.click(screen.getByText("Mensaje antes de la propuesta"));
    await waitFor(() => expect(screen.queryByLabelText("Servicio")).not.toBeNull());

    fireEvent.change(screen.getByLabelText("Servicio"), { target: { value: "role-2" } });
    expect(screen.getByText("Líderes: Beto")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Escribe un mensaje…"), { target: { value: "Tema: gracia" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.queryByText("Tema: gracia", { selector: "p" })).not.toBeNull());

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([
      { url: "/api/admin/service-threads/role-2/messages", method: "POST", body: JSON.stringify({ body: "Tema: gracia" }) },
    ]);
    // No reload: still exactly one list read, and the picker kept its choice.
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
    expect((screen.getByLabelText("Servicio") as HTMLSelectElement).value).toBe("role-2");
  });

  it("says so when every upcoming service already has a proposal", async () => {
    stub([]);
    render(<ServiceThreadsSection />);
    fireEvent.click(screen.getByText("Mensaje antes de la propuesta"));
    await waitFor(() =>
      expect(screen.queryByText("Todos los servicios próximos ya tienen propuesta.")).not.toBeNull(),
    );
  });
});

describe("serviceThreadOption", () => {
  it("names the service, its date, its message count and an unpublished month", () => {
    expect(serviceThreadOption(svc())).toMatch(/^Domingo · .+8.+mar/);
    expect(serviceThreadOption(svc({ messages: [{}, {}] }))).toContain("2 mensajes");
    expect(serviceThreadOption(svc({ messages: [{}] }))).toContain("1 mensaje");
    expect(serviceThreadOption(svc({ published: false }))).toContain("sin publicar");
    expect(
      serviceThreadOption(svc({ _type: "special_role", service_name: "Noche de alabanza" })),
    ).toMatch(/^Noche de alabanza · /);
  });
});
