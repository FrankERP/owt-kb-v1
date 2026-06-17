# Push Notifications (FCM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native push notifications for the Capacitor app via Firebase Cloud Messaging — four event triggers (assignment, setlist publish, proposals, reminders), per-category member preferences (setlist tri-state), and a fully automatic, self-healing token lifecycle.

**Architecture:** The app registers an FCM token (`@capacitor-firebase/messaging`) stored on the member; server code sends via `firebase-admin` through one helper `sendPush(memberIds, category, payload)` called from event hooks in existing mutation routes and a daily Vercel-cron route. Pushes never break the triggering write; dead tokens self-prune on send.

**Tech Stack:** Next.js 16, Capacitor 8, `@capacitor-firebase/messaging`, `firebase-admin`, Sanity v5, Vitest, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-06-16-push-notifications-design.md`

---

## File Structure

**New**
- `app/utils/firebaseAdmin.ts` — `firebase-admin` singleton (from `FIREBASE_SERVICE_ACCOUNT`).
- `app/utils/push.ts` — `sendPush(memberIds, category, payload)` + helpers; unit-tested.
- `app/utils/__tests__/push.test.ts`, `assignmentDiff.test.ts`, `setlistRecipients.test.ts`, `reminderQuery.test.ts`.
- `app/utils/notifyTargets.ts` — pure helpers: `addedAssignees(prev, next)`, `setlistRecipientIds(members, assignedIds)`, `tomorrowDateStr(tz)`.
- `app/api/me/push-token/route.ts` — POST/DELETE device token.
- `app/api/cron/service-reminders/route.ts` — daily reminder sender.
- `app/components/PushRegistrar.tsx` — native token registration + tap handling.
- `app/components/NotificationSettings.tsx` — `/me` preferences UI.
- `vercel.json` — cron schedule.

**Modified**
- `sanity/schemas/worshipTeam.ts` — `deviceTokens`, `notifPrefs`.
- `app/api/admin/roles/route.ts`, `app/api/admin/roles/[id]/route.ts` — assignment trigger.
- `app/api/admin/setlists/route.ts` — setlist trigger.
- proposal routes (`app/api/me/proposals/route.ts`, `app/api/admin/proposals/[id]/route.ts`) — proposal triggers.
- `app/api/me/route.ts` — accept `notifPrefs` in PATCH.
- `app/(client)/layout.tsx` — mount `<PushRegistrar />`.
- `app/(client)/me/page.tsx` — render `<NotificationSettings />`.
- `package.json` — deps.

---

## Task 0: Dependencies & Firebase/native prerequisites (manual + install)

**Files:** `package.json`, `ios/App/App/GoogleService-Info.plist`

- [ ] **Step 1: Install packages**
```bash
cd ~/Documents/Builds/owt-kb-v1
npm i firebase-admin @capacitor-firebase/messaging
npx cap sync ios
```
If `@capacitor-firebase/messaging` reports a Capacitor 8 peer conflict, STOP and report (do not `--force`); we'll pick a compatible version.

- [ ] **Step 2: Manual Firebase/Apple setup (the human does this — document, don't fake it)**

Record these as prerequisites in the commit message; the code reads them from env / native files:
  1. In Firebase console (`owt-knowledge-base`) → add an **iOS app** with bundle id `com.owtBackstage.app`; download `GoogleService-Info.plist` into `ios/App/App/`.
  2. In Xcode: target → Signing & Capabilities → add **Push Notifications** and **Background Modes → Remote notifications**.
  3. Apple Developer → Keys → create an **APNs Auth Key (.p8)**; upload it in Firebase → Project settings → Cloud Messaging → APNs.
  4. Firebase → Project settings → Service accounts → **Generate new private key** (JSON). Add it as env var `FIREBASE_SERVICE_ACCOUNT` (the full JSON, single line) to Vercel (all envs) and `.env.local`.
  5. Add a `CRON_SECRET` env var (a random string) to Vercel + `.env.local`.

- [ ] **Step 3: Commit**
```bash
git add package.json package-lock.json ios
git commit -m "chore(push): add firebase-admin + capacitor-firebase/messaging; iOS FCM config"
```

---

## Task 1: Schema — deviceTokens + notifPrefs

**Files:** `sanity/schemas/worshipTeam.ts`

- [ ] **Step 1: Add both fields** after the existing `disabled` field block:
```ts
    {
      name: "deviceTokens",
      title: "Device push tokens",
      type: "array",
      hidden: true,
      of: [{
        type: "object",
        fields: [
          { name: "token", type: "string" },
          { name: "platform", type: "string" },
          { name: "updatedAt", type: "datetime" },
        ],
      }],
    },
    {
      name: "notifPrefs",
      title: "Preferencias de notificaciones",
      type: "object",
      fields: [
        { name: "assignments", type: "boolean", initialValue: true },
        { name: "setlist", type: "string", initialValue: "all", options: { list: ["all", "assigned", "off"] } },
        { name: "proposals", type: "boolean", initialValue: true },
        { name: "reminders", type: "boolean", initialValue: true },
      ],
    },
