# Draft / Publish workflow for services — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give services a `published` flag so new services are admin-only drafts until an admin publishes them (single or "publish all for the month filter"), with members — and all notifications — only ever seeing/learning about published services' role assignments.

**Architecture:** A boolean `published` on the three role schemas; member-facing role-doc reads gain `&& published != false` (grandfathers existing); create defaults to draft; all role-assignment notifications (POST/PATCH/cron/publish-endpoint) gate on `published`; a new `POST /api/admin/roles/publish` endpoint toggles state, notifies on draft→published, and revalidates member views; ServicesPanel + MonthGenerator get publish controls.

**Tech Stack:** Next.js App Router, Sanity (GROQ), TypeScript, Vitest.

## Global Constraints

- **Invariant (role assignments only):** a member learns who is assigned — in app UI, push, email, reminder cron — ONLY once the service is `published`. The setlist channel is explicitly OUT OF SCOPE (separate follow-up).
- **Draft filter clause (verbatim, everywhere):** `&& published != false` (matches `true` + missing/grandfathered; hides only explicit `false`).
- **Admin = sees drafts:** `session.user.role` ∈ {`super-admin`,`admin`}; admin reads (`/api/admin/roles` GET, PATCH) are NOT filtered. Member-facing pages filter by `published`, not by role.
- **Create default = draft** (`published: false`). Notifications fire only for published services.
- **Spanish UI copy.** Tests = Vitest (`npx vitest run <file>`). `npx tsc --noEmit` must stay at 0 errors.
- **Never break grandfathered visibility:** existing services (no field) stay visible; only July 2026 is later explicitly unpublished by a one-shot.

---

### Task 1: Add `published` field to the three role schemas

**Files:**
- Modify: `sanity/schemas/sunRole.ts`, `sanity/schemas/satRole.ts`, `sanity/schemas/specialRole.ts`

> No unit test (Sanity schema). Gate: `npx tsc --noEmit` = 0 errors.

- [ ] **Step 1: Add the field** to each schema's `fields` array (place it first, before `week`/`date`). Identical in all three files:

```ts
{
  name: "published",
  title: "Publicado",
  type: "boolean",
  initialValue: true,
  description: "Si está apagado, el servicio es un borrador visible solo para admins.",
},
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemas/sunRole.ts sanity/schemas/satRole.ts sanity/schemas/specialRole.ts
git commit -m "feat(schema): add published flag to role docs"
```

---

### Task 2: Add the draft filter to every member-facing + cron role read

**Files:**
- Modify: `app/(client)/page.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/me/page.tsx`, `app/(client)/me/propose/[roleId]/page.tsx`, `app/api/me/proposals/route.ts`, `app/api/cron/service-reminders/route.ts`, `app/api/song/[id]/route.ts`

> This is the safety-critical task. No unit test (GROQ in strings); gate = `tsc` 0 errors AND the grep verification in Step 9. Every role-doc filter below gets `&& published != false` inserted INSIDE the `*[ ... ]` brackets (after the existing date/`_id` conditions, before the closing `]`/`][0]`/`].field`).

- [ ] **Step 1 — `app/(client)/page.tsx` (3 reads).** Add `&& published != false` to each:
  - line 53 `*[_type == "sunday_role" && week == $sun]` → `… && week == $sun && published != false]`
  - line 54 `*[_type == "saturday_role" && week == $sat]` → `… && published != false]`
  - line 55 `*[_type == "special_role" && date >= $today && date <= $sun]` → `… && date <= $sun && published != false]`

- [ ] **Step 2 — `app/(client)/schedule/page.tsx` (3 reads).** Lines 32, 33, 36: append `&& published != false` inside each role `*[…]` filter (the `sundays`, `saturdays`, `specials` queries).

- [ ] **Step 3 — `app/(client)/me/page.tsx` (6 reads).** Lines 67, 85, 103 (the member-assignment reads, after the `&& ${memberFilter}`) AND lines 129, 130, 131 (the calendar-date reads `…].week` / `…].date`): insert `&& published != false` inside each `*[…]`.

