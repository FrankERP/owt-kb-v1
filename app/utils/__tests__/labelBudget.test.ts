// Spec §18 (decision N): one eyebrow per surface. Pins the six named labels at
// their audited counts and ratchets DOWN; a phase that removes one lowers its
// number in the same commit. Equality, so the pin cannot go stale.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUDGET: Record<string, number> = {
  ">Cue<": 0,                 // removed in M0b-1 (CueDialog)
  ">Servicio<": 1,            // DayCard header — goes in R1
  "Índice musical": 0,        // SongSearchList — removed in R1
  "títulos": 0,               // home library count — removed in R1
  "Repertorio": 0,            // /biblioteca eyebrow — DayCardDisclosure (R6/R7)
  "Backstage operations": 1,  // /admin eyebrow — goes in R5
  "Acceso autorizado": 1,     // /admin pill — goes in R5
};

function tsx(): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name); if (rel.includes("__tests__")) continue;
    if (e.isDirectory()) walk(rel); else if (rel.endsWith(".tsx")) out.push(rel); } };
  walk("app"); return out;
}

describe("label budget", () => {
  const files = tsx().map((f) => readFileSync(path.join(REPO_ROOT, f), "utf8"));
  it.each(Object.entries(BUDGET))("%s appears exactly %i times", (needle, n) => {
    const count = files.reduce((acc, src) => acc + src.split(needle).length - 1, 0);
    expect(count).toBe(n);
  });
});
