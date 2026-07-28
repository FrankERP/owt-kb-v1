# Service Notification Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email members when the setlist of a service they serve appears or changes, and when they are added to, removed from, or moved within a service — grouped into one debounced email per person instead of one per edit.

**Architecture:** A new Sanity document type, `notificationOutbox`, buffers "this subject changed" notices. Every protected writer upserts a notice post-commit with a pre-commit snapshot of the prior state. A sweep — triggered by a GitHub Actions cron, opportunistically by admin writes, and by the existing daily Vercel cron — selects due notices, classifies each against live state, groups the resulting lines per recipient, sends one email each, and consumes the notices. Delivery is best-effort with no retry.

**Tech Stack:** Next.js 16 App Router, React 19, Sanity v5 (`next-sanity`), nodemailer over pooled SMTP, vitest, Node 22.

**Spec:** [`docs/superpowers/specs/2026-07-27-service-notification-emails-design.md`](../specs/2026-07-27-service-notification-emails-design.md) — read §1 before Task 3, §6 before Task 8.

## Global Constraints

- **Timezone is `America/Mexico_City`.** Service dates are Sanity `date` (`YYYY-MM-DD`). Render pinned to local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Server "today": `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`.
- **`saturdarSongs` is a deliberate stored typo.** Never rename it.
- **Five member-referencing seats** on role docs: `Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`, `foh_team[].person._ref`. Any "who serves" query reuses `assignedMemberRefsQuery()`.
- **Member-facing reads filter `published != false`.**
- **Sanity array-of-object writes need a `_key` per item.**
- **Reads of protected types use `operationalClient`; writes use `writeClient`.** `operationalClient` carries a read token only.
- **UI copy is Spanish.** Match the app's existing vocabulary — the group label is `Medley` (`DayCard.tsx:191`), and role phrasing is "Sirves como…", never "Cantas como…", because three of the five seat paths do not sing.
- **Both gates must pass before any task is done:** `npx tsc --noEmit` and `npm test`.
- **Conventional commits.** Body explains the *why*. **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- **Palette comes from `app/brand.css`:** blackout `#010B17`, console `#071624`, deck `#0D2234`, beam `#12C8F4`, signal `#37F58A`, frost `#D7E7F6`, steel `#7F94A8`. The one approved exception is amber `#F5B437` for downward movement arrows.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `sanity/schemas/notificationOutbox.ts` | The outbox document type |
| `app/utils/notifyPrefs.ts` | The single per-type preference resolver every sender uses |
| `app/utils/outboxNotice.ts` | Pure: id derivation, snapshot shapes, upsert/claim/consume mutation builders |
| `app/utils/outboxClassify.ts` | Pure: `before` vs live → classified lines, per kind |
| `app/utils/setlistDiff.ts` | Pure: ordered song rows → standings-table rows with `▲n`/`▼n`/`–`/`NUEVA`/`SALIÓ` |
| `app/utils/notificationEmail.ts` | Renders every template; owns the dark on-brand HTML |
| `app/utils/outboxSweep.ts` | The one sweep function; select → claim → classify → filter → group → send → consume |
| `app/api/cron/flush-notifications/route.ts` | Layer-1 trigger |
| `.github/workflows/flush-notifications.yml` | The 5-minute schedule |

**Modified**

| File | Change |
|---|---|
| `sanity/schema.ts` | Register `notificationOutbox` |
| `sanity/schemas/worshipTeam.ts` | Five new `notifPrefs` booleans |
| `app/utils/studioProtection.ts` (+ test) | Compose delete-only with hidden-from-authoring |
| `app/utils/protectedReadAudit.ts` (+ test) | Register the new protected-write sites |
| `app/utils/serviceMutationSideEffects.ts` (+ test) | Queue notices; drop the assignment-email leg |
| `app/utils/assignmentEmail.ts` (+ test) | Route through `notifyPrefs`; restyle |
| `app/utils/proposalNotify.ts` | Route through `notifyPrefs`; restyle |
| The ten writers in spec §2 | Capture `before` pre-commit, queue post-commit, declare `maxDuration` |
| `app/api/me/notif-prefs/route.ts`, `app/api/admin/members/[id]/route.ts` | Accept the five fields |
| `app/components/ProfilePanel.tsx`, `app/components/admin/AdminPanel.tsx` | Five toggles rendering **resolved** values |
| `app/api/cron/service-reminders/route.ts` | Layer-3 trigger + liveness alarm |

---

## Task 1: The preference resolver

Every sender must consult one function. Doing this first means no later task can accidentally read `notifPrefs` directly.

**Files:**
- Create: `app/utils/notifyPrefs.ts`
- Test: `app/utils/__tests__/notifyPrefs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type NotifyKind = "assigned" | "removed" | "roleChanged" | "setlist" | "proposals"`; `wantsNotification(prefs: unknown, kind: NotifyKind): boolean`; `NOTIFY_PREF_FIELD: Record<NotifyKind, string>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/notifyPrefs.test.ts
import { describe, expect, it } from "vitest";
import { NOTIFY_PREF_FIELD, wantsNotification } from "../notifyPrefs";

describe("wantsNotification", () => {
  it("defaults to true when nothing is set", () => {
    expect(wantsNotification({}, "assigned")).toBe(true);
    expect(wantsNotification(undefined, "setlist")).toBe(true);
  });

  it("uses the specific field when it is a boolean", () => {
    expect(wantsNotification({ emailAssigned: false }, "assigned")).toBe(false);
    expect(wantsNotification({ emailAssigned: true, email: false }, "assigned")).toBe(true);
  });

  it("falls back to the legacy email field when the specific one is unset", () => {
    // A member who opted out before per-type toggles existed stays opted out of
    // all five. Nobody starts receiving mail they had switched off.
    for (const kind of ["assigned", "removed", "roleChanged", "setlist", "proposals"] as const) {
      expect(wantsNotification({ email: false }, kind)).toBe(false);
      expect(wantsNotification({ email: true }, kind)).toBe(true);
    }
  });

  it("treats a non-boolean specific field as unset", () => {
    expect(wantsNotification({ emailSetlist: "yes", email: false }, "setlist")).toBe(false);
  });

  it("maps every kind to its stored field name", () => {
    expect(NOTIFY_PREF_FIELD).toEqual({
      assigned: "emailAssigned",
      removed: "emailRemoved",
      roleChanged: "emailRoleChanged",
      setlist: "emailSetlist",
      proposals: "emailProposals",
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/notifyPrefs.test.ts`
Expected: FAIL — `Cannot find module '../notifyPrefs'`.

- [ ] **Step 3: Implement**

```ts
// app/utils/notifyPrefs.ts
// The single per-type email preference resolver. Every sender goes through it —
// nothing reads `notifPrefs` fields directly — so a member's choice cannot be
// honoured on one path and ignored on another.

export type NotifyKind = "assigned" | "removed" | "roleChanged" | "setlist" | "proposals";

export const NOTIFY_PREF_FIELD: Record<NotifyKind, string> = {
  assigned: "emailAssigned",
  removed: "emailRemoved",
  roleChanged: "emailRoleChanged",
  setlist: "emailSetlist",
  proposals: "emailProposals",
};

/**
 * Opt-out semantics with a legacy fallback and NO data migration: an explicit
 * boolean on the per-type field wins; otherwise the pre-existing
 * `notifPrefs.email` decides. A member who opted out before per-type toggles
 * existed therefore stays opted out of all five.
 */
export function wantsNotification(prefs: unknown, kind: NotifyKind): boolean {
  const bag = (prefs && typeof prefs === "object" ? prefs : {}) as Record<string, unknown>;
  const specific = bag[NOTIFY_PREF_FIELD[kind]];
  if (typeof specific === "boolean") return specific;
  return bag.email !== false;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run app/utils/__tests__/notifyPrefs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/utils/notifyPrefs.ts app/utils/__tests__/notifyPrefs.test.ts
git commit -m "feat(notifications): add the single per-type preference resolver

Five per-type toggles replace one boolean, so the resolution rule has to live
in exactly one place or a member's choice gets honoured on one send path and
ignored on another. The legacy field stays as the fallback, which means nobody
who already opted out starts receiving mail and no migration is needed."
```

---

## Task 2: Schema — outbox document and the five preference fields

**Files:**
- Create: `sanity/schemas/notificationOutbox.ts`
- Modify: `sanity/schema.ts:20`, `sanity/schemas/worshipTeam.ts:71-87`
- Test: `app/utils/__tests__/notificationOutboxSchema.test.ts`

**Interfaces:**
- Produces: document type `notificationOutbox` with fields `kind`, `subjectKey`, `memberId`, `roleId`, `proposalId`, `serviceDate`, `roleType`, `before`, `knownRecipients`, `firstQueuedAt`, `notifyAfter`, `deadline`, `status`, `claimedAt`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/notificationOutboxSchema.test.ts
import { describe, expect, it } from "vitest";
import { notificationOutbox } from "@/sanity/schemas/notificationOutbox";
import { schema } from "@/sanity/schema";

const fields = (notificationOutbox.fields as { name: string; type: string }[]);
const byName = (n: string) => fields.find((f) => f.name === n);

