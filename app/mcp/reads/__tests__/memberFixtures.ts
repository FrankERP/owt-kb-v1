// Test-only fixtures for the P1 step 6 read tool `get_member_availability` —
// NOT a test file (no `.test.` in the name, so vitest's `include` never picks
// it up). Independent of `serviceFixtures.ts` / `readToolFixtures.ts`: the tool
// touches no role, setlist or proposal domain, only `teamMembers`.
//
// `MEMBER_DIRECTORY` carries `ministries` on every row so the responder can
// apply `WORSHIP_AUDIENCE_GROQ_FILTER`'s own semantics in JS (absent, empty or
// containing "worship" ⇒ included) the way real GROQ would — then STRIPS that
// field before answering, because `worshipMemberDirectoryQuery()` never
// projects it. A test asserting the presenter never reads `ministries` is
// therefore a property of the fixture, the same discipline `readToolFixtures`
// documents for `SONG_POSTS`'s heavy fields.

import { worshipMemberDirectoryQuery } from "../memberDirectory";

type Row = Record<string, unknown>;

function member(id: string, name: string, over: Row = {}): Row {
  return {
    _id: id,
    member_name: name,
    alias: null,
    memberType: [],
    disabled: false,
    unavailableDates: [],
    unavailabilityNotes: [],
    // Not projected by `worshipMemberDirectoryQuery()`; carried only so the
    // responder can apply the audience filter. Stripped before it answers.
    ministries: undefined,
    ...over,
  };
}

/**
 * - `mem-ana`: two September dates, one with a note — the month-filter/notes case.
 * - `mem-luis` ("Lucho"): `disabled: true` — must still be listed, flagged.
 * - `mem-sofia`: no `ministries` field at all — the legacy-worship case.
 * - `mem-mix`: `ministries: ["worship", "kids"]` — both, still worship-audience.
 * - `mem-kiki`: kids-only (`ministries: ["kids"]`) — absent from every answer,
 *   and a `memberId` naming her is refused like an unknown id (spec I5).
 * - `mem-popo-1` / `mem-popo-2`: share the alias "Popo" — the ambiguous-name case.
 */
export const MEMBER_DIRECTORY: readonly Row[] = [
  member("mem-ana", "Ana", {
    memberType: ["voz", "sunday_lead"],
    unavailableDates: ["2026-09-05", "2026-10-01"],
    unavailabilityNotes: [{ date: "2026-09-05", note: "Viaje" }],
  }),
  member("mem-luis", "Luis", { alias: "Lucho", memberType: ["instrumento"], disabled: true }),
  member("mem-sofia", "Sofía", { memberType: ["voz"], ministries: undefined }),
  member("mem-mix", "Mixta", { memberType: ["voz"], ministries: ["worship", "kids"] }),
  member("mem-kiki", "Kiki", { ministries: ["kids"] }),
  member("mem-popo-1", "Guadalupe", { alias: "Popo" }),
  member("mem-popo-2", "Josefina", { alias: "Popo" }),
];

function isWorshipAudience(row: Row): boolean {
  const ministries = row.ministries;
  if (!Array.isArray(ministries) || ministries.length === 0) return true;
  return ministries.includes("worship");
}

export interface MemberResponderOptions {
  members?: readonly Row[];
  failDirectory?: boolean;
}

export interface MemberResponder {
  fetch: (query: string, params?: Record<string, unknown>) => Promise<unknown>;
  calls: string[];
}

/** Answers `operationalClient.fetch` for `get_member_availability`, keyed by the CALLER's own query text. */
export function memberResponder(options: MemberResponderOptions = {}): MemberResponder {
  const members = options.members ?? MEMBER_DIRECTORY;
  const directoryQuery = worshipMemberDirectoryQuery().query;
  const calls: string[] = [];

  const fetch = async (query: string): Promise<unknown> => {
    if (query === directoryQuery) {
      calls.push("directory");
      if (options.failDirectory) throw new Error("fixture: member directory failed token=sk-fixture-secret");
      return members.filter(isWorshipAudience).map((row) => {
        const { ministries: _ministries, ...projected } = row;
        return structuredClone(projected);
      });
    }
    throw new Error(`fixture: unknown query on operational: ${query.slice(0, 60)}`);
  };

  return { fetch, calls };
}
