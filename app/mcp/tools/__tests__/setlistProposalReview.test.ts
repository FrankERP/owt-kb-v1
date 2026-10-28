// Admin parity phase 3 (S1): the proposal-decision tools over fakes of `/admin`'s writer
// (`proposalReviewCommit.ts`, whose parity with the route is `proposalWriteRoutes.test.ts`). What is
// proved here is the tools' own part: the check never reaches the writer, what it shows, the line the
// write re-renders, who decides, and how the answer is worded.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  planProposalReview: vi.fn(),
  reviewProposal: vi.fn(),
  loadSongTitles: vi.fn(),
  loadPendingSetlistBefore: vi.fn(),
  loadMemberNames: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
vi.mock("@/app/utils/proposalReviewCommit", () => ({
  planProposalReview: h.planProposalReview,
  reviewProposal: h.reviewProposal,
}));
vi.mock("@/app/utils/serviceMutationSideEffects", () => ({
  proposalReviewRecipients: (doc: { lead?: string }) => (doc.lead ? [doc.lead] : []),
}));
vi.mock("@/app/mcp/reads/songTitles", () => ({ loadSongTitles: h.loadSongTitles }));
vi.mock("@/app/mcp/reads/pendingSetlistNotice", () => ({ loadPendingSetlistBefore: h.loadPendingSetlistBefore }));
vi.mock("@/app/mcp/reads/serviceSnapshot", () => ({ loadMemberNames: h.loadMemberNames }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { serviceError } from "@/app/utils/serviceMutation";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  CHECK_PROPOSAL_REVIEW_INPUT,
  REVIEW_PROPOSAL_DESCRIPTION,
  REVIEW_PROPOSAL_INPUT,
  checkProposalReviewResult,
  noteRefusal,
  reviewLine,
  reviewProposalResult,
  sameReviewLine,
} from "../setlistProposalReview";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const ID = "setlistProposal.role-1";
const FAR = "2099-11-08";

function song(ref: string, key = "G", medley?: string) {
  return { _key: `k-${ref}`, song: { _type: "reference", _ref: ref }, play_key: key, ...(medley ? { medley_tag: medley } : {}) };
}

function doc(over: Record<string, unknown> = {}) {
  return {
    _id: ID,
    _rev: "prop-rev-1",
    status: "pending",
    lead: "m-lead",
    team_notes: "Salmo 100",
    songs: [song("s1", "D"), song("s2", "G", "m")],
    ...over,
  };
}

function approvePlan(over: Record<string, unknown> = {}) {
  return {
    kind: "approve",
    id: ID,
    doc: doc(),
    role: { _id: "role-1", _type: "sunday_role" },
    roleType: "sunday_role",
    target: { serviceType: "sunday", serviceDate: FAR, serviceRef: "role-1" },
    docRev: "prop-rev-1",
    needsBootstrap: false,
    teamNotes: "Salmo 100",
    liveTeamNotes: "",
    songs: [song("s1", "D"), song("s2", "G", "m")],
    hasSongs: true,
    subject: { published: true, beforeSongs: [], knownRecipients: ["m-lead", "m-2"] },
    ...over,
  };
}

function transitionPlan(over: Record<string, unknown> = {}) {
  return {
    kind: "transition",
    id: ID,
    doc: doc(),
    role: { _id: "role-1", _type: "sunday_role" },
    roleType: "sunday_role",
    target: { serviceType: "sunday", serviceDate: FAR, serviceRef: "role-1" },
    docRev: "prop-rev-1",
    needsBootstrap: false,
    subject: null,
    ...over,
  };
}

function titles(ok = true) {
  return {
    ok,
    byId: new Map([
      ["s1", { title: "Grande es tu fidelidad", author: null }],
      ["s2", { title: "Santo", author: null }],
      ["s9", { title: "Vieja", author: null }],
    ]),
  };
}

/** The `Argumentos para …` line's JSON, as the model would read it. */
function argsLine(out: CallToolResult): Record<string, unknown> {
  const last = textOf(out as never).split("\n").pop() ?? "";
  expect(last.startsWith("Argumentos para review_setlist_proposal: ")).toBe(true);
  return JSON.parse(last.slice("Argumentos para review_setlist_proposal: ".length));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadSongTitles.mockResolvedValue(titles());
  h.loadPendingSetlistBefore.mockResolvedValue(null);
  h.loadMemberNames.mockResolvedValue({ ok: true, byId: new Map([["m-lead", { member_name: "Lía" }]]) });
});

