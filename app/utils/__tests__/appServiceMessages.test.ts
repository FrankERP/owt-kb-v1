// The native app's «Mensajes del servicio» wire (ADR-0091 A-W2, spec D2, D3.2, A4, A6):
//  - the read builder sends names and `mine`, never a member id, and the two threads apart;
//  - `editable` only for an OWN, KEYED, OPEN, service-thread row (a fallback key such as `s0`
//    passes `isMessageKey`, so the stored `_key` is what is tested);
//  - an empty stored pastor's message is no message (a whitespace-only one is, as the writer reads
//    it); the stamp is the writer's;
//  - the offered pastor's text follows the web dialog's rule;
//  - every body in `native/contract/service-message-bodies.json` (which the iOS XCTest encodes)
//    parses with the writer's own parser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appPastorAnswer, appServiceMessagesAnswer, appTeamNotesAnswer, buildAppServiceMessages } from "../appServiceMessages";
import { parseProposalMessageRequest } from "../proposalMessageWrite";
import { parseMessageEdit, parsePastorMessageEdit, parseTeamNotesEdit } from "../serviceMessageEdit";
import type { ConversationRead } from "../serviceThread";

const TODAY = "2099-01-02";

type ReadOver = {
  service?: Record<string, unknown> | null;
  messages?: unknown;
  pastor_message?: unknown;
  weekendSetlists?: ConversationRead["weekendSetlists"];
  proposal?: unknown;
};

function read(over: ReadOver = {}): ConversationRead {
  return {
    service: {
      _id: "sat-1", _rev: "rr", _type: "saturday_role", service_date: "2099-01-03", published: true, hasSongs: false,
      leads: [{ id: "m7", name: "Luis" }, { id: "m8", name: null }],
      ...(over.service ?? {}),
    } as ConversationRead["service"],
    messages: over.messages ?? [],
    pastor_message: over.pastor_message ?? null,
    weekendSetlists: over.weekendSetlists ?? [],
    proposal: over.proposal ?? null,
  };
}

describe("buildAppServiceMessages", () => {
  it("names people, never member ids, and keeps the threads apart", () => {
    const out = buildAppServiceMessages(
      read({
        messages: [{ _key: "k1", author: "m1", author_name: "Frank", body: "Hola", at: "2099-01-01T10:00:00Z" }],
        proposal: { status: "draft", pastor_message: "Texto", messages: [{ _key: "p1", author: "m7", author_name: "Luis", body: "Va", at: "2099-01-01T11:00:00Z" }] },
      }),
      "m1",
      TODAY,
    )!;
    expect(out.service).toEqual({ id: "sat-1", kind: "saturday", date: "2099-01-03", title: "Sábado", published: true, leads: ["Luis"] });
    expect(out.serviceMessages.map((m) => m.key)).toEqual(["k1"]);
    expect(out.proposalMessages.map((m) => m.key)).toEqual(["p1"]);
    expect(out.proposal).toEqual({ status: "draft", offeredPastorMessage: null });
    const text = JSON.stringify(out);
    for (const id of ["m1", "m7", "m8"]) expect(text).not.toContain(`"${id}"`);
  });

  it("editable: own + stored key + open + service thread, nothing else", () => {
    const rows = [
      { _key: "k1", author: "m1", body: "mío" },
      { author: "m1", body: "mío sin clave" }, // fallback key s1 passes isMessageKey: must still be false
      { _key: "k3", author: "m7", body: "de otro" },
      { _key: "a.b", author: "m1", body: "clave rara" },
    ];
    const open = buildAppServiceMessages(read({ messages: rows, proposal: { status: "pending", messages: [{ _key: "p1", author: "m1", body: "mío en la propuesta" }] } }), "m1", TODAY)!;
    expect(open.serviceMessages.map((m) => [m.key, m.editable])).toEqual([["k1", true], ["s1", false], ["k3", false], ["a.b", false]]);
    expect(open.proposalMessages.map((m) => m.editable)).toEqual([false]);

    const closed = buildAppServiceMessages(read({ messages: rows }), "m1", "2099-01-04")!;
    expect(closed.open).toBe(false);
    expect(closed.serviceMessages.some((m) => m.editable)).toBe(false);
  });

  it("an empty stored pastor's message is none; the stamp is the last edit, else the first set", () => {
    expect(buildAppServiceMessages(read({ pastor_message: { body: "", at: "2099-01-01T10:00:00Z" } }), "m1", TODAY)!.pastorMessage).toBeNull();
    // Whitespace only (Studio): the writer counts it as a message, so its stamp must cross.
    expect(buildAppServiceMessages(read({ pastor_message: { body: "  ", at: "2099-01-01T10:00:00Z" } }), "m1", TODAY)!.pastorMessage?.stamp).toBe(
      "2099-01-01T10:00:00Z",
    );
    const edited = buildAppServiceMessages(
      read({ pastor_message: { body: "Hola", at: "2099-01-01T10:00:00Z", edited_at: "2099-01-01T12:00:00Z", author: "m1", author_name: "Frank" } }),
      "m1",
      TODAY,
    )!.pastorMessage;
    expect(edited).toEqual({ body: "Hola", authorName: "Frank", at: "2099-01-01T10:00:00Z", editedAt: "2099-01-01T12:00:00Z", stamp: "2099-01-01T12:00:00Z" });
  });

  it("offers a submitted proposal's different pastor's text, never a draft's or the same one", () => {
    const offered = (status: string, text: string, stored: string | null) =>
      buildAppServiceMessages(
        read({ proposal: { status, pastor_message: text, messages: [] }, pastor_message: stored ? { body: stored, at: "2099-01-01T10:00:00Z" } : null }),
        "m1",
        TODAY,
      )!.proposal?.offeredPastorMessage;
    expect(offered("pending", "Texto", null)).toBe("Texto");
    expect(offered("approved", "Texto\r\n", "Texto")).toBeNull();
    expect(offered("draft", "Texto", null)).toBeNull();
  });

  it("the team note: none, ambiguous, or the setlist target; a special's lives on its role", () => {
    expect(buildAppServiceMessages(read(), "m1", TODAY)!.teamNotes).toBeNull();
    const two = [{ _id: "a", _rev: "1", _type: "saturdarSongs" }, { _id: "b", _rev: "2", _type: "saturdarSongs" }];
    expect(buildAppServiceMessages(read({ weekendSetlists: two }), "m1", TODAY)!.teamNotes).toEqual({ unavailable: "ambiguous" });
    const special = buildAppServiceMessages(
      read({ service: { _type: "special_role", _id: "sp-1", service_name: "Noche  de  alabanza", hasSongs: true, team_notes: "Traer agua" } }),
      "m1",
      TODAY,
    )!;
    expect(special.service.title).toBe("Noche de alabanza");
    expect(special.teamNotes).toEqual({ text: "Traer agua", observed: { id: "sp-1", rev: "rr" } });
  });
});

