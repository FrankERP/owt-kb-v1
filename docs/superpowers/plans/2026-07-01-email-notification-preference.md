# Email Notification Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each member opt out of assignment emails (default = receive), with a self-service toggle on `/me` and a super-admin toggle in the admin member editor.

**Architecture:** Opt-out semantics — send when `notifPrefs.email !== false`, mirroring the existing push `optedIn` rule. Sending is gated in the two shared functions in `assignmentEmail.ts`. Members write their own pref via a new `/api/me/notif-prefs` route (mirrors `/api/me/availability`); a super-admin writes any member's via the existing super-admin-only `/api/admin/members/[id]` PATCH. All writes use `setIfMissing({notifPrefs:{}}).set({"notifPrefs.email": bool})` to avoid clobbering sibling prefs.

**Tech Stack:** Next.js 16 (App Router, route handlers), React client components, Sanity (`@sanity/client` write/read), Vitest.

## Global Constraints

- Opt-out rule everywhere: a member receives when `notifPrefs.email !== false`. Unset/`null`/`true` → send; only explicit `false` → skip.
- Never clobber sibling `notifPrefs` fields (`assignments`, `setlist`, `proposals`, `reminders`): always `setIfMissing({ notifPrefs: {} }).set({ "notifPrefs.email": bool })`, never `.set({ notifPrefs: {...} })`.
- Send gating is AND: allowlist (`isEmailAllowed`) AND not-opted-out (`wantsEmail`). `EMAIL_ALLOWLIST=*` still honors opt-outs.
- Member self-write endpoints authenticate via `requireActiveSession` and write only `session.user.sanityId`.
- The admin member PATCH (`/api/admin/members/[id]`) is and stays **super-admin only**.
- Spanish UI copy. Member toggle label: **"Recibir asignaciones por correo"**. Admin toggle label: **"Correo de asignaciones"**.
- Do not add Co-Authored-By / AI attribution to commit messages.
- Commit and push directly to `main` (no PRs).

---

### Task 1: Opt-out send gating in `assignmentEmail.ts`

**Files:**
- Modify: `app/utils/assignmentEmail.ts`
- Test: `app/utils/__tests__/assignmentEmail.test.ts`

**Interfaces:**
- Produces: `wantsEmail(pref: unknown): boolean` — returns `pref !== false`.
- The member fetch rows in both send paths gain an `emailPref?: boolean | null` field (GROQ `"emailPref": notifPrefs.email`).

**Context:** Both `sendAssignmentEmails` (single service) and `sendAssignmentEmailsBatch` (publish-all) fetch assigned members with a projection `{ _id, member_name, alias, email }` and loop with `if (!email || !isEmailAllowed(email, allow)) continue;`. The test file mocks `serverClient.fetch` to return fixed rows (no real GROQ), so tests must set `emailPref` directly on mocked rows.

- [ ] **Step 1: Write the failing tests**

Add to `app/utils/__tests__/assignmentEmail.test.ts`, inside the existing `describe("sendAssignmentEmails gating", …)` block, add one case:

```ts
  it("skips a member who opted out of email (emailPref false)", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "frank@x.com", emailPref: false }]);
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
```

And add to the existing `describe("sendAssignmentEmailsBatch", …)` block:

```ts
  it("skips an opted-out member even when EMAIL_ALLOWLIST is '*'", async () => {
    process.env.EMAIL_ALLOWLIST = "*";
    fetchMock.mockResolvedValue([
      { _id: "m1", member_name: "Frank", email: "frank@x.com", emailPref: false },
      { _id: "m2", member_name: "Gaby", email: "gaby@y.com" }, // unset → receives
    ]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmailsBatch([svcA, svcB]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("gaby@y.com");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/utils/__tests__/assignmentEmail.test.ts`
Expected: FAIL — both new tests still send (opted-out member is not yet skipped).

- [ ] **Step 3: Add the `wantsEmail` helper**

In `app/utils/assignmentEmail.ts`, immediately after the `isEmailAllowed` function, add:

```ts
// Whether a member wants assignment emails. Opt-out: unset/null/true → yes,
// only an explicit false → no. Mirrors push.ts optedIn semantics.
export function wantsEmail(pref: unknown): boolean {
  return pref !== false;
}
```