describe("pure parts", () => {
  it("renders the line with the verb first, the songs on approve and the note in full otherwise", () => {
    expect(reviewLine({ action: "approve", label: "domingo 8 nov", songTitles: ["A", "B"], note: "" })).toBe(
      "Aprobar · domingo 8 nov · 2 canciones: A, B",
    );
    expect(reviewLine({ action: "request_changes", label: "domingo 8 nov", songTitles: [], note: "Cambia la 2" })).toBe(
      "Pedir cambios · domingo 8 nov · nota: Cambia la 2",
    );
    expect(reviewLine({ action: "reopen", label: "domingo 8 nov", songTitles: [], note: "" })).toBe(
      "Reabrir · domingo 8 nov · sin nota",
    );
    expect(sameReviewLine("Aprobar · Canción ", "Aprobar · Canción")).toBe(true);
    expect(sameReviewLine("Aprobar · A", "Pedir cambios · A")).toBe(false);
  });

  it("follows the panel's note rules: none on approve, required to request changes, optional to reopen", () => {
    expect(noteRefusal("approve", "hola")).toMatch(/no lleva nota/);
    expect(noteRefusal("approve", undefined)).toBeNull();
    expect(noteRefusal("request_changes", "   ")).toMatch(/obligatoria|hace falta/);
    expect(noteRefusal("request_changes", "Cambia")).toBeNull();
    expect(noteRefusal("reopen", undefined)).toBeNull();
  });

  it("refuses reconcile_target and unknown fields by schema", () => {
    expect(CHECK_PROPOSAL_REVIEW_INPUT.safeParse({ proposalId: ID, action: "reconcile_target" }).success).toBe(false);
    expect(REVIEW_PROPOSAL_INPUT.safeParse({ proposalId: ID, action: "approve", rev: "r", line: "l", extra: 1 }).success).toBe(false);
  });

  it("says in the write description that Frank must see it and say yes first", () => {
    expect(REVIEW_PROPOSAL_DESCRIPTION).toMatch(/espera a que diga que sí/);
    expect(REVIEW_PROPOSAL_DESCRIPTION).toMatch(/NO vuelve al anterior/);
  });
});

