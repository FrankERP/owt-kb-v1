// Slice R (ADR-0084): the two rule tools over fakes of the rules writer (`solverConfigCommit.ts`, whose own
// half is `solverConfigCommit.test.ts`). Proved here: the check writes nothing and answers a token only when
// something would change; the save writes only what was checked (its token over the FRESH rev, edits and
// lines), refuses a stale or forged token and an expired one, maps the writer's refusals, answers an unknown
// outcome when the writer throws, and never names a member id, a rule id or the rules revision (KH-1).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: {}, rawIntegrityClient: {} }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { RuleEdit } from "@/app/utils/ruleEdits";
import type { RuleEditsPlan, SaveRuleEditsOutcome } from "@/app/utils/solverConfigCommit";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import { CHECK_RULE_EDITS_INPUT, SAVE_RULE_EDITS_INPUT, checkRuleEditsResult, cleanRuleEdits, saveRuleEditsResult, type RuleToolDeps } from "../rules";
import { RULE_TOKEN_TTL_S, ruleItemIds } from "../../rules/ruleTokens";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const KEY = new TextEncoder().encode("k".repeat(48));
const NOW = 1_800_000_000;
const REV = "rules-rev-1";
const LINES = ["Nueva regla: «Gaby: Nunca líder domingo»"];
const EDITS: RuleEdit[] = [{ op: "never", person: "Gaby", pattern: { day: "domingo", seat: "líder" } }];
const SECRETS = [REV, "m-gaby", "m-admin", "r-0-0"];

type FakeDeps = { [K in keyof RuleToolDeps]: Mock<RuleToolDeps[K]> };

const planOk = (over: Partial<Extract<RuleEditsPlan, { ok: true }>> = {}): RuleEditsPlan => ({
  ok: true,
  rev: REV,
  lines: LINES,
  noops: [],
  notes: [],
  existing: [],
  fields: {},
  ...over,
});

/** A writer whose fresh read is `{rev, lines}`; it asks `verify` exactly as the real one does. */
function deps(world: { rev?: string; lines?: string[] } = {}, over: Partial<FakeDeps> = {}): FakeDeps & { written: Mock } {
  const written = vi.fn();
  const rev = world.rev ?? REV;
  const lines = world.lines ?? LINES;
  return {
    written,
    check: vi.fn<RuleToolDeps["check"]>(async () => planOk({ rev, lines })),
    save: vi.fn<RuleToolDeps["save"]>(async (_edits, _ids, opts): Promise<SaveRuleEditsOutcome> => {
      if (!lines.length) return { ok: true, unchanged: true, lines: [] };
      const refused = opts.verify(rev, lines);
      if (refused) return { ok: false, status: 409, code: "not_the_checked", message: refused };
      written(opts.actorId);
      return { ok: true, unchanged: false, lines };
    }),
    tokenKey: vi.fn<RuleToolDeps["tokenKey"]>(() => ({ ok: true, key: KEY })),
    nowS: vi.fn<RuleToolDeps["nowS"]>(() => NOW),
    ...over,
  };
}

async function checkedToken(d: FakeDeps, edits = EDITS): Promise<string> {
  const out = await checkRuleEditsResult({ edits }, d);
  expect(out.isError).toBeFalsy();
  return String(sc(out).token);
}

