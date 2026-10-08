// Solver v3 C6 RQ-5 (i)–(iii), RQ-5 (a), KH-1, KH-3 — every wire rule id is MINTED: valid for C5,
// never `mandatory_lead`, unique across kinds, stable for one config, and carrying nothing of its
// source key. Rules are named here by kind and config ordinal, never by key.
import { describe, expect, it } from "vitest";

import {
  capCardLabel, capOrdinal, conflictCardLabel, conflictOrdinal, mintRuleIds, presenceCardLabel, presenceOrdinal,
  renderRuleRefTable, sinTarjetaExact, sinTarjetaPresence, weekExclusionLabel,
} from "../v3RuleIds";
import { NAME_SHAPED, NAME_SHAPED_KEYS, cap, config, restriction } from "./v3Fixtures";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";

const ALL = {
  caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }, { ri: 1, ci: 1 }, { ri: 1, ci: 2 }],
  exactUnmatched: [{ month: "2026-11", memberId: "m-ana", roles: ["Sun.Lead"] as const }],
  conflicts: [0],
  presenceKeys: ["d-carla-dani", "d-old-presence"],
};
const ID = /^[A-Za-z0-9_-]{1,64}$/;

describe("mintRuleIds", () => {
  it("every id matches C5's grammar, none is mandatory_lead, and all are distinct", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    const all = [
      ...ALL.caps.map(({ ri, ci }) => ids.cap(ri, ci)),
      ids.exact("2026-11", "m-ana", ["Sun.Lead"]),
      ids.pair(0),
      ids.presence("d-carla-dani"),
      ids.presence("d-old-presence"),
    ];
    for (const id of all) {
      expect(id).toMatch(ID);
      expect(id).not.toBe("mandatory_lead");
      for (const key of NAME_SHAPED_KEYS) expect(id).not.toContain(key);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("a cap key with a space or an accent, a cap and a conflict sharing a key, and a cap key equal to a presence ruleKey each get a distinct minted id", () => {
    const shared = config({
      restrictions: [restriction("r 1", "Ana", { caps: [cap("dí a", "Sun.Lead", "<=", 1), cap("same", "Sat.Lead", "<=", 1)] })],
      conflicts: [{ id: "same", personA: "Ana", personB: "Bruno", pattern: "*.*" }],
      presence: [{ id: "same", persons: ["Ana", "Bruno"], pattern: "Sun.BGV" }],
    });
    const ids = mintRuleIds(shared, { caps: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }], exactUnmatched: [], conflicts: [0], presenceKeys: ["same"] });
    const minted = [ids.cap(0, 0), ids.cap(0, 1), ids.pair(0), ids.presence("same")];
    for (const id of minted) expect(id).toMatch(ID);
    expect(new Set(minted).size).toBe(4);
  });

  it("orders each kind by its source key in codepoint order (deterministic, ordinal-only ids)", () => {
    const two = config({ restrictions: [restriction("b", "Bruno", { caps: [cap("x", "Sun.Lead", "<=", 1)] }), restriction("a", "Ana", { caps: [cap("x", "Sun.Lead", "<=", 1)] })] });
    const ids = mintRuleIds(two, { caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }], exactUnmatched: [], conflicts: [], presenceKeys: [] });
    expect(ids.cap(1, 0)).toBe("c1");
    expect(ids.cap(0, 0)).toBe("c2");
  });

  it("two restrictions sharing an id (a hand-edited config) still get distinct ids, by config ordinal", () => {
    const dup = config({ restrictions: [restriction("dup", "Ana", { caps: [cap("c", "Sun.Lead", "<=", 1)] }), restriction("dup", "Bruno", { caps: [cap("c", "Sun.Lead", "<=", 1)] })] });
    const ids = mintRuleIds(dup, { caps: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }], exactUnmatched: [], conflicts: [], presenceKeys: [] });
    expect([ids.cap(0, 0), ids.cap(1, 0)]).toEqual(["c1", "c2"]);
  });

  it("the same config gives byte-identical ids on two runs (RQ-5 (ii))", () => {
    const a = mintRuleIds(NAME_SHAPED, ALL);
    const b = mintRuleIds(NAME_SHAPED, ALL);
    expect([a.cap(1, 2), a.pair(0), a.presence("d-carla-dani"), a.exact("2026-11", "m-ana", ["Sun.Lead"])])
      .toEqual([b.cap(1, 2), b.pair(0), b.presence("d-carla-dani"), b.exact("2026-11", "m-ana", ["Sun.Lead"])]);
  });

  it("a carried-only P: key gets an id from the same function (RQ-5 (a))", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    expect(ids.presence("d-old-presence")).toMatch(/^r\d+$/);
  });
});

