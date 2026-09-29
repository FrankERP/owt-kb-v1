/** @vitest-environment jsdom */
// The admin song form's artist and tag pickers follow the catalogue their
// parent hands them.
//
// `SongForm` used to copy `allAuthors`/`allTags` into state at mount and never
// read the props again. The Canciones tab's «+ Agregar» is clickable while its
// first fetch is still in flight, so opening the form early froze an empty
// artist picker for the life of the dialog.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SongForm, type SongTag } from "../SongFormModal";

afterEach(cleanup);

const entry = (_id: string, name: string): SongTag => ({ _id, name, slug: { current: _id } });

function form(props: { allAuthors: SongTag[]; allTags?: SongTag[]; canCreateAuthor?: (n: string) => Promise<SongTag | null> }) {
  return (
    <SongForm
      allTags={props.allTags ?? []}
      allAuthors={props.allAuthors}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      loading={false}
      canCreateTag={async () => null}
      canCreateAuthor={props.canCreateAuthor ?? (async () => null)}
    />
  );
}

describe("SongForm catalogue", () => {
  it("shows artists and tags that arrive after the form mounted", () => {
    const { rerender } = render(form({ allAuthors: [] }));
    expect(screen.queryByRole("button", { name: "Un Corazón" })).toBeNull();

    rerender(form({ allAuthors: [entry("a1", "Un Corazón")], allTags: [entry("t1", "Adoración")] }));
    expect(screen.getByRole("button", { name: "Un Corazón" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "#Adoración" })).not.toBeNull();
  });

  // A parent appends whatever the idempotent create POST returns, so after a
  // «+ Crear» on an existing name it holds that `_id` twice — and a REOPENED
  // form has created nothing yet, so only de-duping the catalogue itself helps.
  it("lists a catalogue entry once even when the parent holds it twice", () => {
    render(form({ allAuthors: [entry("a1", "Un Corazón"), entry("a1", "Un Corazón"), entry("a2", "Hillsong")] }));
    expect(screen.getAllByRole("button", { name: "Un Corazón" })).toHaveLength(1);
  });

  it("«+ Crear» on a name that already exists selects it once and lists it once", async () => {
    const existing = entry("a1", "Un Corazón");
    // The authors POST is idempotent by slug: it answers with the existing doc.
    render(form({ allAuthors: [existing], canCreateAuthor: async () => existing }));

    const artist = screen.getByLabelText("Artista") as HTMLInputElement;
    fireEvent.change(artist, { target: { value: "Un Corazón" } });
    const create = screen.getAllByRole("button", { name: /\+ Crear/ }).find((b) => b.textContent?.includes("Un Corazón"))!;
    await act(async () => { fireEvent.click(create); });

    await waitFor(() => expect(artist.value).toBe(""));
    const chips = screen.getAllByRole("button", { name: "Un Corazón" });
    expect(chips).toHaveLength(1);
    expect(chips[0].className).toContain("bg-accent/15");
  });

  // Members type Spanish without accents: «un corazon» must find «Un Corazón»,
  // and an accented query must still find a name stored without one.
  it("filters artists and tags ignoring accents and case, both ways", () => {
    render(
      form({
        allAuthors: [entry("a1", "Un Corazón"), entry("a2", "Hillsong")],
        allTags: [entry("t1", "Adoración"), entry("t2", "Gozo")],
      }),
    );

    fireEvent.change(screen.getByLabelText("Artista"), { target: { value: "un corazon" } });
    expect(screen.getByRole("button", { name: "Un Corazón" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Hillsong" })).toBeNull();

    const tags = screen.getByPlaceholderText("Filtrar o crear tag...");
    fireEvent.change(tags, { target: { value: "ADORACION" } });
    expect(screen.getByRole("button", { name: "#Adoración" })).not.toBeNull();
    fireEvent.change(tags, { target: { value: "gózo " } });
    expect(screen.getByRole("button", { name: "#Gozo" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "#Adoración" })).toBeNull();
  });
});