describe("notificationOutbox schema", () => {
  it("is hidden from authoring — it is written only by the server token", () => {
    expect(notificationOutbox.hidden).toBe(true);
  });

  it("carries the identity snapshot used when the subject is gone", () => {
    expect(byName("serviceDate")?.type).toBe("string");
    expect(byName("roleType")?.type).toBe("string");
  });

  it("carries the lifecycle fields the sweep depends on", () => {
    for (const n of ["firstQueuedAt", "notifyAfter", "deadline", "claimedAt"]) {
      expect(byName(n)?.type).toBe("datetime");
    }
    expect(byName("status")?.type).toBe("string");
  });

  it("stores before-snapshots as three typed fields, not a JSON blob", () => {
    const before = byName("before") as unknown as { fields: { name: string }[] };
    expect(before.fields.map((f) => f.name).sort())
      .toEqual(["beforeNotes", "beforeRoles", "beforeSongs"]);
  });

  it("is registered in the studio schema", () => {
    expect(schema.types.map((t) => (t as { name: string }).name)).toContain("notificationOutbox");
  });
});

describe("notifPrefs", () => {
  it("gains the five per-type email fields, all defaulting to true", () => {
    const teamMembers = schema.types.find((t) => (t as { name: string }).name === "teamMembers") as
      unknown as { fields: { name: string; fields?: { name: string; initialValue?: unknown }[] }[] };
    const prefs = teamMembers.fields.find((f) => f.name === "notifPrefs");
    const names = prefs?.fields?.map((f) => f.name) ?? [];
    for (const n of ["emailAssigned", "emailRemoved", "emailRoleChanged", "emailSetlist", "emailProposals"]) {
      expect(names).toContain(n);
      expect(prefs?.fields?.find((f) => f.name === n)?.initialValue).toBe(true);
    }
    // The legacy field stays: it is the fallback for members who opted out.
    expect(names).toContain("email");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/notificationOutboxSchema.test.ts`
Expected: FAIL — cannot resolve `@/sanity/schemas/notificationOutbox`.

- [ ] **Step 3: Create the schema**

```ts
// sanity/schemas/notificationOutbox.ts
// A debounce record, not a delivery ledger (spec §1). It buffers "this subject
// changed" until the subject goes quiet, is classified against live state, and
// is consumed. Written only by the server write token through the guarded
// writers — `hidden: true` keeps it off the authoring surface entirely.

export const notificationOutbox = {
  name: "notificationOutbox",
  title: "Notification outbox",
  type: "document",
  hidden: true,
  readOnly: true,
  fields: [
    { name: "kind", type: "string", options: { list: ["role", "setlist", "leadNotes"] } },
    { name: "subjectKey", type: "string" },

    // Stored rather than re-parsed out of subjectKey.
    { name: "memberId", type: "string" },
    { name: "roleId", type: "string" },
    { name: "proposalId", type: "string" },

    // Identity snapshot: the fallback for rendering a subject line when the
    // subject document is gone at flush (a deleted role still owes its
    // assignees an email whose subject carries a date).
    { name: "serviceDate", type: "string" },
    { name: "roleType", type: "string" },

    {
      name: "before",
      type: "object",
      fields: [
        { name: "beforeRoles", type: "array", of: [{ type: "string" }] },
        {
          name: "beforeSongs",
          type: "array",
          of: [{
            type: "object",
            name: "outboxSongRow",
            fields: [
              { name: "ref", type: "string" },
              { name: "key", type: "string" },
              // Index of the contiguous medley run, or absent for a standalone
              // song. Never a raw medley_tag — those are regenerated on every
              // editor write and would make every edit compare as changed.
              { name: "group", type: "number" },
            ],
          }],
        },
        { name: "beforeNotes", type: "text" },
      ],
    },

    // Recipients known when the notice was queued. Anyone absent is new to the
    // subject and gets an introduction rather than a diff.
    { name: "knownRecipients", type: "array", of: [{ type: "string" }] },

    { name: "firstQueuedAt", type: "datetime" },
    { name: "notifyAfter", type: "datetime" },
    { name: "deadline", type: "datetime" },
    { name: "status", type: "string", options: { list: ["pending", "sending"] } },
    { name: "claimedAt", type: "datetime" },
  ],
};
```

- [ ] **Step 4: Register it and add the preference fields**

In `sanity/schema.ts`, add the import and append `notificationOutbox` to the `types` array on line 20.

In `sanity/schemas/worshipTeam.ts`, inside the `notifPrefs` object's `fields` array (after the existing `email` field), add:

```ts
        {
          name: "emailAssigned",
          title: "Nuevas asignaciones por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailRemoved",
          title: "Avisos de baja por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailRoleChanged",
          title: "Cambios de rol por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailSetlist",
          title: "Setlist por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailProposals",
          title: "Propuestas por correo",
          type: "boolean",
          initialValue: true,
        },
```

- [ ] **Step 5: Run the tests and the type gate**

Run: `npx vitest run app/utils/__tests__/notificationOutboxSchema.test.ts && npx tsc --noEmit`
Expected: PASS, 6 tests; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add sanity/schemas/notificationOutbox.ts sanity/schema.ts sanity/schemas/worshipTeam.ts app/utils/__tests__/notificationOutboxSchema.test.ts
git commit -m "feat(notifications): add the outbox document type and per-type prefs

The outbox stores before-snapshots as three typed fields rather than a JSON
blob so the song rows can carry _key like every other array-of-object write
here. Song rows record a medley run index rather than a medley_tag, because
normalizeMedleyTags mints fresh tags on every editor write and comparing raw
tags would report a change whenever any unrelated song moved.

The legacy notifPrefs.email field stays as the fallback for the five new
booleans, so no member who already opted out starts receiving mail."
```

---

## Task 3: Outbox notice — ids, snapshots, mutation builders

Read spec §1 before starting.

**Files:**
- Create: `app/utils/outboxNotice.ts`
- Test: `app/utils/__tests__/outboxNotice.test.ts`

**Interfaces:**
- Consumes: `receiptIdForRequestId` pattern from `app/utils/roleCreationReceipt.ts:196` (digest ids).
- Produces:
  - `outboxId(kind: NoticeKind, subjectKey: string): string`
  - `songRowsFrom(songs: unknown): OutboxSongRow[]`
  - `type OutboxSongRow = { _key: string; ref: string; key: string; group: number | null }`
  - `buildUpsert(input: UpsertInput, now: Date): { createIfNotExists: Record<string, unknown>; patchSet: Record<string, unknown> }`
  - `isDue(notice: NoticeLifecycle, now: Date, claimTtlMs: number): boolean`
  - `NOTICE_KINDS = ["role", "setlist", "leadNotes"] as const`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/outboxNotice.test.ts
import { describe, expect, it } from "vitest";
import { buildUpsert, isDue, outboxId, songRowsFrom } from "../outboxNotice";

const NOW = new Date("2026-08-01T10:00:00.000Z");
const DEBOUNCE = 15 * 60_000;
const MAX_WINDOW = 60 * 60_000;
const CLAIM_TTL = 5 * 60_000;

describe("outboxId", () => {
  it("is deterministic for the same subject", () => {
    expect(outboxId("role", "m1__r1")).toBe(outboxId("role", "m1__r1"));
  });

  it("separates kinds that share a subject key", () => {
    expect(outboxId("role", "r1")).not.toBe(outboxId("setlist", "r1"));
  });

  it("stays inside Sanity's id ceiling even for two 200-char ids", () => {
    const long = "a".repeat(200);
    expect(outboxId("role", `${long}__${long}`).length).toBeLessThanOrEqual(128);
  });

  it("produces an id Sanity accepts", () => {
    expect(outboxId("setlist", "r1")).toMatch(/^outbox\.[a-z]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("songRowsFrom", () => {
  const song = (ref: string, key: string, tag?: string) => ({
    _key: `k-${ref}`, play_key: key, medley_tag: tag, song: { _ref: ref },
  });

  it("records the run index rather than the tag", () => {
    // Two adjacent songs share a tag -> run 0. The tag VALUE is never stored.
    const rows = songRowsFrom([song("a", "G"), song("b", "D", "t1"), song("c", "D", "t1")]);
    expect(rows.map((r) => r.group)).toEqual([null, 0, 0]);
    expect(JSON.stringify(rows)).not.toContain("t1");
  });

  it("normalizes a one-song run to null", () => {
    // buildRuns emits a one-song medley run from stored data; the renderer draws
    // it as a plain single, so the comparison must agree.
    expect(songRowsFrom([song("a", "G", "lonely")])[0].group).toBeNull();
  });

  it("gives two different tag values with identical grouping the same rows", () => {
    const a = songRowsFrom([song("x", "A", "t1"), song("y", "A", "t1")]);
    const b = songRowsFrom([song("x", "A", "zz"), song("y", "A", "zz")]);
    expect(a.map((r) => ({ ...r, _key: "" }))).toEqual(b.map((r) => ({ ...r, _key: "" })));
  });

  it("carries a _key on every row", () => {
    expect(songRowsFrom([song("a", "G")])[0]._key).toBeTruthy();
  });

  it("tolerates junk", () => {
    expect(songRowsFrom(null)).toEqual([]);
    expect(songRowsFrom([{}, { song: {} }])).toEqual([]);
  });
});

describe("buildUpsert", () => {
  const input = {
    kind: "role" as const,
    subjectKey: "m1__r1",
    memberId: "m1",
    roleId: "r1",
    proposalId: null,
    serviceDate: "2026-08-09",
    roleType: "sunday_role" as const,
    before: { beforeRoles: ["BGV"] },
    knownRecipients: ["m1"],
  };

  it("creates with the ceiling and patches only the sliding fields", () => {
    const { createIfNotExists, patchSet } = buildUpsert(input, NOW);
    expect(createIfNotExists.deadline).toBe(new Date(NOW.getTime() + MAX_WINDOW).toISOString());
    expect(createIfNotExists.firstQueuedAt).toBe(NOW.toISOString());
    expect(createIfNotExists.status).toBe("pending");
    // The patch must never carry `deadline` — it is written once, at creation.
    expect(patchSet).toEqual({
      notifyAfter: new Date(NOW.getTime() + DEBOUNCE).toISOString(),
      status: "pending",
    });
  });

  it("uses the deterministic id", () => {
    expect(buildUpsert(input, NOW).createIfNotExists._id).toBe(outboxId("role", "m1__r1"));
  });
});

describe("isDue", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it("is due when the debounce has elapsed", () => {
    expect(isDue({ status: "pending", notifyAfter: at(-1), deadline: at(MAX_WINDOW), claimedAt: null }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("is not due while the window is sliding", () => {
    expect(isDue({ status: "pending", notifyAfter: at(60_000), deadline: at(MAX_WINDOW), claimedAt: null }, NOW, CLAIM_TTL)).toBe(false);
  });

  it("is due at the ceiling even while edits continue", () => {
    // Defeats starvation: an admin saving every 10 minutes forever.
    expect(isDue({ status: "pending", notifyAfter: at(600_000), deadline: at(-1), claimedAt: null }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("reclaims a notice whose lease expired", () => {
    // Without this a killed sweep strands the notice in `sending` permanently.
    expect(isDue({ status: "sending", notifyAfter: at(-1), deadline: at(-1), claimedAt: at(-CLAIM_TTL - 1) }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("leaves a live lease alone", () => {
    expect(isDue({ status: "sending", notifyAfter: at(-1), deadline: at(-1), claimedAt: at(-1000) }, NOW, CLAIM_TTL)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/outboxNotice.test.ts`
Expected: FAIL — `Cannot find module '../outboxNotice'`.

- [ ] **Step 3: Implement**

```ts
// app/utils/outboxNotice.ts
// Pure helpers for the notification outbox (spec §1). No I/O: the callers own
// the Sanity client and may only act on values produced here.

import { createHash } from "node:crypto";
import { buildRuns } from "./medley";

export const NOTICE_KINDS = ["role", "setlist", "leadNotes"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface OutboxSongRow {
  _key: string;
  ref: string;
  key: string;
  /** Index of the contiguous medley run, or null for a standalone song. */
  group: number | null;
}

/**
 * Deterministic AND length-bounded. `${memberId}__${roleId}` composes two ids
 * that `isCanonicalDocumentId` allows at 200 chars each, which would overflow
 * Sanity's id ceiling — so the subject is digested, the way
 * `receiptIdForRequestId` already does for this shape.
 */
export function outboxId(kind: NoticeKind, subjectKey: string): string {
  const digest = createHash("sha256").update(`${kind}:${subjectKey}`).digest("base64url").slice(0, 32);
  return `outbox.${kind.toLowerCase()}.${digest}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Snapshot a stored `songs` array as ordered rows carrying the medley
 * PARTITION, never the tag values: `normalizeMedleyTags` mints a fresh tag for
 * every group on every editor write, so tag equality would report a change
 * whenever any unrelated song was touched. A one-song run normalizes to `null`
 * so the comparison agrees with the renderer, which draws it as a plain single.
 */
export function songRowsFrom(songs: unknown): OutboxSongRow[] {
  if (!Array.isArray(songs)) return [];
  const items = songs
    .filter(isObj)
    .map((s) => ({
      ref: isObj(s.song) && typeof s.song._ref === "string" ? s.song._ref : "",
      key: typeof s.play_key === "string" ? s.play_key : "",
      medley_tag: typeof s.medley_tag === "string" ? s.medley_tag : undefined,
    }))
    .filter((s) => s.ref);

  const rows: OutboxSongRow[] = [];
  let groupIndex = 0;
  for (const run of buildRuns(items)) {
    if (run.kind === "medley" && run.songs.length >= 2) {
      const g = groupIndex++;
      for (const { song } of run.songs) {
        rows.push({ _key: `s${rows.length}`, ref: song.ref, key: song.key, group: g });
      }
    } else {
      const song = run.kind === "single" ? run.song : run.songs[0].song;
      rows.push({ _key: `s${rows.length}`, ref: song.ref, key: song.key, group: null });
    }
  }
  return rows;
}

export interface UpsertInput {
  kind: NoticeKind;
  subjectKey: string;
  memberId: string | null;
  roleId: string | null;
  proposalId: string | null;
  serviceDate: string;
  roleType: "sunday_role" | "saturday_role" | "special_role" | null;
  before: { beforeRoles?: string[]; beforeSongs?: OutboxSongRow[]; beforeNotes?: string };
  knownRecipients: string[];
}

export const DEBOUNCE_MS = Number(process.env.NOTIFY_DEBOUNCE_MINUTES ?? 15) * 60_000;
export const MAX_WINDOW_MS = Number(process.env.NOTIFY_MAX_WINDOW_MINUTES ?? 60) * 60_000;
export const CLAIM_TTL_MS = Number(process.env.NOTIFY_CLAIM_TTL_MINUTES ?? 5) * 60_000;

/**
 * `createIfNotExists` writes the identity, the snapshot and the CEILING once —
 * they survive a whole burst of edits. The patch slides only `notifyAfter` and
 * re-pends. `deadline` is deliberately absent from the patch: writing it twice
 * would either kill the starvation ceiling or make a re-pended notice instantly
 * due, and Sanity cannot express "set only if unset" on one `.set()`.
 */
export function buildUpsert(input: UpsertInput, now: Date) {
  const _id = outboxId(input.kind, input.subjectKey);
  return {
    createIfNotExists: {
      _id,
      _type: "notificationOutbox",
      kind: input.kind,
      subjectKey: input.subjectKey,
      memberId: input.memberId,
      roleId: input.roleId,
      proposalId: input.proposalId,
      serviceDate: input.serviceDate,
      roleType: input.roleType,
      before: input.before,
      knownRecipients: input.knownRecipients,
      firstQueuedAt: now.toISOString(),
      notifyAfter: new Date(now.getTime() + DEBOUNCE_MS).toISOString(),
      deadline: new Date(now.getTime() + MAX_WINDOW_MS).toISOString(),
      status: "pending",
      claimedAt: null,
    } as Record<string, unknown>,
    patchSet: {
      notifyAfter: new Date(now.getTime() + DEBOUNCE_MS).toISOString(),
      status: "pending",
    } as Record<string, unknown>,
  };
}

export interface NoticeLifecycle {
  status: "pending" | "sending";
  notifyAfter: string;
  deadline: string;
  claimedAt: string | null;
}

/** Due on debounce elapsed, on the ceiling, or on an EXPIRED LEASE. */
export function isDue(n: NoticeLifecycle, now: Date, claimTtlMs = CLAIM_TTL_MS): boolean {
  const t = now.getTime();
  if (n.status === "pending") {
    return Math.min(Date.parse(n.notifyAfter), Date.parse(n.deadline)) <= t;
  }
  if (!n.claimedAt) return true;
  return Date.parse(n.claimedAt) + claimTtlMs <= t;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run app/utils/__tests__/outboxNotice.test.ts && npx tsc --noEmit`
Expected: PASS, 14 tests; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/utils/outboxNotice.ts app/utils/__tests__/outboxNotice.test.ts
git commit -m "feat(notifications): add outbox ids, snapshots and mutation builders

Song snapshots record the medley partition rather than medley_tag values,
because normalizeMedleyTags mints a fresh tag for every group on every editor
write — comparing tags would report a change whenever any unrelated song moved,
and would put a NUEVO chip on every medley in the email.

deadline is written by createIfNotExists and never by the patch. Sanity cannot
express set-only-if-unset on a single .set(), so allowing both paths to write it
would either defeat the starvation ceiling or make a re-pended notice instantly
due, depending on which way the implementer resolved it.

Ids are digested rather than composed, since two 200-char document ids would
overflow Sanity's id ceiling."
```

---

## Task 4: Classification

**Files:**
- Create: `app/utils/outboxClassify.ts`
- Test: `app/utils/__tests__/outboxClassify.test.ts`

**Interfaces:**
- Consumes: `OutboxSongRow` from Task 3.
- Produces:
  - `type LineKind = "assigned" | "removed" | "roleChanged" | "setlistReady" | "setlistChanged" | "leadNotes"`
  - `type Line = { kind: LineKind; serviceDate: string; roleType: string | null; before: string[]; after: string[]; songs?: OutboxSongRow[]; beforeSongs?: OutboxSongRow[]; notes?: string }`
  - `classifyRole(input): Line | null`, `classifySetlist(input): Line | null`, `classifyLeadNotes(input): Line | null`
  - `LINE_PREF: Record<LineKind, NotifyKind>`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/outboxClassify.test.ts
import { describe, expect, it } from "vitest";
import { classifyLeadNotes, classifyRole, classifySetlist, LINE_PREF } from "../outboxClassify";

const TODAY = "2026-08-01";
const FUTURE = "2026-08-09";
const row = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

describe("classifyRole", () => {
  const base = { serviceDate: FUTURE, roleType: "sunday_role" as const, today: TODAY, roleExists: true, published: true };

  it("empty -> non-empty is a new assignment", () => {
    expect(classifyRole({ ...base, before: [], after: ["Líder"] })?.kind).toBe("assigned");
  });

  it("non-empty -> empty is a removal", () => {
    expect(classifyRole({ ...base, before: ["BGV"], after: [] })?.kind).toBe("removed");
  });

  it("different non-empty sets are a role change", () => {
    const line = classifyRole({ ...base, before: ["BGV"], after: ["Líder"] });
    expect(line?.kind).toBe("roleChanged");
    expect(line?.before).toEqual(["BGV"]);
    expect(line?.after).toEqual(["Líder"]);
  });

  it("an unchanged set says nothing", () => {
    // Remove-then-re-add inside the window collapses to silence.
    expect(classifyRole({ ...base, before: ["BGV"], after: ["BGV"] })).toBeNull();
  });

  it("drops silently when the service is now unpublished", () => {
    expect(classifyRole({ ...base, published: false, before: ["BGV"], after: [] })).toBeNull();
  });

  it("a deleted role tells the people who knew about it", () => {
    expect(classifyRole({ ...base, roleExists: false, before: ["BGV"], after: [] })?.kind).toBe("removed");
  });

  it("a deleted role says NOTHING to people who were never introduced", () => {
    // Create a published service at 10:00, delete it at 10:05: every assignee
    // has before=[] and would otherwise be told they no longer participate in a
    // service they were never told existed.
    expect(classifyRole({ ...base, roleExists: false, before: [], after: [] })).toBeNull();
  });

  it("drops a service whose date has passed", () => {
    expect(classifyRole({ ...base, serviceDate: "2026-07-31", before: [], after: ["Líder"] })).toBeNull();
  });

  it("keeps a service happening today", () => {
    expect(classifyRole({ ...base, serviceDate: TODAY, before: [], after: ["Líder"] })?.kind).toBe("assigned");
  });
});

describe("classifySetlist", () => {
  const base = { serviceDate: FUTURE, roleType: "sunday_role" as const, today: TODAY, roleExists: true, published: true, dateMatches: true };

  it("empty -> songs introduces the setlist", () => {
    expect(classifySetlist({ ...base, before: [], after: [row("a", "G")] })?.kind).toBe("setlistReady");
  });

  it("a changed key is a change", () => {
    expect(classifySetlist({ ...base, before: [row("a", "E")], after: [row("a", "G")] })?.kind).toBe("setlistChanged");
  });

  it("a reorder is a change", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G"), row("b", "D")], after: [row("b", "D"), row("a", "G")] })?.kind).toBe("setlistChanged");
  });

  it("a regrouping is a change even with identical songs and keys", () => {
    expect(classifySetlist({
      ...base,
      before: [row("a", "G"), row("b", "D")],
      after: [row("a", "G", 0), row("b", "D", 0)],
    })?.kind).toBe("setlistChanged");
  });

  it("an identical list says nothing", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G")], after: [row("a", "G")] })).toBeNull();
  });

  it("an emptied setlist is work in progress, not news", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G")], after: [] })).toBeNull();
  });

  it("drops when unpublished, when the role is gone, or when the date moved", () => {
    const after = [row("a", "G")];
    expect(classifySetlist({ ...base, published: false, before: [], after })).toBeNull();
    expect(classifySetlist({ ...base, roleExists: false, before: [], after })).toBeNull();
    expect(classifySetlist({ ...base, dateMatches: false, before: [], after })).toBeNull();
  });
});

describe("classifyLeadNotes", () => {
  const base = { serviceDate: FUTURE, today: TODAY, reviewable: true };

  it("reports a real change", () => {
    expect(classifyLeadNotes({ ...base, before: "", after: "Bajé la tonalidad" })?.kind).toBe("leadNotes");
  });

  it("ignores whitespace-only differences", () => {
    expect(classifyLeadNotes({ ...base, before: "hola", after: "  hola  " })).toBeNull();
  });

  it("drops when the proposal is no longer reviewable", () => {
    expect(classifyLeadNotes({ ...base, reviewable: false, before: "", after: "x" })).toBeNull();
  });
});

describe("LINE_PREF", () => {
  it("maps every line kind to the toggle that gates it", () => {
    expect(LINE_PREF).toEqual({
      assigned: "assigned",
      removed: "removed",
      roleChanged: "roleChanged",
      setlistReady: "setlist",
      setlistChanged: "setlist",
      leadNotes: "proposals",
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/outboxClassify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/utils/outboxClassify.ts
// Classification: a queue-time snapshot versus live state (spec §1). Pure — the
// sweep does the reads and hands the values in.

import type { NotifyKind } from "./notifyPrefs";
import type { OutboxSongRow } from "./outboxNotice";

export type LineKind =
  | "assigned" | "removed" | "roleChanged"
  | "setlistReady" | "setlistChanged"
  | "leadNotes";

export const LINE_PREF: Record<LineKind, NotifyKind> = {
  assigned: "assigned",
  removed: "removed",
  roleChanged: "roleChanged",
  setlistReady: "setlist",
  setlistChanged: "setlist",
  leadNotes: "proposals",
};

export interface Line {
  kind: LineKind;
  serviceDate: string;
  roleType: string | null;
  before: string[];
  after: string[];
  songs?: OutboxSongRow[];
  beforeSongs?: OutboxSongRow[];
  notes?: string;
}

/** Calendar-day comparison; both sides are already America/Mexico_City dates. */
const isPast = (serviceDate: string, today: string) => serviceDate < today;

const sameSet = (a: string[], b: string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export function classifyRole(i: {
  before: string[]; after: string[];
  serviceDate: string; roleType: string | null; today: string;
  roleExists: boolean; published: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  // An unpublish is silent today and stays silent.
  if (i.roleExists && !i.published) return null;

  // A vanished role tells only the people who had already been introduced to it.
  // Without this gate, creating a published service and deleting it minutes
  // later mails every assignee "Ya no participas" about a service they were
  // never told existed — the create no longer sends immediately.
  if (!i.roleExists) {
    if (!i.before.length) return null;
    return { kind: "removed", serviceDate: i.serviceDate, roleType: i.roleType, before: i.before, after: [] };
  }

  if (sameSet(i.before, i.after)) return null;
  const kind: LineKind = !i.before.length ? "assigned" : !i.after.length ? "removed" : "roleChanged";
  return { kind, serviceDate: i.serviceDate, roleType: i.roleType, before: i.before, after: i.after };
}

const sameSongs = (a: OutboxSongRow[], b: OutboxSongRow[]) =>
  a.length === b.length &&
  a.every((r, n) => r.ref === b[n].ref && r.key === b[n].key && r.group === b[n].group);

export function classifySetlist(i: {
  before: OutboxSongRow[]; after: OutboxSongRow[];
  serviceDate: string; roleType: string | null; today: string;
  roleExists: boolean; published: boolean; dateMatches: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  if (!i.roleExists) return null;
  if (!i.published) return null;
  // A date move invalidates the snapshot: `before` was captured against another
  // week's setlist, so there is nothing truthful to say.
  if (!i.dateMatches) return null;
  if (!i.after.length) return null;
  if (sameSongs(i.before, i.after)) return null;

  return {
    kind: i.before.length ? "setlistChanged" : "setlistReady",
    serviceDate: i.serviceDate,
    roleType: i.roleType,
    before: [], after: [],
    songs: i.after,
    beforeSongs: i.before,
  };
}

export function classifyLeadNotes(i: {
  before: string; after: string;
  serviceDate: string; today: string; reviewable: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  if (!i.reviewable) return null;
  if (i.before.trim() === i.after.trim()) return null;
  return { kind: "leadNotes", serviceDate: i.serviceDate, roleType: null, before: [], after: [], notes: i.after };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run app/utils/__tests__/outboxClassify.test.ts && npx tsc --noEmit`
Expected: PASS, 19 tests; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/utils/outboxClassify.ts app/utils/__tests__/outboxClassify.test.ts
git commit -m "feat(notifications): classify a snapshot against live state

Reading live state at send time rather than storing an after-snapshot buys two
properties: the email is never stale, and any change that nets out to nothing
inside the window collapses to silence.

A vanished role only notifies members whose before-snapshot is non-empty.
Since the immediate assignment email is gone, a queued notice is a member's
first contact — so an admin who creates a published service and deletes it ten
minutes later would otherwise mail every assignee about a service they were
never told existed."
```

---

## Task 5: The standings table

Read spec §6 before starting.

**Files:**
- Create: `app/utils/setlistDiff.ts`
- Test: `app/utils/__tests__/setlistDiff.test.ts`

**Interfaces:**
- Consumes: `OutboxSongRow` from Task 3.
- Produces: `type TableRow = { position: number | null; ref: string; key: string; previousKey: string | null; group: number | null; groupIsNew: boolean; movement: { dir: "up" | "down" | "same"; n: number } | null; status: "present" | "new" | "gone" }`; `buildSetlistTable(before, after): TableRow[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/setlistDiff.test.ts
import { describe, expect, it } from "vitest";
import { buildSetlistTable } from "../setlistDiff";

const row = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

describe("buildSetlistTable", () => {
  it("marks every row, using a dash where nothing moved", () => {
    // A blank cell reads as "not computed"; the dash reads as "computed,
    // unchanged" — that is what makes it scan as a standings table.
    const t = buildSetlistTable([row("a", "G"), row("b", "D")], [row("a", "G"), row("b", "D")]);
    expect(t.map((r) => r.movement?.dir)).toEqual(["same", "same"]);
  });

  it("uses absolute position deltas", () => {
    // Moving the 4th to the front lifts the other three by one. That is literally
    // true — they are played one slot earlier.
    const before = [row("a", "G"), row("b", "D"), row("c", "D"), row("d", "A")];
    const after = [row("d", "A"), row("a", "G"), row("b", "D"), row("c", "D")];
    expect(buildSetlistTable(before, after).map((r) => `${r.movement?.dir}${r.movement?.n}`))
      .toEqual(["up3", "down1", "down1", "down1"]);
  });

  it("flags a new song and lists a departed one last", () => {
    const t = buildSetlistTable([row("a", "G"), row("b", "D")], [row("a", "G"), row("c", "E")]);
    expect(t.find((r) => r.ref === "c")?.status).toBe("new");
    const gone = t[t.length - 1];
    expect(gone.ref).toBe("b");
    expect(gone.status).toBe("gone");
    expect(gone.position).toBeNull();
  });

  it("carries the old key when a song is re-keyed", () => {
    const t = buildSetlistTable([row("a", "E")], [row("a", "G")]);
    expect(t[0].previousKey).toBe("E");
  });

  it("marks only a genuinely new group as new", () => {
    const before = [row("a", "G"), row("b", "D"), row("c", "D")];
    const after = [row("a", "G"), row("b", "D", 0), row("c", "D", 0)];
    const t = buildSetlistTable(before, after);
    expect(t.filter((r) => r.groupIsNew).map((r) => r.ref)).toEqual(["b", "c"]);
  });

  it("does not re-flag a group that already existed", () => {
    const g = [row("a", "G"), row("b", "D", 0), row("c", "D", 0)];
    expect(buildSetlistTable(g, g).some((r) => r.groupIsNew)).toBe(false);
  });

  it("has no movement column for a first setlist", () => {
    expect(buildSetlistTable([], [row("a", "G")]).every((r) => r.movement === null)).toBe(true);
  });

  it("shows the tail lifting when a song is removed", () => {
    const before = [row("a", "G"), row("b", "D"), row("c", "E")];
    const after = [row("a", "G"), row("c", "E")];
    const t = buildSetlistTable(before, after);
    expect(t[0].movement).toEqual({ dir: "same", n: 0 });
    expect(t[1].movement).toEqual({ dir: "up", n: 1 });
    expect(t[2].status).toBe("gone");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/setlistDiff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/utils/setlistDiff.ts
// The standings table behind every setlist email (spec §6). One shape covers
// add, remove, re-key, reorder and regrouping — there is no diff mode.

import type { OutboxSongRow } from "./outboxNotice";

export interface TableRow {
  position: number | null;
  ref: string;
  key: string;
  previousKey: string | null;
  group: number | null;
  groupIsNew: boolean;
  /** null for a first setlist: there is no previous position to compare to. */
  movement: { dir: "up" | "down" | "same"; n: number } | null;
  status: "present" | "new" | "gone";
}

/** The set of adjacent refs forming each group, so "new" survives reindexing. */
function groupSignatures(rows: OutboxSongRow[]): Set<string> {
  const byGroup = new Map<number, string[]>();
  rows.forEach((r) => {
    if (r.group === null) return;
    byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r.ref]);
  });
  return new Set([...byGroup.values()].map((refs) => refs.join("|")));
}

export function buildSetlistTable(before: OutboxSongRow[], after: OutboxSongRow[]): TableRow[] {
  const isFirst = before.length === 0;
  const beforeIndex = new Map(before.map((r, i) => [r.ref, i]));
  const beforeKey = new Map(before.map((r) => [r.ref, r.key]));
  const beforeGroups = groupSignatures(before);

  const afterGroupRefs = new Map<number, string[]>();
  after.forEach((r) => {
    if (r.group === null) return;
    afterGroupRefs.set(r.group, [...(afterGroupRefs.get(r.group) ?? []), r.ref]);
  });

  const rows: TableRow[] = after.map((r, i) => {
    const prev = beforeIndex.get(r.ref);
    const prevKey = beforeKey.get(r.ref);
    const sig = r.group === null ? null : (afterGroupRefs.get(r.group) ?? []).join("|");
    return {
      position: i + 1,
      ref: r.ref,
      key: r.key,
      previousKey: prevKey !== undefined && prevKey !== r.key ? prevKey : null,
      group: r.group,
      groupIsNew: sig !== null && !beforeGroups.has(sig),
      movement: isFirst || prev === undefined
        ? null
        : prev === i
          ? { dir: "same", n: 0 }
          : prev > i
            ? { dir: "up", n: prev - i }
            : { dir: "down", n: i - prev },
      status: prev === undefined && !isFirst ? "new" : "present",
    };
  });

  // Departed songs stay IN the table, below the rest: "don't rehearse this one"
  // is among the most actionable lines the email carries.
  const afterRefs = new Set(after.map((r) => r.ref));
  for (const r of before) {
    if (afterRefs.has(r.ref)) continue;
    rows.push({
      position: null, ref: r.ref, key: r.key, previousKey: null,
      group: null, groupIsNew: false, movement: null, status: "gone",
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run app/utils/__tests__/setlistDiff.test.ts && npx tsc --noEmit`
Expected: PASS, 8 tests; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/utils/setlistDiff.ts app/utils/__tests__/setlistDiff.test.ts
git commit -m "feat(notifications): build the setlist standings table

One table covers add, remove, re-key, reorder and regrouping. An earlier design
switched between a per-song diff and a full list, which broke on the cases where
the song set and keys are identical but the arrangement changed — a new medley
or a reorder produced either nothing or nonsense.

Movement is absolute position arithmetic on every row, so removing a song
legitimately lifts everything below it. A group is new when its set of adjacent
songs was not a group before, which survives run reindexing."
```

---

## Task 6: Guard registries

Doing this before any writer touches Sanity means `npm test` never goes red for an unregistered write.

**Files:**
- Modify: `app/utils/studioProtection.ts`, `app/utils/__tests__/studioProtection.test.ts`
- Modify: `app/utils/protectedReadAudit.ts`, `app/utils/__tests__/protectedReadAudit.test.ts`

**Interfaces:**
- Produces: `notificationOutbox` governed as hidden-from-authoring **and** operator-prunable; `PROTECTED_RUNTIME_WRITERS` entries for `app/utils/serviceMutationSideEffects.ts#module` and `app/utils/outboxSweep.ts#module`.

- [ ] **Step 1: Read the current policy and its tests**

Read `app/utils/studioProtection.ts:20-100` and `app/utils/__tests__/studioProtection.test.ts:115-130,360-380`. Note three exact-set assertions: `INTERNAL_STUDIO_TYPES` as an exact array (`:120`), each internal type's create mechanism containing `"hidden"` (`:123`), and `Object.keys(INTERNAL_STUDIO_FIELDS)` as an exact set (`:373`). Also read `protectedReadAudit.ts:175-260` and `app/utils/__tests__/protectedReadAudit.test.ts:335` — the exact `file#operation` key set.

This is **not** a two-list append: `studioCapability` takes the delete-only branch at `:182` before it consults internal-ness, so a type in both lists never reaches the hidden check.

- [ ] **Step 2: Write the failing test**

Add to `app/utils/__tests__/studioProtection.test.ts`:

```ts
describe("notificationOutbox governance", () => {
  it("is prunable by an operator but never hand-authored", () => {
    // Coordination state written only by the server write token. Pruning is
    // legitimate operator work; authoring or editing an entry is not.
    expect(studioCapability("notificationOutbox")).toEqual({
      read: true, create: false, update: false, delete: true,
    });
  });

  it("is off the create affordance", () => {
    expect(createMechanism("notificationOutbox")).toContain("hidden");
  });
});
```

Add to `app/utils/__tests__/protectedReadAudit.test.ts` (inside the existing registry describe):

```ts
it("registers the outbox writers", () => {
  const keys = Object.keys(PROTECTED_RUNTIME_WRITERS);
  expect(keys).toContain("app/utils/serviceMutationSideEffects.ts#module");
  expect(keys).toContain("app/utils/outboxSweep.ts#module");
});
```

- [ ] **Step 3: Run and confirm they fail**

Run: `npx vitest run app/utils/__tests__/studioProtection.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: FAIL — `studioCapability("notificationOutbox")` returns the ungoverned default; the two registry keys are absent.

- [ ] **Step 4: Restructure `studioCapability` so the properties compose**

In `app/utils/studioProtection.ts`, add the type to both lists and reorder the branches so internal-ness is consulted for the create affordance regardless of the delete-only branch:

```ts
export const DELETE_ONLY_STUDIO_TYPES = ["loginEvent", "notificationOutbox"] as const;

export const INTERNAL_STUDIO_TYPES = [
  "roleTargetLock",
  "roleCreationReceipt",
  "notificationOutbox",
] as const;
```

Then in `studioCapability`, compute `create` from internal-ness *before* returning the delete-only result, so a type can be both:

```ts
  const internal = isInternalStudioType(type);
  if (isDeleteOnlyStudioType(type)) {
    // Read + delete, never create or update. `create` is additionally false for
    // an internal type, which is how `notificationOutbox` is both prunable by an
    // operator and absent from every authoring affordance.
    return { read: true, create: false, update: false, delete: true };
  }
```

Update the three exact-set assertions in `studioProtection.test.ts` (`:120`, `:123`, `:373`) to include `notificationOutbox`.

- [ ] **Step 5: Register the write sites**

In `app/utils/protectedReadAudit.ts`, add two entries in the same shape as the existing `app/utils/roleWriteOps.ts#module` entry at `:189`:

```ts
  "app/utils/serviceMutationSideEffects.ts#module": {
    reason:
      "post-commit outbox upsert: writes notificationOutbox documents through writeClient in a module that names sunday_role for the setlist audience query; queues only, never mutates protected content",
  },
  "app/utils/outboxSweep.ts#module": {
    reason:
      "the notification sweep: claims and consumes notificationOutbox documents through writeClient while reading protected role/setlist/proposal documents through operationalClient; never mutates protected content",
  },
```

Add both keys to the exact key-set assertion at `protectedReadAudit.test.ts:335`.

- [ ] **Step 6: Run the full suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS across all files; tsc silent.

- [ ] **Step 7: Commit**

```bash
git add app/utils/studioProtection.ts app/utils/protectedReadAudit.ts app/utils/__tests__/studioProtection.test.ts app/utils/__tests__/protectedReadAudit.test.ts
git commit -m "feat(notifications): govern the outbox in the guard registries

The outbox needs two properties that the Studio policy could not express
together: hidden from authoring, and prunable by an operator. studioCapability
took the delete-only branch before it consulted internal-ness, so a type in both
lists never reached the hidden check. The branches now compose.

Adding a writeClient mutation to serviceMutationSideEffects.ts turns that whole
file into one protected-write region, because it names sunday_role for the
setlist audience query. Both it and the sweep are registered ahead of the code
that needs them, so the guard never goes red mid-implementation."
```

---

## Task 7: Email templates

Read spec §6 before starting. Every template is table-based with inline styles — no flexbox, no grid, no `<style>` dependency, no remote images, `bgcolor` on every cell.

**Files:**
- Create: `app/utils/notificationEmail.ts`
- Test: `app/utils/__tests__/notificationEmail.test.ts`
- Modify: `app/utils/assignmentEmail.ts` (restyle `buildAssignmentEmail`, `buildBatchAssignmentEmail`; route gating through `notifyPrefs`)

**Interfaces:**
- Consumes: `Line` (Task 4), `TableRow`/`buildSetlistTable` (Task 5), `escapeHtml`/`appBaseUrl` from `assignmentEmail.ts`.
- Produces: `buildGroupedEmail(o: { name: string; lines: Line[] }): { subject: string; html: string }`; `SUBJECT: Record<LineKind, string>`; `renderSetlistTable(rows: TableRow[], titles: Map<string,string>, showMovement: boolean): string`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/notificationEmail.test.ts
import { describe, expect, it } from "vitest";
import { buildGroupedEmail } from "../notificationEmail";
import type { Line } from "../outboxClassify";

const titles = new Map([["a", "Abres Camino"], ["b", "Santo"], ["c", "Digno Es"]]);
const song = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

const roleLine = (kind: Line["kind"], before: string[], after: string[]): Line =>
  ({ kind, serviceDate: "2026-08-09", roleType: "sunday_role", before, after });

describe("buildGroupedEmail", () => {
  it("uses a constant subject plus a date, with nothing interpolated from content", () => {
    const { subject } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(subject).toBe("Nueva asignación — Domingo 9 ago");
    expect(subject).not.toContain("Líder");
  });

  it("switches to the grouped subject for several lines", () => {
    const { subject } = buildGroupedEmail({
      name: "Ana",
      lines: [roleLine("assigned", [], ["Líder"]), roleLine("removed", ["BGV"], [])],
    }, titles);
    expect(subject).toBe("Novedades de tus servicios");
  });

  it("says 'Sirves como', never 'Cantas como'", () => {
    // Three of the five seat paths do not sing.
    const { html } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Bajo"])] }, titles);
    expect(html).toContain("Sirves como");
    expect(html).not.toContain("Cantas");
  });

  it("renders no interpretive prose", () => {
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [song("a", "G")], songs: [song("c", "A"), song("a", "G")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toMatch(/Ahora abren con/);
    expect(html).not.toMatch(/No la ensayes/);
  });

  it("omits the movement column for a first setlist", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [], songs: [song("a", "G")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toContain("Mov.");
  });

  it("shows the movement column and a dash for unmoved rows on a change", () => {
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [],
      beforeSongs: [song("a", "G"), song("b", "D")],
      songs: [song("a", "G"), song("b", "D")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).toContain("Mov.");
    expect(html).toContain("&ndash;");
  });

  it("uses the app's word for a medley and draws a one-song run as a single", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [],
      songs: [song("a", "G", 0), song("b", "D", 0), song("c", "A", 1)],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).toContain("Medley");
    expect(html).not.toContain("Popurr");
    // Group 1 has a single member: rendered plain, so only ONE Medley label.
    expect(html.match(/Medley/g)).toHaveLength(1);
  });

  it("escapes song titles", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [], songs: [song("x", "G")],
    };
    const { html } = buildGroupedEmail(
      { name: "Ana", lines: [line] },
      new Map([["x", "<script>alert(1)</script>"]]),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the service date at local noon, never bare", () => {
    // A bare new Date(iso) would flip the day in America/Mexico_City.
    const { subject } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(subject).toContain("9 ago");
  });

  it("puts bgcolor on cells so a dark email survives Gmail and Apple Mail", () => {
    const { html } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(html).toContain('bgcolor="#010B17"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("<style");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/__tests__/notificationEmail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/utils/notificationEmail.ts`**

Build it from the approved mockups. Required structure:

- A `shell(bodyRows: string)` helper wrapping content in the outer `<table bgcolor="#010B17">` with the `OASIS WORSHIP TEAM` eyebrow and the footer (`Recibes esto porque sirves…` + `Ajustar mis avisos` linking to `${appBaseUrl()}/me`).
- `SUBJECT: Record<LineKind, string>` = `{ assigned: "Nueva asignación", removed: "Ya no participas", roleChanged: "Tu rol cambió", setlistReady: "Setlist listo", setlistChanged: "El setlist cambió", leadNotes: "Notas del líder" }`. A single-line email is `` `${SUBJECT[kind]} — ${formatDate(serviceDate)}` ``; several lines use `"Novedades de tus servicios"`.
- `formatDate(iso)` = `new Date(iso.slice(0,10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" })`, capitalised.
- Role lines render `Sirves como <strong>{after.join(", ")}</strong>` for `assigned`; a two-cell `Antes`/`Ahora` panel for `roleChanged`; and `{before.join(", ")}` struck through for `removed`.
- `renderSetlistTable(rows, titles, showMovement)` emits the `# / Canción / Tono / Mov.` table. Colours: `▲` `#37F58A`, `▼` `#F5B437`, `–` `#7F94A8`, `NUEVA` chip on `#37F58A`, `SALIÓ` chip on `#3B4A5A`. A group of ≥2 consecutive rows sharing a `group` gets the left rule `border-left:2px solid #12C8F4`, an uppercase `Medley` label above it, `+` between songs, and a `Nuevo` chip when `groupIsNew`. A group of one renders plain. When `showMovement` is false the `Mov.` header and cells are omitted entirely.
- Escape every title and role label through the existing `escapeHtml`.

- [ ] **Step 4: Restyle the two shipped templates**

In `app/utils/assignmentEmail.ts`, replace the navy-on-white markup in `buildAssignmentEmail` and `buildBatchAssignmentEmail` with the same shell. `buildBatchAssignmentEmail` becomes a `Fecha → Tu rol` table. Replace both `wantsEmail(m.emailPref)` gates with `wantsNotification(m.notifPrefs, "assigned")`, and change both GROQ projections from `"emailPref": notifPrefs.email` to `notifPrefs`.

- [ ] **Step 5: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — including the existing `assignmentEmail.test.ts`, which asserts content rather than palette.

- [ ] **Step 6: Commit**

```bash
git add app/utils/notificationEmail.ts app/utils/__tests__/notificationEmail.test.ts app/utils/assignmentEmail.ts
git commit -m "feat(notifications): render the dark on-brand templates

Subjects are a constant plus a formatted date, with nothing interpolated from
content, so no song title or member name can leak into or break a subject line.
There is no generated prose: sentences assembled from song titles are the
hardest part to get right across Spanish permutations and the first part to read
as machine-written.

Copy is audited against the app's own vocabulary. The group label is Medley,
matching DayCard, and role phrasing is 'Sirves como' rather than 'Cantas como',
which was wrong for the three of five seat paths that do not sing.

The shipped templates move off navy-on-white, which resembled nothing else in
the product, and both send paths now gate on the per-type resolver."
```

---

## Task 8: The sweep

**Files:**
- Create: `app/utils/outboxSweep.ts`
- Test: `app/utils/__tests__/outboxSweep.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5, 7.
- Produces: `sweepOutbox(opts?: { emailLimit?: number; sendBudgetMs?: number }): Promise<SweepReport>`; `type SweepReport = { claimed: number; emailed: number; consumed: number; deferred: number; unserved: number }`; `EMAIL_LIMIT`, `SEND_BUDGET_MS`.

- [ ] **Step 1: Write the failing test**

Mock `operationalClient`, `writeClient`, `sendEmail` and `isDeliveryBlocked` in the style of `serviceMutationSideEffects.test.ts:8-30`. Cover:

```ts
it("exits without touching the outbox when delivery is blocked", async () => {
  isDeliveryBlockedMock.mockReturnValue(true);
  const report = await sweepOutbox();
  expect(report.claimed).toBe(0);
  expect(writeClientPatch).not.toHaveBeenCalled();
});

it("sends one email per recipient across several notices", async () => {
  // The whole point of the debounce: a member with a role change on Sunday and
  // a new setlist on Saturday gets ONE email with two sections.
  // ...two due notices sharing recipient m1...
  expect(sendEmailMock).toHaveBeenCalledTimes(1);
});

it("sends one email to every participant of a setlist notice", async () => {
  // The regression test for notify-one-participant-then-delete.
  // ...one setlist notice with 5 participants...
  expect(sendEmailMock).toHaveBeenCalledTimes(5);
});

it("does not treat a 20-recipient setlist notice as oversized", async () => {
  // Regression for the 12-vs-20 defect: a Sunday service routinely has 12-20
  // seats, so "taken alone" must be exceptional, not the normal path.
  expect(report.deferred).toBe(0);
});

it("defers a second notice whose recipients would exceed the budget", async () => {
  expect(report.deferred).toBe(1);
  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("deferred"));
});

it("consumes the batch even when a send fails", async () => {
  sendEmailMock.mockResolvedValue({ ok: false, error: "bad address" });
  expect(writeClientDelete).toHaveBeenCalled();
});

it("stops sending at the wall-clock budget and still consumes", async () => {
  const report = await sweepOutbox({ sendBudgetMs: 0 });
  expect(report.unserved).toBeGreaterThan(0);
  expect(writeClientDelete).toHaveBeenCalled();
});

it("skips a notice whose claim fails", async () => {
  patchCommit.mockRejectedValueOnce(Object.assign(new Error("conflict"), { statusCode: 409 }));
  expect(sendEmailMock).not.toHaveBeenCalled();
});

it("filters lines by their own preference and sends nothing when none survive", async () => {
  // A setlist notice whose only participant set emailSetlist:false is consumed,
  // not left immortal.
  expect(sendEmailMock).not.toHaveBeenCalled();
  expect(writeClientDelete).toHaveBeenCalled();
});

it("introduces a recipient absent from knownRecipients", async () => {
  // A member added after the setlist was queued gets "Setlist listo", not a diff
  // against a list they never saw.
  expect(sendEmailMock.mock.calls[0][0].subject).toContain("Setlist listo");
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run app/utils/__tests__/outboxSweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pipeline**

`sweepOutbox` runs exactly these stages, in this order, with no second control flow:

1. **Gate.** `if (isDeliveryBlocked()) return empty report` — before any claim.
2. **Select.** `operationalClient.fetch` due notices ordered by `firstQueuedAt asc`. Resolve each notice's recipients (§4: `assignedMemberRefsQuery` scoped by role type for `setlist`; the stored `memberId` for `role`; the admin query for `leadNotes`). Accumulate while the **union** stays within `emailLimit`; a notice whose own recipients exceed it is taken alone.
3. **Claim** each selected notice with `writeClient.patch(id).ifRevisionId(rev).set({ status: "sending", claimedAt }).commit()` — a patch commit, because `Transaction.commit()` returns no `_rev` to assert later. A rejected claim drops that notice only.
4. **Classify** each claimed notice against live state via Task 4.
5. **Filter** each line by `wantsNotification(member.notifPrefs, LINE_PREF[line.kind])`.
6. **Group** by recipient and render one email each via Task 7.
7. **Send**, stopping when elapsed ≥ `sendBudgetMs`; count unserved.
8. **Consume** every claimed notice: `writeClient.transaction().patch(id, p => p.ifRevisionId(claimRev).set({ status: "sending" })).delete(id).commit()` — `delete()` takes no revision precondition, so the revision-asserting no-op patch in the same transaction is the guard, matching `app/api/admin/roles/[id]/route.ts:458`.

Log one structured line for deferrals and for unserved recipients.

- [ ] **Step 4: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/utils/outboxSweep.ts app/utils/__tests__/outboxSweep.test.ts
git commit -m "feat(notifications): add the outbox sweep

One pipeline, stated once: select, claim, classify, filter, group, send,
consume. Selection bounds the union of recipients rather than counting notices,
which is what makes unconditional consumption safe — every claimed notice is
fully discharged before it is deleted, so there is no partial state to
represent and no per-recipient progress to track.

The claim is a patch commit rather than a transaction because Transaction.commit
returns no revision, and the consume is a revision-asserting no-op patch plus a
delete in one transaction because delete() takes no precondition.

The send loop is bounded by wall clock and the batch is consumed either way, so
a killed sweep cannot re-send the same recipients on every lease expiry."
```

---

## Task 9: Queue notices from the role writers

**Files:**
- Modify: `app/utils/serviceMutationSideEffects.ts` (+ its test), `app/api/admin/roles/route.ts`, `app/api/admin/roles/[id]/route.ts`, `app/api/admin/roles/swap/route.ts`, `app/api/admin/roles/copy-instruments/route.ts`

**Interfaces:**
- Consumes: `buildUpsert`, `songRowsFrom` (Task 3); `sweepOutbox` (Task 8).
- Produces: `queueRoleNotices(input: { roleId; roleType; serviceDate; published; beforeSeats: NormalizedSeats | null; afterSeats: NormalizedSeats | null; deleted?: boolean }): void`.

- [ ] **Step 1: Write the failing test**

Add to `app/utils/__tests__/serviceMutationSideEffects.test.ts`:

```ts
describe("queueRoleNotices", () => {
  it("queues one notice per member in the union of before and after", () => {
    // Removals must be covered, which addedAssignees never was.
    queueRoleNotices({ ...base, beforeSeats: seats(["m1", "m2"]), afterSeats: seats(["m2", "m3"]) });
    expect(upsertedIds()).toHaveLength(3);
  });

  it("snapshots each member's OWN seat labels", () => {
    queueRoleNotices({ ...base, beforeSeats: leadOf("m1"), afterSeats: bgvOf("m1") });
    expect(upsertFor("m1").createIfNotExists.before.beforeRoles).toEqual(["Líder"]);
  });

  it("queues nothing for a draft service", () => {
    queueRoleNotices({ ...base, published: false, beforeSeats: null, afterSeats: seats(["m1"]) });
    expect(upsertedIds()).toHaveLength(0);
  });

  it("queues per current assignee on a delete", () => {
    queueRoleNotices({ ...base, deleted: true, beforeSeats: seats(["m1"]), afterSeats: null });
    expect(upsertFor("m1").createIfNotExists.before.beforeRoles).toEqual(["Líder"]);
  });

  it("no longer sends an immediate assignment email", () => {
    notifyRoleAssignments([{ recipients: ["m1"], ...SERVICE, body: BODY, kind: "created" }]);
    afterCallbacks.forEach((cb) => cb());
    expect(sendAssignmentEmailsMock).not.toHaveBeenCalled();
    expect(sendPushMock).toHaveBeenCalled(); // the push leg is unchanged
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run app/utils/__tests__/serviceMutationSideEffects.test.ts`
Expected: FAIL — `queueRoleNotices` is not exported; the assignment-email assertion fails because the leg still fires.

- [ ] **Step 3: Implement**

Add `queueRoleNotices` to `serviceMutationSideEffects.ts`. It runs inside `after()`, builds one upsert per member in `union(beforeAssignees, afterAssignees)` using `rolesForMember` for each member's own labels, and commits them on `writeClient` in its **own** transaction — never the business transaction, so a failed outbox write can never abort a committed content write.

Remove the `sendAssignmentEmails` call from `notifyRoleAssignments`, keeping the push leg. Update the module header at `:7-9`, which currently claims removals are silent.

In each of the four role writers, capture `before` **pre-commit** from the already-loaded stored role via `normalizeStoredSeats(role)` and pass it into the `after()` block. Add an `after()` block to the `DELETE` handler in `app/api/admin/roles/[id]/route.ts`, and update its `:470` comment.

- [ ] **Step 4: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. `roleWriteRoutes.test.ts`, `roleSwapRoutes.test.ts` and `deliveryFirewallTransports.test.ts:273,676` need updating to assert a queued notice instead of an immediate email.

- [ ] **Step 5: Commit**

```bash
git add app/utils/serviceMutationSideEffects.ts app/utils/__tests__ app/api/admin/roles
git commit -m "feat(notifications): queue role notices from every role writer

Recipients are the union of before- and after-assignees, so a removal is finally
covered — addedAssignees diffed member ids, which meant being dropped from a
service, or moved from BGV to Lider inside one, said nothing at all.

Each member's snapshot holds their OWN seat labels, which is what lets a member
who was never introduced to a service stay silent when it is deleted.

The immediate assignment email goes away here: it is absorbed by the outbox, and
keeping it would produce 'te asignaron' now and 'tu rol cambió' fifteen minutes
later for one edit. The push leg is untouched, so members still get an immediate
in-app signal."
```

---

## Task 10: Queue setlist and lead-notes notices

**Files:**
- Modify: `app/api/admin/setlists/route.ts`, `app/api/admin/proposals/[id]/route.ts`, `app/api/me/proposals/route.ts`, `app/api/admin/roles/publish/route.ts`, `app/api/admin/roles/publish-ready/route.ts`
- Test: `app/api/__tests__/setlistNoticeQueueing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("queues a setlist notice with the pre-commit songs", async () => { /* ... */ });

it("queues on the publish transition with an EMPTY before-snapshot", async () => {
  // Build the setlist while the service is a draft, then publish: without this
  // the member never gets a setlist email at all, and their first one would be
  // "El setlist cambió" on the next edit.
  expect(upsert().createIfNotExists.before.beforeSongs).toEqual([]);
});

it("queues nothing when a published service has no songs", async () => { /* ... */ });

it("uses the same subject key from the manual writer and the approve path", async () => {
  // Two keys would mean two outbox documents and two emails for one change.
  expect(manualKey).toBe(approveKey);
});

it("queues no leadNotes notice on a first submission", async () => {
  // draft -> pending already sends admins "Nueva propuesta"; queueing here too
  // would mail them twice about one submission.
  expect(upsertedKinds()).not.toContain("leadNotes");
});

it("queues leadNotes when an already-pending proposal's notes change", async () => { /* ... */ });
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run app/api/__tests__/setlistNoticeQueueing.test.ts`
Expected: FAIL — no notices queued.

- [ ] **Step 3: Implement**

Add `after()` blocks to `app/api/admin/setlists/route.ts` (which currently awaits `notifySetlistSaved(week)` inline at `:367`), `app/api/me/proposals/route.ts` and `app/api/admin/proposals/[id]/route.ts`. Capture `before` pre-commit from `loadWeekendSetlistTarget(...).target.record?.songs ?? []` / `loadSpecialSetlistTarget(...).target.role?.songs ?? []` / the stored `lead_notes`, run through `songRowsFrom`, and queue.

Both publish surfaces queue a `setlist` notice with `before.beforeSongs = []` for each `false -> true` transition.

Declare `export const maxDuration = 60` in `app/api/admin/setlists/route.ts`, `app/api/admin/proposals/[id]/route.ts`, `app/api/me/proposals/route.ts`, `app/api/admin/roles/unpublish/route.ts` and `app/api/cron/service-reminders/route.ts`.

- [ ] **Step 4: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/api
git commit -m "feat(notifications): queue setlist and lead-notes notices

Publishing queues a setlist notice with an empty before-snapshot, so a service
built as a draft and then published introduces its setlist properly. Without it,
the dominant workflow — create draft, build setlist, publish — sent no setlist
email at all, and the member's first one would have been 'El setlist cambió'.

The approve path queues too: it writes the live setlist today and said nothing
about it. Both setlist writers derive the same subject key, or one service would
produce two outbox documents and two emails for one change.

A first proposal submission queues no lead-notes notice, since admins already
get the immediate 'Nueva propuesta' for that same write."
```

---

## Task 11: Triggers and the liveness alarm

**Files:**
- Create: `app/api/cron/flush-notifications/route.ts`, `.github/workflows/flush-notifications.yml`
- Modify: `app/api/cron/service-reminders/route.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/api/__tests__/flushNotificationsRoute.test.ts
it("rejects a request without the cron secret", async () => {
  expect((await GET(req({}))).status).toBe(401);
});

it("runs the sweep with the secret", async () => {
  await GET(req({ authorization: `Bearer ${process.env.CRON_SECRET}` }));
  expect(sweepOutboxMock).toHaveBeenCalled();
});

it("reports the oldest entry in EITHER status", async () => {
  // A notice stuck mid-fan-out sits in `sending`; reporting only `pending`
  // would blind the alarm to exactly the failure that spams the team.
  expect(staleQuery()).toContain('status in ["pending","sending"]');
});

it("emails super-admins when the outbox is stale", async () => {
  // console.error has no consumer: no log drain, no alerting on Hobby.
  expect(sendEmailMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run app/api/__tests__/flushNotificationsRoute.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

Create the route wrapped in `withVerificationRunContext`, authorized by the `Authorization: Bearer ${CRON_SECRET}` pattern from `app/api/cron/service-reminders/route.ts:13`, declaring `export const maxDuration = 60`, calling `sweepOutbox()`.

Add the layer-3 call plus the liveness check to `service-reminders`: query the oldest `firstQueuedAt` across `status in ["pending","sending"]`, and when it exceeds `NOTIFY_STALE_ALERT_HOURS`, log one structured error **and** email the super-admins.

Create the workflow:

```yaml
name: Flush notification outbox
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
jobs:
  flush:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger the sweep
        run: |
          curl --fail --silent --show-error --max-time 60 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_BASE_URL }}/api/cron/flush-notifications"
```

- [ ] **Step 4: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron .github/workflows app/api/__tests__
git commit -m "feat(notifications): add the three flush triggers and the alarm

Vercel Hobby allows one cron a day, so the primary trigger is a GitHub Actions
schedule. Layer 2 only flushes subjects that have already gone quiet, so it can
never flush the terminal edit of a session — which means layer 1 is genuinely
load-bearing rather than one of three redundant paths.

That makes the liveness signal part of the design rather than an operational
nicety, and it emails super-admins instead of only logging: this repo has no log
drain and Hobby offers no alerting, so a console.error has no consumer. It
counts notices in either status, because one stuck mid-fan-out sits in sending."
```

---

## Task 12: Preference UI

**Files:**
- Modify: `app/api/me/notif-prefs/route.ts`, `app/api/admin/members/[id]/route.ts`, `app/components/ProfilePanel.tsx`, `app/components/admin/AdminPanel.tsx`
- Test: `app/api/__tests__/notifPrefsRoute.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("accepts the five per-type fields", async () => {
  await PATCH(req({ emailSetlist: false, emailRemoved: true }));
  expect(patchSet()).toMatchObject({
    "notifPrefs.emailSetlist": false,
    "notifPrefs.emailRemoved": true,
  });
});

it("returns RESOLVED values, not raw fields", async () => {
  // A member with legacy email:false and the five unset resolves to "no mail".
  // Rendering unset booleans as their true default would show five switches ON
  // to someone receiving nothing.
  commitMock.mockResolvedValue({ notifPrefs: { email: false } });
  const body = await (await PATCH(req({ emailSetlist: false }))).json();
  expect(body.emailAssigned).toBe(false);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run app/api/__tests__/notifPrefsRoute.test.ts`
Expected: FAIL — the fields are rejected as unknown.

- [ ] **Step 3: Implement**

Accept the five booleans in both PATCH routes. Compute every response value through `wantsNotification` so it is the resolved value. In `ProfilePanel.tsx` replace the single "Asignaciones por correo" switch with five, initialised via `wantsNotification(initialMember.notifPrefs, kind)`; mirror in `AdminPanel.tsx`. Keep the existing `try/catch/finally`, `res.ok` check and loading-flag reset in each handler.

- [ ] **Step 4: Run the suite and the type gate**

Run: `npm test && npx tsc --noEmit`
Expected: PASS; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add app/api/me/notif-prefs app/api/admin/members app/components
git commit -m "feat(notifications): expose the five per-type email toggles

The panels render resolved values rather than raw fields. A member who opted
out before per-type toggles existed has all five unset, which resolves to no
mail — but an unset boolean renders as its true default, so a naive render
would show five switches ON to someone receiving nothing."
```

---

## Task 13: Release gates

No code. These are the two things the spec refuses to assert without evidence.

- [ ] **Step 1: Measure the send budget**

Send a real batch of ~20 recipients against `contacto@oasis.mx` with `EMAIL_REDIRECT_TO` set to your own inbox. Record ms/send and evaluate:

```
measured_ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT  <  NOTIFY_SEND_BUDGET_MS
```

At the default 40 and 40 000 that needs < 1 000 ms/send. If it does not hold, **derive** rather than guess: raise `NOTIFY_SEND_BUDGET_MS` (bounded by `maxDuration = 60`) or lower the limit — and if lowering it drops below the largest per-service seat count, stop and redesign, because splitting one notice's recipients across sweeps is a different outbox model.

- [ ] **Step 2: Verify the templates in real clients**

Send one of each template to Gmail (web + Android), Apple Mail (iOS), and Outlook on Windows. Confirm: dark background survives, the key pills are not crushed by the Word engine, and the four-column table does not force horizontal scrolling on a narrow phone.

- [ ] **Step 3: Deploy the Sanity schema**

Run: `npx sanity schema deploy`
Then confirm in `/studio` that `notificationOutbox` does not appear in any create menu.

- [ ] **Step 4: Configure production**

Set `CRON_SECRET` and `APP_BASE_URL` as GitHub Actions secrets. Confirm the workflow's first scheduled run succeeds in the Actions tab.

- [ ] **Step 5: Commit any derived configuration**

```bash
git commit -m "chore(notifications): set the measured send budget

Derived from a real 20-recipient batch rather than the placeholder estimate,
so the knob inequality holds at the shipped recipient limit."
```

---

## Self-Review

**Spec coverage.** §1 outbox → Tasks 2–4, 8. §2 writers → Tasks 9–10. §3 triggers and alarm → Task 11. §4 recipients → Task 8. §5 preferences → Tasks 1, 12. §6 presentation → Tasks 5, 7. §7 publish stays immediate → Task 9 (removes only the email leg). §8 integration constraints → Tasks 6, 10, 11. §9 configuration → Tasks 3, 8, 13. §10 tests → distributed. §11 risks → Task 13 gates.

**Placeholders.** None. Every code step carries real code; Task 7 step 3 and Task 8 step 3 specify structure with exact values, colours and ordering rather than sample code, because both are long renderers whose full text belongs in the file.

**Type consistency.** `OutboxSongRow` (Task 3) is consumed unchanged by Tasks 4, 5, 7. `Line`/`LineKind` (Task 4) by Tasks 7, 8. `TableRow` (Task 5) by Task 7. `NotifyKind`/`wantsNotification` (Task 1) by Tasks 4, 7, 8, 12. `queueRoleNotices` (Task 9) is the only writer-facing entry point.

**Known gap:** Task 7 and Task 8 are the two largest tasks and the likeliest to need splitting during execution. If Task 7's renderer grows past ~400 lines, split the setlist table into its own module.
