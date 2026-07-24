import { describe, expect, it } from "vitest";
import {
  ROLE_CREATION_RECEIPT_TYPE,
  buildCreationReceipt,
  canonicalizeCreatePayload,
  payloadFingerprint,
  receiptIdForRequestId,
  retireReceiptPatch,
  type RoleCreatePayload,
} from "@/app/utils/roleCreationReceipt";

const NOW = "2026-07-24T18:00:00.000Z";

const base: RoleCreatePayload = {
  _type: "sunday_role",
  date: "2026-07-05",
  published: true,
  leads: ["m-1", "m-2"],
  bgvs: ["m-3"],
  chorus: [],
  instruments: [
    { instrument: "Guitarra", personId: "m-4" },
    { instrument: "Bajo", personId: "m-5" },
  ],
  foh: [{ role: "Sonido", personId: "m-6" }],
};

describe("receiptIdForRequestId", () => {
  it("is deterministic, prefixed, and hex-digested", () => {
    const id = receiptIdForRequestId("req-abc");
    expect(id).toBe(receiptIdForRequestId("req-abc"));
    expect(id).toMatch(/^roleCreate\.[0-9a-f]{64}$/);
  });

  it("separates different request ids", () => {
    expect(receiptIdForRequestId("req-abc")).not.toBe(receiptIdForRequestId("req-abd"));
    expect(receiptIdForRequestId("req-abc")).not.toBe(receiptIdForRequestId("REQ-ABC"));
  });

  it("stays inside Sanity's document id character/length limits", () => {
    const id = receiptIdForRequestId("a".repeat(200))!;
    expect(id.length).toBeLessThanOrEqual(128);
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("fails closed on an empty or non-string request id", () => {
    expect(receiptIdForRequestId("")).toBeNull();
    expect(receiptIdForRequestId(null)).toBeNull();
    expect(receiptIdForRequestId(42)).toBeNull();
  });
});

describe("canonicalizeCreatePayload", () => {
  it("normalizes a valid weekend payload with sorted assignment inputs", () => {
    const { valid, issues, canonical } = canonicalizeCreatePayload(base);
    expect(valid).toBe(true);
    expect(issues).toEqual([]);
    expect(canonical).toEqual({
      v: 1,
      roleType: "sunday_role",
      date: "2026-07-05",
      targetIdentity: "sunday_role:2026-07-05",
      serviceName: null,
      published: true,
      leads: ["m-1", "m-2"],
      bgvs: ["m-3"],
      chorus: [],
      instruments: [
        { label: "Bajo", personId: "m-5" },
        { label: "Guitarra", personId: "m-4" },
      ],
      foh: [{ label: "Sonido", personId: "m-6" }],
    });
  });

  it("derives a special target identity from the normalized service name and date", () => {
    const { canonical } = canonicalizeCreatePayload({
      _type: "special_role",
      date: "2026-04-03",
      service_name: "  Viernes   Santo ",
    });
    expect(canonical.serviceName).toBe("Viernes Santo");
    expect(canonical.targetIdentity).toBe("special_role:2026-04-03:Viernes Santo");
  });

  it("ignores a service name on a weekend role, because the writer never stores it", () => {
    const a = canonicalizeCreatePayload({ ...base, service_name: "Nochebuena" });
    expect(a.canonical.serviceName).toBeNull();
    expect(a.canonical.targetIdentity).toBe("sunday_role:2026-07-05");
  });

  it("applies the effective publication default (missing/false -> draft)", () => {
    expect(canonicalizeCreatePayload({ ...base, published: undefined }).canonical.published).toBe(false);
    expect(canonicalizeCreatePayload({ ...base, published: false }).canonical.published).toBe(false);
    // Only an exact boolean true publishes, matching the route's `=== true`.
    expect(canonicalizeCreatePayload({ ...base, published: "true" }).canonical.published).toBe(false);
  });

  it("accepts a datetime-prefixed stored date and normalizes to the calendar day", () => {
    const { canonical, valid } = canonicalizeCreatePayload({ ...base, date: "2026-07-05T12:00:00Z" });
    expect(valid).toBe(true);
    expect(canonical.date).toBe("2026-07-05");
  });

  const invalid: [string, unknown, string][] = [
    ["unknown role type", { ...base, _type: "post" }, "role_type"],
    ["missing role type", { ...base, _type: undefined }, "role_type"],
    ["non-calendar date", { ...base, date: "2026-02-30" }, "date"],
    ["missing date", { ...base, date: undefined }, "date"],
    ["special without a service name", { _type: "special_role", date: "2026-04-03" }, "service_name"],
    ["non-object payload", null, "payload"],
  ];

  it.each(invalid)("reports %s as an issue without throwing", (_label, payload, issue) => {
    const result = canonicalizeCreatePayload(payload as RoleCreatePayload);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain(issue);
  });

  it("drops blank member ids and keeps genuine duplicates (a multiset, not a set)", () => {
    const { canonical } = canonicalizeCreatePayload({
      ...base,
      leads: ["m-2", "", "m-1", "m-2"],
      instruments: [
        { instrument: "Guitarra", personId: "m-9" },
        { instrument: "Guitarra", personId: "m-8" },
        { instrument: " Guitarra ", personId: "m-9" },
      ],
    });
    expect(canonical.leads).toEqual(["m-1", "m-2", "m-2"]);
    expect(canonical.instruments).toEqual([
      { label: "Guitarra", personId: "m-8" },
      { label: "Guitarra", personId: "m-9" },
      { label: "Guitarra", personId: "m-9" },
    ]);
  });
});

describe("payloadFingerprint", () => {
  it("is a deterministic hex digest", () => {
    const fp = payloadFingerprint(base);
    expect(fp).toBe(payloadFingerprint(base));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  const sameFingerprint: [string, RoleCreatePayload][] = [
    ["reordered leads", { ...base, leads: ["m-2", "m-1"] }],
    [
      "reordered instruments",
      {
        ...base,
        instruments: [
          { instrument: "Bajo", personId: "m-5" },
          { instrument: "Guitarra", personId: "m-4" },
        ],
      },
    ],
    ["whitespace around an instrument label", { ...base, instruments: [
      { instrument: " Guitarra ", personId: "m-4" },
      { instrument: "Bajo  ", personId: "m-5" },
    ] }],
    ["a datetime-prefixed date for the same calendar day", { ...base, date: "2026-07-05T00:00:00.000Z" }],
    ["a stray weekend service name the writer would drop", { ...base, service_name: "Nochebuena" }],
  ];

  it.each(sameFingerprint)("is unchanged by incidental difference: %s", (_label, payload) => {
    expect(payloadFingerprint(payload)).toBe(payloadFingerprint(base));
  });

  const differentFingerprint: [string, RoleCreatePayload][] = [
    ["a different date", { ...base, date: "2026-07-12" }],
    ["a different role type", { ...base, _type: "saturday_role" }],
    ["a weekend-to-special change", { ...base, _type: "special_role", service_name: "Nochebuena" }],
    ["a different publication default", { ...base, published: false }],
    ["an added lead", { ...base, leads: ["m-1", "m-2", "m-7"] }],
    ["a removed lead", { ...base, leads: ["m-1"] }],
    ["a duplicated lead", { ...base, leads: ["m-1", "m-2", "m-2"] }],
    ["a swapped instrument person", { ...base, instruments: [
      { instrument: "Guitarra", personId: "m-5" },
      { instrument: "Bajo", personId: "m-4" },
    ] }],
    ["a different instrument label", { ...base, instruments: [
      { instrument: "Guitarra acústica", personId: "m-4" },
      { instrument: "Bajo", personId: "m-5" },
    ] }],
    ["a different FOH label", { ...base, foh: [{ role: "Video", personId: "m-6" }] }],
    ["a moved person between BGV and chorus", { ...base, bgvs: [], chorus: ["m-3"] }],
  ];

  it.each(differentFingerprint)("changes for a meaningful difference: %s", (_label, payload) => {
    expect(payloadFingerprint(payload)).not.toBe(payloadFingerprint(base));
  });

  it("separates two special services on the same date by name", () => {
    const a = payloadFingerprint({ _type: "special_role", date: "2026-04-03", service_name: "Viernes Santo" });
    const b = payloadFingerprint({ _type: "special_role", date: "2026-04-03", service_name: "Vigilia" });
    expect(a).not.toBe(b);
  });

  it("excludes the request id, role id, generated _keys, and timestamps", () => {
    const withNoise = {
      ...base,
      creationRequestId: "req-abc",
      _id: "role-123",
      _key: "k-1",
      createdAt: NOW,
      _rev: "rev-1",
    } as unknown as RoleCreatePayload;
    expect(payloadFingerprint(withNoise)).toBe(payloadFingerprint(base));
  });
});

describe("buildCreationReceipt", () => {
  it("builds a committed receipt at the deterministic id", () => {
    const doc = buildCreationReceipt({
      requestId: "req-abc",
      payload: base,
      roleId: "role-123",
      now: NOW,
    });
    expect(doc).toEqual({
      _id: receiptIdForRequestId("req-abc"),
      _type: ROLE_CREATION_RECEIPT_TYPE,
      requestId: "req-abc",
      fingerprint: payloadFingerprint(base),
      roleId: "role-123",
      roleType: "sunday_role",
      targetIdentity: "sunday_role:2026-07-05",
      state: "committed",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("refuses to build a receipt for an empty request id, missing role id, or invalid payload", () => {
    expect(buildCreationReceipt({ requestId: "", payload: base, roleId: "role-1", now: NOW })).toBeNull();
    expect(buildCreationReceipt({ requestId: "req", payload: base, roleId: "", now: NOW })).toBeNull();
    expect(
      buildCreationReceipt({
        requestId: "req",
        payload: { ...base, date: "nope" },
        roleId: "role-1",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("retires a receipt without touching its immutable identity fields", () => {
    const patch = retireReceiptPatch({ now: NOW });
    expect(patch).toEqual({ set: { state: "role_deleted", updatedAt: NOW }, unset: [] });
    for (const immutable of ["requestId", "fingerprint", "roleId", "roleType", "targetIdentity"]) {
      expect(Object.keys(patch.set)).not.toContain(immutable);
    }
  });
});
