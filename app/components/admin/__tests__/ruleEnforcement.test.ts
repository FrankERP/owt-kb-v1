// app/components/admin/__tests__/ruleEnforcement.test.ts
//
// The rules, in isolation. Every fixture here is PRODUCTION-SHAPED in the one
// respect that decides whether this feature works at all: **`alias` is never
// equal to `member_name`.** Rules name people by alias ("Frank", "Lucía"); the
// grid identifies them by id and the solver by `member_name`. A fixture where
// the two happened to coincide would pass against a resolver that matches
// nothing — which is exactly the bug (E11, fact 12) that would otherwise have
// shipped the whole feature doing nothing, silently, with a green suite.
//
// The calendar is MARCH 2026 on purpose: 5 Sundays, and the month begins on a
// Sunday, so the Saturdays and the weekday special sit where a naive
// `Math.ceil(day / 7)` week number DISAGREES with the real Sunday spine.
import { describe, expect, it } from "vitest";

import { instrumentSeatDef, VOICE_SEATS } from "../seatModel";
import { rankCandidates, type AssignedSeat, type RankMember } from "../candidateRanking";
import { resolveToMemberName, type GridColumn, type SolverConfig } from "../plannerModel";
import { evaluate, parsePattern, patternMatches, unresolvedRuleNames } from "../ruleEnforcement";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

const LEAD = VOICE_SEATS[0];
const BGV = VOICE_SEATS[1];
const CORO = VOICE_SEATS[2];
const BASS = instrumentSeatDef("Bass");

// ─── Members: alias ≠ member_name for every single one ───────────────────────

const m = (
  id: string,
  member_name: string,
  alias: string,
  memberType: string[] = ["voz"],
  unavailableDates: string[] = [],
): RankMember => ({ _id: id, member_name, alias, memberType, unavailableDates });

const MEMBERS: RankMember[] = [
  m("frank", "Francisco Rocha Ramírez", "Frank", ["voz", "instrumento"]),
  m("mkz", "Marcos Zamudio Ley", "Mkz", ["voz", "instrumento"]),
  m("gaby", "Gabriela Solís Herrera", "Gaby"),
  m("lucia", "María Lucía Estrada", "Lucía"),
  m("niza", "Nizarindani Cruz Ávila", "Niza"),
  m("hugo", "Hugo Alberto Peña", "Hugo"),
  m("jakey", "Jaqueline Ortega Mena", "Jakey"),
  m("liu", "Liliana Uribe Cano", "Liu"),
  m("marianne", "Mariana Del Valle Ruiz", "Marianne"),
];

const member = (id: string): RankMember => {
  const found = MEMBERS.find((x) => x._id === id);
  if (!found) throw new Error(`no fixture member ${id}`);
  return found;
};

// ─── The month spine ─────────────────────────────────────────────────────────

/** March 2026 begins on a Sunday and holds five of them. */
const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];

const sun = (date: string): GridColumn => ({ date, type: "sunday_role" });
const sat = (date: string): GridColumn => ({ date, type: "saturday_role" });
const special = (date: string, name = "Vigilia"): GridColumn => ({
  date,
  type: "special_role",
  serviceName: name,
});

const SUN_W2 = sun("2026-03-08");
const SUN_W3 = sun("2026-03-15");
/** Week 3's Saturday. `Math.ceil(14 / 7)` = 2, the real week is 3. */
const SAT_W3 = sat("2026-03-14");
/** A Wednesday. `Math.ceil(18 / 7)` = 3, and a special has NO week at all. */
const SPECIAL_WED = special("2026-03-18");

// ─── Rules, mirroring MonthGenerator.tsx's DEFAULT_SOLVER_CONFIG ─────────────

const emptyConfig: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
};

const restriction = (over: Partial<SolverConfig["restrictions"][number]>) => ({
  id: "r",
  person: "",
  excludedPatterns: [],
  fairness: "none" as const,
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...over,
});

