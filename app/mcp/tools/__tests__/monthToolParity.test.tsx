// MCP P4 step 7, D3 — parity between «Generar mes» under v3 and `solve_month` + `apply_schedule`.
//
// ONE fixture dataset, evaluated with groq-js (the engine Sanity runs; the precedent is
// `adminMemberVisibility.test.ts`). The connector reads it through its REAL reads
// (`loadV3PlanSources`: the roles GET's GROQ, the members GET's, the rules document and the P1
// snapshot). The browser gets what ServicesPanel would hand MonthGenerator from the same
// dataset: the roles and members rows of the same GROQ, the rules through `sourceFromGet`, and
// ServicesPanel's own preflight and stored read over the same summaries. Both surfaces see the
// same ledger answer and the same recorded v3 answer (`echoV3`, a function of the request).
//
// Demanded: the solve body is byte-identical (the browser's minted seed and request id are
// handed to the connector), the fairness PUT body is identical, and the create bodies are
// identical modulo the minted `creationRequestId`s, compared by position. Plus the proposal
// content the roadmap's acceptance names: a target that is not creatable is left out of the
// request, reported with its reasons, and never posted.
//
// The file runs in the NODE environment with a DOM it installs itself (below): the connector's
// modules are `import "server-only"`, a package that only Next provides, and the jsdom
// environment's import analysis cannot resolve it even under `vi.mock` (the node environment
// can). Nothing else differs.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teardownDom = await vi.hoisted(async () => {
  const { builtinEnvironments } = await import("vitest/environments");
  const env = await builtinEnvironments.jsdom.setup(globalThis, { jsdom: { url: "http://localhost/" } });
  return env.teardown;
});

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

const h = vi.hoisted(() => ({ dataset: [] as Record<string, unknown>[] }));

vi.mock("@/sanity/lib/operationalClient", async () => {
  const { evaluate, parse } = await import("groq-js");
  const fetch = async (query: string, params: Record<string, unknown> = {}) =>
    (await evaluate(parse(query), { dataset: h.dataset, params })).get();
  return { operationalClient: { fetch }, rawIntegrityClient: { fetch } };
});

import { evaluate, parse } from "groq-js";
import { echoV3, renderV3, routeFetch, solveRoute } from "@/app/components/admin/__tests__/v3PlannerHarness";
import { ledgerResponse, record, ALL_IN } from "@/app/components/admin/__tests__/v3Fixtures";
import { monthTargetPreflight, type MemberOption, type ServiceRole, type ServiceType } from "@/app/components/admin/serviceCardModel";
import { integrityQueueFor } from "@/app/components/admin/monthPreflight";
import type { V3SolveRequest } from "@/app/components/admin/v3Wire";
import type { FairnessLedgerResponse, FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { adminMembersQuery, adminRolesQuery } from "@/app/utils/serviceReadQueries";
import { SOLVER_CONFIG_DOC_ID, solverConfigFromDocument } from "@/app/utils/solverConfigWriteRequest";
import { planV3Month } from "@/app/utils/v3MonthPlan";
import { buildClaimedLock } from "@/app/utils/roleTargetLock";
import { loadV3PlanSources, type V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { applyScheduleResult, type ApplyScheduleDeps } from "../applySchedule";
import { solveMonthResult, type SolveMonthArgs } from "../solveMonth";
import { parseProposal, type NewProposalDocument } from "../../monthProposals/proposalDocument";
import { HANDLE, PRINCIPAL, textOf } from "./monthToolFixtures";

const NOW = new Date("2026-10-15T18:00:00.000Z");
const TODAY = "2026-10-15";

const member = (id: string, name: string, alias: string, memberType: string[]) => ({
  _id: id, _rev: `rev-${id}`, _type: "teamMembers", member_name: name, alias, memberType, role: "member", email: `${id}@example.com`, ministries: ["worship"],
});
const MEMBER_DOCS = [
  member("m-ana", "Ana Ruiz", "Ana", ["voz", "sunday_lead"]),
  member("m-bruno", "Bruno Díaz", "Bruno", ["voz", "sunday_lead"]),
  member("m-carla", "Carla Soto", "Carla", ["voz", "saturday_lead"]),
  member("m-dani", "Dani Vega", "Dani", ["voz", "support"]),
];
const RULES_DOC = {
  _id: SOLVER_CONFIG_DOC_ID, _type: "solverConfig", _rev: "rules-rev-1",
  sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"], restrictions: [], conflicts: [], presence: [],
};

async function groq<T>(q: { query: string; params: Record<string, unknown> }): Promise<T> {
  return (await (await evaluate(parse(q.query), { dataset: h.dataset, params: q.params })).get()) as T;
}

interface Case {
  /** Extra documents beside the members and the rules. */
  docs?: Record<string, unknown>[];
  ledger?: (months: string[]) => FairnessLedgerResponse;
  args: SolveMonthArgs;
  /** Drives the browser to the same selection as `args`. */
  drive?: (container: HTMLElement) => void;
}

const twoMonths = () => fireEvent.click(within(screen.getByRole("radiogroup", { name: "Planear" })).getByRole("radio", { name: "2 meses" }));
const toggleDay = (container: HTMLElement, date: string) => fireEvent.click(container.querySelector(`[data-date="${date}"]`)!);
function addSpecial(container: HTMLElement, date: string, name: string, counted: boolean) {
  toggleDay(container, date);
  fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: name } });
  if (counted) fireEvent.click(screen.getByRole("switch", { name: "Cuenta para equidad" }));
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
}