```

- [ ] **Step 2: Typecheck + commit**
```bash
npx tsc --noEmit
git add sanity/schemas/worshipTeam.ts
git commit -m "feat(push): add deviceTokens + notifPrefs to teamMembers"
```

---

## Task 2: Pure notify-target helpers (TDD)

**Files:** Create `app/utils/notifyTargets.ts`; Test `app/utils/__tests__/notifyTargets.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { addedAssignees, setlistRecipientIds, tomorrowDateStr } from "../notifyTargets";

describe("addedAssignees", () => {
  it("returns ids present in next but not prev", () => {
    expect(addedAssignees(["a", "b"], ["b", "c", "d"]).sort()).toEqual(["c", "d"]);
  });
  it("returns all on a brand-new doc (empty prev)", () => {
    expect(addedAssignees([], ["a", "b"]).sort()).toEqual(["a", "b"]);
  });
  it("dedupes", () => {
    expect(addedAssignees(["a"], ["b", "b"])).toEqual(["b"]);
  });
});

describe("setlistRecipientIds", () => {
  const members = [
    { _id: "m1", setlist: "all" },
    { _id: "m2", setlist: "assigned" },
    { _id: "m3", setlist: "off" },
    { _id: "m4", setlist: "assigned" },
  ];
  it("includes all 'all' members plus 'assigned' members who are assigned", () => {
    expect(setlistRecipientIds(members, ["m2", "m3"]).sort()).toEqual(["m1", "m2"]);
  });
  it("excludes 'off' even if assigned", () => {
    expect(setlistRecipientIds(members, ["m3"])).toEqual(["m1"]);
  });
});

