// Child A Phase A — the pure mapping behind `scripts/migrate-proposal-messages.mjs`.
//
// The script itself is a one-shot production writer and is never executed here;
// every rule that decides WHAT it would write lives in `scripts/lib/proposalMessages.mjs`
// and is asserted below: the field mapping, both timestamp fallback chains, the
// attribution condition, the ordering, the deterministic-`_key` skip, and the
// hard abort on a live thread.
//
// The stored shape is asserted field-by-field on purpose. `buildProposalMessage`
// (`app/utils/proposalMessageWrite.ts`) re-derives the same fields in TypeScript
// and nothing makes the two agree at compile time, so
// `proposalMessageWrite.test.ts` pins the same set — `_type` included — from the
// other side. A migrated item carrying `_type` while a runtime item does not
// would leave the array permanently heterogeneous, half of it written
// irreversibly.

import { describe, expect, it } from "vitest";

import {
  ADMIN_MESSAGE_KEY,
  ATTRIBUTING_TRANSITION_ACTIONS,
  LEAD_MESSAGE_KEY,
  MIGRATION_KEYS,
  PROPOSAL_MESSAGE_TYPE,
  planProposalMessages,
  storedMessageCount,
  transitionAction,
} from "../lib/proposalMessages.mjs";

const BASE = {
  _id: "proposal-1",
  _rev: "rev-1",
  _createdAt: "2026-08-01T10:00:00Z",
  _updatedAt: "2026-08-09T10:00:00Z",
  status: "pending",
  lead: "member-lead",
  messageCount: 0,
  messageKeys: [],
};

describe("migration keys", () => {
  it("mints the two deterministic keys the plan names", () => {
    expect(LEAD_MESSAGE_KEY).toBe("migleadnote01");
    expect(ADMIN_MESSAGE_KEY).toBe("migadminnote1");
    expect(MIGRATION_KEYS).toEqual(["migleadnote01", "migadminnote1"]);
  });

  it("attributes an admin note only under request_changes or reopen", () => {
    expect([...ATTRIBUTING_TRANSITION_ACTIONS]).toEqual(["request_changes", "reopen"]);
  });
});

describe("field mapping", () => {
  it("maps lead_notes to a lead_note authored by the proposal's lead", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "  Falta el puente  ",
      last_edited_at: "2026-08-05T09:00:00Z",
      submitted_at: "2026-08-04T09:00:00Z",
    });
    expect(plan.decision).toBe("patch");
    expect(plan.messages).toEqual([
      {
        _key: "migleadnote01",
        _type: "proposal_message",
        author: { _ref: "member-lead", _type: "reference" },
        author_role: "lead",
        kind: "lead_note",
        body: "Falta el puente",
        at: "2026-08-05T09:00:00Z",
      },
    ]);
  });

  it("stores exactly the six fields plus _key and _type, and no others", () => {
    const plan = planProposalMessages({ ...BASE, lead_notes: "Hola" });
    expect(Object.keys(plan.messages[0]).sort()).toEqual(
      ["_key", "_type", "at", "author", "author_role", "body", "kind"].sort(),
    );
    expect(plan.messages[0]._type).toBe(PROPOSAL_MESSAGE_TYPE);
  });

  it("wraps last_transition.by, a PLAIN STRING id, as a reference", () => {
    const plan = planProposalMessages({
      ...BASE,
      admin_notes: "Cambia el cierre",
      last_transition: {
        action: "request_changes",
        by: "member-admin",
        at: "2026-08-06T09:00:00Z",
      },
    });
    expect(plan.messages).toEqual([
      {
        _key: "migadminnote1",
        _type: "proposal_message",
        author: { _ref: "member-admin", _type: "reference" },
        author_role: "admin",
        kind: "admin_change_request",
        body: "Cambia el cierre",
        at: "2026-08-06T09:00:00Z",
      },
    ]);
  });

  it("accepts a lead projected as a whole reference object as well as an id", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead: { _ref: "member-lead", _type: "reference" },
      lead_notes: "Hola",
    });
    expect(plan.messages[0].author).toEqual({ _ref: "member-lead", _type: "reference" });
  });

  it("mints no author at all when the lead reference is missing", () => {
    const plan = planProposalMessages({ ...BASE, lead: null, lead_notes: "Hola" });
    expect(plan.messages[0]).not.toHaveProperty("author");
    // The role, never the absence, is what the UI keys its fallback label on.
    expect(plan.messages[0].author_role).toBe("lead");
  });

  it("ignores a whitespace-only note", () => {
    const plan = planProposalMessages({ ...BASE, lead_notes: "   \n  ", admin_notes: "" });
    expect(plan.decision).toBe("noop");
    expect(plan.messages).toEqual([]);
  });
});