interface Surface {
  solve: V3SolveRequest;
  put: FairnessMonthsPut;
  creates: Record<string, unknown>[];
}

// «unchanged» is in every state's expected outcomes (`freezeConfirmEntries`), so one answer serves
// every case on both surfaces.
const outcomes = (body: FairnessMonthsPut) => ({
  months: body.months.map((m) => ({ month: m.month, outcome: "unchanged", rev: "new", contentHash: "sha256:x", recordedAt: "t" })),
});

async function runBrowser(c: Case, roles: ServiceRole[], members: MemberOption[], sources: V3PlanSources): Promise<Surface> {
  const ledger = c.ledger ?? ((m: string[]) => ledgerResponse(m));
  const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
  const puts: FairnessMonthsPut[] = [];
  const posts: Record<string, unknown>[] = [];
  routeFetch(
    (url) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined),
    (url) => {
      if (!url.startsWith("/api/admin/fairness?")) return undefined;
      const q = new URLSearchParams(url.split("?")[1]);
      const first = q.get("month")!;
      const months = q.get("horizon") === "2" ? [first, nextMonth(first)] : [first];
      return { status: 200, body: ledger(months) };
    },
    solve.route,
    (url, init) => {
      if (url !== "/api/admin/fairness/months" || init?.method !== "PUT") return undefined;
      const body = JSON.parse(String(init.body)) as FairnessMonthsPut;
      puts.push(body);
      return { status: 200, body: outcomes(body) };
    },
    (url, init) => {
      if (url !== "/api/admin/roles" || init?.method !== "POST") return undefined;
      posts.push(JSON.parse(String(init.body)));
      return { status: 201, body: {} };
    },
  );

  // ServicesPanel's own wiring over the same summaries (`ServicesPanel.tsx`: `queue`,
  // `preflightTarget`, `storedSource`).
  const readiness = sources.snapshot.readiness;
  const summaries = { roles: readiness.roleSummary, setlists: readiness.setlistSummary, proposals: readiness.proposalSummary };
  const queue = integrityQueueFor({ sources: readiness.sources, roles, summaries });
  const preflight = (type: ServiceType, date: string) => monthTargetPreflight({ sources: readiness.sources, summaries, queue, type, date });
  const storedSource = {
    roles, integrity: summaries.roles, rolesStatus: "ready" as const, integrityStatus: "ready" as const,
    rolesGeneration: 1, integrityGeneration: 1, reload: vi.fn(async () => true),
  };

  const { container } = renderV3({
    roles, members: members as never, config: solverConfigFromDocument(RULES_DOC), preflight, storedSource,
    initialMonth: c.args.month,
  });
  c.drive?.(container);
  fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(solve.requests).toHaveLength(1));
  await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
  const create = screen.getByRole("button", { name: /^Crear \d+ borrador/ });
  const n = Number(/Crear (\d+)/.exec(create.textContent ?? "")![1]);
  await act(async () => { fireEvent.click(create); });
  await waitFor(() => expect(posts).toHaveLength(n));
  expect(puts).toHaveLength(1);
  return { solve: solve.requests[0], put: puts[0], creates: posts };
}

