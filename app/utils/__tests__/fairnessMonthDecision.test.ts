// Solver v3 C2 IF2-21 — the write decision, table-driven over every row of WR-8 (actor
// route) and WR-14 (actor reconstruction, write and delete). Row order is part of the
// contract: an identical replay is `unchanged` before the past-month, revision and
// services checks (spec §9 «No-op first»), and a non-intact record is never `unchanged`.
import { describe, expect, it } from "vitest";

import { decideFairnessMonth, type StoredRecordFacts } from "../fairnessMonthWriteRequest";

const HASH = "sha256:aaa";
const OTHER = "sha256:bbb";
const rec = (patch: Partial<StoredRecordFacts> = {}): StoredRecordFacts => ({
  rev: "rev-1",
  source: "auto",
  contentHash: HASH,
  intact: true,
  ...patch,
});

type Input = Parameters<typeof decideFairnessMonth>[0];
const base: Input = {
  actor: "route",
  op: "write",
  month: "2026-11",
  currentMonth: "2026-11",
  expectedRev: null,
  bodyHash: HASH,
  stored: null,
  hasFreezingServices: false,
};

describe("decideFairnessMonth — actor route (WR-8)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["row 1: identical intact content is unchanged, even past and frozen", { month: "2026-10", stored: rec(), expectedRev: "rev-0", hasFreezingServices: true }, "unchanged"],
    ["row 1 never: a non-intact record with the same stored hash falls through", { stored: rec({ intact: false }), expectedRev: "rev-1" }, "replace"],
    ["row 2: a past month", { month: "2026-10", stored: null }, { refused: "past_month" }],
    ["row 3: no record, expectedRev null → create", {}, "create"],
    ["row 3 (A27): no record, freezing services present → still create", { hasFreezingServices: true }, "create"],
    ["row 4: no record, expectedRev set → record_missing", { expectedRev: "rev-1" }, { refused: "record_missing" }],
    ["row 5: a record exists, expectedRev null", { stored: rec(), bodyHash: OTHER }, { refused: "record_exists" }],
    ["row 6: a different revision", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["row 7 (A5): the month has freezing services", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-1", hasFreezingServices: true }, { refused: "month_has_services" }],
    ["row 8 (A6): otherwise replace", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
    ["a future month replaces the same way", { month: "2026-12", stored: rec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...base, ...patch })).toEqual(expected);
  });

  it("refuses to decide a delete for the route — the route offers none (WR-13)", () => {
    expect(() => decideFairnessMonth({ ...base, op: "delete" })).toThrow(/never deletes/);
  });
});

const recon: Input = { ...base, actor: "reconstruction", month: "2026-09", currentMonth: "2026-11" };
const reconRec = (patch: Partial<StoredRecordFacts> = {}) => rec({ source: "reconstructed", ...patch });

describe("decideFairnessMonth — actor reconstruction, write (WR-14 rows 1–8)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["row 1 (A4): the current month is not past", { month: "2026-11" }, { refused: "not_past_month" }],
    ["row 1: a future month", { month: "2026-12", stored: reconRec() }, { refused: "not_past_month" }],
    ["row 2: identical intact content", { stored: reconRec(), expectedRev: null }, "unchanged"],
    ["row 3: no record, expectedRev null", {}, "create"],
    ["row 4: no record, expectedRev set", { expectedRev: "rev-1" }, { refused: "record_missing" }],
    ["row 5: a record the route wrote", { stored: rec({ source: "manual" }), bodyHash: OTHER, expectedRev: "rev-1" }, { refused: "not_reconstruction_owned" }],
    ["row 6: a reconstructed record edited since", { stored: reconRec({ intact: false }), bodyHash: OTHER, expectedRev: "rev-1" }, { refused: "record_edited" }],
    ["row 7: a different revision", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["row 7: expectedRev null on an existing record", { stored: reconRec(), bodyHash: OTHER, expectedRev: null }, { refused: "stale_revision" }],
    ["row 8: otherwise replace", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
    ["no freezing-services rule applies to this actor", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-1", hasFreezingServices: true }, "replace"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...recon, ...patch })).toEqual(expected);
  });
});

const del: Input = { ...recon, op: "delete", bodyHash: null, expectedRev: "rev-1" };

describe("decideFairnessMonth — actor reconstruction, delete (WR-14 D1–D4)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["D1: no record", {}, { refused: "record_missing" }],
    ["D2: not reconstruction-owned", { stored: rec({ source: "auto" }) }, { refused: "not_reconstruction_owned" }],
    ["D3: edited after reconstruction", { stored: reconRec({ intact: false }) }, { refused: "record_edited" }],
    ["D4: a different revision", { stored: reconRec(), expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["otherwise delete", { stored: reconRec() }, "delete"],
    ["a delete has no past-month rule", { stored: reconRec(), month: "2026-12" }, "delete"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...del, ...patch })).toEqual(expected);
  });
});
