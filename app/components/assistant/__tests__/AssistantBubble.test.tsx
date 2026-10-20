/** @vitest-environment jsdom */
//
// The assistant bubble (ADR-0060): who sees it, that an admin who never opens it costs no request,
// that every question goes with the page it was asked from, and the panel rules carried over from
// the old tab (a failed question restored and left out, a blocked input).

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeChatEvent, type AdminChatEvent } from "@/app/utils/adminChat";

const h = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  pathname: "/",
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: h.session }) }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

const { default: AssistantBubble, ASSISTANT_FAB_VAR } = await import("../AssistantBubble");
const { default: AssistantPageContext } = await import("../AssistantPageContext");

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
const answer = (text: string, spentUsd = 1.6): AdminChatEvent[] => [{ type: "text", text }, { type: "done", spentUsd, budgetUsd: 15 }];
const posted = (calls: FetchCall[]) => calls.filter((c) => c.init?.method === "POST").map((c) => JSON.parse(c.init!.body as string));

const asAdmin = (user: Record<string, unknown> = {}) => {
  h.session = { user: { role: "admin", ministries: ["worship"], isImpersonating: false, ...user } };
};

async function openBubble() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
  await screen.findByText("Cupo del mes: 1.50 de 15 USD");
}

function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Tu pregunta"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  h.pathname = "/";
  asAdmin();
});
afterEach(cleanup);

describe("AssistantBubble — who sees it", () => {
  it.each([
    ["an admin of worship", { role: "admin", ministries: ["worship"] }],
    ["an admin whose token predates ministries", { role: "admin", ministries: undefined }],
    ["a super-admin of any ministry", { role: "super-admin", ministries: ["kids"] }],
  ])("shows for %s", (_who, user) => {
    stubFetch([]);
    asAdmin(user);
    render(<AssistantBubble />);
    expect(screen.queryByRole("button", { name: "Abrir el asistente" })).not.toBeNull();
  });

  it.each([
    ["a member", () => asAdmin({ role: "member" })],
    ["a content-editor", () => asAdmin({ role: "content-editor" })],
    ["an admin of kids only", () => asAdmin({ ministries: ["kids"] })],
    ["a super-admin impersonating", () => asAdmin({ role: "super-admin", isImpersonating: true })],
    ["no session", () => (h.session = null)],
    ["the Studio", () => (h.pathname = "/studio/desk")],
    ["the sign-in page", () => (h.pathname = "/auth/signin")],
  ])("hides for %s", (_who, setup) => {
    stubFetch([]);
    setup();
    render(<AssistantBubble />);
    expect(screen.queryByRole("button", { name: "Abrir el asistente" })).toBeNull();
  });
});