describe("tomorrowDateStr", () => {
  it("returns YYYY-MM-DD for tomorrow in the given tz", () => {
    const s = tomorrowDateStr("America/Mexico_City", new Date("2026-06-16T18:00:00Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — `npx vitest run app/utils/__tests__/notifyTargets.test.ts` → cannot find module.

- [ ] **Step 3: Implement `app/utils/notifyTargets.ts`**
```ts
export type SetlistPref = "all" | "assigned" | "off";

/** Member ids present in `next` but not `prev`. */
export function addedAssignees(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev);
  return [...new Set(next)].filter((id) => !prevSet.has(id));
}

/** Recipients for a published setlist: all "all" members + "assigned" members who are assigned. */
export function setlistRecipientIds(
  members: { _id: string; setlist?: SetlistPref }[],
  assignedIds: string[]
): string[] {
  const assigned = new Set(assignedIds);
  return members
    .filter((m) => m.setlist === "all" || (m.setlist === "assigned" && assigned.has(m._id)))
    .map((m) => m._id);
}

/** Tomorrow's date as YYYY-MM-DD in the given IANA tz. */
export function tomorrowDateStr(tz: string, now: Date = new Date()): string {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return t.toLocaleDateString("sv", { timeZone: tz }); // sv → ISO YYYY-MM-DD
}
```

- [ ] **Step 4: Run tests → PASS.** **Step 5: Commit**
```bash
npx tsc --noEmit
git add app/utils/notifyTargets.ts app/utils/__tests__/notifyTargets.test.ts
git commit -m "feat(push): pure notify-target helpers (assignee diff, setlist recipients, tomorrow)"
```

---

## Task 3: firebase-admin singleton + sendPush (TDD)

**Files:** Create `app/utils/firebaseAdmin.ts`, `app/utils/push.ts`; Test `app/utils/__tests__/push.test.ts`

- [ ] **Step 1: Write the failing test** (`push.test.ts`)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEachForMulticast = vi.fn();
vi.mock("../firebaseAdmin", () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));
const fetchMock = vi.fn();
const patchCommit = vi.fn();
const patchUnset = vi.fn(() => ({ commit: patchCommit }));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
  writeClient: { patch: () => ({ unset: patchUnset }) },
}));

import { sendPush } from "../push";

beforeEach(() => { sendEachForMulticast.mockReset(); fetchMock.mockReset(); patchUnset.mockReset(); patchCommit.mockReset(); patchUnset.mockReturnValue({ commit: patchCommit }); });

describe("sendPush", () => {
  it("skips members who opted out of the category", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "t1" }], notifPrefs: { assignments: false } },
    ]);
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
  });

  it("sends to opted-in tokens", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "t1" }, { token: "t2" }], notifPrefs: { assignments: true } },
    ]);
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }, { success: true }] });
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(2);
  });

  it("prunes tokens FCM reports as unregistered", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "good" }, { token: "dead" }], notifPrefs: {} },
    ]);
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        { success: true },
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
      ],
    });
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(r.pruned).toBe(1);
    expect(patchUnset).toHaveBeenCalled(); // removed the dead token
  });

  it("never throws on send failure", async () => {
    fetchMock.mockResolvedValueOnce([{ _id: "m1", deviceTokens: [{ token: "t1" }], notifPrefs: {} }]);
    sendEachForMulticast.mockRejectedValueOnce(new Error("boom"));
    await expect(sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" })).resolves.toEqual(
      expect.objectContaining({ sent: 0 })
    );
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/utils/firebaseAdmin.ts`**
```ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging as _getMessaging } from "firebase-admin/messaging";

function app() {
  if (getApps().length) return getApps()[0];
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  return initializeApp({ credential: cert(svc) });
}

export function getMessaging() {
  return _getMessaging(app());
}
```

- [ ] **Step 4: Implement `app/utils/push.ts`**
```ts
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { getMessaging } from "./firebaseAdmin";

export type NotifCategory = "assignments" | "setlist" | "proposals" | "reminders";
export type PushPayload = { title: string; body: string; path: string };

type MemberRow = {
  _id: string;
  deviceTokens?: { token: string }[];
  notifPrefs?: Record<string, unknown>;
};

const PRUNE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

function optedIn(prefs: Record<string, unknown> | undefined, category: NotifCategory): boolean {
  const p = prefs ?? {};
  if (category === "setlist") return (p.setlist ?? "all") !== "off"; // scope resolved by caller
  return (p[category] ?? true) !== false;
}

/**
 * Send a push to the given members for a category. Filters by preference, sends via
 * FCM, and self-heals: removes any token FCM reports as dead. Never throws.
 */
export async function sendPush(
  memberIds: string[],
  category: NotifCategory,
  payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
  try {
    if (memberIds.length === 0) return { sent: 0, pruned: 0 };
    const members = await serverClient.fetch<MemberRow[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, deviceTokens, notifPrefs }`,
      { ids: memberIds }
    );

    const tokenOwner = new Map<string, string>(); // token -> memberId
    const tokens: string[] = [];
    for (const m of members) {
      if (!optedIn(m.notifPrefs, category)) continue;
      for (const dt of m.deviceTokens ?? []) {
        if (dt.token) { tokens.push(dt.token); tokenOwner.set(dt.token, m._id); }
      }
    }
    if (tokens.length === 0) return { sent: 0, pruned: 0 };

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: { path: payload.path },
    });

    let sent = 0;
    const dead: { token: string; member: string }[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) { sent++; return; }
      const code = (r.error as { code?: string } | undefined)?.code;
      if (code && PRUNE_CODES.has(code)) dead.push({ token: tokens[i], member: tokenOwner.get(tokens[i])! });
    });

    for (const d of dead) {
      await writeClient
        .patch(d.member)
        .unset([`deviceTokens[token == "${d.token}"]`])
        .commit()
        .catch(() => {});
    }
    return { sent, pruned: dead.length };
  } catch (err) {
    console.error("[push] sendPush failed:", err);
    return { sent: 0, pruned: 0 };
  }
}
```

- [ ] **Step 5: Run tests → PASS. Verify the `firebaseAdmin` import shape against the installed `firebase-admin` (it's `firebase-admin/app` + `firebase-admin/messaging` modular API); adjust if the installed version differs. Step 6: Commit**
```bash
npx tsc --noEmit
git add app/utils/firebaseAdmin.ts app/utils/push.ts app/utils/__tests__/push.test.ts
git commit -m "feat(push): firebase-admin sendPush with preference filter + self-healing token prune"
```

---

## Task 4: Token API

**Files:** Create `app/api/me/push-token/route.ts`

- [ ] **Step 1: Implement**
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

export async function POST(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token, platform } = (await req.json()) as { token?: string; platform?: string };
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const id = session.user.sanityId;
  // Remove any existing copy, then append fresh (dedupe + refresh updatedAt).
  await writeClient.patch(id).unset([`deviceTokens[token == "${token}"]`]).commit().catch(() => {});
  await writeClient
    .patch(id)
    .setIfMissing({ deviceTokens: [] })
    .append("deviceTokens", [{ token, platform: platform ?? "ios", updatedAt: new Date().toISOString() }])
    .commit();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = (await req.json()) as { token?: string };
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  await writeClient.patch(session.user.sanityId).unset([`deviceTokens[token == "${token}"]`]).commit().catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/api/me/push-token
git commit -m "feat(push): device-token register/unregister API"
```

---

## Task 5: PushRegistrar client component

**Files:** Create `app/components/PushRegistrar.tsx`; Modify `app/(client)/layout.tsx`

- [ ] **Step 1: Create the component**
```tsx
"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { isNativeApp } from "@/app/utils/native";

async function registerToken() {
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  const perm = await FirebaseMessaging.checkPermissions();
  if (perm.receive !== "granted") return; // master toggle requests permission explicitly
  const { token } = await FirebaseMessaging.getToken();
  if (token) {
    await fetch("/api/me/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "ios" }),
    });
  }
}

/** Native-only: registers the FCM token when authenticated + permitted; handles refresh + taps. */
export default function PushRegistrar() {
  const { status } = useSession();
  useEffect(() => {
    if (!isNativeApp() || status !== "authenticated") return;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
        await registerToken();
        const refresh = await FirebaseMessaging.addListener("tokenReceived", () => { registerToken().catch(() => {}); });
        const tap = await FirebaseMessaging.addListener("notificationActionPerformed", (e: any) => {
          const path = e?.notification?.data?.path;
          if (typeof path === "string") window.location.assign(path);
        });
        cleanup = () => { refresh.remove(); tap.remove(); };
      } catch (err) { console.error("[push] registrar failed:", err); }
    })();
    return () => cleanup?.();
  }, [status]);
  return null;
}
```
> Verify the `@capacitor-firebase/messaging` API (`checkPermissions`/`requestPermissions`/`getToken`/`addListener` event names) against the installed version; adjust if needed.

- [ ] **Step 2: Mount in `app/(client)/layout.tsx`** next to `<TextScaleBootstrap />`:
```tsx
import PushRegistrar from "../components/PushRegistrar";
// ...
          <TextScaleBootstrap />
          <PushRegistrar />
