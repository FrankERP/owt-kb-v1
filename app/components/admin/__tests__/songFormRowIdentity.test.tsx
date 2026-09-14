/** @vitest-environment jsdom */
// The ADMIN song form's repeatable rows, keyed by identity rather than position
// (issue #69).
//
// This file exists because the first round of the fix guarded only
// `EditSongButton`: reverting `SongFormModal`'s `key={link.id}` back to `key={i}`
// left the whole suite green. `SongForm` is the more-used of the two editors —
// `ContentPanel` and `SetlistEditor` both mount it — so the half with no guard
// was the half more likely to be refactored.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SongForm } from "../SongFormModal";

afterEach(cleanup);

function mountForm() {
  return render(
    <SongForm
      allTags={[]}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      loading={false}
      canCreateTag={async () => null}
    />,
  );
}

const labelOf = (n: number) => screen.getByLabelText(`Etiqueta del link ${n}`) as HTMLInputElement;

describe("SongForm reference links are keyed by identity", () => {
  it("keeps the caret on the same link when a row above it is deleted", () => {
    mountForm();
    const add = screen.getByRole("button", { name: "+ Agregar" });
    act(() => { fireEvent.click(add); fireEvent.click(add); fireEvent.click(add); });

    act(() => { fireEvent.change(labelOf(1), { target: { value: "primero" } }); });
    act(() => { fireEvent.change(labelOf(2), { target: { value: "segundo" } }); });
    act(() => { fireEvent.change(labelOf(3), { target: { value: "tercero" } }); });

    const third = labelOf(3);
    act(() => third.focus());
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Eliminar link 2" })); });

    // Keyed by position, React reuses the deleted row's DOM node for the row that
    // slides up, so the focused node ends up holding a different link.
    expect(
      document.activeElement,
      "the caret left the row the admin was editing — see issue #69",
    ).toBe(third);
    expect(third.value).toBe("tercero");
    expect(labelOf(1).value).toBe("primero");
    expect(labelOf(2).value).toBe("tercero");
    expect(screen.queryByDisplayValue("segundo")).toBeNull();
  });

  it("edits the row the admin is in, not the one at that position", () => {
    mountForm();
    const add = screen.getByRole("button", { name: "+ Agregar" });
    act(() => { fireEvent.click(add); fireEvent.click(add); });
    act(() => { fireEvent.change(labelOf(1), { target: { value: "uno" } }); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Eliminar link 1" })); });

    // The survivor is now row 1. Typing into it must not resurrect "uno".
    act(() => { fireEvent.change(labelOf(1), { target: { value: "dos" } }); });
    expect(labelOf(1).value).toBe("dos");
    expect(screen.queryByDisplayValue("uno")).toBeNull();
  });
});
