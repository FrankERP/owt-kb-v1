// The rules of «Generar mes» as sentences (diseño para admins, bloque 2) — every wording
// the card, its forms and the MCP's `get_solver_rules` share, pinned once.

import { describe, expect, it } from "vitest";

import {
  CADENCE_SENTENCE, CAP_OP_WORD, EXEMPT_SENTENCE, SLACK_STALE_NOTE, SLACK_ZERO_NOTE,
  capSentence, capSubject, conflictNotation, conflictSentence, exclusionSentence, patternLabel, patternPill,
  presenceNotation, presenceSentence, restrictionChips, sentenceText, weekSentence,
} from "../ruleCopy";
import { capLabel, type PersonRestriction, type RestrictionCap } from "../plannerModel";

const cap = (over: Partial<RestrictionCap>): RestrictionCap =>
  ({ id: "c", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0, ...over });

describe("exclusions («!pattern»)", () => {
  it.each([
    ["Sat.*", "Nunca en sábado"],
    ["Sun.*", "Nunca en domingo"],
    ["*.*", "Nunca en fin de semana"],
    ["Sun.BGV", "No BGV en domingo"],
    ["Sun.Choir", "No coro en domingo"],
    ["Sun.Lead", "No líder en domingo"],
    ["Sat.Lead", "No líder en sábado"],
    ["Sat.BGV", "No BGV en sábado"],
    ["*.Lead", "Nunca líder"],
    ["*.BGV", "Nunca BGV"],
    ["*.Choir", "Nunca coro"],
    ["*.LeadBGV", "Nunca líder ni BGV"],
    // A ban on both seats reads «ni» on a day too, never «o».
    ["Sun.LeadBGV", "No líder ni BGV en domingo"],
    // Legacy aliases read as their canonical pattern.
    ["Lead.*", "Nunca líder"],
  ])("%s → %s", (pattern, sentence) => {
    expect(exclusionSentence(pattern)).toBe(sentence);
  });

  it("falls back to the notation for a pattern it does not know, never to a guess", () => {
    expect(exclusionSentence("Mon.Drums")).toBe("Nunca Mon.Drums");
  });
});

describe("week exclusions", () => {
  it.each([
    ["*.*", "Semana 3 libre"],
    ["Sun.*", "Semana 3: sin domingo"],
    ["Sun.BGV", "Semana 3: sin BGV en domingo"],
    ["*.Lead", "Semana 3: sin líder"],
    ["*.LeadBGV", "Semana 3: sin líder ni BGV"],
    ["Sat.LeadBGV", "Semana 3: sin líder ni BGV en sábado"],
  ])("week 3 %s → %s", (pattern, sentence) => {
    expect(weekSentence({ id: "w", week: 3, pattern })).toBe(sentence);
  });
});

describe("counts (caps)", () => {
  it("names the subject the way the forms' pickers do", () => {
    expect(capSubject("Sun.Lead")).toBe("Líder en domingo");
    expect(capSubject("Sun.*")).toBe("Domingos");
    expect(capSubject("Sat.*")).toBe("Sábados");
    expect(capSubject("*.*")).toBe("Servicios");
    expect(capSubject("*.LeadBGV")).toBe("Líder o BGV (sábado o domingo)");
  });

  it("reads the mock's sentences", () => {
    expect(capSentence(cap({ pattern: "Sun.Lead", op: "==", value: 2 }))).toBe("Líder en domingo: exactamente 2 al mes");
    expect(capSentence(cap({ pattern: "Sun.*", op: ">=", value: 2 }))).toBe("Domingos: al menos 2 al mes");
    expect(capSentence(cap({ pattern: "Sun.BGV", op: "<=", value: 1 }))).toBe("BGV en domingo: como máximo 1 al mes");
  });

  it("a relative cap names the month's Sunday count it resolves against", () => {
    expect(capSentence(cap({ pattern: "Sun.BGV", op: "<=", relative: true, relOffset: 2 }))).toBe(
      "BGV en domingo: como máximo los domingos del mes menos 2",
    );
    expect(capSentence(cap({ pattern: "Sun.BGV", op: "<=", relative: true, relOffset: 0 }))).toBe(
      "BGV en domingo: como máximo tantos como domingos tiene el mes",
    );
  });

  it("the operator words are the ones the form's picker shows", () => {
    expect(CAP_OP_WORD).toEqual({ "==": "exactamente", ">=": "al menos", "<=": "como máximo" });
  });
});