async function runConnector(c: Case, identity: { seed: number; requestId: string }): Promise<Surface & { doc: NewProposalDocument; text: string }> {
  const ledger = c.ledger ?? ((m: string[]) => ledgerResponse(m));
  const solves: V3SolveRequest[] = [];
  const stored: NewProposalDocument[] = [];
  const out = await solveMonthResult(c.args, PRINCIPAL, {
    engine: () => "v3",
    plan: planV3Month,
    reads: loadV3PlanSources,
    readLedger: async (months) => ledger([...months]),
    solve: async (request) => {
      solves.push(request);
      return { status: 200, text: JSON.stringify(echoV3(request)) };
    },
    identity: () => identity,
    todayIso: () => TODAY,
    nowMs: () => NOW.getTime(),
    newHandle: () => HANDLE,
    createProposal: async (doc) => { stored.push(doc); return { ok: true }; },
    sweepExpired: async () => ({ ok: true, deleted: 0 }),
  });
  const text = textOf(out);
  if (!stored[0]) throw new Error(`solve_month stored nothing: ${text}`);
  const proposal = parseProposal({ ...stored[0], _rev: "r1" })!;

  const puts: FairnessMonthsPut[] = [];
  const creates: Record<string, unknown>[] = [];
  let n = 0;
  const deps: ApplyScheduleDeps = {
    engine: () => "v3",
    loadProposal: async () => ({ ok: true, proposal }),
    reads: loadV3PlanSources,
    commitRecords: async (body) => {
      puts.push(body as FairnessMonthsPut);
      return { ok: true, status: 200, body: outcomes(body as FairnessMonthsPut), effects: { months: [] } };
    },
    createRole: async (body) => {
      creates.push(body as Record<string, unknown>);
      return { ok: true, status: 201, body: {}, effects: { kind: "created", roleId: `role-new-${++n}`, push: {} as never, notice: null } };
    },
    writeState: async (_p, next) => ({ ok: true, state: next }),
    sweepExpired: async () => ({ ok: true, deleted: 0 }),
    nowMs: () => NOW.getTime(),
    todayIso: () => TODAY,
  };
  const applied = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, deps);
  expect(applied.structuredContent).toMatchObject({ complete: true });
  expect(puts).toHaveLength(1);
  return { solve: solves[0], put: puts[0], creates, doc: stored[0], text };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const byPosition = (bodies: Record<string, unknown>[]) => bodies.map(({ creationRequestId: _, ...rest }) => rest);

async function parity(c: Case) {
  h.dataset = [...MEMBER_DOCS, RULES_DOC, ...(c.docs ?? [])];
  const sources = await loadV3PlanSources();
  if (!sources.ok) throw new Error(`reads failed: ${sources.failed.join()}`);
  const roles = await groq<ServiceRole[]>(adminRolesQuery());
  const members = await groq<MemberOption[]>(adminMembersQuery(true));

  const browser = await runBrowser(c, roles, members, sources.value);
  const connector = await runConnector(c, { seed: browser.solve.seed, requestId: browser.solve.request_id });

  expect(JSON.stringify(connector.solve)).toBe(JSON.stringify(browser.solve));
  expect(connector.put).toEqual(browser.put);
  expect(byPosition(connector.creates)).toEqual(byPosition(browser.creates));
  // Every create id is a fresh one per surface, and one per draft.
  expect(new Set(connector.creates.map((b) => b.creationRequestId)).size).toBe(connector.creates.length);
  return { browser, connector };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => teardownDom(globalThis));

const ref = (id: string, key: string) => ({ _key: key, _type: "reference", _ref: id });

/** A stored, published Sunday with Ana in Lead and its claimed weekend lock. */
function storedSunday(date: string, id = "role-stored-1") {
  const lock = buildClaimedLock({ targetKey: `sunday_role:${date}`, roleId: id, claimNonce: "nonce-1", now: "2026-10-01T00:00:00.000Z" });
  if (!lock) throw new Error("lock");
  return [{ _id: id, _rev: `rev-${id}`, _type: "sunday_role", week: date, published: true,
    Lead: [ref("m-ana", "k1")], BGVs: [], Chorus: [], instruments: [], foh_team: [] }, { ...lock, _rev: "rev-lock" }];
}

