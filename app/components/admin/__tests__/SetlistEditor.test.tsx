/** @vitest-environment jsdom */
//
// «Dirige» on a worship night's setlist (spec 2026-09-22-worship-night-song-leads
// §6): each song picks up to two leaders from the block's Lead, «Aún no dirigen»
// names who has no song yet, a leader who left Lead blocks the save, and the PUT
// carries `leadIds` only on a worship night.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { SetlistEditor } from "../SetlistEditor";

const ROSTER = [
  { id: "m1", name: "Ana" },
  { id: "m2", name: "Beto" },
];

function row(n: number, leadIds: string[] | null) {
  return {
    _key: `k${n}`,
    play_key: n === 1 ? "G" : "A",
    songRef: `s${n}`,
    song: { _id: `s${n}`, title: `Canción ${n}`, author: n === 1 ? "A" : "B", key: n === 1 ? "G" : "A", slug: `c${n}` },
    leadIds,
  };
}

function singleRead(over: Record<string, unknown> = {}) {
  return {
    targetState: "single",
    contentState: "ready",
    observed: { state: "single", id: "role-sp", rev: "r1" },
    setlistId: "role-sp",
    recentSongs: {},
    format: "worship_night",
    leadRoster: ROSTER,
    songs: [row(1, ["m1"]), row(2, null)],
    ...over,
  };
}

type PutReply = { status: number; body: unknown };

/**
 * GET setlist → `read`; tags → []; authors → `authors`; song search → `found`;
 * PUT → `put` (captured). POST author → the existing doc for a known name (the
 * route is idempotent by slug), else a new author; POST song → captured.
 */
function stubFetch(
  read: unknown,
  put: PutReply = { status: 200, body: { ok: true } },
  found: unknown[] = [],
  authors: unknown[] = [],
) {
  const puts: unknown[] = [];
  const posts: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return { ok: put.status < 400, status: put.status, json: async () => put.body };
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { name?: string; title?: string };
      posts.push({ url, body });
      if (url === "/api/content/authors") {
        // Idempotent by slug, like the real route: an existing name answers with that doc.
        const hit = (authors as { _id: string; name: string }[]).find((a) => a.name === body.name);
        return hit
          ? { ok: true, status: 200, json: async () => hit }
          : { ok: true, status: 201, json: async () => ({ _id: "a-new", name: body.name }) };
      }
      if (url === "/api/content/posts") return { ok: true, status: 201, json: async () => ({ _id: "s-new", title: body.title }) };
      throw new Error(`unexpected POST ${url}`);
    }
    if (url.startsWith("/api/admin/setlists?")) return { ok: true, status: 200, json: async () => read };
    if (url === "/api/content/tags") return { ok: true, status: 200, json: async () => [] };
    if (url === "/api/content/authors") return { ok: true, status: 200, json: async () => authors };
    if (url.startsWith("/api/admin/songs?")) return { ok: true, status: 200, json: async () => found };
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, puts, posts };
}

function mount() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <CueDialogProvider>
      <SetlistEditor week="2026-10-03" type="special" roleId="role-sp" onClose={onClose} onSaved={onSaved} />
    </CueDialogProvider>,
  );
  return { onSaved, onClose };
}

