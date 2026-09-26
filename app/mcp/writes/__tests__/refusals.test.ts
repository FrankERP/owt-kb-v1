// app/mcp/writes/refusals.ts — the write tools' Spanish refusals (P3 step 7).
//
// Every registered service code has copy; every text but the two maintenance
// ones ends with «No se escribió nada.»; the writers' own detail and issue
// codes are translated and still travel as machine codes. The publish writer's
// per-service rows are covered here from hand-built bodies in its exact shape,
// and in `refusalsPublishBodies.test.ts` from the bodies it really returns.

import { describe, expect, it } from "vitest";
import { SERVICE_ERROR_CODES, serviceError, type ServiceErrorCode } from "@/app/utils/serviceMutation";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import { refusalCopy } from "@/app/mcp/reads/publishRefusal";
import {
  BOOTSTRAP_COMPLETED_RELOAD_MESSAGE,
  BOOTSTRAP_OUTCOME_UNKNOWN_MESSAGE,
  NOTHING_WRITTEN,
  PUBLISH_OVERRIDE_NOTE,
  STALE_COPY,
  admissionRefusal,
  refusalFor,
} from "../refusals";
import { WRITE_UNKNOWN_OUTCOME_MESSAGE } from "../runWriteTool";

function refusal(code: ServiceErrorCode, details?: Record<string, unknown>) {
  return { ok: false as const, ...serviceError(code, details ? { details } : {}) };
}

function textOf(result: { content: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe("text");
  return content[0].text;
}

const MAINTENANCE: ServiceErrorCode[] = ["bootstrap_completed_reload", "bootstrap_outcome_unknown"];

describe("refusalFor — every registered code", () => {
  it.each(SERVICE_ERROR_CODES.map((code) => [code]))("%s: a Spanish tool error with the route's code", (code) => {
    const result = refusalFor(refusal(code));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ refused: true, code });
    const text = textOf(result);
    expect(text.length).toBeGreaterThan(NOTHING_WRITTEN.length);
    // The English default message never reaches the model.
    expect(text).not.toContain(serviceError(code).body.message);
    if (MAINTENANCE.includes(code)) {
      expect(text).not.toContain(NOTHING_WRITTEN);
    } else {
      expect(text.endsWith(NOTHING_WRITTEN)).toBe(true);
      expect(text.indexOf(NOTHING_WRITTEN)).toBe(text.length - NOTHING_WRITTEN.length);
    }
  });

  it("bootstrap_completed_reload says the repair landed and the change did not — exactly", () => {
    const result = refusalFor(refusal("bootstrap_completed_reload", { id: "role-sat-1010", lockId: "x" }));
    expect(textOf(result)).toBe(
      "Se reparó un dato interno de coordinación del servicio, pero tu cambio NO se aplicó. Vuelve a leer con get_service y reintenta.",
    );
    expect(BOOTSTRAP_COMPLETED_RELOAD_MESSAGE).toBe(textOf(result));
  });

  it("bootstrap_outcome_unknown says not to retry — exactly", () => {
    const result = refusalFor(refusal("bootstrap_outcome_unknown", { id: "role-sat-1010" }));
    expect(textOf(result)).toBe("No se pudo confirmar una reparación interna. No reintentes; revísalo en /admin.");
    expect(BOOTSTRAP_OUTCOME_UNKNOWN_MESSAGE).toBe(textOf(result));
  });

  it("a stale revision tells the model to re-read, and nothing else", () => {
    const result = refusalFor(refusal("stale_revision", { id: "role-sun-1004", storedRev: "r2", observedRev: "r1" }));
    expect(textOf(result)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(textOf(result)).toContain("vuelve a leer con get_service");
    // Neither revision reaches the text.
    expect(textOf(result)).not.toMatch(/\br[12]\b/);
  });

  it("an unregistered body error (the recovery-only 503) is never «No se escribió nada.»", () => {
    const result = refusalFor({
      ok: false,
      status: 503,
      body: { error: "unknown_outcome", outcome: "unknown", message: "No se pudo confirmar el resultado." },
    });
    expect(textOf(result)).toBe(WRITE_UNKNOWN_OUTCOME_MESSAGE);
    expect(result.structuredContent).toEqual({ refused: true, code: "unknown_outcome" });
  });

  it("a body that is not an object at all is the unknown-outcome text too", () => {
    expect(textOf(refusalFor({ ok: false, status: 500, body: null as unknown as Record<string, unknown> }))).toBe(
      WRITE_UNKNOWN_OUTCOME_MESSAGE,
    );
  });
});