describe("the write answers", () => {
  it("a message write answers the service thread (open: the writer just checked) or null", () => {
    const ok = appServiceMessagesAnswer({ status: 200, body: { ok: true, message: { author: { _ref: "m1" } }, messages: [{ _key: "k1", author: "m1", body: "Hola" }] } }, "m1");
    expect(ok.body).toEqual({ serviceMessages: [expect.objectContaining({ key: "k1", mine: true, editable: true })] });
    expect(JSON.stringify(ok.body)).not.toContain('"m1"');
    expect(appServiceMessagesAnswer({ status: 200, body: { ok: true, messages: null } }, "m1").body).toEqual({ serviceMessages: null });
  });

  it("the pastor answer drops the fallback row's author id and names the caller", () => {
    const out = appPastorAnswer({ status: 200, body: { ok: true, pastor_message: { body: "Hola", author: "m1", at: "2099-01-01T10:00:00Z" } } }, "Frank");
    expect(out.body).toEqual({ pastorMessage: { body: "Hola", authorName: "Frank", at: "2099-01-01T10:00:00Z", editedAt: null, stamp: "2099-01-01T10:00:00Z" } });
  });

  it("the team-notes answer is verbatim, an empty note null", () => {
    expect(appTeamNotesAnswer({ status: 200, body: { ok: true, teamNotes: null, observed: { id: "x", rev: "r2" } } }).body).toEqual({ teamNotes: null, observed: { id: "x", rev: "r2" } });
  });
});

describe("native/contract/service-message-bodies.json", () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const fixture = JSON.parse(readFileSync(path.join(REPO, "native/contract/service-message-bodies.json"), "utf8")) as {
    cases: { name: string; door: string; body: unknown; parsed: unknown }[];
  };
  it("holds every door", () => {
    expect(new Set(fixture.cases.map((c) => c.door))).toEqual(new Set(["post", "edit", "pastor", "teamNotes"]));
  });
  it.each(fixture.cases)("$name parses with the writer's own parser", ({ door, body, parsed }) => {
    const parse = { post: parseProposalMessageRequest, edit: parseMessageEdit, pastor: parsePastorMessageEdit, teamNotes: parseTeamNotesEdit }[door]!;
    const out = parse(body) as { ok: boolean; value?: unknown };
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject(parsed as object);
  });
});
