// The colours of the Jóvenes groups (ADR-0087). The classes are literals Tailwind reads as text,
// so nothing but this file notices a group added to the registry without a row in
// `jovenesGroupStyle.ts` — it would render in the neutral «unknown» tone, silently.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MINISTRIES } from "@/app/ministries";
import {
  MINISTRY_TONE,
  UNKNOWN_TONE,
  audienceBadges,
  audienceRail,
  audienceTone,
  groupMonogram,
  groupTone,
} from "../jovenesGroupStyle";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const GROUPS = MINISTRIES.jovenes.groups;

describe("groupTone", () => {
  it("gives every registered group its own tone, spelled with its own token", () => {
    for (const g of GROUPS) {
      const tone = groupTone(g.id);
      expect(tone, `${g.id} has no row in GROUP_TONE`).not.toBe(UNKNOWN_TONE);
      for (const cls of Object.values(tone)) expect(cls).toContain(`group-${g.id}`);
    }
    expect(new Set(GROUPS.map((g) => groupTone(g.id).solid)).size).toBe(GROUPS.length);
  });

  it("has a token for each group in both themes and in Tailwind", () => {
    const css = read("app/brand.css");
    const light = css.slice(css.indexOf("\n.light {"));
    const tw = read("tailwind.config.ts");
    for (const g of GROUPS) {
      expect(css.match(new RegExp(`--group-${g.id}-rgb:`, "g"))?.length, `${g.id} in brand.css`).toBe(2);
      expect(light).toContain(`--group-${g.id}-rgb:`);
      expect(tw).toContain(`"group-${g.id}": "rgb(var(--group-${g.id}-rgb) / <alpha-value>)"`);
    }
  });

  it("is neutral for an id the registry does not know, an inherited key included", () => {
    expect(groupTone("retirado")).toBe(UNKNOWN_TONE);
    expect(groupTone("constructor")).toBe(UNKNOWN_TONE);
    expect(groupTone("__proto__")).toBe(UNKNOWN_TONE);
  });
});

describe("groupMonogram", () => {
  it("is the initials of a two-word name, else the first two letters", () => {
    expect(groupMonogram("Otro Nivel")).toBe("ON");
    expect(groupMonogram("Guerreras")).toBe("GU");
    expect(groupMonogram("  adrenalin ")).toBe("AD");
    expect(groupMonogram("")).toBe("?");
  });

  it("tells the registered groups apart without colour", () => {
    const monograms = GROUPS.map((g) => groupMonogram(g.name));
    expect(new Set(monograms).size).toBe(GROUPS.length);
  });
});

describe("audienceBadges", () => {
  it("is the one «Todo Jóvenes» in the accent for the whole ministry", () => {
    expect(audienceBadges({ kind: "ministry" })).toEqual([{ key: "ministry", label: "Todo Jóvenes", monogram: null, tone: MINISTRY_TONE }]);
    expect(audienceTone({ kind: "ministry" })).toBe(MINISTRY_TONE);
  });

  it("is one badge per group, in the stored order, a repeated id once", () => {
    const [a, b] = GROUPS;
    const badges = audienceBadges({ kind: "groups", groups: [b.id, a.id, b.id] });
    expect(badges.map((x) => x.key)).toEqual([b.id, a.id]);
    expect(badges[0]).toEqual({ key: b.id, label: b.name, monogram: groupMonogram(b.name), tone: groupTone(b.id) });
    expect(audienceTone({ kind: "groups", groups: [b.id, a.id] })).toBe(groupTone(b.id));
    expect(audienceRail({ kind: "groups", groups: [b.id, a.id] })).toEqual([groupTone(b.id).solid, groupTone(a.id).solid]);
  });

  it("shows an unknown id as itself, neutral, and never throws on a missing audience", () => {
    expect(audienceBadges({ kind: "groups", groups: ["retirado"] })).toEqual([
      { key: "retirado", label: "retirado", monogram: "RE", tone: UNKNOWN_TONE },
    ]);
    expect(audienceBadges(null)).toEqual([{ key: "none", label: "Sin audiencia", monogram: null, tone: UNKNOWN_TONE }]);
    expect(audienceBadges({ kind: "groups", groups: [] })).toEqual([{ key: "none", label: "Sin grupos", monogram: null, tone: UNKNOWN_TONE }]);
  });
});