describe("attribution condition", () => {
  for (const action of ["request_changes", "reopen"]) {
    it(`attributes the admin note under ${action}`, () => {
      const plan = planProposalMessages({
        ...BASE,
        admin_notes: "nota",
        last_transition: { action, by: "member-admin", at: "2026-08-06T09:00:00Z" },
      });
      expect(plan.attributing).toBe(true);
      expect(plan.messages[0].author).toEqual({ _ref: "member-admin", _type: "reference" });
      expect(plan.messages[0].at).toBe("2026-08-06T09:00:00Z");
    });
  }

  it("refuses to attribute a reconcile_target retarget, and drops its timestamp too", () => {
    // reconcile_target writes last_transition while never touching admin_notes,
    // so borrowing either field would credit one admin's note to another —
    // permanently, with no edit path.
    const plan = planProposalMessages({
      ...BASE,
      admin_notes: "nota",
      reviewed_at: "2026-08-03T09:00:00Z",
      last_transition: {
        action: "reconcile_target",
        by: "member-other-admin",
        at: "2026-08-07T09:00:00Z",
      },
    });
    expect(plan.attributing).toBe(false);
    expect(plan.messages[0]).not.toHaveProperty("author");
    expect(plan.messages[0].at).toBe("2026-08-03T09:00:00Z");
  });

  it("leaves an approved proposal's admin note unattributed — approve writes no transition", () => {
    const plan = planProposalMessages({
      ...BASE,
      status: "approved",
      admin_notes: "nota",
      reviewed_at: "2026-08-03T09:00:00Z",
    });
    expect(plan.action).toBe("");
    expect(plan.messages[0]).not.toHaveProperty("author");
  });

  it("still mints an unattributed message when the action is right but `by` is absent", () => {
    const plan = planProposalMessages({
      ...BASE,
      admin_notes: "nota",
      last_transition: { action: "request_changes", at: "2026-08-06T09:00:00Z" },
    });
    expect(plan.messages[0]).not.toHaveProperty("author");
    expect(plan.messages[0].at).toBe("2026-08-06T09:00:00Z");
  });
});

describe("timestamp fallback chains", () => {
  it("walks last_edited_at → submitted_at → _createdAt for the lead note", () => {
    const at = (doc: Record<string, unknown>) =>
      planProposalMessages({ ...BASE, lead_notes: "n", ...doc }).messages[0].at;
    expect(
      at({ last_edited_at: "2026-08-05T00:00:00Z", submitted_at: "2026-08-04T00:00:00Z" }),
    ).toBe("2026-08-05T00:00:00Z");
    expect(at({ submitted_at: "2026-08-04T00:00:00Z" })).toBe("2026-08-04T00:00:00Z");
    expect(at({})).toBe(BASE._createdAt);
  });

  it("walks last_transition.at → reviewed_at → _updatedAt for the admin note", () => {
    const at = (doc: Record<string, unknown>) =>
      planProposalMessages({ ...BASE, admin_notes: "n", ...doc }).messages[0].at;
    expect(
      at({
        last_transition: { action: "reopen", at: "2026-08-06T00:00:00Z" },
        reviewed_at: "2026-08-03T00:00:00Z",
      }),
    ).toBe("2026-08-06T00:00:00Z");
    expect(at({ reviewed_at: "2026-08-03T00:00:00Z" })).toBe("2026-08-03T00:00:00Z");
    expect(at({})).toBe(BASE._updatedAt);
    // The action gates the timestamp exactly as it gates the author.
    expect(
      at({
        last_transition: { action: "reconcile_target", at: "2026-08-06T00:00:00Z" },
        reviewed_at: "2026-08-03T00:00:00Z",
      }),
    ).toBe("2026-08-03T00:00:00Z");
  });

  it("aborts rather than storing a message with no resolvable timestamp", () => {
    const plan = planProposalMessages({
      ...BASE,
      _createdAt: undefined,
      _updatedAt: undefined,
      lead_notes: "n",
    });
    expect(plan.decision).toBe("abort");
    expect(plan.reason).toBe("unresolvable_timestamp");
    expect(plan.messages).toEqual([]);
  });
});

