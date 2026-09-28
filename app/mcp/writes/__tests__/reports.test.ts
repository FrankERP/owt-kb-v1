// app/mcp/writes/reports.ts — what a write says it queued (P3 step 7, I9).
//
// The builders read the step-2 descriptors in `effects` and nothing else; an
// empty list is «nadie», a null descriptor is «no se encoló», and nothing is
// ever «enviada» or «entregada». Names come from one canonical lookup that can
// fail without failing the write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ loadMemberNames: vi.fn() }));

vi.mock("@/app/mcp/reads/serviceSnapshot", () => ({
  loadMemberNames: (...a: unknown[]) => h.loadMemberNames(...a),
}));
// `assignmentEmail` (whose two pure helpers the publish report reuses) imports
// the tokened client and the mail transport at module load; neither is used here.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() }, writeClient: {} }));
vi.mock("@/app/utils/email", () => ({ sendEmail: vi.fn() }));

import type { SetlistSaveEffects } from "@/app/utils/setlistSaveCommit";
import type { RoleSwapEffects, RoleSwapRoleEffect } from "@/app/utils/roleSwapCommit";
import type { PublishReadyEffects } from "@/app/utils/publishReadyCommit";
import type { ServiceObservation } from "@/app/utils/publishReadyBundle";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";
import {
  PUBLISH_EMAIL_AUDIENCE_NOTE,
  WHEN_AFTER_RESPONSE,
  WHEN_DEBOUNCED,
  WHEN_IMMEDIATE,
  audienceMember,
  notificationSummary,
  publishEmailCandidates,
  publishNotifications,
  resolveNotifications,
  safeMemberLookup,
  setlistSaveNotifications,
  swapNotifications,
  type PendingNotification,
} from "../reports";

const member = (id: string, name: string): CanonicalMember => ({ _id: id, _rev: `${id}-rev`, member_name: name });

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.loadMemberNames.mockReset();
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Fixtures: effects exactly as the writers type them ──────────────────────

function setlistEffects(overrides: Partial<SetlistSaveEffects> = {}): SetlistSaveEffects {
  return {
    kind: "sunday",
    week: "2026-10-04",
    roleId: "role-sun-1004",
    setlistId: "setlist-1004",
    created: false,
    songs: [{ _key: "k1", song: { _type: "reference", _ref: "song-1" } }],
    subject: {
      roleId: "role-sun-1004",
      roleType: "sunday_role",
      published: true,
      beforeSongs: [],
      knownRecipients: ["mem-ana", "mem-luis"],
    },
    push: { recipients: ["mem-ana", "mem-sofia"] },
    notice: { kind: "setlist", roleId: "role-sun-1004", knownRecipients: ["mem-ana", "mem-luis"] },
    ...overrides,
  };
}

function swapRole(id: string, published: boolean, notice: RoleSwapRoleEffect["notice"]): RoleSwapRoleEffect {
  const seats = { leads: [], bgvs: [], chorus: [], instruments: [], foh: [] };
  return {
    role: { _id: id, _rev: `${id}-rev`, _type: "sunday_role", week: "2026-10-04", published },
    set: {},
    seatStates: { before: seats, after: seats },
    notice,
  };
}

function observation(roleId: string, serviceDate: string): ServiceObservation {
  return { roleId, serviceDate } as unknown as ServiceObservation;
}

function publishEffects(overrides: Partial<PublishReadyEffects> = {}): PublishReadyEffects {
  return {
    recovered: false,
    observations: [observation("role-sat-1003", "2026-10-03")],
    push: {
      pushes: [{ recipients: ["mem-ana", "mem-luis"], date: "2026-10-03" }],
      emailBatch: [
        { type: "saturday_role", date: "2026-10-03", body: { leads: ["mem-ana"], chorus: ["mem-luis"] } },
      ],
    },
    notice: { kind: "publishedSetlist", subjects: [{ roleId: "role-sat-1003", knownRecipients: ["mem-ana", "mem-luis"] }] },
    ...overrides,
  };
}