describe("refusalFor — details.detail", () => {
  it.each([
    ["stale_revision", "concurrent_creation", "Alguien creó el setlist mientras tanto."],
    ["stale_revision", "revision_moved", "Alguien guardó un cambio mientras tanto."],
    ["stale_revision", "identity_mismatch", "El setlist guardado ya no es el que leíste."],
    ["stale_revision", "revision_mismatch", "El setlist se guardó otra vez desde que lo leíste."],
    ["stale_revision", "target_vanished", "El setlist que leíste ya no existe."],
    [
      "integrity_conflict",
      "setlist_draft_conflict",
      "Hay un borrador de Studio sobre este setlist; descártalo o publícalo en Studio y vuelve a leer.",
    ],
    [
      "integrity_conflict",
      "role_draft_conflict",
      "Hay un borrador de Studio sobre este servicio; descártalo o publícalo en Studio y vuelve a leer.",
    ],
    ["integrity_conflict", "setlist_malformed", "El setlist guardado está mal formado."],
    ["integrity_conflict", "hidden_saturday_chorus", "Un sábado con Coro guardado no se puede intercambiar"],
    ["integrity_conflict", "lock_wrong_owner", "pertenece a otro servicio"],
    ["integrity_conflict", "unexpected_type", "no es un servicio"],
  ] as const)("%s / %s", (code, detail, expected) => {
    const result = refusalFor(refusal(code, { detail, week: "2026-10-04" }));
    const text = textOf(result);
    expect(text).toContain(expected);
    expect(text.endsWith(NOTHING_WRITTEN)).toBe(true);
    expect(result.structuredContent).toEqual({ refused: true, code, detail });
  });

  it("an unknown detail is still carried as a machine code, with the code's own copy", () => {
    const result = refusalFor(refusal("integrity_conflict", { detail: "something_new" }));
    expect(result.structuredContent).toEqual({ refused: true, code: "integrity_conflict", detail: "something_new" });
    expect(textOf(result)).not.toContain("something_new");
    expect(textOf(result).endsWith(NOTHING_WRITTEN)).toBe(true);
  });

  it("a raw draft overlay (no detail, `rawDrafts`) names the Studio draft", () => {
    const text = textOf(refusalFor(refusal("integrity_conflict", { id: "role-x", rawDrafts: ["drafts.role-x"] })));
    expect(text).toContain("borrador de Studio");
    expect(text).not.toContain("drafts.role-x");
  });

  it("a moved person who dangles says so, without the id", () => {
    const text = textOf(refusalFor(refusal("integrity_conflict", { danglingRefs: ["mem-gone"] })));
    expect(text).toContain("ya no existe como miembro");
    expect(text).not.toContain("mem-gone");
  });
});