describe("ordering", () => {
  it("orders the two messages by resolved `at`, ascending", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "lead",
      admin_notes: "admin",
      last_edited_at: "2026-08-08T00:00:00Z",
      reviewed_at: "2026-08-06T00:00:00Z",
    });
    expect(plan.messages.map((m: { _key: string }) => m._key)).toEqual([
      ADMIN_MESSAGE_KEY,
      LEAD_MESSAGE_KEY,
    ]);
  });

  it("compares `at` as an INSTANT, so a mixed offset does not order lexicographically", () => {
    // 10:00-06:00 is 16:00Z — an hour AFTER the admin note, though it sorts
    // before it as a string. Every resolved value is `Z` today; the order is
    // stored permanently, so the compare must be the one `proposalThread.ts`
    // documents for this field.
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "lead",
      admin_notes: "admin",
      last_edited_at: "2026-08-06T10:00:00-06:00",
      reviewed_at: "2026-08-06T11:00:00Z",
    });
    expect(plan.messages.map((m: { _key: string }) => m._key)).toEqual([
      ADMIN_MESSAGE_KEY,
      LEAD_MESSAGE_KEY,
    ]);
  });

  it("puts the lead first on a tie", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "lead",
      admin_notes: "admin",
      last_edited_at: "2026-08-06T00:00:00Z",
      reviewed_at: "2026-08-06T00:00:00Z",
    });
    expect(plan.messages.map((m: { _key: string }) => m._key)).toEqual([
      LEAD_MESSAGE_KEY,
      ADMIN_MESSAGE_KEY,
    ]);
  });
});

