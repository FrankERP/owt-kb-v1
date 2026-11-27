// The native app's proposal contract (ADR-0091 W1, spec D3, D6, D7b), bound to the server's own
// parser so the Swift encoder and the writer cannot drift apart:
//
//  - every save body in `native/contract/proposal-save-body.json` (the same file the iOS XCTest
//    encodes, key for key) parses, and every field survives with its value. `parseSongRows`
//    ignores unknown keys and every notes field is optional, so a misspelled or missing key would
//    otherwise still get a 200 and drop keys, medleys or the co-leads' team notes;
//  - the editor read's song rows (`buildAppProposalEditor`), echoed back as the app does, keep
//    their keys and medley tags through `parseSongRows`, a row with no medley included;
//  - `normalizeMedleyTags` gives each case of `native/contract/medley-normalize.json` exactly, the
//    cases the Swift port is tested against;
//  - every admin decision body in `native/contract/proposal-decision-bodies.json` (A-W1) parses
//    with its action, revision and note: a dropped `adminNotes` would parse as an empty note.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseProposalSaveRequest, parseProposalTransitionRequest } from "../proposalWriteRequest";
import { parseSongRows } from "../setlistWriteRequest";
import { buildAppProposalEditor } from "../appProposalEditor";
import { normalizeMedleyTags } from "../medley";
import type { ProposalEditorRead } from "../proposalEditorRead";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = <T,>(name: string): T => JSON.parse(readFileSync(path.join(REPO, "native/contract", name), "utf8")) as T;

type SaveCase = {
  name: string;
  status: string;
  body: {
    roleId: string;
    observed: { state: string; id?: string; rev?: string };
    songs: { songId: string; play_key: string; medley_tag: string | null }[];
    leadNotes: string;
    teamNotes: string;
    pastorMessage: string;
    status: string;
  };
};

describe("the app's save bodies survive the writer's parser", () => {
  const { cases } = fixture<{ cases: SaveCase[] }>("proposal-save-body.json");

  it("reads real cases (an empty fixture would pass vacuously)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
    // At least one medley, one row with no medley, both observed shapes, a cleared pastor's message.
    const songs = cases.flatMap((c) => c.body.songs);
    expect(songs.some((s) => s.medley_tag !== null)).toBe(true);
    expect(songs.some((s) => s.medley_tag === null)).toBe(true);
    expect(new Set(cases.map((c) => c.body.observed.state))).toEqual(new Set(["none", "single"]));
    expect(cases.some((c) => c.body.pastorMessage === "")).toBe(true);
  });

  for (const c of cases) {
    it(c.name, () => {
      // The app always sends every key: an omitted `teamNotes` would erase the stored notes.
      expect(Object.keys(c.body).sort()).toEqual(["leadNotes", "observed", "pastorMessage", "roleId", "songs", "status", "teamNotes"]);
      expect(c.body.status).toBe(c.status);
      const parsed = parseProposalSaveRequest(c.body);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.roleId).toBe(c.body.roleId);
      expect(parsed.value.status).toBe(c.body.status);
      expect(parsed.value.observed).toEqual(c.body.observed);
      expect(parsed.value.teamNotes).toBe(c.body.teamNotes);
      expect(parsed.value.leadNotes).toBe(c.body.leadNotes);
      // A string, never `null` (= «unchanged»): the app always sends what the lead sees, cleared included.
      expect(parsed.value.pastorMessage).toBe(c.body.pastorMessage);
      expect(parsed.value.songs).toEqual(
        c.body.songs.map((s) => ({ songId: s.songId, playKey: s.play_key, medleyTag: s.medley_tag, leadIds: [] })),
      );
    });
  }
});

describe("the editor read's song rows round-trip through parseSongRows", () => {
  it("keeps every key and medley tag, and a row with no medley", () => {
    const read: ProposalEditorRead = {
      roleDoc: { _id: "sun-1", _type: "sunday_role", week: "2099-01-04" },
      serviceType: "sunday",
      serviceDate: "2099-01-04",
      proposal: {
        _id: "setlistProposal.sun-1",
        _rev: "r1",
        status: "draft",
        songs: [
          { song_id: "song-1", title: "A", key: "G", play_key: "A", medley_tag: "m1" },
          { song_id: "song-2", title: "B", key: "D", play_key: null, medley_tag: "m1" },
          { song_id: "song-3", title: "C", key: "E", play_key: "F", medley_tag: null },
        ],
      },
      thread: { messages: [], pastorMessage: null },
    };
    const editor = buildAppProposalEditor(read, "m1", new Map());
    const echoed = editor.proposal!.songs.map((s) => ({ songId: s.songId, play_key: s.play_key, medley_tag: s.medley_tag }));
    expect(echoed[2]!.medley_tag).toBeNull();
    const parsed = parseSongRows(echoed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.map((r) => [r.songId, r.playKey, r.medleyTag])).toEqual([
      ["song-1", "A", "m1"],
      // A row stored with no play key opens on the song's own key, as the web editor does.
      ["song-2", "D", "m1"],
      ["song-3", "F", null],
    ]);
  });

  it("an empty medley tag is refused, so the app must send null", () => {
    expect(parseSongRows([{ songId: "song-1", play_key: "G", medley_tag: "" }]).ok).toBe(false);
  });
});

describe("normalizeMedleyTags agrees with the shared cases", () => {
  const { cases } = fixture<{ cases: { name: string; input: (string | null)[]; expected: (string | null)[] }[] }>("medley-normalize.json");

  it("reads real cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of cases) {
    it(c.name, () => {
      let n = 0;
      const out = normalizeMedleyTags(
        c.input.map((tag) => ({ medley_tag: tag ?? undefined })),
        () => `t${++n}`,
      );
      expect(out.map((e) => e.medley_tag ?? null)).toEqual(c.expected);
    });
  }
});

// A-W1: the admin's three decision bodies, as the iPhone encodes them, parse with their action,
// revision and note intact.
type DecisionCase = {
  name: string;
  body: { action: string; rev: string; adminNotes: string };
  parsed: { action: string; adminNotes: string };
};

describe("the native admin decision body contract (A-W1)", () => {
  const { cases } = fixture<{ cases: DecisionCase[] }>("proposal-decision-bodies.json");

  it("covers the three decisions the panel offers", () => {
    expect(cases.map((c) => c.body.action).sort()).toEqual(["approve", "reopen", "request_changes"]);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const result = parseProposalTransitionRequest(c.body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ action: c.parsed.action, rev: c.body.rev, adminNotes: c.parsed.adminNotes });
  });
});