- [ ] **Step 4: Add `emailPref` to both projections and member types, and gate both loops**

In `sendAssignmentEmailsBatch`, change the member fetch to include `emailPref`:

```ts
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string; emailPref?: boolean | null }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email, "emailPref": notifPrefs.email }`,
      { ids },
    );
```

and change its guard line to:

```ts
      if (!email || !isEmailAllowed(email, allow) || !wantsEmail(m.emailPref)) continue;
```

In `sendAssignmentEmails`, make the identical two changes — projection:

```ts
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string; emailPref?: boolean | null }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email, "emailPref": notifPrefs.email }`,
      { ids },
    );
```

and guard:

```ts
      if (!email || !isEmailAllowed(email, allow) || !wantsEmail(m.emailPref)) continue;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/utils/__tests__/assignmentEmail.test.ts`
Expected: PASS (all cases, including the 2 new ones).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 tsc errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/utils/assignmentEmail.ts app/utils/__tests__/assignmentEmail.test.ts
git commit -m "feat(email): honor per-member opt-out (notifPrefs.email) when sending"
```

---

### Task 2: Schema field — default email pref to ON

**Files:**
- Modify: `sanity/schemas/worshipTeam.ts` (the `notifPrefs.email` field, around line 76-82)

**Context:** `initialValue` only seeds NEW Studio-created docs; it never backfills existing members. Flipping it to `true` aligns Studio-created members with the opt-out default. No data migration.

- [ ] **Step 1: Update the field**

Replace the `email` field object inside `notifPrefs.fields` with:

```ts
        {
          name: "email",
          title: "Asignaciones por correo",
          type: "boolean",
          initialValue: true,
          description: "Recibir asignaciones por correo electrónico.",
        },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemas/worshipTeam.ts
git commit -m "feat(schema): default notifPrefs.email to true (opt-out)"
```

- [ ] **Step 4: Deploy the Studio schema**

After merge, deploy the schema so Studio shows the updated field. Use the `sanity:deploy-schema` skill (or `npx sanity schema deploy`). This is an operator step; note it in the completion summary. It does not affect app runtime behavior (the app reads `notifPrefs.email` directly).

---

### Task 3: Member self-service — endpoint + `/me` query + ProfilePanel toggle

**Files:**
- Create: `app/api/me/notif-prefs/route.ts`
- Modify: `app/(client)/me/page.tsx` (member query, ~line 40-42)
- Modify: `app/components/ProfilePanel.tsx` (`MemberProfile` type, state, handler, new section)

**Interfaces:**
- Consumes: `wantsEmail` semantics (default ON when unset).
- Produces: `PATCH /api/me/notif-prefs` accepting `{ email: boolean }`, returning `{ email: boolean }`.

**Context:** `/me` is a server component; `MePage` fetches `member` by `session.user.sanityId` and renders `<ProfilePanel initialMember={member} />`. `ProfilePanel` is a client component with a `showToast(msg, ok)` helper and a scrollable drawer body containing an "Identidad" section and a "Contraseña" section.

- [ ] **Step 1: Create the self-service endpoint**

Create `app/api/me/notif-prefs/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { email?: boolean };
  if (typeof body.email !== "boolean") {
    return NextResponse.json({ error: "email must be a boolean" }, { status: 400 });
  }

  const doc = await writeClient
    .patch(session.user.sanityId)
    .setIfMissing({ notifPrefs: {} })
    .set({ "notifPrefs.email": body.email })
    .commit();

  const email = (doc as { notifPrefs?: { email?: boolean } }).notifPrefs?.email;
  return NextResponse.json({ email: email !== false });
}
```

- [ ] **Step 2: Include `notifPrefs` in the `/me` member query**

In `app/(client)/me/page.tsx`, in the member `serverClient.fetch` projection, add `notifPrefs` to the field list. Change:

```ts
      _id, member_name, alias, email, role, memberType,
      unavailableDates, unavailabilityNotes,
```
to:
```ts
      _id, member_name, alias, email, role, memberType, notifPrefs,
      unavailableDates, unavailabilityNotes,