describe("check_setlist_proposal_review", () => {
  it("peeks (never the writer) and shows songs, the replaced list, the copied note, who is told, rev and line", async () => {
    h.planProposalReview.mockResolvedValue({
      ok: true,
      plan: approvePlan({ subject: { published: true, beforeSongs: [song("s9", "A")], knownRecipients: ["m-lead", "m-2"] } }),
    });
    const out = await checkProposalReviewResult({ proposalId: ID, action: "approve" });
    expect(h.planProposalReview).toHaveBeenCalledWith(ID, { action: "approve", rev: null, adminNotes: "" }, "peek");
    expect(h.reviewProposal).not.toHaveBeenCalled();
    const text = textOf(out as never);
    expect(text).toContain("1. Grande es tu fidelidad (tono D); 2. Santo (tono G, medley)");
    expect(text).toContain("Reemplaza el setlist actual: 1. Vieja (tono A)");
    expect(text).toContain("Mensaje para el equipo que se copia: «Salmo 100»");
    expect(text).toContain("«El setlist cambió» a 2 participantes");
    expect(text).toContain("Aviso push «Propuesta aprobada» a 1 persona");
    expect(argsLine(out)).toEqual({
      proposalId: ID,
      action: "approve",
      rev: "prop-rev-1",
      line: expect.stringMatching(/^Aprobar · .* · 2 canciones: Grande es tu fidelidad, Santo$/),
    });
    expect(sc(out)).toMatchObject({ rev: "prop-rev-1" });
  });

  it("says an empty proposal note BLANKS the live one, and nothing live mails the whole team", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan({ teamNotes: "", liveTeamNotes: "Lean Salmo 23" }) });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("(«Lean Salmo 23») quedaría VACÍO");
    expect(text).toContain("«Setlist listo» a TODO el equipo de alabanza");
    expect(text).toContain("No hay setlist todavía.");
  });

  it("uses a pending notice's first snapshot, not the live list, for the audience", async () => {
    h.loadPendingSetlistBefore.mockResolvedValue([]);
    h.planProposalReview.mockResolvedValue({
      ok: true,
      plan: approvePlan({ subject: { published: true, beforeSongs: [song("s9")], knownRecipients: ["m-lead"] } }),
    });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("«Setlist listo» a TODO el equipo");
    expect(text).toContain("Hay un aviso pendiente");
  });

  it("forecasts no email for an unpublished service and does not read the outbox", async () => {
    h.planProposalReview.mockResolvedValue({
      ok: true,
      plan: approvePlan({ subject: { published: false, beforeSongs: [], knownRecipients: [] } }),
    });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("Correo de setlist: ninguno, el servicio no está publicado.");
    expect(h.loadPendingSetlistBefore).not.toHaveBeenCalled();
  });

  it("forecasts no email when the songs would not change", async () => {
    h.planProposalReview.mockResolvedValue({
      ok: true,
      plan: approvePlan({ subject: { published: true, beforeSongs: [song("s1", "D"), song("s2", "G", "m")], knownRecipients: [] } }),
    });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("ninguno si las canciones no cambian");
  });

  it("a reopen says the published setlist stays, and carries the note in the line and the arguments", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: transitionPlan({ doc: doc({ status: "approved" }) }) });
    const out = await checkProposalReviewResult({ proposalId: ID, action: "reopen", note: "  Ajustar tonos " });
    const text = textOf(out as never);
    expect(text).toContain("Reabrir no devuelve el setlist anterior");
    expect(text).toContain("«Ajustar tonos»");
    expect(argsLine(out)).toMatchObject({ action: "reopen", note: "Ajustar tonos", line: expect.stringMatching(/· nota: Ajustar tonos$/) });
  });

  it("predicts a replay and says nothing would be written", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: { ...transitionPlan(), kind: "replay", status: "approved" } });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("no se escribe nada ni se avisa a nadie");
    expect(text).not.toContain("Aviso push");
  });

  it("names a needed lock bootstrap", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan({ needsBootstrap: true }) });
    const text = textOf((await checkProposalReviewResult({ proposalId: ID, action: "approve" })) as never);
    expect(text).toContain("prepara un dato interno");
  });

  it("words the writer's refusals for a proposal, without «No se escribió nada.»", async () => {
    h.planProposalReview.mockResolvedValue({
      ok: false,
      ...serviceError("stale_revision", { details: { id: ID, detail: "source_status", status: "approved" } }),
    });
    const out = await checkProposalReviewResult({ proposalId: ID, action: "approve" });
    expect(out.isError).toBe(true);
    expect(textOf(out as never)).toMatch(/está aprobada: solo se aprueba/);
    expect(textOf(out as never)).not.toContain("No se escribió nada");
  });

  it("refuses when the titles cannot be read, rather than show unknown songs", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan() });
    h.loadSongTitles.mockResolvedValue(titles(false));
    const out = await checkProposalReviewResult({ proposalId: ID, action: "approve" });
    expect(out.isError).toBe(true);
  });

  it("refuses a note on approve and a missing change-request note before any read", async () => {
    expect((await checkProposalReviewResult({ proposalId: ID, action: "approve", note: "x" })).isError).toBe(true);
    expect((await checkProposalReviewResult({ proposalId: ID, action: "request_changes" })).isError).toBe(true);
    expect(h.planProposalReview).not.toHaveBeenCalled();
  });

  it("answers a throw with the fixed read error", async () => {
    h.planProposalReview.mockRejectedValue(new Error("token=secret"));
    const out = await checkProposalReviewResult({ proposalId: ID, action: "approve" });
    expect(textOf(out as never)).not.toContain("secret");
    expect(out.isError).toBe(true);
  });
});

