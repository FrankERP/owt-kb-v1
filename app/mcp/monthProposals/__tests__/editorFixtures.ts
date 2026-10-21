// Shared by the proposal editor's pure suites — NOT a test file (no `.test.` in the name).
// Fictitious people only (the repository is public). Boards are built from hand-written drafts so
// each case states its own dates: a trailing Saturday, a second month's Sunday, a special.
import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { ANA, BRUNO, CARLA, DANI, config, restriction } from "@/app/components/admin/__tests__/v3Fixtures";
import { proposalBoard, type EditorBoard } from "../editorBoard";
import type { EditorMember } from "../revise";
import type { ProposalDraft } from "../proposalDocument";

/** A kids-only member whose Tipo would fit a worship seat (I5). */
export const KIRA = { _id: "m-kira", member_name: "Kira Luna", alias: "Kira", memberType: ["voz", "sunday_lead"], ministries: ["kids"] };
/** Plays bass only: no Tipo «voz», so any voice seat is C3. */
export const TOMAS = { _id: "m-tomas", member_name: "Tomás Gil", alias: "Tomás", memberType: ["instrumento"], instruments: ["Bass"] };
export const MEMBERS: EditorMember[] = [ANA, BRUNO, CARLA, DANI, KIRA, TOMAS] as EditorMember[];

export const POOLS = { sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"] };

export function rules(extra: Partial<SolverConfig> = {}): SolverConfig {
  return config({ ...POOLS, ...extra });
}

/** Ana may not lead on Sundays; Carla is out of week 5's Saturday Lead; Bruno out of week 2. */
export const RULES = rules({
  restrictions: [
    restriction("x-ana", "Ana", { excludedPatterns: ["Sun.Lead"] }),
    restriction("x-carla", "Carla", { weekExclusions: [{ id: "w5", week: 5, pattern: "Sat.Lead" }] }),
    restriction("x-bruno", "Bruno", { weekExclusions: [{ id: "w2", week: 2, pattern: "Sun.*" }] }),
  ],
  conflicts: [{ id: "c-ana-dani", personA: "Ana", personB: "Dani", pattern: "*.*" }],
});

type Seats = { leads?: string[]; bgvs?: string[]; chorus?: string[] };

export function draft(localId: string, type: ProposalDraft["draft"]["_type"], date: string, seats: Seats = {}, atSolve: ProposalDraft["atSolve"] = "creatable"): ProposalDraft {
  return {
    draft: {
      localId,
      creationRequestId: `req-${localId}`,
      _type: type,
      date,
      ...(type === "special_role" ? { service_name: "Noche de alabanza" } : {}),
      exists: false,
      isExisting: false,
      skipped: false,
      countsForFairness: true,
      leads: seats.leads ?? [],
      bgvs: seats.bgvs ?? [],
      chorus: seats.chorus ?? [],
      instruments: [],
      foh: [],
    },
    atSolve,
    reasons: [],
  };
}

export function board(drafts: ProposalDraft[]): EditorBoard {
  const b = proposalBoard(drafts);
  if (!b) throw new Error("drafts do not make a board");
  return b;
}

/**
 * November–December 2026 (two months) plus July 2027's trailing Saturday. `sun1` (Nov 1) has Ana
 * on Lead; `sat-done` is a date apply will not create (R10).
 */
export const DRAFTS: ProposalDraft[] = [
  draft("sun1", "sunday_role", "2026-11-01", { leads: ["m-ana"] }),
  draft("sat2", "saturday_role", "2026-11-07"),
  draft("sun2", "sunday_role", "2026-11-08"),
  draft("sat-done", "saturday_role", "2026-11-14", {}, "exists"),
  draft("dec2", "sunday_role", "2026-12-13"),
  draft("dec3", "sunday_role", "2026-12-20"),
  draft("jul-trail", "saturday_role", "2027-07-31"),
  draft("jul-sat1", "saturday_role", "2027-07-03"),
  draft("special", "special_role", "2026-11-18"),
];