```

- [ ] **Step 3: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/components/PushRegistrar.tsx "app/(client)/layout.tsx"
git commit -m "feat(push): native FCM token registration + tap deep-linking"
```

---

## Task 6: Assignment trigger (added-only)

**Files:** Modify `app/api/admin/roles/route.ts` (POST) and `app/api/admin/roles/[id]/route.ts` (PATCH)

Both routes build the full assignee set from `leads/bgvs/chorus/instruments[].personId/foh[].personId`.

- [ ] **Step 1: Add a shared assignee extractor** near the top of each route file:
```ts
import { addedAssignees } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";

function allAssignees(b: { leads?: string[]; bgvs?: string[]; chorus?: string[]; instruments?: { personId: string }[]; foh?: { personId: string }[] }): string[] {
  return [
    ...(b.leads ?? []), ...(b.bgvs ?? []), ...(b.chorus ?? []),
    ...(b.instruments ?? []).map((i) => i.personId),
    ...(b.foh ?? []).map((f) => f.personId),
  ].filter(Boolean);
}
```

- [ ] **Step 2: POST (create) in `roles/route.ts`** — after `const doc = await writeClient.create({...})` and before the `return`:
```ts
  const added = allAssignees(body); // brand-new doc → everyone is "added"
  const dateLabel = body.date;
  void sendPush(added, "assignments", {
    title: "Nuevo servicio asignado",
    body: `Te asignaron para el ${dateLabel}.`,
    path: "/me",
  });
```