describe("safety", () => {
  it("HARD ABORTS on a live thread — a non-empty messages[] with no migration key", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "n",
      messageCount: 1,
      messageKeys: ["abc1234"],
    });
    expect(plan.decision).toBe("abort");
    expect(plan.reason).toBe("live_thread");
    expect(plan.messages).toEqual([]);
  });

  it("aborts on a live thread even when the document has nothing to migrate", () => {
    const plan = planProposalMessages({ ...BASE, messageCount: 1, messageKeys: ["abc1234"] });
    expect(plan.decision).toBe("abort");
    expect(plan.reason).toBe("live_thread");
  });

  it("counts a keyless stored item through count(messages), not through the key list", () => {
    // GROQ does NOT compact nulls: `messages[]._key` over a keyless item really
    // projects `[null]`. It is `storedMessageKeys` that drops the non-string,
    // leaving an empty key list that would read as "empty array, safe to
    // overwrite" — so `count(messages)` is what makes the abort fire.
    expect(storedMessageCount({ messageCount: 1, messageKeys: [null] })).toBe(1);
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "n",
      messageCount: 1,
      messageKeys: [null],
    });
    expect(plan.decision).toBe("abort");
    expect(plan.reason).toBe("live_thread");
    expect(plan.existingKeys).toEqual([]);
  });

  it("is idempotent: a second pass over its own output patches nothing", () => {
    const doc = {
      ...BASE,
      lead_notes: "lead",
      admin_notes: "admin",
      last_transition: { action: "request_changes", by: "member-admin", at: "2026-08-06T00:00:00Z" },
    };
    const first = planProposalMessages(doc);
    expect(first.decision).toBe("patch");
    expect(first.messages).toHaveLength(2);

    const migrated = {
      ...doc,
      messageCount: first.messages.length,
      messageKeys: first.messages.map((m: { _key: string }) => m._key),
    };
    const second = planProposalMessages(migrated);
    expect(second.decision).toBe("skip");
    expect(second.reason).toBe("already_migrated");
    expect(second.messages).toEqual([]);
  });

  it("skips when ANY key it would mint is present, never half-migrating a both-notes doc", () => {
    // A singular check ("is the lead key there?") would re-mint the admin note
    // on a re-run of a document that minted both.
    const doc = {
      ...BASE,
      lead_notes: "lead",
      admin_notes: "admin",
      messageCount: 2,
      messageKeys: [LEAD_MESSAGE_KEY, ADMIN_MESSAGE_KEY],
    };
    expect(planProposalMessages(doc).decision).toBe("skip");
    expect(
      planProposalMessages({ ...doc, messageCount: 1, messageKeys: [ADMIN_MESSAGE_KEY] }).decision,
    ).toBe("skip");
  });

  it("refuses a whole-array set that would drop a stored migration message", () => {
    // The one corner the abort/skip interlock leaves: a document already
    // carrying one migration message whose OTHER note appeared afterwards.
    const plan = planProposalMessages({
      ...BASE,
      admin_notes: "written after the lead note was migrated",
      messageCount: 1,
      messageKeys: [LEAD_MESSAGE_KEY],
    });
    expect(plan.decision).toBe("abort");
    expect(plan.reason).toBe("partial_migration");
    expect(plan.messages).toEqual([]);
  });

  it("never writes on any decision other than patch", () => {
    for (const doc of [
      { ...BASE },
      { ...BASE, messageCount: 1, messageKeys: ["live99"] },
      { ...BASE, lead_notes: "n", messageCount: 1, messageKeys: [LEAD_MESSAGE_KEY] },
    ]) {
      const plan = planProposalMessages(doc);
      expect(plan.decision).not.toBe("patch");
      expect(plan.messages).toEqual([]);
    }
  });
});

describe("reporting helpers", () => {
  it("surfaces the resolved transition action so the dry run can print it", () => {
    expect(transitionAction({ last_transition: { action: "reopen" } })).toBe("reopen");
    expect(transitionAction({})).toBe("");
    expect(transitionAction(null)).toBe("");
  });

  it("resolves the admin author ONCE, for the printed line and the minted message alike", () => {
    const transition = { action: "request_changes", by: "member-admin", at: "2026-08-06T09:00:00Z" };
    const attributed = planProposalMessages({
      ...BASE,
      admin_notes: "nota",
      last_transition: transition,
    });
    expect(attributed.adminAuthorId).toBe("member-admin");
    expect(attributed.messages[0].author).toEqual({ _ref: "member-admin", _type: "reference" });

    // A blank `by` is NOT an author. The dry run reads this field rather than
    // `doc.last_transition?.by ?? …`, which would print `author=` here.
    const blank = planProposalMessages({
      ...BASE,
      admin_notes: "nota",
      last_transition: { ...transition, by: "   " },
    });
    expect(blank.adminAuthorId).toBe("");
    expect(blank.messages[0]).not.toHaveProperty("author");

    // Reported on a REFUSED document too, which mints no message to read it off.
    const refused = planProposalMessages({
      ...BASE,
      admin_notes: "nota",
      last_transition: transition,
      messageCount: 1,
      messageKeys: ["live99"],
    });
    expect(refused.decision).toBe("abort");
    expect(refused.adminAuthorId).toBe("member-admin");
  });

  it("reports the migration keys already present on the document", () => {
    const plan = planProposalMessages({
      ...BASE,
      lead_notes: "n",
      messageCount: 1,
      messageKeys: [LEAD_MESSAGE_KEY],
    });
    expect(plan.migrationKeysPresent).toEqual([LEAD_MESSAGE_KEY]);
    expect(plan.existingCount).toBe(1);
  });
});