const PEOPLE = [
  { memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-bruno", name: "Bruno", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-carla", name: "Carla", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
];
const recordedLedger = (recordBinds: boolean) => (months: string[]) =>
  ledgerResponse(months, { horizon: [{ record: record(months[0], PEOPLE), storedServices: 0, recordBinds }] });

const dates = (bodies: Record<string, unknown>[]) => bodies.map((b) => b.date);

describe("D3 — the same Auto, the same confirm", () => {
  it("one month, nothing stored", async () => {
    const { browser } = await parity({ args: { month: "2026-11" } });
    expect(browser.creates).toHaveLength(9);
    expect(browser.creates.some((b) => (b.leads as unknown[]).length > 0)).toBe(true);   // the answer landed
    expect(browser.put.months.map((m) => m.month)).toEqual(["2026-11"]);
  });

  it("two months with a stored service and a counted special", async () => {
    const { browser, connector } = await parity({
      docs: storedSunday("2026-11-08"),
      ledger: (months) => ledgerResponse(months, { horizon: [{ storedServices: 1 }] }),
      args: { month: "2026-11", months: 2, specials: [{ date: "2026-12-09", name: "Vigilia", countsForFairness: true }] },
      drive: (container) => {
        twoMonths();
        addSpecial(container, "2026-12-09", "Vigilia", true);
      },
    });
    expect(browser.put.months.map((m) => m.month)).toEqual(["2026-11", "2026-12"]);
    expect(dates(browser.creates)).not.toContain("2026-11-08");
    expect(browser.creates.find((b) => b.date === "2026-12-09")).toMatchObject({ _type: "special_role", service_name: "Vigilia", countsForFairness: true });
    expect(browser.solve.services.some((sv) => sv.fixed)).toBe(true);
    expect(parseProposal({ ...connector.doc, _rev: "r" })!.payload.storedServiceIds).toEqual(["role-stored-1"]);
  });

  it("an uncounted special is filled locally, the same on both surfaces", async () => {
    const { browser } = await parity({
      args: { month: "2026-11", specials: [{ date: "2026-11-11", name: "Ensayo" }] },
      drive: (container) => addSpecial(container, "2026-11-11", "Ensayo", false),
    });
    const special = browser.creates.find((b) => b.date === "2026-11-11");
    expect(special).toMatchObject({ _type: "special_role", service_name: "Ensayo", countsForFairness: false });
    expect(browser.solve.services.map((sv) => sv.date)).not.toContain("2026-11-11");
  });

  it("a planned date that is not creatable is left out of the request, reported, and never posted", async () => {
    const { browser, connector } = await parity({
      // A weekend lock claimed for a role that does not exist: the lock is not eligible.
      docs: [{ ...buildClaimedLock({ targetKey: "sunday_role:2026-11-15", roleId: "role-ghost", claimNonce: "n", now: "2026-10-01T00:00:00.000Z" })!, _rev: "rev-lock" }],
      args: { month: "2026-11" },
    });
    expect(browser.solve.services.map((sv) => sv.date)).not.toContain("2026-11-15");
    expect(dates(browser.creates)).not.toContain("2026-11-15");
    const proposal = parseProposal({ ...connector.doc, _rev: "r" })!;
    expect(proposal.payload.drafts.find((d) => d.draft.date === "2026-11-15")?.atSolve).not.toBe("creatable");
    expect(connector.text).toMatch(/15 nov.*no se planeó/);
  });

  it("an excluded Sunday and an excluded Saturday", async () => {
    const { browser } = await parity({
      args: { month: "2026-11", excludeSundays: ["2026-11-22"], excludeSaturdays: ["2026-11-07"] },
      drive: (container) => {
        toggleDay(container, "2026-11-22");
        toggleDay(container, "2026-11-07");
      },
    });
    expect(dates(browser.creates)).not.toContain("2026-11-22");
    expect(dates(browser.creates)).not.toContain("2026-11-07");
    expect(browser.creates).toHaveLength(7);
  });

  it("a bound month: the record decides", async () => {
    const { browser } = await parity({ ledger: recordedLedger(true), args: { month: "2026-11" } });
    expect(browser.put.months[0]).toMatchObject({ month: "2026-11", expectedRev: "rev-2026-11" });
  });

  it("a recorded, unbound month: replaced under its revision", async () => {
    const { browser } = await parity({ ledger: recordedLedger(false), args: { month: "2026-11" } });
    expect(browser.put.months[0]).toMatchObject({ month: "2026-11", expectedRev: "rev-2026-11" });
  });
});