let consoleLines: string[];
beforeEach(() => {
  consoleLines = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleLines.push(a.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

function expectClean(...outs: CallToolResult[]) {
  for (const s of [...outs.flatMap((o) => [textOf(o), JSON.stringify(o.structuredContent ?? {})]), ...consoleLines]) {
    for (const secret of SECRETS) expect(s, `«${secret}» leaked`).not.toContain(secret);
  }
}

describe("wire", () => {
  it("is strict: an unknown op, field or pattern word is refused", () => {
    expect(CHECK_RULE_EDITS_INPUT.safeParse({ edits: EDITS }).success).toBe(true);
    expect(CHECK_RULE_EDITS_INPUT.safeParse({ edits: [{ ...EDITS[0], extra: 1 }] }).success).toBe(false);
    expect(CHECK_RULE_EDITS_INPUT.safeParse({ edits: [{ op: "delete", person: "Gaby" }] }).success).toBe(false);
    expect(CHECK_RULE_EDITS_INPUT.safeParse({ edits: [{ op: "never", person: "Gaby", pattern: { day: "lunes", seat: "todo" } }] }).success).toBe(false);
    expect(CHECK_RULE_EDITS_INPUT.safeParse({ edits: [] }).success).toBe(false);
    expect(SAVE_RULE_EDITS_INPUT.safeParse({ edits: EDITS }).success).toBe(false);
  });

  it("cleans names (NFC, whitespace) so the token binds what the server reads", () => {
    const decomposed = "Gaby  Sotó ".normalize("NFD");
    const [e] = cleanRuleEdits([{ op: "balance", person: decomposed, exempt: true }]);
    expect(e).toEqual({ op: "balance", person: "Gaby Sotó", exempt: true });
    const [p] = cleanRuleEdits([{ op: "pool", pool: "soporte", add: [" Pau "] }]);
    expect(p).toEqual({ op: "pool", pool: "soporte", add: ["Pau"] });
  });
});

describe("check_rule_edits", () => {
  it("answers the lines, the notes and a token, and writes nothing", async () => {
    const d = deps();
    const out = await checkRuleEditsResult({ edits: EDITS }, d);
    expect(out.isError).toBeFalsy();
    expect(textOf(out)).toContain(LINES[0]!);
    expect(textOf(out)).toContain("Los meses ya guardados no cambian");
    expect(String(sc(out).token)).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(d.save).not.toHaveBeenCalled();
    expectClean(out);
  });

  it("builds the new items' ids from the key and the edits (the same ones the save builds)", async () => {
    const d = deps();
    await checkRuleEditsResult({ edits: EDITS }, d);
    const idsFor = d.check.mock.calls[0]![1];
    expect(idsFor(REV)("r", 0, 0)).toBe(ruleItemIds(KEY, EDITS)(REV)("r", 0, 0));
    expect(idsFor(REV)("r", 0, 0)).toMatch(/^r-[0-9a-f]{12}$/);
  });

  it("answers «no cambiaría nada» and no token when the lines are empty", async () => {
    const d = deps({ lines: [] });
    d.check.mockResolvedValue(planOk({ lines: [], noops: ["Gaby ya tiene «Nunca líder domingo»."] }));
    const out = await checkRuleEditsResult({ edits: EDITS }, d);
    expect(textOf(out)).toContain("Con estos cambios no cambiaría nada.");
    expect(textOf(out)).toContain("Gaby ya tiene");
    expect(sc(out).token).toBeUndefined();
  });

  it("shows existing problems as notes, never as a refusal", async () => {
    const d = deps();
    d.check.mockResolvedValue(planOk({ existing: ["Pau tiene dos «exactamente»."] }));
    const out = await checkRuleEditsResult({ edits: EDITS }, d);
    expect(out.isError).toBeFalsy();
    expect(textOf(out)).toContain("Las reglas ya tienen este problema (no lo causa este cambio): Pau tiene dos «exactamente».");
  });

  it("maps the writer's refusals to their codes", async () => {
    const d = deps();
    d.check.mockResolvedValue({ ok: false, status: 422, code: "lossy", message: "m" });
    const out = await checkRuleEditsResult({ edits: EDITS }, d);
    expect(out.isError).toBe(true);
    expect(sc(out)).toMatchObject({ code: "integrity_conflict" });
  });

  it("refuses without the secret, and calls nothing", async () => {
    const d = deps({}, { tokenKey: vi.fn(() => ({ ok: false as const })) as FakeDeps["tokenKey"] });
    const out = await checkRuleEditsResult({ edits: EDITS }, d);
    expect(out.isError).toBe(true);
    expect(d.check).not.toHaveBeenCalled();
  });
});

describe("save_rule_edits", () => {
  it("saves with the check's token, as the caller", async () => {
    const d = deps();
    const token = await checkedToken(d);
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(out.isError).toBeFalsy();
    expect(sc(out)).toMatchObject({ saved: true });
    expect(textOf(out)).toContain("Guardado en las reglas:");
    expect(textOf(out)).toContain("Nadie recibe aviso.");
    expect(d.written).toHaveBeenCalledWith(PRINCIPAL.sub);
    expectClean(out);
  });

  it("refuses when the rules moved since the check (another rev)", async () => {
    const token = await checkedToken(deps());
    const d = deps({ rev: "rules-rev-2" });
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("vuelve a revisarlos con check_rule_edits");
    expect(textOf(out)).toContain("No se escribió nada.");
    expect(d.written).not.toHaveBeenCalled();
  });

  it("refuses when the fresh lines differ (the team changed what the edit means)", async () => {
    const token = await checkedToken(deps());
    const d = deps({ lines: ["Nueva regla: «Gaby: Nunca BGV domingo»"] });
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(d.written).not.toHaveBeenCalled();
  });

  it("refuses other edits under a checked token", async () => {
    const d = deps();
    const token = await checkedToken(d);
    const other: RuleEdit[] = [{ op: "never", person: "Gaby", pattern: { day: "ambos", seat: "todo" } }];
    const out = await saveRuleEditsResult({ edits: other, token }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(d.written).not.toHaveBeenCalled();
  });

  it("refuses a forged or malformed token", async () => {
    for (const token of ["", "abc", `${NOW}.${"A".repeat(43)}`, `${NOW}.x.y`]) {
      const d = deps();
      const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
      expect(out.isError).toBe(true);
      expect(d.written).not.toHaveBeenCalled();
    }
  });

  it("refuses an expired token, and one from the future", async () => {
    const token = await checkedToken(deps());
    const late = deps({}, { nowS: vi.fn(() => NOW + RULE_TOKEN_TTL_S + 1) });
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, late);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("más de 30 minutos");
    expect(late.written).not.toHaveBeenCalled();
    const early = deps({}, { nowS: vi.fn(() => NOW - 61) });
    expect((await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, early)).isError).toBe(true);
    expect(early.written).not.toHaveBeenCalled();
  });

  it("answers «ya estaba» when nothing would change any more", async () => {
    const token = await checkedToken(deps());
    const d = deps({ lines: [] });
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(out.isError).toBeFalsy();
    expect(sc(out)).toMatchObject({ saved: false });
    expect(textOf(out)).toContain("Ya estaba así");
  });

  it("maps a lost race to stale_revision", async () => {
    const d = deps();
    const token = await checkedToken(d);
    d.save.mockResolvedValue({ ok: false, status: 409, code: "changed", message: "Las reglas cambiaron desde la revisión." });
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ code: "stale_revision" });
  });

  it("answers an UNKNOWN outcome, never «no se escribió nada», when the writer throws", async () => {
    const d = deps();
    const token = await checkedToken(d);
    d.save.mockRejectedValue(new Error(`boom ${REV} m-gaby`));
    const out = await saveRuleEditsResult({ edits: EDITS, token }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("No sé si se guardó");
    expect(textOf(out)).not.toContain("No se escribió nada");
    expectClean(out);
  });

  it("refuses with no principal, and calls nothing", async () => {
    const d = deps();
    const out = await saveRuleEditsResult({ edits: EDITS, token: "x" }, null, d);
    expect(out.isError).toBe(true);
    expect(sc(out)).toMatchObject({ code: "forbidden" });
    expect(d.save).not.toHaveBeenCalled();
  });
});