- [ ] **Step 4 — `app/(client)/me/propose/[roleId]/page.tsx` (1 read).** Line 14 `*[_id == $id && (_type == … ) && $leadId in Lead[]._ref][0]` → add `&& published != false` before `][0]`.

- [ ] **Step 5 — `app/api/me/proposals/route.ts` (1 read).** Line 51 `*[_id == $id && $leadId in Lead[]._ref][0]` → `*[_id == $id && $leadId in Lead[]._ref && published != false][0]`.

- [ ] **Step 6 — `app/api/cron/service-reminders/route.ts` (3 reads).** Lines 13, 14, 15: each `*[_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day)]` → add `&& published != false` before the `]`.

- [ ] **Step 7 — `app/api/song/[id]/route.ts` (1 read, the INNER role join).** Line ~31-33 inner filter:
  ```
  "leaders": *[
    _type == select(^._type == "featuredSongs" => "sunday_role", "saturday_role")
    && week == ^.week
    && published != false
  ][0].Lead[]-> { … }
  ```
  Add `&& published != false` to the INNER role `*[…][0]` — NOT the outer `featuredSongs`/`saturdarSongs` query.

- [ ] **Step 8: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 9: Verify every member-facing role read has the filter.** Run:
  ```bash
  grep -rn "sunday_role\|saturday_role\|special_role" \
    app/\(client\)/page.tsx app/\(client\)/schedule/page.tsx app/\(client\)/me/page.tsx \
    app/\(client\)/me/propose/\[roleId\]/page.tsx app/api/me/proposals/route.ts \
    app/api/cron/service-reminders/route.ts app/api/song/\[id\]/route.ts
  ```
  Manually confirm every role-doc `*[…]` filter line in the output is followed by `published != false`. (The admin `/api/admin/roles` GET is intentionally NOT in this list.)

- [ ] **Step 10: Commit**

```bash
git add app/\(client\)/page.tsx app/\(client\)/schedule/page.tsx app/\(client\)/me/page.tsx \
  "app/(client)/me/propose/[roleId]/page.tsx" app/api/me/proposals/route.ts \
  app/api/cron/service-reminders/route.ts "app/api/song/[id]/route.ts"
git commit -m "feat(publish): hide unpublished services from all member-facing + cron reads"
```

---

### Task 3: Role routes — return `published`, create-as-draft, gate notifications

**Files:**
- Modify: `app/api/admin/roles/route.ts` (GET projection + POST)
- Modify: `app/api/admin/roles/[id]/route.ts` (PATCH)

**Interfaces:**
- Produces: POST/PATCH accept/preserve `published`; GET returns `published` per role.