const optionTexts = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.textContent);
const saveButton = () => screen.getByRole("button", { name: "Guardar setlist" }) as HTMLButtonElement;

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("SetlistEditor — «Dirige» on a worship night", () => {
  it("picks a leader per song from Lead, names who has none yet, and saves leadIds per row", async () => {
    const { puts } = stubFetch(singleRead());
    const { onSaved } = mount();

    const first = await screen.findByLabelText("Dirige Canción 1");
    const second = screen.getByLabelText("Dirige Canción 2");
    expect(optionTexts(first)).toEqual(["—", "Ana", "Beto"]);
    expect(optionTexts(second)).toEqual(["—", "Ana", "Beto"]);
    expect((first as HTMLSelectElement).value).toBe("m1");
    expect((second as HTMLSelectElement).value).toBe("");
    // The «y» picker waits for a first leader.
    expect((screen.getByLabelText("Y también dirige Canción 2") as HTMLSelectElement).disabled).toBe(true);
    // Offers everyone in Lead except the one already leading this song.
    expect(optionTexts(screen.getByLabelText("Y también dirige Canción 1"))).toEqual(["—", "Beto"]);

    expect(screen.getByText("Aún no dirigen: Beto.")).not.toBeNull();

    fireEvent.change(second, { target: { value: "m2" } });
    expect(screen.queryByText(/Aún no dirigen/)).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = puts[0] as { songs: { leadIds?: string[] }[] };
    expect(body.songs[0].leadIds).toEqual(["m1"]);
    expect(body.songs[1].leadIds).toEqual(["m2"]);
  });

  it("marks a song whose leader left Lead and refuses to save until it is fixed", async () => {
    const { puts } = stubFetch(singleRead({ songs: [row(1, ["m9"]), row(2, ["m2"])] }));
    mount();

    const first = (await screen.findByLabelText("Dirige Canción 1")) as HTMLSelectElement;
    expect(screen.getAllByText("Dirige alguien que ya no está en Lead")).toHaveLength(1);
    expect(screen.getByText("Corrige quién dirige las canciones marcadas.")).not.toBeNull();
    expect(saveButton().disabled).toBe(true);

    // The picker shows the stale leader rather than «—»: with no matching option
    // React would select «—», and choosing «—» could then never clear the mark.
    expect(first.value).toBe("m9");
    expect(optionTexts(first)).toEqual(["—", "Ya no está en Lead", "Ana", "Beto"]);

    // Clearing it removes the mark and re-enables the save.
    fireEvent.change(first, { target: { value: "" } });
    expect(screen.queryByText("Dirige alguien que ya no está en Lead")).toBeNull();
    expect(screen.queryByText("Corrige quién dirige las canciones marcadas.")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText("Aún no dirigen: Ana.")).not.toBeNull();
    expect(puts).toHaveLength(0);
  });

  it("shows no «Dirige» on an ordinary special and sends no leadIds", async () => {
    const { puts } = stubFetch(singleRead({ format: null, leadRoster: [] }));
    const { onSaved } = mount();

    await screen.findByText("Canción 1");
    expect(screen.queryAllByLabelText(/dirige/i)).toHaveLength(0);
    expect(screen.queryByText(/Aún no dirigen/)).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = puts[0] as { songs: Record<string, unknown>[] };
    expect(body.songs).toHaveLength(2);
    for (const s of body.songs) expect("leadIds" in s).toBe(false);
  });

  // [post-approval] A set with no saved songs has no revision to go stale, so a
  // Lead change there surfaces as the PUT's 400 — the same reload path as a 409.
  it("turns a 400 naming songs[i].leadIds into the reload prompt, not the generic error", async () => {
    const found = [{ _id: "s3", title: "Canción 3", author: "C", key: "D", slug: "c3" }];
    const { fetchMock, puts } = stubFetch(
      singleRead({ targetState: "none", contentState: undefined, observed: { state: "none" }, setlistId: null, songs: [] }),
      {
        status: 400,
        body: { error: "invalid_request", message: "x", conflict: false, details: { issues: ["songs[0].leadIds"] } },
      },
      found,
    );
    const { onSaved } = mount();

    fireEvent.change(await screen.findByPlaceholderText("Buscar por título..."), { target: { value: "Canción" } });
    fireEvent.click(await screen.findByRole("button", { name: "+ Añadir" }));
    const picker = screen.getByLabelText("Dirige Canción 3");
    // A song added from search starts with no leader.
    expect((picker as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Aún no dirigen: Ana, Beto.")).not.toBeNull();
    fireEvent.change(picker, { target: { value: "m1" } });

    fireEvent.click(saveButton());
    await screen.findByText("Cambió quién está en Lead mientras editabas. Recarga el setlist.");
    expect((puts[0] as { songs: { leadIds?: string[] }[] }).songs[0].leadIds).toEqual(["m1"]);
    expect(screen.queryByText("No se pudo guardar el setlist. Intenta de nuevo.")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);

    // The editor's one reload action re-reads the set.
    const getsBefore = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/setlists?")).length;
    fireEvent.click(screen.getByRole("button", { name: "Recargar setlist" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/setlists?")).length).toBe(getsBefore + 1),
    );
    await waitFor(() => expect(screen.queryByText(/Cambió quién está en Lead/)).toBeNull());
  });

  it("keeps the generic save error for a 400 that is not about leaders", async () => {
    stubFetch(singleRead(), {
      status: 400,
      body: { error: "invalid_request", message: "x", conflict: false, details: { issues: ["songs[0].songId"] } },
    });
    mount();

    await screen.findByLabelText("Dirige Canción 1");
    fireEvent.click(saveButton());
    await screen.findByText("No se pudo guardar el setlist. Intenta de nuevo.");
    expect(screen.queryByText(/Cambió quién está en Lead/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Recargar setlist" })).toBeNull();
  });

  it("tells the admin to save Lead first when a worship night has nobody in Lead yet", async () => {
    stubFetch(singleRead({ leadRoster: [], songs: [row(1, null), row(2, null)] }));
    mount();

    await screen.findByText("Canción 1");
    expect(
      screen.getByText("Nadie está en Lead todavía. Agrégalos en el planner y guarda para elegir quién dirige."),
    ).not.toBeNull();
  });

  it("never shows the empty-Lead hint on an ordinary special", async () => {
    stubFetch(singleRead({ format: null, leadRoster: [] }));
    mount();

    await screen.findByText("Canción 1");
    expect(screen.queryByText(/Nadie está en Lead todavía/)).toBeNull();
  });
});

// «Nueva canción» opened from the setlist editor is the same `SongForm` the
// Canciones tab mounts, and it must offer the same catalogue of artists. It was
// once mounted with no `allAuthors` and no `canCreateAuthor`: the list was empty
// and «+ Crear» on an artist silently did nothing.
describe("SetlistEditor — «Nueva canción» offers the existing artists", () => {
  const AUTHORS = [
    { _id: "a1", name: "Un Corazón" },
    { _id: "a2", name: "Hillsong" },
  ];

  async function openCreate() {
    await screen.findByText("Canción 1");
    fireEvent.click(screen.getByRole("button", { name: /\+ Crear/ }));
    return (await screen.findByLabelText("Artista")) as HTMLInputElement;
  }

  it("lists existing artists, filters them, and sends the picked one with the song", async () => {
    const { posts } = stubFetch(singleRead({ format: null, leadRoster: [] }), undefined, [], AUTHORS);
    mount();
    const artist = await openCreate();

    // Unfiltered, every artist is a chip.
    expect(screen.getByRole("button", { name: "Un Corazón" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hillsong" })).not.toBeNull();

    fireEvent.change(artist, { target: { value: "coraz" } });
    expect(screen.getByRole("button", { name: "Un Corazón" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Hillsong" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Un Corazón" }));

    fireEvent.change(screen.getByLabelText("Título *"), { target: { value: "Solo Dios" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(posts.some((p) => p.url === "/api/content/posts")).toBe(true));
    const song = posts.find((p) => p.url === "/api/content/posts")!.body as { authorIds: string[] };
    expect(song.authorIds).toEqual(["a1"]);
  });

  it("creates a new artist from «+ Crear» and selects it", async () => {
    const { posts } = stubFetch(singleRead({ format: null, leadRoster: [] }), undefined, [], AUTHORS);
    mount();
    const artist = await openCreate();

    fireEvent.change(artist, { target: { value: "Nuevo Artista" } });
    const createArtist = screen
      .getAllByRole("button", { name: /\+ Crear/ })
      .find((b) => b.textContent?.includes("Nuevo Artista"))!;
    fireEvent.click(createArtist);

    await waitFor(() =>
      expect(posts.find((p) => p.url === "/api/content/authors")?.body).toEqual({ name: "Nuevo Artista" }),
    );
    // The search clears and the new artist shows as a selected chip.
    await waitFor(() => expect(artist.value).toBe(""));
    expect(screen.getByRole("button", { name: "Nuevo Artista" }).className).toContain("bg-accent/15");
  });

  it("«+ Crear» on an artist that already exists lists and selects it once", async () => {
    stubFetch(singleRead({ format: null, leadRoster: [] }), undefined, [], AUTHORS);
    mount();
    const artist = await openCreate();

    fireEvent.change(artist, { target: { value: "Un Corazón" } });
    const createArtist = screen
      .getAllByRole("button", { name: /\+ Crear/ })
      .find((b) => b.textContent?.includes("Un Corazón"))!;
    fireEvent.click(createArtist);

    await waitFor(() => expect(artist.value).toBe(""));
    const chips = screen.getAllByRole("button", { name: "Un Corazón" });
    expect(chips).toHaveLength(1);
    expect(chips[0].className).toContain("bg-accent/15");
  });
});