describe("card labels — what the admin can find on screen", () => {
  it("a cap reads like its card, a pair and a presence rule like theirs", () => {
    expect(capCardLabel(NAME_SHAPED, 1, 2)).toBe("Bruno · Sun.Lead <= 1");
    expect(conflictCardLabel(NAME_SHAPED, 0)).toBe("Ana ≠ Bruno en *.*");
    expect(presenceCardLabel(NAME_SHAPED.presence[0])).toBe("Carla, Dani en Sun.BGV c/sem");
    expect(weekExclusionLabel(restriction("r", "Ana"), { id: "w", week: 5, pattern: "Sat.*" })).toBe("Ana · sem.5 Sat.*");
  });
});

describe("KH-3 — the rule reference table (kind and config ordinal, never a key)", () => {
  const ledger = {
    people: [{ window: { "P:d-old-presence": { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } } }],
    horizon: [{ record: { presence: [{ ruleKey: "d-carla-dani" }] } }],
  } as unknown as FairnessLedgerResponse;

  it("spells ordinals, «sin tarjeta» with its GET index, and an unmatched exact item's own facts", () => {
    expect(capOrdinal(1, 2)).toBe("restrictions[1].caps[2]");
    expect(conflictOrdinal(0)).toBe("conflicts[0]");
    expect(presenceOrdinal(NAME_SHAPED, "d-carla-dani")).toBe("presence[0]");
    expect(presenceOrdinal(NAME_SHAPED, "d-old-presence")).toBeNull();
    // Distinct ruleKeys of the GET body in codepoint order: d-carla-dani, d-old-presence.
    expect(sinTarjetaPresence("d-old-presence", ledger)).toBe("sin tarjeta, posición 1 entre las reglas de presencia de la lectura");
    expect(sinTarjetaExact("2026-11", "m-ana", ["Sun.Lead", "Sat.Lead"])).toBe("sin tarjeta, 2026-11 m-ana Sun.Lead,Sat.Lead");
  });

  it("renders one copyable block headed by the request id, name-free for a name-shaped config", () => {
    const ids = mintRuleIds(NAME_SHAPED, ALL);
    const text = renderRuleRefTable("req-1", [
      { wire: ids.cap(1, 2), kind: "count", ordinal: capOrdinal(1, 2) },
      { wire: ids.pair(0), kind: "pair", ordinal: conflictOrdinal(0) },
      { wire: ids.presence("d-carla-dani"), kind: "presence", ordinal: presenceOrdinal(NAME_SHAPED, "d-carla-dani")! },
      { wire: `P:${ids.presence("d-old-presence")}`, kind: "presence", ordinal: sinTarjetaPresence("d-old-presence", ledger) },
    ]);
    expect(text.split("\n")[0]).toBe("request_id req-1");
    expect(text).toContain("\tcount\trestrictions[1].caps[2]");
    for (const key of [...NAME_SHAPED_KEYS, "d-old-presence"]) expect(text).not.toContain(key);
    for (const name of ["Ana", "Bruno", "Carla", "Dani"]) expect(text).not.toContain(name);
    expect(text).not.toMatch(/[0-9a-f]{16,}/);
  });
});
