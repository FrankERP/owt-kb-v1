// The cross-check's own mutation test (plan T2.6): the FINDER fed a wrong or empty spine while the
// gate's is right. The gate then forces a week exclusion the finder cannot see, and the replay must
// refuse (`judge_disagreement`) instead of storing a seat no waiver would ever cover. File-scoped
// mock: only `ruleFindings` is wrapped, `ruleRefusals` (the gate's) is the real one.
import { describe, expect, it, vi } from "vitest";

const finder = vi.hoisted(() => ({ spine: null as string[] | null }));
vi.mock("@/app/components/admin/ruleEnforcement", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/components/admin/ruleEnforcement")>();
  return {
    ...real,
    ruleFindings: (input: Parameters<typeof real.ruleFindings>[0]) =>
      real.ruleFindings(finder.spine === null ? input : { ...input, sundayDates: finder.spine }),
  };
});

import { REPLAY_SENTENCES, replayEdits, type EditorEdit } from "../revise";
import { DRAFTS, MEMBERS, RULES, board } from "./editorFixtures";

const FORCED: EditorEdit[] = [
  { op: "place", service: "jul-trail", row: "lead", member: "m-carla", force: true },
  { op: "place", service: "dec2", row: "lead", member: "m-bruno", force: true },
];

describe("the cross-check catches a finder that disagrees with the gate", () => {
  it("with the finder's spine right, both forced week exclusions are stored", () => {
    finder.spine = null;
    for (const edit of FORCED) expect(replayEdits({ board: board(DRAFTS), edits: [edit], members: MEMBERS, config: RULES }).ok).toBe(true);
  });

  for (const [name, spine] of [["empty", []], ["another month's", ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]]] as const) {
    it(`with the finder's spine ${name}, each forced week exclusion is refused, nothing stored`, () => {
      finder.spine = [...spine];
      try {
        for (const edit of FORCED) {
          const out = replayEdits({ board: board(DRAFTS), edits: [edit], members: MEMBERS, config: RULES });
          expect(out.ok, JSON.stringify(edit)).toBe(false);
          if (!out.ok) {
            expect(out.refusal).toMatchObject({ index: 0, code: "judge_disagreement", sentence: REPLAY_SENTENCES.judge_disagreement });
            expect(out.verdicts).toEqual([]);
          }
        }
      } finally {
        finder.spine = null;
      }
    });
  }
});
