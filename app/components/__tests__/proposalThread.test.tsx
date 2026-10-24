/** @vitest-environment jsdom */
// `ProposalThread` — the rendering rules that a green suite would otherwise not
// notice being broken.
//
// Three of these guard decisions that look like styling and are not:
//   • rendering UNCONDITIONALLY, because the two blocks this replaced were gated
//     and inheriting either would hide the conversation on a `pending` proposal;
//   • the author fallback keyed on the ROLE, because an author-less `lead_note`
//     rendering as "Admin" misattributes a message in a history admins read to
//     decide things;
//   • the composer clearing only on success, because this channel's whole
//     promise is that nothing written is lost.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProposalThread, { type ThreadMessage } from "../ProposalThread";

afterEach(cleanup);

/** Far future, so `isThreadOpen` is true without pinning the clock. */
const OPEN_DATE = "2099-01-10";
const PAST_DATE = "2020-01-10";

function msg(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    _key: "k1",
    author: "mem-1",
    author_name: "Ana",
    author_role: "lead",
    kind: "lead_note",
    body: "Bajé la tonalidad",
    at: "2026-08-20T15:00:00.000Z",
    ...over,
  };
}

function renderThread(over: Partial<React.ComponentProps<typeof ProposalThread>> = {}) {
  const onPost = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <ProposalThread
      messages={[]}
      viewerId="mem-1"
      viewerRole="lead"
      serviceDate={OPEN_DATE}
      onPost={onPost}
      {...over}
    />,
  );
  return { onPost, ...utils };
}

describe("ProposalThread — read-only (ADR-0065)", () => {
  it("shows the messages and the hint, and no composer, when there is no onPost", () => {
    renderThread({
      onPost: undefined,
      title: "Mensajes de los admins",
      readOnlyHint: "Responde al guardar.",
      messages: [msg({ author_role: "admin", author_name: "Frank", body: "Tema: gracia" })],
    });
    expect(screen.getByText("Mensajes de los admins")).toBeTruthy();
    expect(screen.getByText("Tema: gracia")).toBeTruthy();
    expect(screen.getByText("Responde al guardar.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Escribe un mensaje…")).toBeNull();
    expect(screen.queryByText("Enviar")).toBeNull();
  });
});

