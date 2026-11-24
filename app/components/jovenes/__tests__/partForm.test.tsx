/** @vitest-environment jsdom */
// «Mi parte» (ADR-0089): what the form SENDS (the part route, only this part's fields, the
// revision its values were loaded from) and that a refusal never reads as saved. The server decides
// who may write a part; these rows pin only that the client asks for the right thing.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { ToastProvider } from "@/app/components/ui/Toast";
import PartForm, { type PartFormValues } from "../PartForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

installMotionTestEnv();

const TOKEN = "0f8e6a52-1c1b-4d7e-9a43-6a2b1c0d9e11";
const EMPTY: PartFormValues = { note: "", music: null, helpers: "" };

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, id: "x", rev: "rev-2" } };

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { ok: true, id: "x", rev: "rev-2" } };
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function form(over: Partial<Parameters<typeof PartForm>[0]> = {}) {
  return (
    <ToastProvider>
      <PartForm ministry="jovenes" eventId={`ministryEvent.${TOKEN}`} rev="rev-1" part="dinamica1" initial={EMPTY} mine defaultOpen {...over} />
    </ToastProvider>
  );
}

const save = () => screen.getByRole("button", { name: /Guardar/ });
/** The form's own alert, by its words: the toast region keeps an empty `role="alert"` of its own. */
async function alertSaying(words: string | RegExp) {
  const el = await screen.findByText(words);
  expect(el.getAttribute("role")).toBe("alert");
  return el;
}

describe("PartForm — what it sends", () => {
  it("a dinámica sends its description and helpers to the part route, under the loaded revision, and no music", async () => {
    render(form());
    fireEvent.change(screen.getByLabelText("Descripción de la dinámica"), { target: { value: "  Sillas musicales con preguntas  " } });
    fireEvent.change(screen.getByLabelText("Jóvenes que apoyan (opcional)"), { target: { value: "Dani y Sofi" } });
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: `/api/ministries/jovenes/events/${TOKEN}/parts/dinamica1`,
      method: "PATCH",
      body: { _rev: "rev-1", note: "Sillas musicales con preguntas", helpers: "Dani y Sofi" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("Oración sends the music choice and no helpers; an empty note goes as null", async () => {
    render(form({ part: "oracion" }));
    fireEvent.click(screen.getByRole("radio", { name: "Que toque alguien de alabanza" }));
    expect(screen.getByText(/se le avisa a quien organiza/i)).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe(`/api/ministries/jovenes/events/${TOKEN}/parts/oracion`);
    expect(calls[0].body).toEqual({ _rev: "rev-1", note: null, music: "alabanza" });
  });

  it("Plática asks for the topic and offers its own two music options", () => {
    render(form({ part: "platica" }));
    expect(screen.getByLabelText("Tema")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Track al final" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Canción con el grupo de alabanza" })).toBeTruthy();
    expect(screen.queryByLabelText("Jóvenes que apoyan (opcional)")).toBeNull();
  });

  it("nothing to save until something changes", () => {
    render(form({ initial: { note: "Ya escrita", music: null, helpers: "" } }));
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Descripción de la dinámica"), { target: { value: "Otra" } });
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it("the description stops at 300 characters and says how many are used", () => {
    render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    expect(area.maxLength).toBe(300);
    fireEvent.change(area, { target: { value: "x".repeat(42) } });
    expect(screen.getByText("42/300")).toBeTruthy();
  });

  it("the second save starts from the revision the first one answered", async () => {
    render(form());
    const area = screen.getByLabelText("Descripción de la dinámica");
    fireEvent.change(area, { target: { value: "Uno" } });
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect((save() as HTMLButtonElement).disabled).toBe(true));
    fireEvent.change(area, { target: { value: "Dos" } });
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body._rev).toBe("rev-2");
  });

  it("a saved text stays in the form while the page still holds the meeting from before the save", async () => {
    const view = render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Uno" } });
    fireEvent.click(save());
    await waitFor(() => expect((save() as HTMLButtonElement).disabled).toBe(true));
    expect(area.value).toBe("Uno");
    // The refresh lands with what was stored: still «Uno», now under the answered revision.
    view.rerender(form({ rev: "rev-2", initial: { note: "Uno", music: null, helpers: "" } }));
    expect(area.value).toBe("Uno");
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it("a 409 right after my own save waits for the page's NEWER meeting, not the one from before my save", async () => {
    const view = render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Uno" } });
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect((save() as HTMLButtonElement).disabled).toBe(true));
    answer = { status: 409, body: { error: "stale" } };
    fireEvent.change(area, { target: { value: "Dos" } });
    fireEvent.click(save());
    await alertSaying(/cambió mientras escribías/);
    expect(calls[1].body._rev).toBe("rev-2");
    view.rerender(form({ rev: "rev-7", initial: { note: "De otra persona", music: null, helpers: "" } }));
    answer = { status: 200, body: { ok: true, id: "x", rev: "rev-8" } };
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].body).toEqual({ _rev: "rev-7", note: "Dos", helpers: null });
  });
});