- [ ] **Step 3: PATCH (edit) in `roles/[id]/route.ts`** — fetch the prior assignees BEFORE the patch, then diff after. Add `serverClient` to the existing import (`import { serverClient, writeClient } from "@/sanity/lib/serverClient";`), then insert before `const doc = await writeClient.patch(id)...`:
```ts
  const prevDoc = await serverClient.fetch<{ leads?: string[]; bgvs?: string[]; chorus?: string[]; inst?: string[]; foh?: string[] } | null>(
    `*[_id == $id][0]{ "leads": Lead[]._ref, "bgvs": BGVs[]._ref, "chorus": Chorus[]._ref, "inst": instruments[].person._ref, "foh": foh_team[].person._ref }`,
    { id }
  );
```

Then after the patch commit, before `return`:
```ts
  const prevIds = prevDoc ? [...(prevDoc.leads ?? []), ...(prevDoc.bgvs ?? []), ...(prevDoc.chorus ?? []), ...(prevDoc.inst ?? []), ...(prevDoc.foh ?? [])].filter(Boolean) : [];
  const added = addedAssignees(prevIds, allAssignees(body));
  void sendPush(added, "assignments", {
    title: "Servicio actualizado",
    body: `Te asignaron para el ${body.date}.`,
    path: "/me",
  });
```

- [ ] **Step 4: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/api/admin/roles
git commit -m "feat(push): notify newly-assigned members on role create/update"
```

---

## Task 7: Setlist trigger (tri-state)

**Files:** Modify `app/api/admin/setlists/route.ts`

- [ ] **Step 1:** After the successful setlist write + `revalidateServiceViews()`, resolve recipients and send. The setlist write has the service date/week and the assigned team (the role doc for that week). Insert:
```ts
import { setlistRecipientIds } from "@/app/utils/notifyTargets";
import { sendPush } from "@/app/utils/push";
import { serverClient } from "@/sanity/lib/serverClient";
// ... after write + revalidate, with `week` = the setlist's week/date:
  const members = await serverClient.fetch<{ _id: string; setlist?: "all"|"assigned"|"off" }[]>(
    `*[_type == "teamMembers"]{ _id, "setlist": notifPrefs.setlist }`
  );
  const assigned = await serverClient.fetch<string[]>(
    `array::unique([
      ...*[_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week)].Lead[]._ref,
      ...*[_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week)].instruments[].person._ref
    ][defined(@)])`,
    { week }
  );
  void sendPush(setlistRecipientIds(members, assigned), "setlist", {
    title: "Setlist de la semana",
    body: "Ya están las canciones de este servicio.",
    path: "/",
  });
```
> Read the route to use its actual variable for the week/date and confirm where the write succeeds. Keep the send AFTER the write so a push error can't block publishing.

- [ ] **Step 2: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/api/admin/setlists/route.ts
git commit -m "feat(push): notify setlist subscribers on publish (all vs assigned scope)"
```

---

## Task 8: Proposal triggers

**Files:** Modify the proposal mutation routes (`app/api/me/proposals/route.ts` for submit; `app/api/admin/proposals/[id]/route.ts` for status changes)

- [ ] **Step 1: On submit** (in the route that creates a `setlistProposal`), after the write, notify admins:
```ts
import { sendPush } from "@/app/utils/push";
import { serverClient } from "@/sanity/lib/serverClient";
// after the proposal is created:
  const adminIds = await serverClient.fetch<string[]>(
    `*[_type == "teamMembers" && role in ["super-admin","admin"]]._id`
  );
  void sendPush(adminIds, "proposals", { title: "Nueva propuesta", body: "Hay una propuesta de setlist por revisar.", path: "/admin" });
```

- [ ] **Step 2: On status change** (in `app/api/admin/proposals/[id]/route.ts`, after the write that sets `status`), notify the proposal's lead when status becomes `changes_requested` or approved. The proposal's lead ref is `lead._ref` (same field the existing `notifications/count` route filters on). `id` is the route param and `status` the new value being written:
```ts
import { sendPush } from "@/app/utils/push";
import { serverClient } from "@/sanity/lib/serverClient";
// ...after the status write commits:
  if (status === "changes_requested" || status === "approved") {
    const leadId = await serverClient.fetch<string | null>(`*[_id == $id][0].lead._ref`, { id });
    if (leadId) {
      void sendPush([leadId], "proposals", {
        title: status === "approved" ? "Propuesta aprobada" : "Cambios solicitados",
        body: status === "approved" ? "Tu propuesta fue aprobada." : "Revisaron tu propuesta y pidieron cambios.",
        path: "/me",
      });
    }
  }
```
> Read the route to confirm the variable holding the new status value; wire `status` to it.