describe("refusalFor — details.issues", () => {
  it.each([
    ["incompatible_team_topology", "entre un sábado y un servicio que no es sábado"],
    ["incompatible_section_topology", "El Coro no se puede intercambiar con un sábado"],
    ["identical_selection", "Los dos servicios son el mismo."],
    ["songs_length", "como máximo 60 canciones"],
  ])("%s", (issue, expected) => {
    const result = refusalFor(refusal("invalid_request", { issues: [issue] }));
    expect(textOf(result)).toContain(expected);
    expect(result.structuredContent).toEqual({ refused: true, code: "invalid_request", issues: [issue] });
  });

  it("a leader issue names the song by position, counted from 1", () => {
    const text = textOf(refusalFor(refusal("invalid_request", { issues: ["songs[2].leadIds"] })));
    expect(text).toContain("canción 3");
    expect(text).toContain("Noche de alabanza");
  });

  it("an issue with no copy is listed as a technical detail, never dropped", () => {
    const text = textOf(refusalFor(refusal("invalid_request", { issues: ["songs[0].medley_tag", "observed.rev"] })));
    expect(text).toContain("Detalle técnico: songs[0].medley_tag, observed.rev.");
    expect(text.endsWith(NOTHING_WRITTEN)).toBe(true);
  });
});

// ── The publish writer's bodies, in its exact shape (publishReadyCommit.ts) ──

function publishRefusalBody(code: "stale_revision" | "integrity_conflict", services: Record<string, unknown>[]) {
  return refusal(code, { mode: "ready", services });
}

