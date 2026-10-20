/** @vitest-environment jsdom */
//
// The admin assistant's panel (ADR-0059): it streams the answer in, keeps a failed question out
// of the next request, and blocks the input when the assistant is not set up or the month's cap
// is spent.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AssistantPanel from "../AssistantPanel";
import { encodeChatEvent, type AdminChatEvent } from "@/app/utils/adminChat";

function streamOf(events: AdminChatEvent[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(events.map(encodeChatEvent).join(""));
  return new ReadableStream({
    start(controller) {
      // Two chunks, cut mid-line, as a real network would.
      const cut = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
}

const STATUS = { configured: true, spentUsd: 1.5, budgetUsd: 15 };

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(postResponses: Array<() => unknown>, status: unknown = STATUS) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init || init.method !== "POST") return { ok: true, status: 200, json: async () => status };
      const next = postResponses.shift();
      if (!next) throw new Error("unexpected POST");
      return next();
    }),
  );
  return calls;
}

const ok = (events: AdminChatEvent[]) => () => ({ ok: true, status: 200, body: streamOf(events), json: async () => ({}) });

function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Tu pregunta"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("AssistantPanel", () => {
  it("shows the month's usage and streams an answer in", async () => {
    stubFetch([
      ok([
        { type: "status", text: "Leyendo la letra…" },
        { type: "text", text: "Habla de " },
        { type: "text", text: "la gracia." },
        { type: "done", spentUsd: 1.62, budgetUsd: 15 },
      ]),
    ]);
    render(<AssistantPanel />);
    await screen.findByText("Cupo del mes: 1.50 de 15 USD");

    ask("¿De qué habla Gracia?");
    await screen.findByText("Habla de la gracia.");
    expect(screen.getByText("¿De qué habla Gracia?")).not.toBeNull();
    await screen.findByText("Cupo del mes: 1.62 de 15 USD");
  });

  it("sends the conversation so far, and drops a question that failed", async () => {
    const calls = stubFetch([
      ok([{ type: "text", text: "Primera respuesta" }, { type: "done", spentUsd: 1.6, budgetUsd: 15 }]),
      () => ({ ok: false, status: 429, json: async () => ({ error: "Ya usaste tu cupo de este mes (15 USD)." }) }),
      ok([{ type: "text", text: "Tercera" }, { type: "done", spentUsd: 1.7, budgetUsd: 15 }]),
    ]);
    render(<AssistantPanel />);
    await screen.findByText("Cupo del mes: 1.50 de 15 USD");

    ask("Uno");
    await screen.findByText("Primera respuesta");
    ask("Dos");
    await screen.findByText("Ya usaste tu cupo de este mes (15 USD).");
    // The failed question is restored to the input so it can be sent again.
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).value).toBe("Dos");

    ask("Tres");
    await screen.findByText("Tercera");
    const posts = calls.filter((c) => c.init?.method === "POST");
    expect(JSON.parse(posts[2]!.init!.body as string)).toEqual({
      messages: [
        { role: "user", text: "Uno" },
        { role: "assistant", text: "Primera respuesta" },
        { role: "user", text: "Tres" },
      ],
    });
  });

  it("shows a streamed error instead of a partial answer", async () => {
    stubFetch([
      ok([
        { type: "text", text: "Parcial" },
        { type: "error", message: "No puedo ayudar con esa pregunta." },
        { type: "done", spentUsd: 1.5, budgetUsd: 15 },
      ]),
    ]);
    render(<AssistantPanel />);
    await screen.findByText("Cupo del mes: 1.50 de 15 USD");
    ask("Algo");
    await screen.findByText("No puedo ayudar con esa pregunta.");
    expect(screen.queryByText("Parcial")).toBeNull();
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks the input when the assistant is not configured", async () => {
    stubFetch([], { configured: false, spentUsd: 0, budgetUsd: 15 });
    render(<AssistantPanel />);
    await screen.findByText("El asistente todavía no está configurado.");
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("blocks the input once the month's cap is spent", async () => {
    stubFetch([], { configured: true, spentUsd: 15.01, budgetUsd: 15 });
    render(<AssistantPanel />);
    await screen.findByText("Ya usaste tu cupo de este mes. Se renueva el día 1.");
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("shows the route's own refusal, or says who it is for when there is none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "No disponible." }) })));
    render(<AssistantPanel />);
    await waitFor(() => expect(screen.getByText("No disponible.")).not.toBeNull());
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => null })));
    render(<AssistantPanel />);
    await screen.findByText("El asistente es solo para los admins del equipo de alabanza.");
  });
});