describe("AssistantBubble — the conversation", () => {
  it("reads nothing until it is first opened, then shows the month's usage", async () => {
    const calls = stubFetch([]);
    render(<AssistantBubble />);
    await act(async () => {});
    expect(calls).toHaveLength(0);
    await openBubble();
    expect(calls).toHaveLength(1);
    expect(screen.getByText("Viendo: Inicio")).not.toBeNull();
  });

  it("sends every question with the page it was asked from, and keeps the earlier turns' pages", async () => {
    const calls = stubFetch([ok(answer("Habla de un Dios que abre camino.")), ok(answer("Isaías 43:16", 1.7))]);
    h.pathname = "/posts/way-maker";
    const App = ({ onSong }: { onSong: boolean }) => (
      <>
        {onSong && <AssistantPageContext label="Canción: Way Maker" refs={[{ kind: "song", id: "abc123", label: "Way Maker" }]} />}
        <AssistantBubble />
      </>
    );
    const view = render(<App onSong />);
    await openBubble();
    expect(screen.getByText("Viendo: Canción: Way Maker")).not.toBeNull();
    ask("¿De qué habla esta canción?");
    await screen.findByText("Habla de un Dios que abre camino.");

    // Navigating away unmounts the song page's description; the bubble stays and keeps the conversation.
    h.pathname = "/biblioteca";
    view.rerender(<App onSong={false} />);
    await screen.findByText("Viendo: Biblioteca de canciones");
    ask("¿Qué pasaje la inspira?");
    await screen.findByText("Isaías 43:16");

    const song = { path: "/posts/way-maker", label: "Canción: Way Maker", refs: [{ kind: "song", id: "abc123", label: "Way Maker" }] };
    expect(posted(calls)[1]).toEqual({
      messages: [
        { role: "user", text: "¿De qué habla esta canción?", page: song },
        { role: "assistant", text: "Habla de un Dios que abre camino." },
        { role: "user", text: "¿Qué pasaje la inspira?", page: { path: "/biblioteca", label: "Biblioteca de canciones", refs: [] } },
      ],
    });
  });

  it("restores a failed question to the input and leaves it out of the next request", async () => {
    const calls = stubFetch([
      ok(answer("Primera respuesta")),
      () => ({ ok: false, status: 429, json: async () => ({ error: "Ya usaste tu cupo de este mes (15 USD)." }) }),
      ok(answer("Tercera", 1.7)),
    ]);
    render(<AssistantBubble />);
    await openBubble();
    ask("Uno");
    await screen.findByText("Primera respuesta");
    ask("Dos");
    await screen.findByText("Ya usaste tu cupo de este mes (15 USD).");
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).value).toBe("Dos");

    ask("Tres");
    await screen.findByText("Tercera");
    expect(posted(calls)[2].messages.map((m: { text: string }) => m.text)).toEqual(["Uno", "Primera respuesta", "Tres"]);
  });

  it("blocks the input when not configured, or once the month's cap is spent", async () => {
    stubFetch([], { configured: false, spentUsd: 0, budgetUsd: 15 });
    render(<AssistantBubble />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
    await screen.findByText("El asistente todavía no está configurado.");
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();

    stubFetch([], { configured: true, spentUsd: 15.01, budgetUsd: 15 });
    render(<AssistantBubble />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
    await screen.findByText("Ya usaste tu cupo de este mes. Se renueva el día 1.");
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("lets a drag in the conversation scroll it instead of pulling to refresh", async () => {
    stubFetch([]);
    render(<AssistantBubble />);
    await openBubble();
    expect(screen.getByRole("complementary", { name: "Asistente" }).hasAttribute("data-pull-ignore")).toBe(true);
  });

  it("keeps the input focusable while the month's usage is still loading", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AssistantBubble />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
    const input = screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Escape and gives focus back to the bubble", async () => {
    stubFetch([]);
    render(<AssistantBubble />);
    await openBubble();
    fireEvent.keyDown(screen.getByLabelText("Tu pregunta"), { key: "Escape" });
    const bubble = screen.getByRole("button", { name: "Abrir el asistente" });
    expect(bubble.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(bubble);
  });

  it("moves focus to the input once on opening, never again while the admin types", async () => {
    stubFetch([]);
    render(<AssistantBubble />);
    await openBubble();
    const input = screen.getByLabelText("Tu pregunta");
    await waitFor(() => expect(document.activeElement).toBe(input));
    const other = screen.getByRole("button", { name: "Nueva conversación" });
    other.removeAttribute("disabled");
    other.focus();
    fireEvent.change(input, { target: { value: "Hola" } });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(other);
  });
});

describe("AssistantBubble — placement", () => {
  it("fixes a wrapper, never the button: the primary sheen's `position: relative` would win over `fixed`", () => {
    stubFetch([]);
    render(<AssistantBubble />);
    const bubble = screen.getByRole("button", { name: "Abrir el asistente" });
    expect(bubble.className).toContain("brand-btn-sheen");
    expect(bubble.className).not.toMatch(/\bfixed\b/);
    expect(bubble.parentElement!.className).toMatch(/\bfixed\b/);
    expect(bubble.parentElement!.style.bottom).toContain("--bottom-nav-h");
  });
});

describe("AssistantBubble — the song FAB", () => {
  it("publishes its footprint while on screen and clears it when gone", () => {
    stubFetch([]);
    const view = render(<AssistantBubble />);
    expect(document.documentElement.style.getPropertyValue(ASSISTANT_FAB_VAR)).toBe("4.25rem");
    view.unmount();
    expect(document.documentElement.style.getPropertyValue(ASSISTANT_FAB_VAR)).toBe("");
  });
});