describe("restrictionChips", () => {
  const r: PersonRestriction = {
    id: "r", person: "Gaby",
    excludedPatterns: ["Sat.*", "Sun.Choir"],
    weekExclusions: [{ id: "w1", week: 2, pattern: "*.*" }],
    caps: [cap({ id: "c1", pattern: "Sun.*", op: ">=", value: 2 })],
    fairness: "slack", fairnessSlack: 2,
    sundayCadence: "alternate",
  };

  it("one chip per clause, in the card's order, each carrying the notation it replaced", () => {
    expect(restrictionChips(r)).toEqual([
      { key: "x:0:Sat.*", tone: "no", text: "Nunca en sábado", notation: "!Sat.*" },
      { key: "x:1:Sun.Choir", tone: "no", text: "No coro en domingo", notation: "!Sun.Choir" },
      { key: "w:w1", tone: "no", text: "Semana 2 libre", notation: "sem.2 *.*" },
      { key: "c:c1", tone: "num", text: "Domingos: al menos 2 al mes", notation: capLabel(r.caps[0]) },
      { key: "f:slack", tone: "stale", text: "Holgura 2", notation: "fairness_slack 2", note: SLACK_STALE_NOTE },
      { key: "cadence", tone: "cad", text: CADENCE_SENTENCE, notation: "sundayCadence: alternate" },
    ]);
  });

  it("«Exenta» is a quiet chip; a slack of 0 says it has no effect (`localFill` and `restrictionToDs` ignore it)", () => {
    expect(restrictionChips({ ...r, fairness: "exempt" }).find((c) => c.key === "f:exempt")).toEqual(
      { key: "f:exempt", tone: "cad", text: EXEMPT_SENTENCE, notation: "fairness_exempt" },
    );
    expect(restrictionChips({ ...r, fairnessSlack: 0 }).find((c) => c.key === "f:slack")?.note).toBe(SLACK_ZERO_NOTE);
  });

  it("a repeated exclusion (a hand-edited document) still gets a distinct key", () => {
    const keys = restrictionChips({ ...r, excludedPatterns: ["Sat.*", "Sat.*"] }).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a card with no clause has no chip", () => {
    expect(restrictionChips({ id: "e", person: "Ana", excludedPatterns: [], weekExclusions: [], caps: [], fairness: "none", fairnessSlack: 1 })).toEqual([]);
  });
});

describe("conflicts", () => {
  const c = (pattern: string) => ({ id: "k", personA: "Lucía", personB: "Niza", pattern });

  it.each([
    ["*.LeadBGV", "Lucía y Niza no coinciden como Lead ni BGV en ningún servicio"],
    ["*.Lead", "Lucía y Niza no coinciden como Lead en ningún servicio"],
    ["Sun.Lead", "Lucía y Niza no coinciden como Lead en domingo"],
    ["Sun.BGV", "Lucía y Niza no coinciden como BGV en domingo"],
    ["Sun.*", "Lucía y Niza no coinciden en domingo"],
    ["*.*", "Lucía y Niza no coinciden en ningún servicio"],
  ])("%s → %s", (pattern, sentence) => {
    expect(sentenceText(conflictSentence(c(pattern)))).toBe(sentence);
  });

  it("dims only the connective words", () => {
    expect(conflictSentence(c("*.LeadBGV"))).toEqual([
      { text: "Lucía y Niza" }, { text: "no coinciden como", dim: true }, { text: "Lead ni BGV" }, { text: "en ningún servicio", dim: true },
    ]);
  });

  it("the notation is `conflictCardLabel`'s shape", () => {
    expect(conflictNotation(c("*.Lead"))).toBe("Lucía ≠ Niza en *.Lead");
  });
});

describe("presence", () => {
  const p = (pattern: string, persons = ["Hugo", "Jakey"]) => ({ id: "p", persons, pattern });

  it.each([
    ["Sun.BGV", "Hugo o Jakey en BGV de domingo cada semana"],
    ["Sat.Lead", "Hugo o Jakey en Lead de sábado cada semana"],
    ["Sun.*", "Hugo o Jakey en domingo cada semana"],
    ["*.*", "Hugo o Jakey en sábado o domingo cada semana"],
    ["*.Lead", "Hugo o Jakey en Lead (sábado o domingo) cada semana"],
  ])("%s → %s", (pattern, sentence) => {
    expect(sentenceText(presenceSentence(p(pattern)))).toBe(sentence);
  });

  it("three or more people read «A, B o C»", () => {
    expect(sentenceText(presenceSentence(p("Sun.BGV", ["Mkz", "Ana", "Beto"])))).toBe("Mkz, Ana o Beto en BGV de domingo cada semana");
  });

  it("the notation is `presenceCardLabel`'s shape", () => {
    expect(presenceNotation(p("Sun.BGV"))).toBe("Hugo, Jakey en Sun.BGV c/sem");
  });
});

describe("the forms' pattern labels", () => {
  it("picker labels", () => {
    expect(["Sun.*", "Sat.*", "*.*", "Sun.Lead", "Sat.BGV", "Sun.Choir", "*.Lead", "*.LeadBGV"].map(patternLabel)).toEqual([
      "Domingo (todo)", "Sábado (todo)", "Ambos servicios", "Líder en domingo", "BGV en sábado", "Coro en domingo", "Líder (ambos)", "Líder o BGV (ambos)",
    ]);
  });

  it("pill labels", () => {
    expect(["Sat.*", "Sun.*", "*.*", "Sun.BGV", "Sat.Lead", "*.BGV", "*.LeadBGV"].map(patternPill)).toEqual([
      "Sábado", "Domingo", "Ambos", "BGV dom", "Líder sáb", "BGV", "Líder o BGV",
    ]);
  });
});
