// Guard: every reader that turns canonical roles into setlist targets must pick
// the specials through the ONE predicate, `specialRolesWithEmbeddedSetlist`.
//
// The two hand-written filters it replaced (the integrity route and the publish
// bundle) tested `songs !== undefined`, and GROQ projects an absent `songs` as
// `null` — so every special without songs read as an invalid setlist, showed
// «Setlist con datos inválidos» and hard-blocked «Publicar listos»
// (2026-09-22, the camp sets). A third copy of that filter would bring it back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const READERS = [
  "app/api/admin/service-integrity/setlists/route.ts",
  "app/utils/publishReadyBundle.ts",
];

describe("special setlist targets go through one predicate", () => {
  it.each(READERS)("%s uses specialRolesWithEmbeddedSetlist and no hand-rolled songs check", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toContain("specialRolesWithEmbeddedSetlist(");
    expect(src).not.toMatch(/songs\s*!==?\s*undefined/);
  });
});