function allText(entries: { summary?: string; note?: string; title: string; audienceNote?: string }[]): string {
  return JSON.stringify(entries);
}

// ── setlist save ────────────────────────────────────────────────────────────

describe("setlistSaveNotifications", () => {
  it("a published save: the setlist push to its recipients and the debounced outbox notice", () => {
    const entries = setlistSaveNotifications(setlistEffects());
    expect(entries).toEqual([
      expect.objectContaining({
        channel: "push",
        title: "Setlist de la semana",
        status: "encolada",
        memberIds: ["mem-ana", "mem-sofia"],
        when: WHEN_AFTER_RESPONSE,
        date: "2026-10-04",
      }),
      expect.objectContaining({
        channel: "outbox_email",
        status: "encolada",
        memberIds: ["mem-ana", "mem-luis"],
        when: WHEN_DEBOUNCED,
      }),
    ]);
    for (const entry of entries) expect(entry.conditions.length).toBeGreaterThan(0);
    expect(entries[0].conditions.join(" ")).toContain("deviceTokens");
    expect(entries[1].conditions.join(" ")).toContain("EMAIL_ALLOWLIST");
  });

  it("a draft service and a role-less week queue nothing", () => {
    expect(
      setlistSaveNotifications(
        setlistEffects({
          subject: { ...setlistEffects().subject!, published: false },
          push: null,
          notice: null,
        }),
      ),
    ).toEqual([]);
    expect(setlistSaveNotifications(setlistEffects({ subject: null, roleId: null, push: null, notice: null }))).toEqual([]);
  });

  it("a null descriptor on a published save is «no encolada», never dropped", () => {
    const entries = setlistSaveNotifications(setlistEffects({ push: null, notice: null, songs: [] }));
    expect(entries.map((e) => [e.channel, e.status, e.memberIds])).toEqual([
      ["push", "no encolada", []],
      ["outbox_email", "no encolada", []],
    ]);
    expect(entries[1].note).toBe("No se encoló: el setlist quedó sin canciones.");
  });

  it("never shares a list with the descriptor", () => {
    const effects = setlistEffects();
    const entries = setlistSaveNotifications(effects);
    entries[0].memberIds.push("mem-x");
    expect(effects.push!.recipients).toEqual(["mem-ana", "mem-sofia"]);
  });
});

// ── swap ────────────────────────────────────────────────────────────────────

describe("swapNotifications", () => {
  it("one push per destination role with added members, and an outbox notice per role", () => {
    const effects: RoleSwapEffects = {
      roles: [
        swapRole("role-a", true, { kind: "role", roleId: "role-a", memberIds: ["mem-ana", "mem-luis"] }),
        swapRole("role-b", true, { kind: "role", roleId: "role-b", memberIds: ["mem-luis", "mem-ana"] }),
      ],
      push: { pushes: [{ recipients: ["mem-luis"], date: "2026-10-04", kind: "updated" }] },
    };
    const entries = swapNotifications(effects);
    expect(entries.map((e) => [e.channel, e.title, e.status, e.memberIds, e.when])).toEqual([
      ["push", "Servicio actualizado", "encolada", ["mem-luis"], WHEN_AFTER_RESPONSE],
      ["outbox_email", "Cambio en el servicio (correo agrupado)", "encolada", ["mem-ana", "mem-luis"], WHEN_DEBOUNCED],
      ["outbox_email", "Cambio en el servicio (correo agrupado)", "encolada", ["mem-luis", "mem-ana"], WHEN_DEBOUNCED],
    ]);
    expect(entries[1].date).toBe("2026-10-04");
  });

  it("an empty push list is «nadie» (ran, notified nobody); a draft role's null notice says it is a draft", () => {
    const entries = swapNotifications({
      roles: [swapRole("role-a", false, null), swapRole("role-b", false, null)],
      push: { pushes: [] },
    });
    expect(entries[0]).toMatchObject({ channel: "push", status: "encolada", memberIds: [] });
    expect(entries[1]).toMatchObject({ status: "no encolada", note: "No se encoló: el servicio es un borrador." });
  });
});

// ── publish ─────────────────────────────────────────────────────────────────

