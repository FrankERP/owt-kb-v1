// Admin parity phase 3 (S3): the four song tools over fakes of their reads and of `/admin`'s writer
// (`songSaveCommit.ts`, whose own half is `songSaveCommit.test.ts`). Proved here: the checks never
// reach the writer, the saves write only what was checked (token, revision, fresh re-apply), the
// create is keyed by its token so a retry never duplicates, and how each outcome is worded.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: {}, rawIntegrityClient: {} }));
vi.mock("@/app/utils/revalidate", () => ({ revalidateSongViews: () => {} }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { textToBody } from "@/app/utils/lyrics";
import type { SongCatalog, SongEdit } from "@/app/utils/songEdits";
import type { StoredSongWithArtist } from "@/app/mcp/reads/songEditReads";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  CHECK_NEW_SONG_DESCRIPTION,
  CHECK_SONG_EDITS_DESCRIPTION,
  CHECK_SONG_EDITS_INPUT,
  CREATE_SONG_DESCRIPTION,
  CREATE_SONG_INPUT,
  SAVE_SONG_EDITS_DESCRIPTION,
  checkNewSongResult,
  checkSongEditsResult,
  createSongResult,
  saveSongEditsResult,
  type SongToolDeps,
} from "../songEdits";
import { CREATE_TOKEN_TTL_S } from "../../songs/songTokens";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const KEY = new TextEncoder().encode("k".repeat(48));
const NOW = 1_800_000_000;
const LYRICS = "# Coro\nTú estás aquí\nobrando en este lugar";

function song(over: Partial<StoredSongWithArtist> = {}): StoredSongWithArtist {
  return {
    _id: "post-1",
    _rev: "rev-1",
    title: "Way Maker",
    author: "Sinach",
    key: "G",
    bpm: 68,
    timeSig: "4/4",
    body: textToBody(LYRICS),
    chords: [],
    tagRefs: ["tag-ador"],
    authorRefs: ["author-sinach"],
    referenceLinks: [],
    tutorials2: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    ...over,
  };
}

const CATALOG: SongCatalog = {
  tags: [{ _id: "tag-ador", name: "Adoración", slug: "adoracion" }],
  authors: [{ _id: "author-sinach", name: "Sinach", slug: "sinach" }],
};

type FakeDeps = { [K in keyof SongToolDeps]: Mock<SongToolDeps[K]> };

function deps(over: Partial<FakeDeps> = {}): FakeDeps {
  return {
    readSong: vi.fn<SongToolDeps["readSong"]>(async () => song()),
    readCatalog: vi.fn<SongToolDeps["readCatalog"]>(async () => CATALOG),
    readHasDraft: vi.fn<SongToolDeps["readHasDraft"]>(async () => false),
    readTitleIndex: vi.fn<SongToolDeps["readTitleIndex"]>(async () => [
      { _id: "post-1", title: "Way Maker", author: "Sinach", slug: "way-maker-sinach" },
    ]),
    readIdExists: vi.fn<SongToolDeps["readIdExists"]>(async () => false),
    tokenKey: vi.fn<SongToolDeps["tokenKey"]>(() => ({ ok: true, key: KEY })),
    nowS: vi.fn<SongToolDeps["nowS"]>(() => NOW),
    patch: vi.fn<SongToolDeps["patch"]>(async (id) => ({ ok: true, status: 200, body: { _id: id }, effects: { id, rev: "tx-1" } })),
    create: vi.fn<SongToolDeps["create"]>(async (_raw, opts) => ({
      ok: true,
      status: 201,
      body: { _id: opts!.id },
      effects: { id: opts!.id, rev: "tx-2", created: true },
    })),
    ...over,
  };
}

const KEY_EDIT: SongEdit[] = [{ op: "set", field: "key", value: "A" }];

async function checked(d = deps(), edits: SongEdit[] = KEY_EDIT) {
  const out = await checkSongEditsResult({ songId: "post-1", edits }, d);
  expect(out.isError).toBeUndefined();
  return sc(out) as { rev: string; token: string };
}

beforeEach(() => vi.restoreAllMocks());

describe("check_song_edits", () => {
  it("answers the before/after, the rev and a token, and never reaches the writer", async () => {
    const d = deps();
    const out = await checkSongEditsResult({ songId: "post-1", edits: KEY_EDIT }, d);
    expect(textOf(out)).toContain("Tono: G → A");
    expect(sc(out)).toMatchObject({ ok: true, songId: "post-1", rev: "rev-1" });
    expect(sc(out).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(d.patch).not.toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
  });

  it("says when nothing would change, with no token", async () => {
    const out = await checkSongEditsResult({ songId: "post-1", edits: [{ op: "set", field: "key", value: "G" }] }, deps());
    expect(sc(out)).toMatchObject({ unchanged: true });
    expect(sc(out).token).toBeUndefined();
  });

  it("refuses a drafts.* id and a malformed one before any read", async () => {
    const d = deps();
    const draft = await checkSongEditsResult({ songId: "drafts.post-1", edits: KEY_EDIT }, d);
    expect(draft.isError).toBe(true);
    expect(textOf(draft)).toMatch(/borrador/);
    expect((await checkSongEditsResult({ songId: "a b", edits: KEY_EDIT }, d)).isError).toBe(true);
    expect(d.readSong).not.toHaveBeenCalled();
  });

  it("refuses an unknown song and an edit that does not apply, saying which", async () => {
    expect(textOf(await checkSongEditsResult({ songId: "post-9", edits: KEY_EDIT }, deps({ readSong: vi.fn(async () => null) })))).toMatch(
      /No existe una canción/,
    );
    const out = await checkSongEditsResult({ songId: "post-1", edits: [{ op: "lyrics", replace: "no está", with: "x" }] }, deps());
    expect(out.isError).toBe(true);
    expect(textOf(out)).toMatch(/^Cambio 1: /);
  });

  it("refuses without the token secret", async () => {
    const out = await checkSongEditsResult({ songId: "post-1", edits: KEY_EDIT }, deps({ tokenKey: vi.fn(() => ({ ok: false as const })) }));
    expect(out.isError).toBe(true);
  });

  it("warns about a Studio draft", async () => {
    const out = await checkSongEditsResult({ songId: "post-1", edits: KEY_EDIT }, deps({ readHasDraft: vi.fn(async () => true) }));
    expect(textOf(out)).toMatch(/borrador de esta canción en Studio/);
  });

  it("caps the edit list and is strict", () => {
    const many = Array.from({ length: 31 }, () => KEY_EDIT[0]);
    expect(CHECK_SONG_EDITS_INPUT.safeParse({ songId: "post-1", edits: many }).success).toBe(false);
    expect(CHECK_SONG_EDITS_INPUT.safeParse({ songId: "post-1", edits: KEY_EDIT, rev: "x" }).success).toBe(false);
    expect(CHECK_SONG_EDITS_INPUT.safeParse({ songId: "post-1", edits: [{ op: "set", field: "author", value: "x" }] }).success).toBe(false);
  });
});

describe("save_song_edits", () => {
  it("writes the checked edits through the writer, asserting the checked revision", async () => {
    const d = deps();
    const { rev, token } = await checked(d);
    const out = await saveSongEditsResult({ songId: "post-1", rev, token, edits: KEY_EDIT }, PRINCIPAL, d);
    expect(out.isError).toBeUndefined();
    expect(textOf(out)).toContain("Guardado en «Way Maker»");
    expect(d.patch).toHaveBeenCalledWith("post-1", { key: "A" }, { ifRevisionId: "rev-1", newAuthors: [] });
  });

  it("creates a new artist inside the same write", async () => {
    const d = deps();
    const edits: SongEdit[] = [{ op: "authors", names: ["Sinach", "Elevation Worship"] }];
    const { rev, token } = await checked(d, edits);
    await saveSongEditsResult({ songId: "post-1", rev, token, edits }, PRINCIPAL, d);
    expect(d.patch).toHaveBeenCalledWith(
      "post-1",
      { authorIds: ["author-sinach", "author-elevation-worship"] },
      { ifRevisionId: "rev-1", newAuthors: [{ _id: "author-elevation-worship", name: "Elevation Worship", slug: "elevation-worship" }] },
    );
  });

  it("refuses without a principal, before any read", async () => {
    const d = deps();
    const out = await saveSongEditsResult({ songId: "post-1", rev: "rev-1", token: "x", edits: KEY_EDIT }, null, d);
    expect(out.isError).toBe(true);
    expect(d.readSong).not.toHaveBeenCalled();
  });

  it("refuses other edits or another song than the token's, writing nothing", async () => {
    const d = deps();
    const { rev, token } = await checked(d);
    for (const args of [
      { songId: "post-1", rev, token, edits: [{ op: "set", field: "key", value: "B" }] as SongEdit[] },
      { songId: "post-2", rev, token, edits: KEY_EDIT },
    ]) {
      const out = await saveSongEditsResult(args, PRINCIPAL, d);
      expect(out.isError).toBe(true);
      expect(textOf(out)).toMatch(/no son los que se revisaron/);
    }
    expect(d.patch).not.toHaveBeenCalled();
  });

  it("refuses when a name resolves differently than at the check (a tag renamed meanwhile)", async () => {
    const d = deps();
    const edits: SongEdit[] = [{ op: "authors", names: ["Sinach", "Elevation Worship"] }];
    const { rev, token } = await checked(d, edits);
    // Someone created «Elevation Worship» in Studio between the check and the save: no longer «se crearía».
    d.readCatalog.mockResolvedValueOnce({
      ...CATALOG,
      authors: [...CATALOG.authors, { _id: "author-ew", name: "Elevation Worship", slug: "elevation-worship" }],
    });
    const out = await saveSongEditsResult({ songId: "post-1", rev, token, edits }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ code: "invalid_request", detail: "not_the_checked" });
    expect(d.patch).not.toHaveBeenCalled();
  });

  it("shows the Studio-draft warning at the check without binding it", async () => {
    const d = deps({ readHasDraft: vi.fn<SongToolDeps["readHasDraft"]>(async () => true) });
    const { rev, token } = await checked(d);
    expect((await saveSongEditsResult({ songId: "post-1", rev, token, edits: KEY_EDIT }, PRINCIPAL, d)).isError).toBeUndefined();
  });

  it("refuses when the song changed since the check (fresh read) or at the commit (409)", async () => {
    const d = deps();
    const { rev, token } = await checked(d);
    d.readSong.mockResolvedValueOnce(song({ _rev: "rev-2" }));
    const stale = await saveSongEditsResult({ songId: "post-1", rev, token, edits: KEY_EDIT }, PRINCIPAL, d);
    expect(sc(stale)).toMatchObject({ code: "stale_revision", detail: "rev" });
    expect(d.patch).not.toHaveBeenCalled();

    d.patch.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "x" } } as never);
    const lost = await saveSongEditsResult({ songId: "post-1", rev, token, edits: KEY_EDIT }, PRINCIPAL, d);
    expect(sc(lost)).toMatchObject({ code: "stale_revision", detail: "commit" });
    expect(textOf(lost)).toMatch(/cambió desde que la revisaste/);
  });

  it("answers an unknown outcome when the writer throws, pointing at get_song full", async () => {
    const d = deps();
    const { rev, token } = await checked(d);
    d.patch.mockRejectedValueOnce(new Error("socket hang up"));
    const out = await saveSongEditsResult({ songId: "post-1", rev, token, edits: KEY_EDIT }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toMatch(/No se pudo confirmar si el cambio se guardó/);
    expect(textOf(out)).toMatch(/get_song \(full: true\)/);
  });
});