describe("ProposalThread — rendering", () => {
  it("renders its empty state rather than nothing at all", () => {
    renderThread();
    // The blocks this replaced were `{proposal.lead_notes && …}` and
    // `{status === "changes_requested" && …}`. Inheriting either would leave a
    // pending proposal with no visible conversation and no composer.
    expect(screen.getByText("Aún no hay mensajes.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Escribe un mensaje…")).toBeTruthy();
  });

  it("shows both sides of the conversation, oldest first", () => {
    renderThread({
      messages: [
        msg({ _key: "a", body: "primera", at: "2026-08-20T10:00:00.000Z" }),
        msg({
          _key: "b",
          body: "respuesta",
          at: "2026-08-20T11:00:00.000Z",
          author: "admin-1",
          author_name: "Dani",
          author_role: "admin",
          kind: "admin_change_request",
        }),
      ],
    });
    const bodies = screen.getAllByText(/primera|respuesta/).map((n) => n.textContent);
    expect(bodies).toEqual(["primera", "respuesta"]);
  });

  it("labels an author-less message from its ROLE, never as Admin by default", () => {
    renderThread({
      messages: [
        msg({ _key: "a", author: null, author_name: null, author_role: "lead", body: "sin autor" }),
        msg({
          _key: "b",
          author: null,
          author_name: null,
          author_role: "admin",
          kind: "admin_change_request",
          body: "del admin",
        }),
      ],
    });
    // Two production `admin_notes` have nobody to attribute them to. Keying the
    // fallback on the missing NAME instead of the role would render the
    // author-less lead note as "Admin".
    expect(screen.getByText("Líder")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("prefers the resolved name when there is one", () => {
    renderThread({ messages: [msg({ author_name: "Ana" })] });
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Líder")).toBeNull();
  });
});

describe("ProposalThread — the composer", () => {
  it("closes when the SERVICE has passed, not when the proposal is approved", () => {
    renderThread({ serviceDate: PAST_DATE });
    expect(screen.getByText("La conversación se cerró al pasar el servicio.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Escribe un mensaje…")).toBeNull();
  });

  it("posts the TRIMMED body and clears on success", async () => {
    const { onPost } = renderThread();
    const box = screen.getByPlaceholderText("Escribe un mensaje…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "  hola  " } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(onPost).toHaveBeenCalledWith("hola"));
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("KEEPS the text and shows an error when the post fails", async () => {
    const onPost = vi.fn().mockRejectedValue(new Error("nope"));
    render(
      <ProposalThread
        messages={[]}
        viewerId="mem-1"
        viewerRole="lead"
        serviceDate={OPEN_DATE}
        onPost={onPost}
      />,
    );
    const box = screen.getByPlaceholderText("Escribe un mensaje…") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "no se pierde" } });
    fireEvent.click(screen.getByText("Enviar"));
    await waitFor(() => expect(screen.getByText("Error al enviar el mensaje")).toBeTruthy());
    // The one thing this channel promises.
    expect(box.value).toBe("no se pierde");
  });

  it("refuses to post an empty or whitespace-only body", () => {
    const { onPost } = renderThread();
    const send = screen.getByText("Enviar") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Escribe un mensaje…"), {
      target: { value: "   " },
    });
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(onPost).not.toHaveBeenCalled();
  });

  it("names the right counterpart on each surface", () => {
    const { unmount } = renderThread({ viewerRole: "lead" });
    expect(screen.getByText("Conversación con los admins")).toBeTruthy();
    unmount();
    renderThread({ viewerRole: "admin" });
    expect(screen.getByText("Conversación con el líder")).toBeTruthy();
  });
});

describe("ProposalThread — the pastor's message (ADR-0065)", () => {
  it("no longer offers «Es el mensaje del pastor»: it has its own box in the dialog", () => {
    renderThread({ viewerRole: "admin" });
    expect(screen.queryByLabelText("Es el mensaje del pastor")).toBeNull();
  });

  it("labels a pastor's note as the pastor's, naming who relayed it", () => {
    renderThread({
      messages: [
        msg({ _key: "p", author: "adm-1", author_role: "admin", author_name: "Frank", kind: "pastor_note", body: "Efesios 2" }),
        msg({ _key: "q", author: null, author_role: "admin", author_name: null, kind: "pastor_note", body: "Gracia", at: "2026-08-21T15:00:00.000Z" }),
      ],
    });
    expect(screen.getByText("Mensaje del pastor · vía Frank")).toBeTruthy();
    expect(screen.getByText("Mensaje del pastor")).toBeTruthy();
  });
});

describe("ProposalThread — editing one's own messages (ADR-0065, 2026-10-24)", () => {
  const mine = msg({ _key: "m1", author: "adm-1", author_role: "admin", author_name: "Frank", kind: "admin_change_request", body: "Ensayo a las 9" });
  const theirs = msg({ _key: "l1", at: "2026-08-21T15:00:00.000Z" });

  function renderModifiable(over: Partial<React.ComponentProps<typeof ProposalThread>> = {}) {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const utils = renderThread({
      viewerId: "adm-1",
      viewerRole: "admin",
      messages: [mine, theirs],
      canModify: (m) => m.author === "adm-1",
      onEdit,
      onDelete,
      ...over,
    });
    return { onEdit, onDelete, ...utils };
  }

  it("offers Editar/Borrar only on the messages `canModify` allows", () => {
    renderModifiable();
    expect(screen.getAllByText("Editar")).toHaveLength(1);
    expect(screen.getAllByText("Borrar")).toHaveLength(1);
  });

  it("offers nothing without the handlers", () => {
    renderModifiable({ onEdit: undefined, onDelete: undefined });
    expect(screen.queryByText("Editar")).toBeNull();
    expect(screen.queryByText("Borrar")).toBeNull();
  });

  it("edits in place and closes the editor on success", async () => {
    const { onEdit } = renderModifiable();
    fireEvent.click(screen.getByText("Editar"));
    const box = screen.getByLabelText("Editar mensaje") as HTMLTextAreaElement;
    expect(box.value).toBe("Ensayo a las 9");
    fireEvent.change(box, { target: { value: "Ensayo a las 10" } });
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("m1", "Ensayo a las 10"));
    await waitFor(() => expect(screen.queryByLabelText("Editar mensaje")).toBeNull());
  });

  it("keeps the editor and its text when the edit fails", async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error("nope"));
    renderModifiable({ onEdit });
    fireEvent.click(screen.getByText("Editar"));
    fireEvent.change(screen.getByLabelText("Editar mensaje"), { target: { value: "Ensayo a las 10" } });
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => expect(screen.getByText("No se pudo guardar el cambio")).toBeTruthy());
    expect((screen.getByLabelText("Editar mensaje") as HTMLTextAreaElement).value).toBe("Ensayo a las 10");
  });

  it("asks before deleting, and deletes only on «Sí, borrar»", async () => {
    const { onDelete } = renderModifiable();
    fireEvent.click(screen.getByText("Borrar"));
    expect(screen.getByText("¿Borrar este mensaje?")).toBeTruthy();
    fireEvent.click(screen.getByText("No"));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Borrar"));
    fireEvent.click(screen.getByText("Sí, borrar"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("m1"));
  });

  it("offers nothing once the service has passed", () => {
    renderModifiable({ serviceDate: PAST_DATE });
    expect(screen.queryByText("Editar")).toBeNull();
    expect(screen.queryByText("Borrar")).toBeNull();
  });

  it("marks an edited message «editado»", () => {
    renderThread({ messages: [msg({ edited_at: "2026-08-20T16:00:00.000Z" })] });
    expect(screen.getByText(/· editado/)).toBeTruthy();
  });
});