describe("publishNotifications", () => {
  it("push to every assignee, the consolidated email labelled as the batch's derivation, «Setlist listo» immediately", () => {
    const entries = publishNotifications(publishEffects());
    expect(entries.map((e) => [e.channel, e.title, e.memberIds, e.when])).toEqual([
      ["push", "Nuevo servicio asignado", ["mem-ana", "mem-luis"], WHEN_AFTER_RESPONSE],
      ["email", "Asignación (correo consolidado)", ["mem-ana", "mem-luis"], WHEN_AFTER_RESPONSE],
      ["outbox_email", "Setlist listo", ["mem-ana", "mem-luis"], WHEN_IMMEDIATE],
    ]);
    expect(entries[1].audienceNote).toBe(PUBLISH_EMAIL_AUDIENCE_NOTE);
    expect(entries[1].conditions.join(" ")).toMatch(/EMAIL_ALLOWLIST/);
    expect(entries[1].conditions.join(" ")).toMatch(/wantsNotification/);
    expect(entries[2].date).toBe("2026-10-03");
    expect(entries[2].note).toContain("solo si el servicio tiene canciones");
  });

  it("no assignee (a null push descriptor) is «no encolada» for both the push and the email", () => {
    const entries = publishNotifications(publishEffects({ push: null }));
    expect(entries.slice(0, 2).map((e) => [e.channel, e.status, e.memberIds])).toEqual([
      ["push", "no encolada", []],
      ["email", "no encolada", []],
    ]);
  });

  it("a recovered request queued nothing", () => {
    expect(publishNotifications(publishEffects({ recovered: true, push: null, notice: null, observations: [] }))).toEqual(
      [],
    );
  });
});

describe("publishEmailCandidates — the batch's own derivation", () => {
  it("keeps each distinct assignee with a role, in first-seen order across services", () => {
    expect(
      publishEmailCandidates([
        {
          type: "sunday_role",
          date: "2026-10-04",
          body: {
            leads: ["mem-ana", "mem-ana"],
            bgvs: ["mem-sofia"],
            instruments: [{ instrument: "Bajo", personId: "mem-luis" }, { instrument: "Batería", personId: "" }],
          },
        },
        { type: "saturday_role", date: "2026-10-03", body: { foh: [{ role: "Sonido", personId: "mem-sofia" }], leads: ["mem-pablo"] } },
      ]),
    ).toEqual(["mem-ana", "mem-sofia", "mem-luis", "mem-pablo"]);
    expect(publishEmailCandidates([])).toEqual([]);
  });
});

// ── wording ─────────────────────────────────────────────────────────────────

describe("the wording is «encolada», never «enviada» or «entregada»", () => {
  it("across every builder's output and summary", async () => {
    h.loadMemberNames.mockResolvedValue({ ok: true, byId: new Map([["mem-ana", member("mem-ana", "Ana")]]) });
    const pending: PendingNotification[] = [
      ...setlistSaveNotifications(setlistEffects()),
      ...setlistSaveNotifications(setlistEffects({ push: null, notice: null })),
      ...swapNotifications({ roles: [swapRole("role-a", false, null)], push: { pushes: [] } }),
      ...publishNotifications(publishEffects()),
      ...publishNotifications(publishEffects({ push: null, notice: null })),
    ];
    const reports = await resolveNotifications(pending);
    const text = allText(reports);
    expect(text).not.toMatch(/enviad|entregad/i);
    expect(text).toContain("encolada para Ana");
  });
});

// ── names ───────────────────────────────────────────────────────────────────