describe("refusalFor — a publish refusal is keyed on its per-service reasons (F10)", () => {
  it("not_ready under a top-level stale_revision reads as the blockers, with no retry advice", () => {
    const result = refusalFor(
      publishRefusalBody("stale_revision", [
        {
          id: "role-sp-1017-a",
          reasons: ["not_ready"],
          hardBlockers: [],
          workflowBlockers: ["incomplete_setlist", "availability_conflict"],
          publishState: "draft",
          storedRev: "r1",
          observedRev: "r1",
        },
      ]),
    );
    const text = textOf(result);
    expect(text).toBe(
      `No se puede publicar todavía: ${PUBLISH_SKIP_COPY.incomplete_setlist}; ${PUBLISH_SKIP_COPY.availability_conflict}. ` +
        `${PUBLISH_OVERRIDE_NOTE} ${NOTHING_WRITTEN}`,
    );
    expect(text).not.toContain("vuelve a leer");
    expect(text).not.toContain("reintenta");
    expect(result.structuredContent).toEqual({
      refused: true,
      code: "stale_revision",
      services: [
        {
          id: "role-sp-1017-a",
          reasons: ["not_ready"],
          hardBlockers: [],
          workflowBlockers: ["incomplete_setlist", "availability_conflict"],
        },
      ],
    });
  });

  it("hard_integrity_blocker reads as the hard blockers, with no retry advice", () => {
    const text = textOf(
      refusalFor(
        publishRefusalBody("integrity_conflict", [
          {
            id: "role-sun-1018",
            reasons: ["hard_integrity_blocker"],
            hardBlockers: ["setlist_draft_conflict"],
            workflowBlockers: [],
          },
        ]),
      ),
    );
    expect(text).toContain(`No se puede publicar por un problema de integridad: ${PUBLISH_SKIP_COPY.setlist_draft_conflict}.`);
    expect(text).toContain(PUBLISH_OVERRIDE_NOTE);
    expect(text).not.toContain("vuelve a leer");
  });

  it("unusable_observation uses the route-only copy get_service shows", () => {
    const text = textOf(
      refusalFor(
        publishRefusalBody("integrity_conflict", [
          { id: "role-x", reasons: ["hard_integrity_blocker", "unusable_observation"], hardBlockers: ["invalid_record"], workflowBlockers: [] },
        ]),
      ),
    );
    const copy = refusalCopy("unusable_observation");
    expect(text).toContain(copy.charAt(0).toUpperCase() + copy.slice(1));
    expect(text).toContain(PUBLISH_SKIP_COPY.invalid_record);
  });

  it("a retry of a publish that landed leads with «ya está publicado»", () => {
    const text = textOf(
      refusalFor(
        publishRefusalBody("stale_revision", [
          { id: "role-sat-1003", reasons: ["already_published", "stale_revision"], hardBlockers: [], workflowBlockers: [] },
        ]),
      ),
    );
    expect(text.startsWith("Ya está publicado.")).toBe(true);
    expect(text).toBe(`Ya está publicado. Además, el servicio cambió desde que lo leíste. ${NOTHING_WRITTEN}`);
  });

  it("stale_revision ALONE in the reasons is the re-read instruction", () => {
    const text = textOf(
      refusalFor(
        publishRefusalBody("stale_revision", [
          { id: "role-sat-1003", reasons: ["stale_revision"], hardBlockers: [], workflowBlockers: [] },
        ]),
      ),
    );
    expect(text).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
  });

  it("a blocker beside a moved revision stays the blocker copy: the stale fact is noted, not advised", () => {
    const text = textOf(
      refusalFor(
        publishRefusalBody("stale_revision", [
          { id: "role-sp-1017-a", reasons: ["stale_revision", "not_ready"], hardBlockers: [], workflowBlockers: ["team_empty"] },
        ]),
      ),
    );
    expect(text.startsWith(`No se puede publicar todavía: ${PUBLISH_SKIP_COPY.team_empty}.`)).toBe(true);
    expect(text).toContain("Además, el servicio cambió desde que lo leíste.");
    expect(text).not.toContain("vuelve a leer");
  });

  it("the commit race (`details.guard`) is the re-read instruction", () => {
    const result = refusalFor(
      refusal("stale_revision", { mode: "ready", ids: ["role-sat-1003"], guard: "publish_ready_assertions" }),
    );
    expect(textOf(result)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(result.structuredContent).toEqual({ refused: true, code: "stale_revision", detail: "publish_ready_assertions" });
  });

  it.each(["assertionIssues", "mergeIssues", "planIssues"])("the assertion stage (%s) is the integrity copy", (key) => {
    const result = refusalFor(refusal("integrity_conflict", { [key]: key === "assertionIssues" ? { "role-x": ["member"] } : ["x"] }));
    const text = textOf(result);
    expect(text).toContain("no pasan una verificación de integridad");
    expect(text).not.toContain("vuelve a leer");
    expect(text.endsWith(NOTHING_WRITTEN)).toBe(true);
    expect(result.structuredContent).toEqual({ refused: true, code: "integrity_conflict", detail: key });
  });

  it("a not_found row inside a publish refusal uses the route-only copy", () => {
    const text = textOf(
      refusalFor(publishRefusalBody("stale_revision", [{ id: "role-missing", reasons: ["not_found"] }])),
    );
    expect(text).toBe(`El servicio no existe. ${NOTHING_WRITTEN}`);
  });
});

describe("admissionRefusal", () => {
  it("is the same shape, with the gate as the detail and «No se escribió nada.» appended once", () => {
    const result = admissionRefusal(
      "ambiguous_target",
      "duplicate_special_identity",
      "Hay otro especial el 2026-10-17 con el mismo nombre; corrígelo en /admin → Servicios.",
    );
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Hay otro especial el 2026-10-17 con el mismo nombre; corrígelo en /admin → Servicios. No se escribió nada.",
        },
      ],
      structuredContent: { refused: true, code: "ambiguous_target", detail: "duplicate_special_identity" },
    });
  });

  it("never doubles the closing sentence", () => {
    const text = textOf(admissionRefusal("invalid_request", "invalid_content", `Setlist inválido. ${NOTHING_WRITTEN}`));
    expect(text).toBe(`Setlist inválido. ${NOTHING_WRITTEN}`);
  });

  it("carries issues when given", () => {
    const result = admissionRefusal("invalid_request", "medley_not_adjacent", "El enlace no se puede aplicar.", {
      issues: ["rows[2].medleyTag"],
    });
    expect(result.structuredContent).toEqual({
      refused: true,
      code: "invalid_request",
      detail: "medley_not_adjacent",
      issues: ["rows[2].medleyTag"],
    });
  });
});