```

- [ ] **Step 3: Extend `MemberProfile` type + add toggle state/handler in ProfilePanel**

In `app/components/ProfilePanel.tsx`, add `notifPrefs` to the interface (after `hasPassword: boolean;`):

```ts
  hasPassword: boolean;
  notifPrefs?: { email?: boolean };
```

Add state near the other form state (after the password state block, ~line 88):

```ts
  // Email notifications (opt-out: default ON when unset)
  const [emailPref, setEmailPref] = useState(initialMember.notifPrefs?.email !== false);
  const [savingEmailPref, setSavingEmailPref] = useState(false);
```

Add to the `useEffect` that syncs on `initialMember` change (after `setEmail(...)`, ~line 94):

```ts
    setEmailPref(initialMember.notifPrefs?.email !== false);
```

Add the handler after `handleSavePassword` (~line 163):

```ts
  const handleToggleEmailPref = async () => {
    const next = !emailPref;
    setEmailPref(next);            // optimistic
    setSavingEmailPref(true);
    const res = await fetch("/api/me/notif-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: next }),
    });
    setSavingEmailPref(false);
    if (res.ok) {
      showToast(next ? "Recibirás correos de asignación." : "Ya no recibirás correos de asignación.");
    } else {
      setEmailPref(!next);         // revert on failure
      showToast("Error al guardar la preferencia.", false);
    }
  };
