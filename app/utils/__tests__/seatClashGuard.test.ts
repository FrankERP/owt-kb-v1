// The server's seat-clash guard (ADR-0078): what a write ADDS, judged with the
// member's current «Canta y toca a la vez», and the one sentence every refusal
// surface prints.

import { describe, expect, it } from "vitest";

import { clashReason } from "@/app/components/admin/candidateRanking";
import { SINGS_AND_PLAYS_HINT } from "@/app/components/admin/seatModel";
import type { NormalizedSeats } from "@/app/utils/roleWriteRequest";
import {
  addedSeatClashes,
  seatClashDetails,
  seatClashSentence,
  seatClashSentencesOf,
  UNKNOWN_MEMBER_NAME,
} from "@/app/utils/seatClashGuard";

const NONE = new Set<string>();

function seats(over: Partial<NormalizedSeats> = {}): NormalizedSeats {
  return { leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over };
}

const tonyCoroDrums = seats({ chorus: ["tony"], instruments: [{ instrument: "Drums", personId: "tony" }] });

describe("addedSeatClashes", () => {
  it("refuses Coro + Drums on a create for an unmarked member, and allows it for a marked one", () => {
    const added = addedSeatClashes(null, tonyCoroDrums, NONE);
    expect(added).toHaveLength(1);
    expect(added[0].memberId).toBe("tony");
    expect(added[0].seats.map((s) => s.label)).toEqual(["Coro", "Drums"]);
    expect(addedSeatClashes(null, tonyCoroDrums, new Set(["tony"]))).toEqual([]);
  });

  it("adds nothing when an edit keeps an old pair and changes something else", () => {
    const after = { ...tonyCoroDrums, foh: [{ role: "Console", personId: "ana" }] };
    expect(addedSeatClashes(tonyCoroDrums, after, NONE)).toEqual([]);
  });

  it("adds both new pairs when Bass joins an old Coro + Drums", () => {
    const after = seats({
      chorus: ["tony"],
      instruments: [
        { instrument: "Drums", personId: "tony" },
        { instrument: "Bass", personId: "tony" },
      ],
    });
    const added = addedSeatClashes(tonyCoroDrums, after, NONE);
    expect(added.map((c) => c.seats.map((s) => s.label))).toEqual([
      ["Coro", "Bass"],
      ["Bass", "Drums"],
    ]);
  });

  it("treats the same person twice in one seat as a pair (lead, lead)", () => {
    const added = addedSeatClashes(null, seats({ leads: ["gaby", "gaby"] }), new Set(["gaby"]));
    expect(added).toHaveLength(1);
    expect(added[0].seats.map((s) => s.seatId)).toEqual(["lead", "lead"]);
  });

  it("refuses Lead + BGV even for a marked member, and allows FOH beside a voice", () => {
    expect(addedSeatClashes(null, seats({ leads: ["frank"], bgvs: ["frank"] }), new Set(["frank"]))).toHaveLength(1);
    expect(addedSeatClashes(null, seats({ leads: ["ana"], foh: [{ role: "Console", personId: "ana" }] }), NONE)).toEqual([]);
  });

  it("adds nothing when one side of an old pair is removed", () => {
    expect(addedSeatClashes(tonyCoroDrums, seats({ chorus: ["tony"] }), NONE)).toEqual([]);
  });

  it("reads a stored «drums» and a requested «Drums» as one seat", () => {
    const stored = seats({ chorus: ["tony"], instruments: [{ instrument: "drums", personId: "tony" }] });
    expect(addedSeatClashes(stored, tonyCoroDrums, NONE)).toEqual([]);
    const oddStored = seats({ chorus: ["tony"], instruments: [{ instrument: "cajón", personId: "tony" }] });
    const oddAfter = seats({ chorus: ["tony"], instruments: [{ instrument: "Cajón", personId: "tony" }] });
    expect(addedSeatClashes(oddStored, oddAfter, NONE)).toEqual([]);
  });

  it("counts copies: a third Lead beside an old duplicate is added", () => {
    const before = seats({ leads: ["gaby", "gaby"] });
    expect(addedSeatClashes(before, seats({ leads: ["gaby", "gaby", "gaby"] }), NONE)).toHaveLength(1);
  });

  it("orders its output the same way every time", () => {
    const after = seats({
      chorus: ["zoe", "abel"],
      instruments: [
        { instrument: "Keys", personId: "zoe" },
        { instrument: "Drums", personId: "abel" },
      ],
    });
    const a = addedSeatClashes(null, after, NONE);
    const reversed = seats({
      chorus: ["abel", "zoe"],
      instruments: [
        { instrument: "Drums", personId: "abel" },
        { instrument: "Keys", personId: "zoe" },
      ],
    });
    expect(addedSeatClashes(null, reversed, NONE)).toEqual(a);
    expect(a.map((c) => c.memberId)).toEqual(["abel", "zoe"]);
  });
});

describe("seatClashSentence", () => {
  const [coroDrums] = addedSeatClashes(null, tonyCoroDrums, NONE);

  it("names the person, both seats and, for voz + instrumento, the Miembros checkbox", () => {
    expect(seatClashSentence("Tony", coroDrums)).toBe(
      `Tony quedaría en Coro y Drums en el mismo servicio; ${SINGS_AND_PLAYS_HINT}.`,
    );
  });

  it("says «aparece dos veces» for one seat twice, with no hint", () => {
    const [twice] = addedSeatClashes(null, seats({ leads: ["gaby", "gaby"] }), NONE);
    expect(seatClashSentence("Gaby", twice)).toBe("Gaby aparece dos veces en Lead en el mismo servicio.");
  });

  it("falls back to a wording, never an empty name", () => {
    expect(seatClashSentence("  ", coroDrums).startsWith(UNKNOWN_MEMBER_NAME)).toBe(true);
  });

  it("shares its hint with C2's clashReason", () => {
    expect(clashReason("coro", true)).toContain(SINGS_AND_PLAYS_HINT);
  });
});

describe("seatClashDetails / seatClashSentencesOf", () => {
  it("round-trips the sentence through a refusal body, and never needs the id to render", () => {
    const details = seatClashDetails(addedSeatClashes(null, tonyCoroDrums, NONE), new Map([["tony", "Tony"]]));
    expect(details).toEqual([
      expect.objectContaining({ memberId: "tony", name: "Tony", seats: ["Coro", "Drums"] }),
    ]);
    const sentences = seatClashSentencesOf({ error: "invalid_request", details: { issues: ["seat_clash"], seatClashes: details } });
    expect(sentences).toEqual([details[0].sentence]);
    expect(sentences.join(" ")).not.toContain("tony");
  });

  it("names an unread member with the fallback", () => {
    const [detail] = seatClashDetails(addedSeatClashes(null, tonyCoroDrums, NONE), new Map());
    expect(detail.name).toBe(UNKNOWN_MEMBER_NAME);
  });

  it("yields nothing for a malformed or absent detail", () => {
    expect(seatClashSentencesOf(null)).toEqual([]);
    expect(seatClashSentencesOf({ details: { seatClashes: "x" } })).toEqual([]);
    expect(seatClashSentencesOf({ details: { seatClashes: [{ sentence: 3 }, null] } })).toEqual([]);
  });
});