describe("review_setlist_proposal", () => {
  async function checkedLine(action: "approve" | "request_changes" | "reopen", note?: string): Promise<string> {
    const out = await checkProposalReviewResult({ proposalId: ID, action, ...(note ? { note } : {}) });
    return String(argsLine(out).line);
  }

  it("refuses without a principal before any read", async () => {
    const out = await reviewProposalResult({ proposalId: ID, action: "approve", rev: "r", line: "l" }, null);
    expect(out.isError).toBe(true);
    expect(h.planProposalReview).not.toHaveBeenCalled();
  });

  it("re-renders the line from a fresh peek and refuses a changed one without calling the writer", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan() });
    const out = await reviewProposalResult(
      { proposalId: ID, action: "approve", rev: "prop-rev-1", line: "Aprobar · otra cosa" },
      PRINCIPAL,
    );
    expect(out.isError).toBe(true);
    expect(sc(out)).toMatchObject({ code: "stale_revision", detail: "line_changed" });
    expect(h.reviewProposal).not.toHaveBeenCalled();
  });

  it("refuses a line checked for another action", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: transitionPlan() });
    const line = await checkedLine("request_changes", "Cambia");
    const out = await reviewProposalResult({ proposalId: ID, action: "reopen", rev: "prop-rev-1", line, note: "Cambia" }, PRINCIPAL);
    expect(out.isError).toBe(true);
    expect(h.reviewProposal).not.toHaveBeenCalled();
  });

  it("decides as the bearer's member and reports the push and the queued email", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan() });
    const line = await checkedLine("approve");
    h.reviewProposal.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, status: "approved", setlistId: "featuredSongs.x" },
      effects: {
        action: "approve",
        status: "approved",
        idempotent: false,
        roleId: "role-1",
        roleType: "sunday_role",
        serviceDate: FAR,
        setlistId: "featuredSongs.x",
        songs: [song("s1"), song("s2")],
        replacedSongs: [],
        published: true,
        pushRecipients: ["m-lead"],
        notice: { kind: "setlist", roleId: "role-1", knownRecipients: ["m-lead"] },
      },
    });
    const out = await reviewProposalResult({ proposalId: ID, action: "approve", rev: "prop-rev-1", line }, PRINCIPAL);
    expect(h.reviewProposal).toHaveBeenCalledWith(ID, { action: "approve", rev: "prop-rev-1", adminNotes: "" }, { reviewerId: PRINCIPAL.sub });
    const text = textOf(out as never);
    expect(text).toContain("Setlist publicado en");
    expect(text).toContain("2 canciones");
    expect(text).toContain("Push «Propuesta aprobada»");
    expect(text).toContain("encolada para Lía");
    expect(text).toContain("TODO el equipo de alabanza si el setlist no tenía canciones");
    expect(text).not.toMatch(/enviad[oa]/);
  });

  it("reports a replay as nothing written", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: transitionPlan() });
    const line = await checkedLine("request_changes", "Cambia");
    h.reviewProposal.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, status: "changes_requested", idempotent: true },
      effects: { action: "request_changes", status: "changes_requested", idempotent: true, pushRecipients: [], notice: null },
    });
    const out = await reviewProposalResult(
      { proposalId: ID, action: "request_changes", rev: "prop-rev-1", line, note: "Cambia" },
      PRINCIPAL,
    );
    expect(textOf(out as never)).toContain("no se escribió nada ni se avisó a nadie");
  });

  it("words a stale revision from the writer as «vuelve a revisarla»", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan() });
    const line = await checkedLine("approve");
    h.reviewProposal.mockResolvedValue({ ok: false, ...serviceError("stale_revision", { details: { id: ID, storedRev: "x", observedRev: "y" } }) });
    const out = await reviewProposalResult({ proposalId: ID, action: "approve", rev: "prop-rev-1", line }, PRINCIPAL);
    expect(textOf(out as never)).toMatch(/La propuesta cambió: vuelve a revisarla con check_setlist_proposal_review\. No se escribió nada\./);
  });

  it("a bootstrap reload says the decision was NOT applied and never «No se escribió nada.»", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan({ needsBootstrap: true }) });
    const line = await checkedLine("approve");
    h.reviewProposal.mockResolvedValue({ ok: false, ...serviceError("bootstrap_completed_reload", { details: { id: "role-1" } }) });
    const out = await reviewProposalResult({ proposalId: ID, action: "approve", rev: "prop-rev-1", line }, PRINCIPAL);
    expect(textOf(out as never)).toContain("la decisión NO se aplicó");
    expect(textOf(out as never)).not.toContain("No se escribió nada");
  });

  it("a throw from the writer is an unknown outcome pointing at the check", async () => {
    h.planProposalReview.mockResolvedValue({ ok: true, plan: approvePlan() });
    const line = await checkedLine("approve");
    h.reviewProposal.mockRejectedValue(new Error("boom"));
    const out = await reviewProposalResult({ proposalId: ID, action: "approve", rev: "prop-rev-1", line }, PRINCIPAL);
    expect(textOf(out as never)).toMatch(/No se pudo confirmar si la decisión se guardó.*check_setlist_proposal_review/);
  });
});