> No new unit test (route wiring; notification logic is exercised by Task 4's helper test and the existing email/push tests). Gate: `tsc` 0.

- [ ] **Step 1 — GET projection.** In `app/api/admin/roles/route.ts` GET GROQ (~line 59, the projection object), add `published,` so the panel knows each service's status:
  ```
  _id, _type, service_name, published,
  "date": coalesce(week, date),
  ```

- [ ] **Step 2 — POST accepts `published`.** In the POST body type (~line 87) add `published?: boolean;`. In the `writeClient.create({...})` (~line 104) add as the last field:
  ```ts
  published: body.published === true,   // default false = draft
  ```

- [ ] **Step 3 — POST gates notifications on published.** Wrap the existing `void sendPush(added, "assignments", {...});` AND `void sendAssignmentEmails(added, {...});` (~lines 116–121) in a published check:
  ```ts
  if (body.published === true) {
    void sendPush(added, "assignments", { title: "Nuevo servicio asignado", body: `Te asignaron para el ${body.date}.`, path: "/me" });
    void sendAssignmentEmails(added, { type: body._type, date: body.date, body });
  }
  ```

- [ ] **Step 4 — PATCH gates notifications on the service's current published state.** In `app/api/admin/roles/[id]/route.ts`: add `"published": published` to the `prevDoc` projection (~line 69), and wrap the existing `void sendPush(added, …)` AND `void sendAssignmentEmails(added, …)` (~lines 88–92) in:
  ```ts
  if (prevDoc?.published !== false) {   // published or grandfathered; drafts stay silent
    void sendPush(added, "assignments", { title: "Servicio actualizado", body: `Te asignaron para el ${body.date}.`, path: "/me" });
    void sendAssignmentEmails(added, { type: body._type, date: body.date, body });
  }
  ```
  Do NOT add `published` to the PATCH `.set({...})` — editing must preserve the existing state.

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/roles/route.ts "app/api/admin/roles/[id]/route.ts"
git commit -m "feat(publish): roles API returns published, creates drafts, gates notifications"
```

---

### Task 4: Publish endpoint with a unit-tested transition helper

**Files:**
- Create: `app/utils/publishTransitions.ts`
- Test: `app/utils/__tests__/publishTransitions.test.ts`
- Create: `app/api/admin/roles/publish/route.ts`

**Interfaces:**
- Produces: `computePublishTransitions(current: {_id: string; published?: boolean}[], target: boolean): { toPatch: string[]; toNotify: string[] }`
  - `toPatch` = ids whose current state differs from `target` (skip no-ops). A doc is "currently published" when `published !== false`.
  - `toNotify` = ids transitioning **draft→published** only (i.e. `target === true` AND the doc was `published === false`). Empty when `target === false`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/publishTransitions.test.ts
import { describe, it, expect } from "vitest";
import { computePublishTransitions } from "../publishTransitions";

describe("computePublishTransitions", () => {
  it("publishes drafts and notifies only the newly-published", () => {
    const r = computePublishTransitions(
      [{ _id: "a", published: false }, { _id: "b", published: true }, { _id: "c" }],
      true,
    );
    expect(r.toPatch).toEqual(["a"]);   // b already true, c grandfathered-true → skip
    expect(r.toNotify).toEqual(["a"]);
  });

  it("unpublishes published/grandfathered and never notifies", () => {
    const r = computePublishTransitions(
      [{ _id: "a", published: true }, { _id: "b", published: false }, { _id: "c" }],
      false,
    );
    expect(r.toPatch.sort()).toEqual(["a", "c"]); // b already false → skip
    expect(r.toNotify).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/utils/__tests__/publishTransitions.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// app/utils/publishTransitions.ts
export function computePublishTransitions(
  current: { _id: string; published?: boolean }[],
  target: boolean,
): { toPatch: string[]; toNotify: string[] } {
  const isPublished = (p?: boolean) => p !== false; // missing = grandfathered published
  const toPatch: string[] = [];
  const toNotify: string[] = [];
  for (const doc of current) {
    if (isPublished(doc.published) === target) continue; // no-op, skip
    toPatch.push(doc._id);
    if (target && doc.published === false) toNotify.push(doc._id); // draft -> published
  }
  return { toPatch, toNotify };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run app/utils/__tests__/publishTransitions.test.ts` → PASS (2).

- [ ] **Step 5: Create the endpoint**

```ts
// app/api/admin/roles/publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails, type ServiceType } from "@/app/utils/assignmentEmail";
import { computePublishTransitions } from "@/app/utils/publishTransitions";

export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as { ids: string[]; published: boolean };
  const ids = [...new Set((body.ids ?? []).filter(Boolean))];
  if (!ids.length) return NextResponse.json({ ok: true, published: 0, unpublished: 0 });

  const current = await serverClient.fetch<{ _id: string; published?: boolean }[]>(
    `*[_id in $ids]{ _id, published }`, { ids },
  );
  const { toPatch, toNotify } = computePublishTransitions(current, body.published === true);

  if (toPatch.length) {
    let tx = writeClient.transaction();
    for (const id of toPatch) tx = tx.patch(id, (p) => p.set({ published: body.published === true }));
    await tx.commit();
  }

  // Deferred assignment notification, only for draft -> published transitions.
  if (toNotify.length) {
    const docs = await serverClient.fetch<{
      _id: string; _type: ServiceType; date: string;
      leads: string[]; bgvs: string[]; chorus: string[];
      instruments: { instrument: string; personId: string }[];
      foh: { role: string; personId: string }[];
    }[]>(
      `*[_id in $ids]{
        _id, _type, "date": coalesce(week, date),
        "leads": Lead[]._ref, "bgvs": BGVs[]._ref, "chorus": Chorus[]._ref,
        "instruments": instruments[]{ instrument, "personId": person._ref },
        "foh": foh_team[]{ role, "personId": person._ref }
      }`, { ids: toNotify },
    );
    for (const d of docs) {
      const added = [
        ...(d.leads ?? []), ...(d.bgvs ?? []), ...(d.chorus ?? []),
        ...(d.instruments ?? []).map((i) => i.personId),
        ...(d.foh ?? []).map((f) => f.personId),
      ].filter(Boolean);
      void sendPush(added, "assignments", { title: "Nuevo servicio asignado", body: `Te asignaron para el ${d.date}.`, path: "/me" });
      void sendAssignmentEmails(added, { type: d._type, date: d.date, body: d });
    }
  }

  // Invalidate member-facing caches so the change is prompt (esp. on unpublish).
  revalidatePath("/"); revalidatePath("/schedule"); revalidatePath("/me");

  const published = body.published === true ? toPatch.length : 0;
  const unpublished = body.published === true ? 0 : toPatch.length;
  return NextResponse.json({ ok: true, published, unpublished });
}
```

- [ ] **Step 6: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/utils/publishTransitions.ts app/utils/__tests__/publishTransitions.test.ts "app/api/admin/roles/publish/route.ts"
git commit -m "feat(publish): publish endpoint (toggle, notify on publish, revalidate)"
```

---

### Task 5: ServicesPanel — draft badge, per-card toggle, "Publicar todo", ServiceForm buttons

**Files:**
- Modify: `app/components/admin/ServicesPanel.tsx`

> UI task. The `ServiceRole` type (line ~25) must gain `published?: boolean` (the GET now returns it). Gate: `tsc` 0 + visual check.

- [ ] **Step 1:** Add `published?: boolean;` to the `ServiceRole` interface (~line 25–36).

- [ ] **Step 2: Per-card draft badge.** In the service card render (the card header area near the `CARD_HEADER`/type label, ~line 1164+ grid of cards), when `role.published === false`, show a badge:
  ```tsx
  {role.published === false && (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-label uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30">
      Borrador
    </span>
  )}
  ```

- [ ] **Step 3: Per-card publish toggle.** Add a button on each card that calls a new handler:
  ```tsx
  <button type="button" onClick={() => handlePublish([role._id], role.published === false)}
    className="px-2 py-1 rounded-lg border border-[#00bfff]/20 text-xs hover:border-[#00bfff] transition-colors">
    {role.published === false ? "Publicar" : "Despublicar"}
  </button>
  ```

- [ ] **Step 4: The handler.** Add to the component body:
  ```ts
  async function handlePublish(ids: string[], published: boolean) {
    const res = await fetch("/api/admin/roles/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, published }),
    });
    if (res.ok) fetchData();   // reuse existing refresh (re-reads roles incl. published)
  }
  ```

- [ ] **Step 5: "Publicar todo (filtro actual)".** In the header/actions row, compute the visible drafts and show the button when there are any:
  ```tsx
  {(() => {
    const draftIds = visible.filter(r => r.published === false).map(r => r._id);
    return draftIds.length > 0 ? (
      <button type="button"
        onClick={() => { if (confirm(`¿Publicar ${draftIds.length} servicio(s) del filtro actual?`)) handlePublish(draftIds, true); }}
        className="px-3 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 font-label text-xs uppercase tracking-widest transition-colors">
        Publicar todo ({draftIds.length})
      </button>
    ) : null;
  })()}
  ```
  (`visible` is the already-computed filtered list at ~line 1013.)

- [ ] **Step 6: ServiceForm two create buttons.** In the create form submit area (`ServiceForm`, ~line 228+), replace the single create button with two, passing `published` to the existing submit handler (thread a `published` arg through to the `POST /api/admin/roles` body):
  ```tsx
  <button type="button" onClick={() => submit(false)} className="…">Crear</button>
  <button type="button" onClick={() => submit(true)}  className="…">Crear y publicar</button>
  ```
  Ensure the form's POST body includes `published` (the value passed to `submit`). Editing an existing service keeps its current state (don't send `published` on edit/PATCH).

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 8: Visual check.** Run the app → Servicios panel: drafts show "Borrador" + "Publicar"; published show "Despublicar"; "Publicar todo (N)" appears when the filter has drafts and publishes them; "Crear" makes a draft, "Crear y publicar" makes a public one.

- [ ] **Step 9: Commit**

```bash
git add app/components/admin/ServicesPanel.tsx
git commit -m "feat(publish): ServicesPanel draft badge, publish toggle, publish-all, create buttons"
```

---

### Task 6: MonthGenerator — draft-or-publish choice on create

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (the preview `handleConfirm` ~line 1304 + the create buttons ~line 1463)

> UI task. Gate: `tsc` 0 + visual check.

- [ ] **Step 1:** Make two minimal edits to the existing `handleConfirm` (do NOT rewrite the body — keep its current `toCreate`/`setPushing`/loop/`onCreated`/`onClose` logic and the existing `instruments`/`foh` `.filter(...)` exactly as they are):
  1. Change the signature `async function handleConfirm()` → `async function handleConfirm(publish: boolean)`.
  2. In the `JSON.stringify({ ... })` POST body inside the loop, add one field: `published: publish,`.
  That is the entire change to this function.

- [ ] **Step 2:** Replace the single "Crear N servicios" button (~line 1467) with two:
  ```tsx
  <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || toCreate.length === 0} className="…">
    {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
  </button>
  <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || toCreate.length === 0} className="…">
    Crear y publicar
  </button>
  ```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 4: Visual check** — generate a month → "Crear N borradores" creates drafts (hidden from members, badged in panel); "Crear y publicar" creates public services + notifies.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx
git commit -m "feat(publish): MonthGenerator draft-or-publish choice on create"
```