describe("resolveNotifications", () => {
  const pending: PendingNotification[] = [
    {
      channel: "push",
      title: "Servicio actualizado",
      status: "encolada",
      memberIds: ["mem-ana", "mem-gone"],
      when: WHEN_AFTER_RESPONSE,
      date: "2026-10-04",
      conditions: [],
    },
    {
      channel: "outbox_email",
      title: "Cambio en el servicio (correo agrupado)",
      status: "encolada",
      memberIds: ["mem-ana", "mem-luis"],
      when: WHEN_DEBOUNCED,
      conditions: [],
    },
  ];

  it("reads every name in ONE lookup over the union of ids, passing the known members through", async () => {
    const known = new Map([["mem-luis", member("mem-luis", "Luis")]]);
    h.loadMemberNames.mockResolvedValue({
      ok: true,
      byId: new Map([
        ["mem-ana", member("mem-ana", "Ana")],
        ["mem-luis", member("mem-luis", "Luis")],
      ]),
    });
    const reports = await resolveNotifications(pending, known);
    expect(h.loadMemberNames).toHaveBeenCalledTimes(1);
    expect(h.loadMemberNames).toHaveBeenCalledWith(["mem-ana", "mem-gone", "mem-luis"], known);
    expect(reports[0].audience).toEqual([
      { memberId: "mem-ana", name: "Ana" },
      { memberId: "mem-gone", name: null, missing: true },
    ]);
    expect(reports[1].audience).toEqual([
      { memberId: "mem-ana", name: "Ana" },
      { memberId: "mem-luis", name: "Luis" },
    ]);
    expect(reports[0].summary).toBe(
      "Push «Servicio actualizado» (2026-10-04): encolada para Ana, mem-gone (miembro inexistente), tras la respuesta.",
    );
    expect("memberIds" in reports[0]).toBe(false);
  });

  it("a lookup that reports ok: false marks every unread name unresolved — never missing, never dropped", async () => {
    h.loadMemberNames.mockResolvedValue({ ok: false, byId: new Map([["mem-ana", member("mem-ana", "Ana")]]) });
    const reports = await resolveNotifications(pending);
    expect(reports[0].audience).toEqual([
      { memberId: "mem-ana", name: "Ana" },
      { memberId: "mem-gone", name: null, unresolved: true },
    ]);
    expect(reports[0].summary).toContain("mem-gone (nombre no resuelto)");
  });

  it("a lookup that THROWS is caught here: every name unresolved, and no throw reaches the caller", async () => {
    h.loadMemberNames.mockRejectedValue(new Error("Request error https://xyz.api.sanity.io token=abc"));
    const reports = await resolveNotifications(pending);
    expect(reports.flatMap((r) => r.audience).every((m) => m.unresolved === true && m.name === null)).toBe(true);
    expect(reports[1].audience.map((m) => m.memberId)).toEqual(["mem-ana", "mem-luis"]);
    expect(error).toHaveBeenCalledWith("[mcp-write] report read failed:", "member names");
    expect(JSON.stringify(error.mock.calls)).not.toContain("token=abc");
  });

  it("reads nothing when no entry names anyone", async () => {
    const reports = await resolveNotifications([{ ...pending[0], memberIds: [] }]);
    expect(h.loadMemberNames).not.toHaveBeenCalled();
    expect(reports[0].summary).toBe("Push «Servicio actualizado» (2026-10-04): nadie.");
  });
});

describe("safeMemberLookup / audienceMember", () => {
  it("falls back to the alias when the member has no name", () => {
    const lookup = { ok: true, byId: new Map([["mem-x", { _id: "mem-x", _rev: "r", alias: "Equis" }]]) };
    expect(audienceMember("mem-x", lookup)).toEqual({ memberId: "mem-x", name: "Equis" });
  });

  it("returns ok: false with nothing resolved on a throw", async () => {
    h.loadMemberNames.mockRejectedValue(new Error("down"));
    const lookup = await safeMemberLookup(["mem-ana"]);
    expect(lookup.ok).toBe(false);
    expect(lookup.byId.size).toBe(0);
  });
});

describe("notificationSummary", () => {
  it("a no-encolada entry says why, with no audience", () => {
    expect(
      notificationSummary({
        channel: "email",
        title: "Asignación (correo consolidado)",
        status: "no encolada",
        when: WHEN_AFTER_RESPONSE,
        conditions: [],
        note: "No se encoló: el servicio no tiene a nadie asignado.",
        audience: [],
      }),
    ).toBe("Correo «Asignación (correo consolidado)»: No se encoló: el servicio no tiene a nadie asignado.");
  });
});
