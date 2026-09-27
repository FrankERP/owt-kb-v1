// Every issue token the FOUR write-tool request parsers can emit must render
// as real Spanish through `refusalFor` — never the bare `"Detalle técnico:
// <token>."` fallback (review round 1, IMPORTANT: a schema-valid input still
// reached an untranslated domain refusal).
//
// This does not guess the token list: it DRIVES each real parser
// (`parseUnpublishRequest`/`parsePublishReadyRequest` in
// `publishReadyBundle.ts`, `parseSwapRequest` in `roleWriteRequest.ts`,
// `parseSetlistWriteRequest` in `setlistWriteRequest.ts`) with a malformed
// body crafted to hit ONE `fail([...])` branch at a time, and feeds the EXACT
// token that parser returned through `refusalFor`. A parser that grows a new
// `fail([...])` token this suite does not already cover would still pass
// (nothing here re-parses the parsers' source), but every token these four
// functions are KNOWN to emit today is proven translated. Pair with
// `refusals.test.ts`'s pinned-copy tests for the exact wording.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));

import { parsePublishReadyRequest, parseUnpublishRequest } from "@/app/utils/publishReadyBundle";
import { parseSwapRequest } from "@/app/utils/roleWriteRequest";
import { parseSetlistWriteRequest } from "@/app/utils/setlistWriteRequest";
import { serviceError } from "@/app/utils/serviceMutation";
import { refusalFor } from "../refusals";

/** The `issues` a parser's OWN refusal carries — fails loudly if the fixture body was not actually refused. */
function issuesOf(result: { ok: boolean; issues?: string[] }, body: unknown): string[] {
  expect(result.ok, `expected ${JSON.stringify(body)} to be refused`).toBe(false);
  return (result as { issues: string[] }).issues;
}

/** The Spanish text `refusalFor` renders for exactly these issues, as a real writer's `invalid_request` would carry them. */
function textFor(issues: string[]): string {
  const outcome = { ok: false as const, ...serviceError("invalid_request", { details: { issues } }) };
  return (refusalFor(outcome).content as { type: string; text: string }[])[0].text;
}

/** Every token in `issues` rendered real Spanish — never the untranslated fallback. */
function expectTranslated(issues: string[]) {
  const text = textFor(issues);
  expect(text, `issues=${JSON.stringify(issues)} -> "${text}"`).not.toContain("Detalle técnico");
}

const GOOD_SEAT = { roleId: "role-sun-1004", rev: "rev-1", path: "Lead", itemKey: "k1" };
const GOOD_SETLIST_BASE = { type: "sunday", week: "2026-10-04", observed: { state: "none" }, songs: [] };