---

### Task 7: One-time July-2026 unpublish script + Studio deploy

**Files:**
- Create: `scripts/unpublish-july-2026.mjs`

> Operator step, run once AFTER deploy. Idempotent.

- [ ] **Step 1: Write the script** (dry-run by default; `--apply` to commit):

```js
// scripts/unpublish-july-2026.mjs — set published:false on existing July 2026 services.
import { createClient } from "@sanity/client";
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
  dataset: "production", apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN, useCdn: false,
});
const apply = process.argv.includes("--apply");
const q = `*[_type in ["sunday_role","saturday_role","special_role"]
  && coalesce(week, date) >= "2026-07-01" && coalesce(week, date) < "2026-08-01"]{ _id, _type, "d": coalesce(week,date), published }`;
const docs = await client.fetch(q);
console.log(`July 2026 services: ${docs.length}`);
for (const d of docs) console.log(`  ${d.d} ${d._type} published=${d.published}`);
if (!apply) { console.log("\nDry-run. Re-run with --apply to set published:false."); process.exit(0); }
let tx = client.transaction();
for (const d of docs) tx = tx.patch(d._id, (p) => p.set({ published: false }));
await tx.commit();
console.log(`Set published:false on ${docs.length} services.`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/unpublish-july-2026.mjs
git commit -m "chore(publish): one-shot script to mark existing July 2026 services as drafts"
```

- [ ] **Step 3 (operator, post-deploy):** deploy the Studio schema so `published` shows in Studio: run the `sanity:deploy-schema` skill. Then dry-run the script (`node scripts/unpublish-july-2026.mjs`), review, then `node scripts/unpublish-july-2026.mjs --apply`.

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — whole suite green (existing + `publishTransitions`).
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] Manual: create a draft → absent from home/schedule/`/me` as a member, badged in panel, no notification; publish it → appears + assignees notified; unpublish → disappears, no notification; "Publicar todo" publishes the filtered drafts.

## Out of scope (do not build)
- Setlist visibility/notification gating (separate follow-up spec).
- Participation sidebar (separate queued feature).
- Publish history/audit log, scheduled auto-publish.