describe("PartForm — a refusal is never a save", () => {
  it("shows the server's words and keeps the text", async () => {
    answer = { status: 403, body: { error: "No puedes editar esta parte." } };
    render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Mi dinámica" } });
    fireEvent.click(save());
    await alertSaying("No puedes editar esta parte.");
    expect(area.value).toBe("Mi dinámica");
    expect(refresh).not.toHaveBeenCalled();
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed request says so and frees the button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(form());
    fireEvent.change(screen.getByLabelText("Descripción de la dinámica"), { target: { value: "Mi dinámica" } });
    fireEvent.click(save());
    await alertSaying("Sin conexión. Intenta de nuevo.");
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it("409: keeps the text, refreshes the page, and the next save carries the revision the page then brings", async () => {
    answer = { status: 409, body: { error: "stale" } };
    const view = render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "Mi dinámica" } });
    fireEvent.click(save());
    await alertSaying(/cambió mientras escribías/);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(area.value).toBe("Mi dinámica");

    // The refresh hands the newer meeting: someone else's text is stored, mine is still typed.
    view.rerender(form({ rev: "rev-9", initial: { note: "Lo de otra persona", music: null, helpers: "" } }));
    expect((screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement).value).toBe("Mi dinámica");
    answer = { status: 200, body: { ok: true, id: "x", rev: "rev-10" } };
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ _rev: "rev-9", note: "Mi dinámica", helpers: null });
  });
});

describe("PartForm — following the page", () => {
  it("untouched, it takes the newer values and revision a refresh brings", async () => {
    const view = render(form({ initial: { note: "Vieja", music: null, helpers: "" } }));
    view.rerender(form({ rev: "rev-5", initial: { note: "Nueva", music: null, helpers: "Dani" } }));
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    expect(area.value).toBe("Nueva");
    fireEvent.change(area, { target: { value: "Nueva y mía" } });
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ _rev: "rev-5", note: "Nueva y mía", helpers: "Dani" });
  });

  it("touched, a refresh never replaces what is being typed NOR lets it save over the newer meeting unseen", async () => {
    answer = { status: 409, body: { error: "stale" } };
    const view = render(form());
    const area = screen.getByLabelText("Descripción de la dinámica") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "A medias" } });
    view.rerender(form({ rev: "rev-5", initial: { note: "De otra persona", music: null, helpers: "" } }));
    expect(area.value).toBe("A medias");
    fireEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    // Still the revision the text was typed against: the server answers 409 and the person looks.
    expect(calls[0].body._rev).toBe("rev-1");
  });

  it("someone else's part reads as theirs, folded until opened", () => {
    render(form({ mine: false, who: "Pau y Mkz", defaultOpen: false }));
    expect(screen.getByText("Parte de Pau y Mkz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Llenar Dinámica 1" }).getAttribute("aria-expanded")).toBe("false");
  });
});