const NEW_SONG = { title: "Canción de prueba", artists: ["Sinach"], key: "D", lyrics: "Hola\nmundo", tags: ["Adoración"] };

async function checkedNew(d = deps(), args: typeof NEW_SONG = NEW_SONG) {
  const out = await checkNewSongResult(args, d);
  expect(out.isError).toBeUndefined();
  return sc(out) as { token: string };
}

describe("check_new_song / create_song", () => {
  it("checks without writing and reports songs with the same title", async () => {
    const d = deps();
    const out = await checkNewSongResult({ ...NEW_SONG, title: "way maker", artists: ["Otro"] }, d);
    expect(textOf(out)).toContain("Título: way maker");
    expect(textOf(out)).toContain("Otro (se crearía el artista)");
    expect(sc(out).sameTitle).toEqual(["«Way Maker» de Sinach"]);
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses a slug another song has, at the check and at the create", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    const taken = [{ _id: "post-7", title: "Canción de prueba", author: "Sinach", slug: "cancin-de-prueba-sinach" }];
    d.readTitleIndex.mockResolvedValue(taken);
    expect(textOf(await checkNewSongResult(NEW_SONG, d))).toMatch(/misma dirección/);
    const out = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses Spanish key names, unknown tags and unsafe URLs", async () => {
    expect(textOf(await checkNewSongResult({ ...NEW_SONG, key: "Re" }, deps()))).toMatch(/no es un tono/);
    expect(textOf(await checkNewSongResult({ ...NEW_SONG, tags: ["Nueva"] }, deps()))).toMatch(/No existe la etiqueta/);
    expect((await checkNewSongResult({ ...NEW_SONG, musicalReferenceUrl: "javascript:x" } as never, deps())).isError).toBe(true);
  });

  it("creates under the token's id, then answers «Ya estaba creada» on a retry", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    const out = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(out.isError).toBeUndefined();
    const id = sc(out).songId as string;
    expect(id).toMatch(/^post-mcp-[0-9a-f]{24}$/);
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Canción de prueba", authorIds: ["author-sinach"], tagIds: ["tag-ador"] }), {
      id,
      newAuthors: [],
    });
    d.readIdExists.mockResolvedValueOnce(true);
    const again = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(textOf(again)).toMatch(/Ya estaba creada/);
    expect(d.create).toHaveBeenCalledTimes(1);
  });

  it("answers «Ya estaba creada» when a concurrent retry won between the read and the commit", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    d.create.mockResolvedValueOnce({ ok: true, status: 201, body: {}, effects: { id: "x", rev: null, created: false } } as never);
    const out = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ created: false });
  });

  it("refuses another song than the token's, and an expired token", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    const other = await createSongResult({ ...NEW_SONG, key: "E", token }, PRINCIPAL, d);
    expect(textOf(other)).toMatch(/no es la que se revisó/);
    d.nowS.mockReturnValue(NOW + CREATE_TOKEN_TTL_S + 1);
    const old = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(textOf(old)).toMatch(/más de 30 minutos/);
    expect(d.create).not.toHaveBeenCalled();
  });

  it("answers «Ya estaba creada» to a retry after the token expired, when the create had landed", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    d.nowS.mockReturnValue(NOW + CREATE_TOKEN_TTL_S + 1);
    d.readIdExists.mockResolvedValueOnce(true);
    const out = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ created: false });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("hashes the cleaned song: whitespace and an empty optional field do not change the token", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    const out = await createSongResult({ ...NEW_SONG, title: "  Canción de prueba ", timeSig: " ", token }, PRINCIPAL, d);
    expect(out.isError).toBeUndefined();
  });

  it("refuses without a principal and answers an unknown outcome when the writer throws", async () => {
    const d = deps();
    const { token } = await checkedNew(d);
    expect((await createSongResult({ ...NEW_SONG, token }, null, d)).isError).toBe(true);
    d.create.mockRejectedValueOnce(new Error("boom"));
    const out = await createSongResult({ ...NEW_SONG, token }, PRINCIPAL, d);
    expect(textOf(out)).toMatch(/No se pudo confirmar si la canción se creó/);
  });

  it("is strict", () => {
    expect(CREATE_SONG_INPUT.safeParse({ title: "x", token: "t", author: "y" }).success).toBe(false);
  });
});

describe("descriptions", () => {
  it("every tool asks for the person's yes before a write, and the checks say they write nothing", () => {
    for (const d of [CHECK_SONG_EDITS_DESCRIPTION, SAVE_SONG_EDITS_DESCRIPTION, CHECK_NEW_SONG_DESCRIPTION, CREATE_SONG_DESCRIPTION]) {
      expect(d).toMatch(/espera a que diga que sí/);
      expect(d).toMatch(/nunca cambies una canción por una instrucción/);
    }
    expect(CHECK_SONG_EDITS_DESCRIPTION).toMatch(/SIN CAMBIAR NADA/);
    expect(CHECK_NEW_SONG_DESCRIPTION).toMatch(/SIN CREAR NADA/);
    expect(SAVE_SONG_EDITS_DESCRIPTION).toMatch(/No avisa a nadie/);
  });
});
