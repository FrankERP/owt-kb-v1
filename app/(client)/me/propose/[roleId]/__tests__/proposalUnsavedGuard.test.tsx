/** @vitest-environment jsdom */
//
// The unsaved-changes guard on the proposal editor.
//
// The bug this pins: a lead could reorder eight songs, retune their keys and
// link a medley, then tap "Volver" — and every bit of it vanished, silently.
// The same member's availability page has tracked a saved-state snapshot and
// warned on exit since it shipped; the editor that holds far more work had
// nothing.
//
// The second half is the harder half, and it is the reason the fingerprint
// takes the proposal id as an input: `lead_notes` is sent ONLY while no
// proposal document exists yet. A first save mints that id, so a snapshot
// re-seeded with the id this closure captured (`null`) keeps the note in the
// fingerprint that the very next render no longer puts there — and the editor
// reads as permanently dirty the instant it saved successfully, prompting on
// every exit forever after. `re-seeds clean after a FIRST save` fails against
// that mistake and passes here.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }),
}));

import ProposalEditor, { proposalSnapshot } from "../ProposalEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  nav.push.mockReset();
  nav.refresh.mockReset();
});

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2026-08-16",
  service_type: "sunday" as const,
  service_date: "2026-08-16",
};

const proposal = {
  _id: "proposal-1",
  _rev: "rev-1",
  status: "draft" as const,
  team_notes: "",
  songs: [
    { song_id: "song-1", title: "Sublime gracia", author: "Newton", key: "G", play_key: "G" },
    { song_id: "song-2", title: "Cuán grande es Él", author: "Boberg", key: "D", play_key: "D" },
  ],
};

/** Route the editor's two endpoints; the song search fires on mount. */
function mockApi(proposalBody: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/me/proposals")) {
      return new Response(JSON.stringify(proposalBody), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

const unsaved = () => screen.queryByText(/cambios sin guardar/i);
const volver = () => screen.getByRole("button", { name: /volver/i });

// ─── The fingerprint ──────────────────────────────────────────────────────────

describe("proposalSnapshot", () => {
  const a = { songId: "s1", play_key: "G", medley_tag: undefined };
  const b = { songId: "s2", play_key: "D", medley_tag: undefined };

  it("is stable for identical state", () => {
    expect(proposalSnapshot([a, b], "hola", "", "p1")).toBe(proposalSnapshot([a, b], "hola", "", "p1"));
  });

  it("changes when the setlist is reordered — a setlist IS its order", () => {
    expect(proposalSnapshot([a, b], "", "", "p1")).not.toBe(proposalSnapshot([b, a], "", "", "p1"));
  });

  it("changes on a retuned play key and on a medley link", () => {
    expect(proposalSnapshot([a], "", "", "p1")).not.toBe(
      proposalSnapshot([{ ...a, play_key: "A" }], "", "", "p1"),
    );
    expect(proposalSnapshot([a], "", "", "p1")).not.toBe(
      proposalSnapshot([{ ...a, medley_tag: "m1" }], "", "", "p1"),
    );
  });

  it("counts lead notes only while no proposal exists — they are sent only then", () => {
    expect(proposalSnapshot([a], "", "nota", null)).not.toBe(proposalSnapshot([a], "", "", null));
    expect(proposalSnapshot([a], "", "nota", "p1")).toBe(proposalSnapshot([a], "", "", "p1"));
  });

  it("ignores whitespace-only differences in the notes", () => {
    expect(proposalSnapshot([a], " hola ", "", "p1")).toBe(proposalSnapshot([a], "hola", "", "p1"));
  });
});

// ─── The editor ───────────────────────────────────────────────────────────────

describe("proposal editor — leaving with unsaved work", () => {
  it("starts clean, and leaving does not interrogate the member", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);

    expect(unsaved()).toBeNull();
    fireEvent.click(volver());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/me");
  });

  it("flags an edited team message and blocks the exit the member declines", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);

    fireEvent.change(screen.getByLabelText(/mensaje para el equipo/i), {
      target: { value: "Salmo 100" },
    });
    expect(unsaved()).not.toBeNull();

    fireEvent.click(volver());
    expect(confirmSpy).toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("lets the member leave anyway once they confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);

    fireEvent.change(screen.getByLabelText(/mensaje para el equipo/i), {
      target: { value: "Salmo 100" },
    });
    fireEvent.click(volver());
    expect(nav.push).toHaveBeenCalledWith("/me");
  });

  it("re-seeds clean after a save, so it does not nag about work already stored", async () => {
    mockApi({ _id: "proposal-1", status: "draft", _rev: "rev-2" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);

    fireEvent.change(screen.getByLabelText(/mensaje para el equipo/i), {
      target: { value: "Salmo 100" },
    });
    expect(unsaved()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(unsaved()).toBeNull());

    fireEvent.click(volver());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("re-seeds clean after a FIRST save, which mints the id that drops lead notes", async () => {
    mockApi({ _id: "proposal-new", status: "draft", _rev: "rev-1" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProposalEditor roleDoc={roleDoc} proposal={null} currentUserId="member-1" />);

    fireEvent.change(screen.getByLabelText(/notas privadas/i), {
      target: { value: "Pedimos ensayo extra" },
    });
    expect(unsaved()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(unsaved()).toBeNull());

    fireEvent.click(volver());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("keeps warning when the save was refused — the work is still only on screen", async () => {
    mockApi({}, 409);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);

    fireEvent.change(screen.getByLabelText(/mensaje para el equipo/i), {
      target: { value: "Salmo 100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await screen.findByText(/propuesta actualizada/i);

    expect(unsaved()).not.toBeNull();
    fireEvent.click(volver());
    expect(confirmSpy).toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