- [ ] **Step 3: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/api/me/proposals app/api/admin/proposals
git commit -m "feat(push): proposal submit/status notifications"
```

---

## Task 9: Reminder cron

**Files:** Create `app/api/cron/service-reminders/route.ts`, `vercel.json`; Test `app/utils/__tests__/reminderQuery.test.ts` (covered by Task 2's `tomorrowDateStr` — no new pure logic).

- [ ] **Step 1: Implement the cron route**
```ts
import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { tomorrowDateStr } from "@/app/utils/notifyTargets";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const day = tomorrowDateStr("America/Mexico_City");
  const assigned = await serverClient.fetch<string[]>(
    `array::unique([
      ...*[_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day)].Lead[]._ref,
      ...*[_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day)].instruments[].person._ref,
      ...*[_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day)].BGVs[]._ref
    ][defined(@)])`,
    { day }
  );
  const r = await sendPush(assigned, "reminders", {
    title: "Recordatorio de servicio",
    body: "Sirves mañana. ¡Prepárate!",
    path: "/me",
  });
  return NextResponse.json({ day, ...r });
}
```

- [ ] **Step 2: Create `vercel.json`** (or add to existing):
```json
{
  "crons": [{ "path": "/api/cron/service-reminders", "schedule": "0 1 * * *" }]
}
```
> Vercel Cron calls the path with no secret by default; protect via the `CRON_SECRET` — Vercel sends an `Authorization: Bearer <CRON_SECRET>` header when you set the env var. Verify Vercel's current cron auth convention.

- [ ] **Step 3: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/api/cron vercel.json
git commit -m "feat(push): daily service-reminder cron"
```

---

## Task 10: /me notification settings UI

**Files:** Create `app/components/NotificationSettings.tsx`; Modify `app/api/me/route.ts` (accept `notifPrefs`), `app/(client)/me/page.tsx`

- [ ] **Step 1: Accept `notifPrefs` in `app/api/me/route.ts` PATCH.** In the PATCH handler's `patch` object building, add:
```ts
  if (body.notifPrefs !== undefined) patch.notifPrefs = body.notifPrefs;
```
and widen the body type to include `notifPrefs?: { assignments?: boolean; setlist?: "all"|"assigned"|"off"; proposals?: boolean; reminders?: boolean }`.

