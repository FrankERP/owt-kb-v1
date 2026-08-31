import { describe, expect, it } from "vitest";
import {
  computeRates,
  declaredFloorMinutes,
  declaredPerHour,
  extractCron,
  intervals,
  parseArgs,
  validateSince,
} from "../lib/cronDelivery.mjs";

const at = (iso: string) => new Date(iso).getTime();

describe("parseArgs", () => {
  it("accepts every known flag together", () => {
    const r = parseArgs(["--limit", "60", "--since", "2026-08-30T07:01:04Z", "--workflow", "W", "--repo", "o/r"]);
    expect(r.ok).toBe(true);
    expect(r.opts).toMatchObject({ limit: 60, since: "2026-08-30T07:01:04Z", workflow: "W", repo: "o/r" });
  });

  // THE THREE FORMS THAT USED TO PARSE AS "NO BOUND AT ALL". Each silently
  // produced an unbounded window that averaged two cadences into one rate and
  // read as an improvement — the bias this tool exists to avoid.
  it.each([
    ["equals form", ["--since=2026-08-30"]],
    ["single dash", ["-since", "2026-08-30"]],
    ["bare positional", ["2026-08-30"]],
    ["misspelled flag", ["--sinc", "2026-08-30"]],
  ] as Array<[string, string[]]>)("rejects %s rather than ignoring it", (_label, argv) => {
    const r = parseArgs(argv);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("rejects a flag whose value is missing or is another flag", () => {
    expect(parseArgs(["--since"]).ok).toBe(false);
    expect(parseArgs(["--workflow", "--repo"]).ok).toBe(false);
  });

  it("rejects a --limit that cannot bound anything", () => {
    expect(parseArgs(["--limit", "x"]).ok).toBe(false);
    expect(parseArgs(["--limit", "1"]).ok).toBe(false);
    expect(parseArgs(["--limit", "2"]).ok).toBe(true);
  });
});

describe("validateSince", () => {
  it("accepts a date, and a timestamp carrying an explicit zone", () => {
    expect(validateSince("2026-08-30")).toBeNull();
    expect(validateSince("2026-08-30T07:01:04Z")).toBeNull();
    expect(validateSince("2026-08-30T01:01:04-06:00")).toBeNull();
  });

  // JS reads an offset-less timestamp as LOCAL; GitHub's `created:` filter reads
  // it as UTC. Six hours apart here, which shortened one window by 30% and moved
  // the rate 43% toward the hypothesis.
  it("rejects a time with no timezone, because JS and GitHub disagree about it", () => {
    expect(validateSince("2026-08-30T07:01:04")).toMatch(/timezone/);
  });

  it("rejects something that is not a date at all", () => {
    expect(validateSince("yesterday")).toMatch(/not a date/);
  });
});

describe("computeRates", () => {
  const runs = [
    at("2026-08-30T12:46:37Z"), at("2026-08-30T16:59:03Z"), at("2026-08-30T19:44:17Z"),
    at("2026-08-30T22:06:58Z"), at("2026-08-31T00:30:23Z"),
  ];

  // `n/T` overstates by n/(n-1) when both endpoints are events — 25% at n=5.
  // The recorded baseline was computed this way, so the comparison has to be too.
  it("uses n-1 intervals for the steady rate, not n", () => {
    const r = computeRates(runs)!;
    expect(r.steadyH).toBeCloseTo(11.73, 1);
    expect(r.steadyRate).toBeCloseTo(4 / 11.73, 3);
    expect(r.steadyRate).toBeLessThan(runs.length / r.steadyH);
  });

  // Anchoring to the first delivered run deletes the dead period after a cadence
  // change. Both numbers are honest; they answer different questions.
  it("reports the elapsed rate separately, and how much of it is transient", () => {
    const r = computeRates(runs, { since: at("2026-08-30T07:01:04Z"), now: at("2026-08-31T02:51:56Z") })!;
    expect(r.elapsedH).toBeCloseTo(19.85, 1);
    expect(r.elapsedRate).toBeCloseTo(5 / 19.85, 3);
    expect(r.elapsedRate).toBeLessThan(r.steadyRate!);
    // 5.76 h of lead-in plus 2.36 h trailing over a 19.85 h window.
    expect(r.transientShare).toBeGreaterThan(0.4);
  });

  it("returns null rather than a divide-by-zero for a single run", () => {
    expect(computeRates([runs[0]])).toBeNull();
  });
});

describe("declaredPerHour / declaredFloorMinutes", () => {
  const cases: Array<[string, number, number | null]> = [
    ["*/5 * * * *", 12, 5],
    ["7,22,37,52 * * * *", 4, 15],
    ["* * * * *", 60, null],
  ];
  it.each(cases)("reads %s as %i runs/hour", (expr, perHour, floor) => {
    expect(declaredPerHour(expr)).toBe(perHour);
    if (floor !== null) expect(declaredFloorMinutes(expr)).toBe(floor);
  });

  // Four runs an hour does NOT imply 15-minute spacing, so a cadence gate keyed
  // on runs/hour would print a false "unreachable" note here.
  it("distinguishes four-per-hour clustered from four-per-hour spaced", () => {
    expect(declaredPerHour("0,1,2,3 * * * *")).toBe(4);
    expect(declaredFloorMinutes("0,1,2,3 * * * *")).toBe(1);
    expect(declaredFloorMinutes("7,22,37,52 * * * *")).toBe(15);
  });

  it("gives up cleanly on a form it does not understand", () => {
    expect(declaredPerHour("H/5 * * * *")).toBeNull();
  });
});

describe("extractCron", () => {
  // The workflow header quotes BOTH the old and new expressions in comments, so
  // a substring match would judge the schedule against a commented-out one.
  it("finds the key, never a comment quoting one", () => {
    const yml = [
      '#     The schedule was `- cron: "*/5 * * * *"` before the experiment.',
      "on:",
      "  schedule:",
      '    - cron: "7,22,37,52 * * * *"',
    ].join("\n");
    expect(extractCron(yml)).toBe("7,22,37,52 * * * *");
  });

  it("returns null when there is no schedule at all", () => {
    expect(extractCron("on:\n  workflow_dispatch:\n")).toBeNull();
  });
});

describe("intervals", () => {
  it("returns n-1 gaps in ascending minutes", () => {
    const r = intervals([at("2026-08-30T00:00:00Z"), at("2026-08-30T02:00:00Z"), at("2026-08-30T02:30:00Z")]);
    expect(r).toEqual([30, 120]);
  });
});
