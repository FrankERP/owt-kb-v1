// app/utils/__tests__/proposalNotify.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a), SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000 }));

const sendPushMock = vi.fn();
vi.mock("../push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

// assignmentEmail (imported for its pure allowlist helpers) transitively imports
// the real serverClient, which evaluates sanity/env. Stub it so the module loads
// under vitest without real Sanity env vars; proposalNotify itself no longer
// reads through serverClient.
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { create: vi.fn(), patch: vi.fn() },
}));

// Canonical reads go through operationalClient; draft-conflict evidence through
// rawIntegrityClient. Mock both explicitly so a test controls role identity.
const opFetchMock = vi.fn();
const rawFetchMock = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => opFetchMock(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetchMock(...a) },
}));

import { buildProposalEmail, notifyProposalSubmitted } from "../proposalNotify";

// A structurally valid canonical role with two Leads (Lead refs drive co-lead
// notification). `validateRole` requires all five seat arrays to be present.
function validRole(leadRefs: string[]) {
  return {
    _id: "r1",
    _rev: "rev1",
    _type: "sunday_role",
    week: "2026-07-05",
    Lead: leadRefs.map((ref, i) => ({ _key: `l${i}`, _type: "reference", _ref: ref })),
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
}

const SONGS = [
  { _key: "s0", ref: "s1", key: "G", group: null },
  { _key: "s1", ref: "s2", key: "D", group: 0 },
  { _key: "s2", ref: "s3", key: "D", group: 0 },
];
const TITLES = new Map([["s1", "Abres Camino"], ["s2", "Santo"], ["s3", "Digno"]]);

function submit(over: Partial<Parameters<typeof notifyProposalSubmitted>[0]> = {}) {
  return { leadId: "lead1", roleId: "r1", proposalId: "p1", serviceType: "sunday" as const, serviceDate: "2026-07-05", ...over };
}

describe("buildProposalEmail", () => {
  it("builds a Spanish subject + body with an absolute admin link", () => {
    process.env.NEXTAUTH_URL = "https://example.com";
    const e = buildProposalEmail({ leadName: "Frank", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(e.subject).toContain("Domingo");
    expect(e.html).toContain("Frank");
    expect(e.html).toContain('href="https://example.com/admin"');
    expect(e.html).toContain("Revisar propuesta");
    expect(e.html).not.toContain("Canción");
    delete process.env.NEXTAUTH_URL;
  });

  it("escapes HTML in the lead name", () => {
    const e = buildProposalEmail({ leadName: "A & <b>", serviceType: "saturday", serviceDate: "2026-07-11" });
    expect(e.html).toContain("A &amp; &lt;b&gt;");
    expect(e.html).not.toContain("<b>");
  });

  it("renders the setlist table without a Mov. column, groups medleys, and omits empty notes", () => {
    const e = buildProposalEmail({
      leadName: "Frank",
      serviceType: "sunday",
      serviceDate: "2026-07-05",
      songs: SONGS,
      titles: TITLES,
      notes: "   \n  ",
    });
    expect(e.html).toContain("Abres Camino");
    expect(e.html).toContain("Santo");
    expect(e.html).toContain("Digno");
    expect(e.html).toContain("Medley");
    expect(e.html).toContain("Canción");
    expect(e.html).not.toContain("Mov.");
    expect(e.html).not.toContain("Notas del líder");
  });

  it("renders lead notes with pre-wrap and escaped HTML", () => {
    const e = buildProposalEmail({
      leadName: "Frank",
      serviceType: "sunday",
      serviceDate: "2026-07-05",
      notes: "Ensayo <jueves>\n& más",
    });
    expect(e.html).toContain("Notas del líder");
    expect(e.html).toContain("white-space:pre-wrap");
    expect(e.html).toContain("Ensayo &lt;jueves&gt;\n&amp; más");
    expect(e.html).not.toContain("<jueves>");
    expect(e.html).not.toContain("Canción");
  });
});

describe("notifyProposalSubmitted", () => {
  beforeEach(() => {
    sendEmailMock.mockReset(); sendPushMock.mockReset();
    opFetchMock.mockReset(); rawFetchMock.mockReset();
    process.env.EMAIL_ALLOWLIST = "admin@x.com";
    sendPushMock.mockResolvedValue({ sent: 0, pruned: 0 });
    rawFetchMock.mockResolvedValue([]); // no draft overlay by default
  });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  // op fetches, in order: [0] canonical role-by-id array, [1] admins+lead+proposal,
  // [2] song titles (only when the proposal has refs), then admin email rows.
  // raw fetch: drafts.* overlay for the role base id.
  function primeValidRole(
    leadRefs: string[],
    admins: string[],
    adminRows: unknown[] = [],
    extra: { proposal?: unknown; titles?: { _id: string; title?: string }[] } = {},
  ) {
    const proposal = extra.proposal ?? null;
    const chain = opFetchMock
      .mockResolvedValueOnce([validRole(leadRefs)])
      .mockResolvedValueOnce({ admins, lead: { member_name: "Frank" }, proposal });
    if (extra.titles) chain.mockResolvedValueOnce(extra.titles);
    chain.mockResolvedValueOnce(adminRows);
  }

  it("pushes to admins and to co-leads, excluding the submitting lead", async () => {
    primeValidRole(["lead1", "lead2"], ["a1"]);
    await notifyProposalSubmitted(submit());

    const targets = sendPushMock.mock.calls.map((c) => c[0]);
    expect(targets).toContainEqual(["a1"]);        // admins
    expect(targets).toContainEqual(["lead2"]);     // co-lead, NOT lead1 (submitter)
    const coLeadCall = sendPushMock.mock.calls.find((c) => Array.isArray(c[0]) && c[0].includes("lead2"));
    expect(coLeadCall?.[2].path).toBe("/me/propose/r1");
  });

  it("does not push to co-leads when the lead is the only lead", async () => {
    primeValidRole(["lead1"], ["a1"]);
    await notifyProposalSubmitted(submit());
    // Only the admin push fires.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["a1"]);
  });

  it("emails an allowlisted admin", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted(submit());
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("admin@x.com");
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("Domingo");
    expect(sendEmailMock.mock.calls[0][0].html).not.toContain("Canción");
  });

  it("loads the proposal songs and notes into the admin email", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com" }], {
      proposal: {
        songs: [
          { play_key: "G", song: { _ref: "s1" } },
          { play_key: "D", medley_tag: "m", song: { _ref: "s2" } },
          { play_key: "D", medley_tag: "m", song: { _ref: "s3" } },
        ],
        // The row as `SUBMITTED_NOTIFY_QUERY` returns it: ALREADY filtered to
        // lead notes by `LEAD_NOTE_MESSAGES`. Two of them, because the email
        // must carry the lead's LAST word — taking `[0]` would mail their
        // oldest note forever, and both pass an "is the block non-empty" check.
        leadMessages: [
          { kind: "lead_note", body: "Una nota vieja" },
          { kind: "lead_note", body: "Ensayo <jueves> & más" },
        ],
      },
      titles: [
        { _id: "s1", title: "Abres Camino" },
        { _id: "s2", title: "Santo" },
        { _id: "s3", title: "Digno" },
      ],
    });
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted(submit());
    const html = sendEmailMock.mock.calls[0][0].html as string;
    expect(html).toContain("Abres Camino");
    expect(html).toContain("Santo");
    expect(html).toContain("Medley");
    // NOT `toContain("Notas del líder")` alone — that is the section label,
    // rendered whenever the block is non-empty, so it passes even if the body
    // came from the wrong message entirely.
    expect(html).toContain("Notas del líder");
    expect(html).toContain("Ensayo &lt;jueves&gt; &amp; más");
    expect(html).not.toContain("Una nota vieja");
    expect(html).not.toContain("Mov.");
    expect(html).not.toContain("<jueves>");
  });

  it("still pushes and emails when the song-title fetch throws", async () => {
    opFetchMock
      .mockResolvedValueOnce([validRole(["lead1"])])
      .mockResolvedValueOnce({
        admins: ["a1"],
        lead: { member_name: "Frank" },
        proposal: { songs: [{ play_key: "G", song: { _ref: "s1" } }] },
      })
      .mockRejectedValueOnce(new Error("titles boom"))
      .mockResolvedValueOnce([{ _id: "a1", email: "admin@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted(submit());
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["a1"]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].html).toContain("s1");
    expect(sendEmailMock.mock.calls[0][0].html).toContain("Revisar propuesta");
  });

  it("still emails when the proposal document is missing", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com" }], { proposal: null });
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted(submit());
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].html).toContain("Revisar propuesta");
    expect(sendEmailMock.mock.calls[0][0].html).not.toContain("Canción");
  });

  it("does not email a non-allowlisted admin", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "other@x.com" }]);
    await notifyProposalSubmitted(submit());
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips an admin who opted out of email (notifPrefs.email false)", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com", notifPrefs: { email: false } }]);
    await notifyProposalSubmitted(submit());
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips an admin who opted out of proposal email specifically (emailProposals false)", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com", notifPrefs: { emailProposals: false } }]);
    await notifyProposalSubmitted(submit());
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("never throws when the fetch fails", async () => {
    opFetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notifyProposalSubmitted(submit()),
    ).resolves.toBeUndefined();
  });

  // ── Fail-closed on non-canonical role identity: sends NOTHING ────────────────
  it("sends nothing when the role does not resolve (missing)", async () => {
    opFetchMock.mockResolvedValueOnce([]); // none
    await notifyProposalSubmitted(submit());
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the role id is ambiguous (duplicate canonical docs)", async () => {
    opFetchMock.mockResolvedValueOnce([validRole(["lead1"]), validRole(["lead2"])]);
    await notifyProposalSubmitted(submit());
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the resolved role is structurally invalid", async () => {
    // Missing seat arrays -> validateRole not groupable.
    opFetchMock.mockResolvedValueOnce([{ _id: "r1", _rev: "v1", _type: "sunday_role", week: "2026-07-05" }]);
    await notifyProposalSubmitted(submit());
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the role is draft-conflicted (a drafts. overlay exists)", async () => {
    opFetchMock.mockResolvedValueOnce([validRole(["lead1", "lead2"])]);
    rawFetchMock.mockResolvedValueOnce([{ _id: "drafts.r1" }]);
    await notifyProposalSubmitted(submit());
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