- [ ] **Step 2: Create `app/components/NotificationSettings.tsx`** — a client component with a master enable toggle (requests permission via `FirebaseMessaging.requestPermissions()` then registers; on disable, `DELETE`s the token) and the four category controls (setlist = 3-way Todos/Solo donde sirvo/No), persisting via `PATCH /api/me { notifPrefs }`. It reads initial prefs from a prop passed by the page. Use the same styling tokens as `TextSizeControl.tsx` (cyan accents, rounded pills). On non-native, hide the master OS-permission toggle but still allow editing category prefs.
```tsx
"use client";
import { useState } from "react";
import { isNativeApp } from "@/app/utils/native";

type Prefs = { assignments: boolean; setlist: "all" | "assigned" | "off"; proposals: boolean; reminders: boolean };
const DEFAULTS: Prefs = { assignments: true, setlist: "all", proposals: true, reminders: true };

export default function NotificationSettings({ initial }: { initial?: Partial<Prefs> }) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULTS, ...initial });

  async function save(next: Prefs) {
    setPrefs(next);
    await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notifPrefs: next }) });
  }
  async function enablePush() {
    if (!isNativeApp()) return;
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive === "granted") {
      const { token } = await FirebaseMessaging.getToken();
      if (token) await fetch("/api/me/push-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, platform: "ios" }) });
    }
  }

  return (
    <section className="rounded-2xl border border-[#003572]/20 dark:border-[#00bfff]/15 p-5">
      <h3 className="font-display text-lg font-bold mb-1">Notificaciones</h3>
      {isNativeApp() && (
        <button onClick={enablePush} className="font-label text-xs uppercase tracking-widest px-4 py-2 rounded-full border border-[#00bfff] text-[#00bfff] bg-[#00bfff]/10 mb-4">
          Activar notificaciones
        </button>
      )}
      <Toggle label="Asignaciones" on={prefs.assignments} set={(v) => save({ ...prefs, assignments: v })} />
      <SetlistChoice value={prefs.setlist} set={(v) => save({ ...prefs, setlist: v })} />
      <Toggle label="Propuestas" on={prefs.proposals} set={(v) => save({ ...prefs, proposals: v })} />
      <Toggle label="Recordatorios" on={prefs.reminders} set={(v) => save({ ...prefs, reminders: v })} />
    </section>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="font-body text-sm">{label}</span>
      <button onClick={() => set(!on)} aria-pressed={on} className={`px-3 py-1 rounded-full border text-xs font-label uppercase ${on ? "border-[#00bfff] text-[#00bfff] bg-[#00bfff]/10" : "border-[#003572]/25 text-gray-500"}`}>{on ? "Sí" : "No"}</button>
    </div>
  );
}
function SetlistChoice({ value, set }: { value: "all"|"assigned"|"off"; set: (v: "all"|"assigned"|"off") => void }) {
  const opts: { v: "all"|"assigned"|"off"; l: string }[] = [{ v: "all", l: "Todos" }, { v: "assigned", l: "Donde sirvo" }, { v: "off", l: "No" }];
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <span className="font-body text-sm shrink-0">Setlists</span>
      <div className="flex flex-wrap gap-1.5 justify-end">
        {opts.map((o) => (
          <button key={o.v} onClick={() => set(o.v)} aria-pressed={value === o.v} className={`px-3 py-1 rounded-full border text-xs font-label uppercase ${value === o.v ? "border-[#00bfff] text-[#00bfff] bg-[#00bfff]/10" : "border-[#003572]/25 text-gray-500"}`}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render on `/me`.** In `app/(client)/me/page.tsx`, fetch the member's `notifPrefs` (the page already loads `member`) and render after `<TextSizeControl />`:
```tsx
import NotificationSettings from "@/app/components/NotificationSettings";
// ...
        <TextSizeControl />
        <NotificationSettings initial={member?.notifPrefs} />
```
Ensure the member GROQ in the page includes `notifPrefs`.

- [ ] **Step 4: tsc + build + commit**
```bash
npx tsc --noEmit && npx next build
git add app/components/NotificationSettings.tsx app/api/me/route.ts "app/(client)/me/page.tsx"
git commit -m "feat(push): /me notification preferences (master + per-category, setlist tri-state)"
```

---

## Task 11: Device verification (manual)

**Files:** none. Needs a Vercel deploy + Xcode rebuild (new native plugin).

- [ ] **Step 1:** Push commits; set `FIREBASE_SERVICE_ACCOUNT` + `CRON_SECRET` in Vercel; redeploy. `npx cap sync ios && npx cap open ios` → Run on device.
- [ ] **Step 2:** `/me` → **Activar notificaciones** → grant permission → confirm a token row appears on your `teamMembers` doc in Sanity.
- [ ] **Step 3:** Assign yourself to a service (admin) → receive the assignment push. Publish that week's setlist → receive the setlist push (test `assigned` vs `all` scope). Submit/approve a proposal → receive. Tap a notification → app opens to the payload `path`.
- [ ] **Step 4:** Toggle a category **No** → re-trigger → confirm silenced.
- [ ] **Step 5:** Trigger the cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://owt-backstage.vercel.app/api/cron/service-reminders` → assigned members for tomorrow receive it.
- [ ] **Step 6:** Delete the app, trigger any send → confirm the dead token is pruned from the member doc. **Step 7:** `npm test` → all unit tests pass.

---

## Self-review notes (for the implementer)
- External APIs to verify against installed versions: `@capacitor-firebase/messaging` (permissions/getToken/listener names) and `firebase-admin` modular imports + `sendEachForMulticast` response/error shape. Adjust the touched code + its test together.
- Every trigger uses `void sendPush(...)` (fire-and-forget) AFTER the successful write — a push failure must never fail the mutation.
- Tasks 2 & 3 are the fully-unit-tested core; Tasks 6–9 wire pure helpers into real routes (read each route first for exact field/variable names).
- The Sanity `unset` token-prune uses a GROQ filter on the array; verify the `deviceTokens[token == "..."]` selector against your Sanity version during Task 3.