/** The six seeded restrictions and five seeded conflicts (`MonthGenerator.tsx:124-166`). */
const SEEDED: SolverConfig = {
  ...emptyConfig,
  restrictions: [
    restriction({ id: "d-frank", person: "Frank", excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"], fairness: "exempt" }),
    restriction({ id: "d-mkz", person: "Mkz", excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"], fairness: "exempt" }),
    restriction({ id: "d-gaby", person: "Gaby", excludedPatterns: ["Sat.*", "Sun.Choir"], fairness: "slack" }),
    restriction({ id: "d-lucia-week", person: "Lucía", weekExclusions: [{ id: "w", week: 3, pattern: "*.*" }] }),
    restriction({ id: "d-liu-week", person: "Liu", weekExclusions: [{ id: "w", week: 3, pattern: "*.*" }] }),
    restriction({ id: "d-marianne-week", person: "Marianne", weekExclusions: [{ id: "w", week: 1, pattern: "*.*" }] }),
  ],
  conflicts: [
    { id: "d-lucia-niza", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" },
    { id: "d-hugo-lucia", personA: "Hugo", personB: "Lucía", pattern: "*.Lead" },
    { id: "d-niza-hugo", personA: "Niza", personB: "Hugo", pattern: "*.Lead" },
    { id: "d-jakey-hugo-bgv", personA: "Jakey", personB: "Hugo", pattern: "*.BGV" },
    { id: "d-jakey-hugo-lead", personA: "Jakey", personB: "Hugo", pattern: "*.Lead" },
  ],
  presence: [{ id: "d-hugo-jakey", persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" }],
};

const seat = (seatId: string, memberId: string): AssignedSeat => ({
  seatId,
  category: seatId.startsWith("instrumento") ? "instrumento" : "voz",
  memberId,
});

const check = (over: {
  member: RankMember;
  row?: { id: string };
  column?: GridColumn;
  sundayDates?: string[];
  assigned?: AssignedSeat[];
  config?: SolverConfig;
}) =>
  evaluate({
    member: over.member,
    row: over.row ?? LEAD,
    column: over.column,
    sundayDates: over.sundayDates ?? SUNDAYS,
    assigned: over.assigned ?? [],
    members: MEMBERS,
    config: over.config ?? SEEDED,
  });

// ─── The fixture's own precondition ──────────────────────────────────────────

describe("the fixture", () => {
  it("gives every member an alias DIFFERENT from their member_name — a fixture where they matched would prove nothing", () => {
    for (const mm of MEMBERS) {
      expect(mm.alias).toBeTruthy();
      expect(mm.alias).not.toBe(mm.member_name);
    }
    // And every seeded rule names people by the alias, never by member_name.
    const named = [
      ...SEEDED.restrictions.map((r) => r.person),
      ...SEEDED.conflicts.flatMap((c) => [c.personA, c.personB]),
    ];
    for (const n of named) {
      expect(MEMBERS.some((mm) => mm.alias === n)).toBe(true);
      expect(MEMBERS.some((mm) => mm.member_name === n)).toBe(false);
    }
  });
});

// ─── E11: resolve-or-report ──────────────────────────────────────────────────

describe("resolveToMemberName", () => {
  it("resolves an ALIAS to the canonical member_name — the whole feature hangs on this", () => {
    expect(resolveToMemberName("Frank", MEMBERS)).toEqual({ resolved: "Francisco Rocha Ramírez" });
    expect(resolveToMemberName("Lucía", MEMBERS)).toEqual({ resolved: "María Lucía Estrada" });
  });

  it("resolves a member_name too, and is case/whitespace insensitive", () => {
    expect(resolveToMemberName("  maría lucía estrada ", MEMBERS)).toEqual({
      resolved: "María Lucía Estrada",
    });
  });

  it("REPORTS a miss instead of echoing the input back as if it had matched", () => {
    expect(resolveToMemberName("Fantasma", MEMBERS)).toEqual({ unresolved: "Fantasma" });
  });
});

describe("unresolvedRuleNames", () => {
  it("reports a name matching nobody, from any rule kind, deduplicated and as written", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      restrictions: [restriction({ person: "Fantasma" })],
      conflicts: [{ id: "c", personA: "Frank", personB: "Fantasma" , pattern: "*.Lead" }],
      presence: [{ id: "p", persons: ["Otro Ausente"], pattern: "Sun.BGV" }],
    };
    expect(unresolvedRuleNames(config, MEMBERS)).toEqual(["Fantasma", "Otro Ausente"]);
  });

  it("reports nothing for the seeded config against this member list", () => {
    expect(unresolvedRuleNames(SEEDED, MEMBERS)).toEqual([]);
  });

  it("would report EVERY seeded name if the resolver only knew member_name (the shipped-doing-nothing bug)", () => {
    const aliasless = MEMBERS.map(({ alias: _alias, ...rest }) => rest);
    expect(unresolvedRuleNames(SEEDED, aliasless).length).toBeGreaterThan(0);
  });

  it("returns [] with no config, and ignores a blank person", () => {
    expect(unresolvedRuleNames(undefined, MEMBERS)).toEqual([]);
    expect(unresolvedRuleNames({ ...emptyConfig, restrictions: [restriction({ person: "  " })] }, MEMBERS)).toEqual([]);
  });
});

// ─── Patterns ────────────────────────────────────────────────────────────────

describe("patterns", () => {
  it("maps the role half onto grid row ids, LeadBGV covering two (E16)", () => {
    expect(parsePattern("*.Lead")).toEqual({ service: "*", rows: ["lead"] });
    expect(parsePattern("Sun.Choir")).toEqual({ service: "Sun", rows: ["coro"] });
    expect(parsePattern("*.LeadBGV")).toEqual({ service: "*", rows: ["lead", "bgv"] });
    expect(parsePattern("*.*")?.rows).toEqual(["lead", "bgv", "coro"]);
    expect(parsePattern("Lead.*")).toEqual({ service: "*", rows: ["lead"] }); // solver's legacy alias
    expect(parsePattern("nonsense")).toBeNull();
  });

  it("`*.*` reaches VOICE rows only — never an instrument or FOH row", () => {
    expect(patternMatches("*.*", SUN_W3, LEAD)).toBe(true);
    expect(patternMatches("*.*", SUN_W3, CORO)).toBe(true);
    expect(patternMatches("*.*", SUN_W3, BASS)).toBe(false);
  });

  it("matches the service half against the column type, and a special answers ONLY to `*` (E15)", () => {
    expect(patternMatches("Sat.*", SAT_W3, LEAD)).toBe(true);
    expect(patternMatches("Sat.*", SUN_W3, LEAD)).toBe(false);
    expect(patternMatches("Sat.*", SPECIAL_WED, LEAD)).toBe(false);
    expect(patternMatches("*.Lead", SPECIAL_WED, LEAD)).toBe(true);
  });

  it("matches nothing without a column — the service half is half the pattern", () => {
    expect(patternMatches("*.*", undefined, LEAD)).toBe(false);
  });
});

// ─── E14: pairwise conflicts, the user's actual requirement ──────────────────

describe("conflicts", () => {
  it("a `*`-scoped conflict FIRES on a special — nothing else enforces rules there", () => {
    // Niza is seated in Lead of the special; Lucía is offered BGV. `*.LeadBGV`
    // binds both rows of the same column.
    const v = check({
      member: member("lucia"),
      row: BGV,
      column: SPECIAL_WED,
      assigned: [seat("lead", "niza")],
    });
    expect(v.blocked).toBe(true);
    expect(v.blocked && v.reason).toContain("Niza");
  });

  it("is symmetric — the rule names Lucía first, and Niza is refused just the same", () => {
    const v = check({
      member: member("niza"),
      row: LEAD,
      column: SPECIAL_WED,
      assigned: [seat("bgv", "lucia")],
    });
    expect(v.blocked).toBe(true);
    expect(v.blocked && v.reason).toContain("Lucía");
  });

  it("scopes by the PATTERN, not by the column: `*.Lead` binds the Lead row alone", () => {
    // Hugo/Lucía is `*.Lead`. Hugo in Lead, Lucía offered Lead → refused.
    expect(
      check({ member: member("lucia"), row: LEAD, column: SPECIAL_WED, assigned: [seat("lead", "hugo")] }).blocked,
    ).toBe(true);
    // Same pair, Lucía offered BGV → allowed; only `*.LeadBGV`/`*.*` cross rows.
    // Niza is deliberately absent from `assigned` here so the LeadBGV rule
    // cannot be what produces the answer.
    expect(
      check({ member: member("lucia"), row: BGV, column: SPECIAL_WED, assigned: [seat("lead", "hugo")] }).blocked,
    ).toBe(false);
  });

  it("does not fire when the other person is not seated on this column", () => {
    expect(check({ member: member("lucia"), row: BGV, column: SPECIAL_WED, assigned: [] }).blocked).toBe(false);
  });

  it("fires on Sunday and Saturday columns too — `*.` covers every service", () => {
    expect(
      check({ member: member("jakey"), row: BGV, column: SUN_W2, assigned: [seat("bgv", "hugo")] }).blocked,
    ).toBe(true);
    expect(
      check({ member: member("jakey"), row: LEAD, column: SAT_W3, assigned: [seat("lead", "hugo")] }).blocked,
    ).toBe(true);
  });

  it("never binds an instrument row, even for `*.*`", () => {
    const config: SolverConfig = {
      ...emptyConfig,
      conflicts: [{ id: "c", personA: "Frank", personB: "Mkz", pattern: "*.*" }],
    };
    const v = check({
      member: member("frank"),
      row: BASS,
      column: SPECIAL_WED,
      assigned: [seat("instrumento:Bass", "mkz")],
      config,
    });
    expect(v.blocked).toBe(false);
  });
});

// ─── E15: person exclusions ──────────────────────────────────────────────────

describe("person exclusions", () => {
  it("a `Sat.*` exclusion does NOT fire on a special (E15) — the service half must match", () => {
    expect(check({ member: member("frank"), row: LEAD, column: SPECIAL_WED }).blocked).toBe(false);
  });

  it("...but that same `Sat.*` exclusion DOES fire on a Saturday column", () => {
    const v = check({ member: member("frank"), row: LEAD, column: SAT_W3 });
    expect(v.blocked).toBe(true);
    expect(v.blocked && v.reason).toContain("Sat.*");
  });

  it("scopes the role half too: Frank is excluded from Sun.BGV but not from Sun.Lead", () => {
    expect(check({ member: member("frank"), row: BGV, column: SUN_W3 }).blocked).toBe(true);
    expect(check({ member: member("frank"), row: LEAD, column: SUN_W3 }).blocked).toBe(false);
  });

  it("no SEEDED exclusion fires on a special — the stated consequence of E15", () => {
    for (const mm of MEMBERS) {
      for (const row of [LEAD, BGV, CORO]) {
        const config: SolverConfig = { ...SEEDED, conflicts: [] }; // exclusions only
        expect(check({ member: mm, row, column: SPECIAL_WED, config }).blocked).toBe(false);
      }
    }
  });
});

// ─── E7/E21: week exclusions ─────────────────────────────────────────────────

describe("week exclusions", () => {
  it("does NOT fire on a special, even one whose day-of-month LOOKS like the excluded week", () => {
    // 2026-03-18: `Math.ceil(18 / 7)` = 3, and Lucía is excluded from week 3.
    // A special has no week at all (E7), so this must not fire.
    expect(check({ member: member("lucia"), row: LEAD, column: SPECIAL_WED }).blocked).toBe(false);
  });

  it("DOES fire on the third Sunday of a 5-Sunday month, and not on the second", () => {
    const w3 = check({ member: member("lucia"), row: LEAD, column: SUN_W3 });
    expect(w3.blocked).toBe(true);
    expect(w3.blocked && w3.reason).toContain("semana 3");
    expect(check({ member: member("lucia"), row: LEAD, column: SUN_W2 }).blocked).toBe(false);
  });

  it("DOES fire on week 3's SATURDAY, where `Math.ceil(day / 7)` says 2", () => {
    // 2026-03-14 is the Saturday adjacent to 2026-03-15, the third Sunday.
    // A day-of-month week number gets this wrong; the Sunday spine gets it right.
    expect(check({ member: member("lucia"), row: LEAD, column: SAT_W3 }).blocked).toBe(true);
    // And week 2's Saturday (the 7th, `ceil` = 1, real week 2) must stay clear
    // for Lucía and blocked for nobody but a week-2 rule.
    expect(check({ member: member("lucia"), row: LEAD, column: sat("2026-03-07") }).blocked).toBe(false);
  });

  it("uses the SPINE's numbering: Marianne's week-1 rule lands on the first Sunday", () => {
    expect(check({ member: member("marianne"), row: BGV, column: sun("2026-03-01") }).blocked).toBe(true);
    expect(check({ member: member("marianne"), row: BGV, column: SUN_W3 }).blocked).toBe(false);
  });

  it("is not evaluated at all without a Sunday spine — conflicts and exclusions still are", () => {
    expect(
      evaluate({
        member: member("lucia"),
        row: LEAD,
        column: SUN_W3,
        assigned: [],
        members: MEMBERS,
        config: SEEDED,
      }).blocked,
    ).toBe(false);
    // Same call, same missing spine, but a conflict is still enforced.
    expect(
      evaluate({
        member: member("lucia"),
        row: LEAD,
        column: SUN_W3,
        assigned: [seat("lead", "hugo")],
        members: MEMBERS,
        config: SEEDED,
      }).blocked,
    ).toBe(true);
  });

  it("`*.*` week exclusions never touch instrument or FOH rows on the weekend grid", () => {
    expect(check({ member: member("lucia"), row: BASS, column: SUN_W3 }).blocked).toBe(false);
  });
});

// ─── E6/P9: the self-exemption ───────────────────────────────────────────────

describe("the occupant of the cell being edited", () => {
  it("is NEVER blocked, so a violating pair the solver produced can still be un-seated", () => {
    // Niza in Lead and Lucía in BGV of the same column violates `*.LeadBGV`.
    const assigned = [seat("lead", "niza"), seat("bgv", "lucia")];
    // Lucía, offered the BGV cell she already occupies: allowed, so the picker's
    // `!blocked` guards on onClick/onKeyDown let the admin toggle her off.
    expect(check({ member: member("lucia"), row: BGV, column: SPECIAL_WED, assigned }).blocked).toBe(false);
    // The same Lucía offered a DIFFERENT cell is still refused — the exemption
    // is per-cell, not a general amnesty.
    expect(check({ member: member("lucia"), row: LEAD, column: SPECIAL_WED, assigned }).blocked).toBe(true);
  });

  it("exempts even a person their own week exclusion bars", () => {
    expect(
      check({ member: member("lucia"), row: LEAD, column: SUN_W3, assigned: [seat("lead", "lucia")] }).blocked,
    ).toBe(false);
  });
});

// ─── No config ───────────────────────────────────────────────────────────────

describe("no rules", () => {
  it("blocks nothing when no config is supplied", () => {
    expect(
      evaluate({
        member: member("frank"),
        row: LEAD,
        column: SAT_W3,
        sundayDates: SUNDAYS,
        assigned: [],
        members: MEMBERS,
      }).blocked,
    ).toBe(false);
  });
});

// ─── The rankCandidates boundary ─────────────────────────────────────────────

const role = (over: Partial<ParticipantRole> = {}): ParticipantRole => ({
  _type: "sunday_role",
  date: "2026-03-01",
  leads: [],
  bgvs: [],
  chorus: [],
  instruments: [],
  foh: [],
  ...over,
});

describe("rankCandidates with rules", () => {
  const base = {
    seat: BGV,
    date: SPECIAL_WED.date,
    members: MEMBERS,
    windowRoles: [] as ParticipantRole[],
    assigned: [seat("lead", "niza")],
  };

  it("reports the rule refusal in `ruleBlockedReason`, a field DISTINCT from `blockedReason`", () => {
    const lucia = rankCandidates({ ...base, column: SPECIAL_WED, sundayDates: SUNDAYS, config: SEEDED })
      .find((c) => c.id === "lucia");
    expect(lucia?.ruleBlockedReason).toContain("Niza");
    // The double-duty block is a different refusal and stays untouched.
    expect(lucia?.blockedReason).toBeNull();
    expect(lucia?.eligible).toBe(false);
  });

  it("leaves both fields clean for everyone the rules do not name", () => {
    const gaby = rankCandidates({ ...base, column: SPECIAL_WED, sundayDates: SUNDAYS, config: SEEDED })
      .find((c) => c.id === "gaby");
    expect(gaby?.ruleBlockedReason).toBeNull();
    expect(gaby?.eligible).toBe(true);
  });

  it("changes NOTHING without a config — SeatBoard's shipped behaviour is untouched", () => {
    const lucia = rankCandidates(base).find((c) => c.id === "lucia");
    expect(lucia?.ruleBlockedReason).toBeNull();
    expect(lucia?.eligible).toBe(true);
  });

  it("does NOT move a rule-blocked candidate in the sort (P7b) — it is refused, not buried", () => {
    const windowRoles = [
      // Gaby has served; Lucía has not, so Lucía sorts first on load.
      role({ bgvs: [{ _id: "gaby", member_name: "Gabriela Solís Herrera" }] }),
    ];
    const ranked = rankCandidates({
      ...base,
      windowRoles,
      column: SPECIAL_WED,
      sundayDates: SUNDAYS,
      config: SEEDED,
    });
    const lucia = ranked.findIndex((c) => c.id === "lucia");
    const gaby = ranked.findIndex((c) => c.id === "gaby");
    expect(ranked[lucia].ruleBlockedReason).not.toBeNull();
    expect(lucia).toBeLessThan(gaby);
  });

  it("`eligible` also folds in availability, which `blockedReason` never does (P8)", () => {
    const away: RankMember[] = MEMBERS.map((mm) =>
      mm._id === "gaby" ? { ...mm, unavailableDates: [SPECIAL_WED.date] } : mm,
    );
    const gaby = rankCandidates({ ...base, members: away, column: SPECIAL_WED, config: SEEDED })
      .find((c) => c.id === "gaby");
    expect(gaby?.available).toBe(false);
    expect(gaby?.blockedReason).toBeNull();
    expect(gaby?.ruleBlockedReason).toBeNull();
    expect(gaby?.eligible).toBe(false);
  });
});
