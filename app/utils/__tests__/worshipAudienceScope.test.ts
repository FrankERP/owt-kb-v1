/**
 * A Kids-only member must never be a worship notification recipient.
 *
 * `setlistRecipientIds` reads an unset `notifPrefs.setlist` as `"all"` — the
 * spec default, and correct for the worship team. Combined with an audience
 * query of `*[_type == "teamMembers"]`, that meant every Kids volunteer seeded
 * into the dataset was a recipient of "Ya están las canciones de este servicio".
 * Zero exposure while the native apps are unshipped, which is exactly why it
 * needed fixing before they ship rather than after.
 *
 * These tests EVALUATE the real filter against a dataset with groq-js rather
 * than asserting on the query string, because the failure this guards against —
 * a filter written against the wrong default — is invisible to a string match.
 * A bare `"worship" in ministries` would pass any `toContain` assertion while
 * silencing all 35 members who predate the Kids feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, parse } from "groq-js";
import { WORSHIP_AUDIENCE_GROQ_FILTER, WORSHIP_MEMBER_GROQ_FILTER } from "@/app/ministries";
import { setlistRecipientIds } from "@/app/utils/notifyTargets";

const DATASET = [
  // Every member who predates Oasis Kids: no `ministries` field at all.
  { _id: "legacy", _type: "teamMembers", member_name: "Legacy Singer", notifPrefs: {} },
  { _id: "worship", _type: "teamMembers", member_name: "Worship", ministries: ["worship"], notifPrefs: {} },
  { _id: "kids", _type: "teamMembers", member_name: "Kids Only", ministries: ["kids"], notifPrefs: {} },
  { _id: "dual", _type: "teamMembers", member_name: "Both", ministries: ["worship", "kids"], notifPrefs: {} },
  // A malformed value nobody should be able to write, but the guard should not
  // hand the benefit of the doubt to.
  { _id: "empty", _type: "teamMembers", member_name: "Emptied", ministries: [], notifPrefs: {} },
];

async function idsMatching(filter: string, params: Record<string, unknown> = {}) {
  const tree = parse(`*[_type == "teamMembers" && ${filter}]._id`);
  const value = await evaluate(tree, { dataset: DATASET, params });
  return ((await value.get()) as string[]).sort();
}

describe("worship notification audience", () => {
  it("excludes a kids-only member", async () => {
    const ids = await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER);
    expect(ids).not.toContain("kids");
  });

  it("KEEPS every legacy member, whose ministries field does not exist", async () => {
    // The assertion that catches a filter written against the wrong default.
    // Getting this wrong silences the entire existing worship team.
    const ids = await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER);
    expect(ids).toContain("legacy");
    expect(ids).toContain("empty");
  });

  it("keeps a dual-ministry member — they serve worship too", async () => {
    const ids = await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER);
    expect(ids).toContain("dual");
  });

  it("matches exactly the worship side of the roster", async () => {
    expect(await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER)).toEqual(
      ["dual", "empty", "legacy", "worship"],
    );
  });

  it("has NO super-admin bypass — seeing someone is not a reason to notify them", async () => {
    // WORSHIP_MEMBER_GROQ_FILTER's `$all` arm exists for admin LISTS. If an
    // audience ever bound it true, the whole Kids roster gets worship pushes.
    const audience = await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER);
    const adminList = await idsMatching(WORSHIP_MEMBER_GROQ_FILTER, { all: true });
    expect(adminList).toContain("kids");
    expect(audience).not.toContain("kids");
    // Bound false, the two agree — one rule, two call shapes.
    expect(await idsMatching(WORSHIP_MEMBER_GROQ_FILTER, { all: false })).toEqual(audience);
  });

  it("the setlist audience query actually APPLIES the filter", () => {
    // The tests above prove the filter is correct; this proves it is used.
    // Without it they all still pass while the leak is wide open, because the
    // defect lives at the call site rather than in the constant. `notifySetlistSaved`
    // is the ONLY worship audience not already narrowed to ids or an admin role.
    const src = readFileSync(
      join(process.cwd(), "app/utils/serviceMutationSideEffects.ts"),
      "utf8",
    );
    const audience = src.match(/\*\[_type == "teamMembers"[^\]]*\]\{ _id, "setlist"/);
    expect(audience, "the setlist audience query moved or was renamed").not.toBeNull();
    expect(
      audience![0],
      "notifySetlistSaved fetches every member again — a kids-only volunteer is a recipient",
    ).toContain("WORSHIP_AUDIENCE_GROQ_FILTER");
  });

  it("end to end: the kids member is not a setlist recipient", async () => {
    // The audience query feeds setlistRecipientIds, whose unset-means-all
    // default is what made this reachable.
    const ids = await idsMatching(WORSHIP_AUDIENCE_GROQ_FILTER);
    const members = DATASET.filter((m) => ids.includes(m._id)).map((m) => ({
      _id: m._id,
      setlist: undefined,
    }));
    const recipients = setlistRecipientIds(members, []);
    expect(recipients).not.toContain("kids");
    expect(recipients).toContain("legacy");
    expect(recipients).toContain("dual");
  });
});
