/** @vitest-environment jsdom */
// The admin card's POST protocol (Child A §5).
//
// The mutation each test is written to catch is the SAME one, from two angles:
// replacing the in-place record patch with a `load()`. That reads as the obvious
// implementation and is disqualifying, because `load()` sets `loading` and the
// card list renders only inside `{!loading && !error && (` — so every card
// unmounts and every per-card `useState` resets. An in-progress "Solicitar
// cambios" note in any open card is wiped, the fail-closed `conflict` lock this
// protocol installs would not survive its own remount, and the whole list
// flashes to skeletons on every chat message.
//
// A test asserting only "the new message appears" cannot tell the two apart:
// `load()` re-reads the list and the message appears either way.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TODAY } = vi.hoisted(() => ({ TODAY: "2026-09-02" }));
vi.mock("../serviceReadiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../serviceReadiness")>()),
  serviceTodayIso: () => TODAY,
}));

import ProposalsPanel from "../ProposalsPanel";

interface Row {
  _id: string;
  _rev: string;
  service_type: "sunday";
  service_date: string;
  status: "pending";
  lead_name: string;
  lead_id: string;
  messages?: unknown[];
  songs: Array<{ _key: string; play_key: string; song_id: string; title: string; author: string; key: string }>;
}

function row(over: Partial<Row> = {}): Row {
  return {
    _id: "p1",
    _rev: "rev-1",
    service_type: "sunday",
    service_date: "2026-09-06",
    status: "pending",
    lead_name: "Ana Líder",
    lead_id: "mem-1",
    messages: [],
    songs: [
      { _key: "s1", play_key: "G", song_id: "song-1", title: "Santo", author: "X", key: "G" },
    ],
    ...over,
  } as Row;
}

/**
 * `fetch` over a mutable list, counting LIST reads separately.
 *
 * `listReads` is the whole point: it is what distinguishes patching one record
 * in place from calling `load()`.
 */
function stubApi(rows: Row[], postResponse: Record<string, unknown>) {
  const list = rows.map((r) => ({ ...r }));
  const counts = { listReads: 0, posts: 0 };
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST" && String(url).includes("/messages")) {
      counts.posts += 1;
      return { ok: true, status: 200, json: async () => postResponse };
    }
    counts.listReads += 1;
    return { ok: true, status: 200, json: async () => list.map((r) => ({ ...r })) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return counts;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

async function mountAndPost(postResponse: Record<string, unknown>, initial: Partial<Row> = {}) {
  const counts = stubApi([row(initial)], postResponse);
  render(<ProposalsPanel viewerId="admin-1" />);
  await waitFor(() => expect(screen.queryByText("Ana Líder")).not.toBeNull());
  const readsAfterMount = counts.listReads;

  fireEvent.change(screen.getByPlaceholderText("Escribe un mensaje…"), {
    target: { value: "¿Podemos cerrar más lento?" },
  });
  fireEvent.click(screen.getByText("Enviar"));
  await waitFor(() => expect(counts.posts).toBe(1));
  return { counts, readsAfterMount };
}

describe("ProposalsPanel — posting into a card's thread", () => {
  it("patches the record in place and does NOT re-read the list", async () => {
    const { counts, readsAfterMount } = await mountAndPost({
      ok: true,
      rev: "rev-2",
      observedRev: "rev-1",
      messages: [
        { _key: "n1", author: "admin-1", author_name: "Dani", author_role: "admin", kind: "admin_change_request", body: "¿Podemos cerrar más lento?", at: "2026-09-02T10:00:00.000Z" },
      ],
    });

    await waitFor(() => expect(screen.queryByText("¿Podemos cerrar más lento?")).not.toBeNull());
    // THE assertion. A `load()` would push this above the mount count, and the
    // rendered message would look identical either way.
    expect(counts.listReads).toBe(readsAfterMount);
  });

  it("does NOT raise the stale lock when only this post moved the document", async () => {
    await mountAndPost({
      ok: true,
      rev: "rev-2",
      observedRev: "rev-1", // === the rev the card held
      messages: [],
    });
    // Gating on the RELOADED `_rev` instead would fire here — the admin's own
    // append always moves it — and lock them out of their own card after every
    // message they send.
    await waitFor(() => expect(screen.queryByText("Propuesta actualizada")).toBeNull());
  });

  it("DOES raise it when something else moved the document while composing", async () => {
    await mountAndPost({
      ok: true,
      rev: "rev-3",
      observedRev: "rev-2", // the route read a revision the card never had
      messages: [],
    });
    await waitFor(() => expect(screen.queryByText("Propuesta actualizada")).not.toBeNull());
  });

  it("seeds the change-request composer EMPTY, not from the legacy field", async () => {
    stubApi([row({ status: "pending" } as Partial<Row>)], {});
    render(<ProposalsPanel viewerId="admin-1" />);
    await waitFor(() => expect(screen.queryByText("Ana Líder")).not.toBeNull());
    fireEvent.click(screen.getByText("Solicitar cambios"));
    // It used to seed from `proposal.admin_notes`, now a legacy mirror of the
    // newest change request — pre-filling it would re-send a stale note as a
    // brand-new message the moment the panel opened.
    const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    for (const box of boxes) expect(box.value).toBe("");
  });
});