describe("issueSentences/ISSUE_COPY cover every token the four write parsers can emit", () => {
  describe("parseUnpublishRequest", () => {
    it.each<[string, unknown]>([
      ["payload", null],
      ["mode", { mode: "bogus", roles: [{ id: "role-x", rev: "r1" }] }],
      ["published", { roles: [{ id: "role-x", rev: "r1" }], published: true }],
      ["acknowledged_blockers", { acknowledgedBlockers: [] }],
      ["roles", { roles: [] }],
      ["batch_size", { roles: Array.from({ length: 101 }, () => ({})) }],
      ["role_id", { roles: [{ id: "drafts.role-x", rev: "r1" }] }],
      ["duplicate_role_id", { roles: [{ id: "role-x", rev: "r1" }, { id: "role-x", rev: "r2" }] }],
      ["role_rev", { roles: [{ id: "role-x", rev: "a b" }] }],
    ])("%s", (_label, body) => {
      const issues = issuesOf(parseUnpublishRequest(body), body);
      expectTranslated(issues);
    });
  });

  describe("parsePublishReadyRequest", () => {
    it.each<[string, unknown]>([
      ["payload", null],
      ["mode", { mode: "bogus", roles: [{ id: "role-x", rev: "r1" }] }],
      ["roles", { mode: "ready", roles: [] }],
      ["batch_size", { mode: "ready", roles: Array.from({ length: 101 }, () => ({})) }],
      ["published", { mode: "recover", roles: [{ id: "role-x" }], published: "nope" }],
      ["role_id", { mode: "ready", roles: [{ id: "drafts.role-x", rev: "r1" }] }],
      ["duplicate_role_id", { mode: "ready", roles: [{ id: "role-x", rev: "r1" }, { id: "role-x", rev: "r2" }] }],
      ["role_rev", { mode: "ready", roles: [{ id: "role-x", rev: "a b" }] }],
      [
        "acknowledged_blockers",
        { mode: "ready", roles: [{ id: "role-x", rev: "r1", acknowledgedBlockers: ["not_a_real_code"] }] },
      ],
    ])("%s", (_label, body) => {
      const issues = issuesOf(parsePublishReadyRequest(body), body);
      expectTranslated(issues);
    });
  });

  describe("parseSwapRequest", () => {
    it.each<[string, unknown]>([
      ["payload", null],
      ["kind", { kind: "bogus" }],
      ["source (bare)", { kind: "seat", source: null, target: GOOD_SEAT }],
      ["source.roleId", { kind: "seat", source: { ...GOOD_SEAT, roleId: "drafts.role-x" }, target: GOOD_SEAT }],
      ["source.rev", { kind: "seat", source: { ...GOOD_SEAT, rev: "a b" }, target: GOOD_SEAT }],
      ["source.path", { kind: "seat", source: { ...GOOD_SEAT, path: "Bogus" }, target: GOOD_SEAT }],
      ["source.itemKey", { kind: "seat", source: { ...GOOD_SEAT, itemKey: "bad key!" }, target: GOOD_SEAT }],
      ["target (bare)", { kind: "seat", source: GOOD_SEAT, target: null }],
      ["target.roleId", { kind: "seat", source: GOOD_SEAT, target: { ...GOOD_SEAT, roleId: "drafts.role-y" } }],
      ["target.rev", { kind: "seat", source: GOOD_SEAT, target: { ...GOOD_SEAT, rev: "a b" } }],
      ["target.path", { kind: "seat", source: GOOD_SEAT, target: { ...GOOD_SEAT, path: "Bogus" } }],
      ["target.itemKey", { kind: "seat", source: GOOD_SEAT, target: { ...GOOD_SEAT, itemKey: "bad key!" } }],
      ["identical_selection (seat)", { kind: "seat", source: GOOD_SEAT, target: GOOD_SEAT }],
      [
        "rev_disagreement",
        {
          kind: "seat",
          source: { ...GOOD_SEAT, rev: "r1" },
          target: { ...GOOD_SEAT, path: "BGVs", rev: "r2" },
        },
      ],
      ["path", { kind: "section", path: "Bogus", roles: [{ id: "role-a", rev: "r1" }, { id: "role-b", rev: "r2" }] }],
      ["roles (wrong length)", { kind: "team", roles: [{ id: "role-a", rev: "r1" }] }],
      ["roles[0] (bare)", { kind: "team", roles: [null, { id: "role-b", rev: "r2" }] }],
      ["roles[0].id", { kind: "team", roles: [{ id: "drafts.role-a", rev: "r1" }, { id: "role-b", rev: "r2" }] }],
      ["roles[0].rev", { kind: "team", roles: [{ id: "role-a", rev: "a b" }, { id: "role-b", rev: "r2" }] }],
      ["roles[1].id", { kind: "team", roles: [{ id: "role-a", rev: "r1" }, { id: "drafts.role-b", rev: "r2" }] }],
      [
        "identical_selection (team)",
        { kind: "team", roles: [{ id: "role-a", rev: "r1" }, { id: "role-a", rev: "r1" }] },
      ],
    ])("%s", (_label, body) => {
      const issues = issuesOf(parseSwapRequest(body), body);
      expectTranslated(issues);
    });
  });

  describe("parseSetlistWriteRequest", () => {
    it.each<[string, unknown]>([
      ["payload", null],
      ["type", { ...GOOD_SETLIST_BASE, type: "bogus" }],
      ["week", { ...GOOD_SETLIST_BASE, week: "not-a-date" }],
      [
        "roleId (special)",
        { type: "special", week: "2026-10-17", roleId: "drafts.role-x", observed: { state: "none" }, songs: [] },
      ],
      ["observed (bare)", { ...GOOD_SETLIST_BASE, observed: null }],
      ["observed.state (none+id)", { ...GOOD_SETLIST_BASE, observed: { state: "none", id: "x" } }],
      ["observed.state (unknown)", { ...GOOD_SETLIST_BASE, observed: { state: "bogus" } }],
      ["observed.id", { ...GOOD_SETLIST_BASE, observed: { state: "single", id: "drafts.role-x", rev: "r1" } }],
      ["observed.rev", { ...GOOD_SETLIST_BASE, observed: { state: "single", id: "role-x", rev: "a b" } }],
      ["songs (not array)", { ...GOOD_SETLIST_BASE, songs: "nope" }],
      ["songs_length", { ...GOOD_SETLIST_BASE, songs: Array.from({ length: 61 }, (_, i) => ({ songId: `song-${i}` })) }],
      ["songs[0] (bare)", { ...GOOD_SETLIST_BASE, songs: [null] }],
      ["songs[0].songId", { ...GOOD_SETLIST_BASE, songs: [{ songId: "drafts.song-x" }] }],
      ["songs[0].play_key", { ...GOOD_SETLIST_BASE, songs: [{ songId: "song-x", play_key: 1 }] }],
      ["songs[0].medley_tag", { ...GOOD_SETLIST_BASE, songs: [{ songId: "song-x", medley_tag: 1 }] }],
      ["songs[1].songId", { ...GOOD_SETLIST_BASE, songs: [{ songId: "song-a" }, { songId: "drafts.song-b" }] }],
    ])("%s", (_label, body) => {
      const issues = issuesOf(parseSetlistWriteRequest(body), body);
      expectTranslated(issues);
    });
  });
});