```

- [ ] **Step 4: Add the "Notificaciones" section to the drawer**

In `app/components/ProfilePanel.tsx`, inside the scrollable body, add a new `<section>` after the Password section's closing `</section>` (~line 297, still inside the `<div className="flex-1 overflow-y-auto …">`):

```tsx
          {/* Notifications */}
          <section className="space-y-4 border-t border-[#003572]/10 dark:border-[#00bfff]/10 pt-6">
            <h3 className="font-label text-[10px] uppercase tracking-widest text-gray-500">Notificaciones</h3>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-body text-sm">Recibir asignaciones por correo</p>
                <p className="font-body text-xs text-gray-500 mt-0.5">Te avisamos por email cuando te asignen a un servicio.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailPref}
                aria-label="Recibir asignaciones por correo"
                disabled={savingEmailPref}
                onClick={handleToggleEmailPref}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${emailPref ? "bg-[#00bfff]" : "bg-gray-500/40"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${emailPref ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          </section>
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 tsc errors; all tests pass.

- [ ] **Step 6: Manual verification (dev)**

Run: `npm run dev`, sign in, open `/me` → "Editar perfil" → Notificaciones. Toggle off → toast "Ya no recibirás…"; reload page → toggle stays off. Toggle on → toast + persists.
Expected: toggle persists across reload (confirms the PATCH wrote `notifPrefs.email`).

- [ ] **Step 7: Commit**

```bash
git add app/api/me/notif-prefs/route.ts "app/(client)/me/page.tsx" app/components/ProfilePanel.tsx
git commit -m "feat(me): self-service email notification toggle on /me"
```

---

### Task 4: Admin control — GET projection + PATCH whitelist + AdminPanel edit toggle

**Files:**
- Modify: `app/api/admin/members/route.ts` (GET projection, ~line 20)
- Modify: `app/api/admin/members/[id]/route.ts` (PATCH body type + whitelist, ~line 19-38)
- Modify: `app/components/admin/AdminPanel.tsx` (`Member` interface ~line 15, `MemberForm` ~line 164, `handleEdit` ~line 426)

**Interfaces:**
- Consumes: opt-out semantics; the super-admin-only PATCH route.
- Produces: `PATCH /api/admin/members/[id]` additionally accepts `{ notifEmail?: boolean }`.

**Context:** The admin member editor is `AdminPanel.tsx`. `MemberForm` is shared by Add and Edit; only Edit passes `initial={modal.member}`, so the email toggle is rendered only when `initial` is present. `handleEdit` sends the form data as the PATCH body; `handleAdd` (create) ignores unknown fields. The PATCH route is super-admin only and whitelists fields into a `patch` object.

- [ ] **Step 1: Add `notifPrefs` to the admin members GET projection**

In `app/api/admin/members/route.ts`, in the GET `serverClient.fetch` projection, add `notifPrefs`. Change:

```ts
      _id, member_name, alias, email, role, memberType,
      unavailableDates, unavailabilityNotes,
```
to:
```ts
      _id, member_name, alias, email, role, memberType, notifPrefs,
      unavailableDates, unavailabilityNotes,
```

- [ ] **Step 2: Extend the PATCH whitelist to accept `notifEmail`**

In `app/api/admin/members/[id]/route.ts`, add `notifEmail?: boolean;` to the body type:

```ts
  const body = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
    notifEmail?: boolean;
  };
```

Then apply it with `setIfMissing` so siblings are preserved. Replace the commit line:

```ts
  const doc = await writeClient.patch(id).set(patch).commit();
```
with:
```ts
  let mutation = writeClient.patch(id).set(patch);
  if (typeof body.notifEmail === "boolean") {
    mutation = mutation.setIfMissing({ notifPrefs: {} }).set({ "notifPrefs.email": body.notifEmail });
  }
  const doc = await mutation.commit();
```

Also relax the "Nothing to update" guard so a notifEmail-only change is allowed. Replace:

```ts
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
```
with:
```ts
  if (Object.keys(patch).length === 0 && typeof body.notifEmail !== "boolean") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
```

- [ ] **Step 3: Add `notifPrefs` to the `Member` interface + thread `notifEmail` through `MemberForm`/`handleEdit`**

In `app/components/admin/AdminPanel.tsx`, add to the `Member` interface (after `photoUrl?: string;`):

```ts
  photoUrl?: string;
  notifPrefs?: { email?: boolean };
```

In `MemberForm`, widen the `onSubmit` prop type to include optional `notifEmail`:

```ts
  onSubmit: (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => void;
```

Add toggle state near the other `MemberForm` state (after `memberType` state):

```ts
  const [notifEmail, setNotifEmail] = useState<boolean>(initial?.notifPrefs?.email !== false);
```

Change the form `onSubmit` call to include `notifEmail`:

```tsx
      onSubmit={(e) => { e.preventDefault(); onSubmit({ member_name: name, alias, email, role, memberType, notifEmail }); }}
```

Render the toggle only in edit mode (when `initial` exists), just before the `<div className="flex gap-3 pt-1">` action buttons:

```tsx
      {initial && (
        <div className="flex items-center justify-between gap-4 pt-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Correo de asignaciones</label>
          <button
            type="button"
            role="switch"
            aria-checked={notifEmail}
            aria-label="Correo de asignaciones"
            onClick={() => setNotifEmail((v) => !v)}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${notifEmail ? "bg-[#00bfff]" : "bg-gray-500/40"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notifEmail ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      )}
```

Widen `handleEdit`'s parameter type to accept `notifEmail` and pass the whole data as the PATCH body (it already does `JSON.stringify(data)`):

```ts
  const handleEdit = async (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => {
```

Also widen `handleAdd`'s parameter type to match the shared `onSubmit` type (it's passed as `MemberForm`'s `onSubmit` in add mode), but ignore the field — the create route drops unknown props and new members default to receive:

```ts
  const handleAdd = async (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => {
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 tsc errors; all tests pass.

- [ ] **Step 5: Manual verification (dev)**

Run: `npm run dev`, sign in as super-admin → admin members → Editar a member → toggle "Correo de asignaciones" off → Guardar. Re-open the member → toggle reflects off. Confirm in Sanity Vision or by reopening that other `notifPrefs` fields are intact.
Expected: pref persists; siblings untouched.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/members/route.ts "app/api/admin/members/[id]/route.ts" app/components/admin/AdminPanel.tsx
git commit -m "feat(admin): super-admin can set a member's email notification pref"
```

---

## Final steps (after all tasks)

- [ ] Run `npx tsc --noEmit && npx vitest run` once more; confirm 0 errors / all pass.
- [ ] `git push origin main`.
- [ ] Deploy the Studio schema (Task 2, Step 4) via the `sanity:deploy-schema` skill.
- [ ] Summarize for the user: opt-out is live; members toggle on `/me`, super-admin toggles in admin editor; nobody is opted out yet so team behavior is unchanged.
