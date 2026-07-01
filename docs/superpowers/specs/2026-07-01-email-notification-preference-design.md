# Email notification preference (opt-out) — design

Date: 2026-07-01
Status: Approved (design)

## Problem

Assignment emails now send to the whole team (`EMAIL_ALLOWLIST=*`, sent from
`contacto@oasis.mx` via SMTP). Members have no way to say "don't email me."
We need a per-member preference — with an opt-out default so the team keeps
receiving — editable by the member themselves and viewable/settable by an admin.

## Semantics: opt-out, mirroring push

A member receives assignment emails **unless they have explicitly turned them
off**.

- Rule: send when `notifPrefs.email !== false`. Unset or `true` → send; only an
  explicit `false` suppresses.
- This mirrors the existing push preference logic in `app/utils/push.ts`
  (`optedIn`: `(p[category] ?? true) !== false`).
- Verified against live data (2026-07-01): all 34 members have `notifPrefs`
  unset, so under this rule everyone keeps receiving — nobody is accidentally
  excluded on rollout.

Schema change (`sanity/schemas/worshipTeam.ts`, `notifPrefs.email` field):
- `initialValue: false → true` (consistency with opt-out semantics).
- Remove the "(próximamente)" note in the description; it's live now.

This is a schema change to the field definition only; it does not backfill
existing docs (they stay `notifPrefs` unset, which the rule already treats as
"send").

## Send gating

File: `app/utils/assignmentEmail.ts`.

Both send paths (`sendAssignmentEmails`, `sendAssignmentEmailsBatch`) already
fetch the assigned members. Changes:

1. Add `notifPrefs.email` to each GROQ member projection, e.g.
   `"emailPref": notifPrefs.email`.
2. Add a helper `export function wantsEmail(pref: unknown): boolean` returning
   `pref !== false`.
3. In each send loop, skip a member when `!wantsEmail(m.emailPref)` — **in
   addition to** the existing allowlist check (`isEmailAllowed`). Both gates
   must pass: allowlist AND not-opted-out. So `EMAIL_ALLOWLIST=*` still honors
   individual opt-outs.

No change to the single create/edit routes' behavior beyond what the shared
send functions do.

## Member self-service UI (`/me`)

- Add a toggle labeled **"Recibir asignaciones por correo"** to
  `app/components/ProfilePanel.tsx` (already the member settings home:
  alias / email / photo / password). Sits alongside the existing controls.
- The `/me` page query (`app/(client)/me/page.tsx`) and the `ProfilePanel`
  `initialMember` prop gain `notifPrefs` (or a projected `emailPref`). Default
  the toggle to ON when the value is unset (matching send semantics).
- New endpoint `PATCH /api/me/notif-prefs`:
  - Auth via `requireActiveSession` (401 if none).
  - Body: `{ email: boolean }`.
  - Write only the caller's own doc:
    `writeClient.patch(session.user.sanityId)
      .setIfMissing({ notifPrefs: {} })
      .set({ "notifPrefs.email": body.email }).commit()`.
  - `setIfMissing` guards the case where `notifPrefs` doesn't exist yet
    (all current members), so the dotted `set` has a parent to write into.
  - Returns the resulting email pref.
  - Mirrors the auth of `app/api/me/availability/route.ts`. PATCH only — no GET
    needed, since `ProfilePanel` seeds the toggle from the `/me` page query.
- Toggle is optimistic with a success/error toast, consistent with the other
  ProfilePanel settings.

## Admin control (view/set any member)

- `app/api/admin/members/route.ts` GET projection gains `notifPrefs` (so the
  admin UI can show each member's current email pref).
- The same toggle is added to the **member-edit modal in
  `app/components/admin/AdminPanel.tsx`** (the existing member editor that
  already PATCHes `/api/admin/members/[id]`).
- Extend the whitelist in `app/api/admin/members/[id]/route.ts` PATCH to accept
  an email-pref boolean and apply it with the same
  `setIfMissing({ notifPrefs: {} }).set({ "notifPrefs.email": ... })` pattern.
  - This route is **super-admin only** (unchanged). So only a super-admin sets
    *other* members' prefs; regular members set their own via `/me`.
  - Body field name: `notifEmail?: boolean` (explicit, avoids colliding with the
    existing `email` address field). Applied only when a boolean is provided.

## Tests

- `app/utils/__tests__/assignmentEmail.test.ts`:
  - A member with `notifPrefs.email === false` (i.e. `emailPref: false`) is
    skipped even when `EMAIL_ALLOWLIST=*`.
  - A member with unset pref (`emailPref` undefined) still receives.
  - Applies to both `sendAssignmentEmails` and `sendAssignmentEmailsBatch`.
- Endpoints and UI follow existing coverage norms (the `/api/me/*` routes are
  currently untested; match that rather than adding new harness). `wantsEmail`
  is trivially covered by the send-gating tests.

## Out of scope (YAGNI)

- No member UI for the other `notifPrefs` categories (push assignments, setlist,
  proposals, reminders). Email only, per request.
- No digest/frequency/scheduling options.
- No backfill migration of existing member docs (unset already means "send").

## Files touched

- `sanity/schemas/worshipTeam.ts` — `notifPrefs.email` initialValue + description.
- `app/utils/assignmentEmail.ts` — `wantsEmail` + gating in both send paths + projections.
- `app/utils/__tests__/assignmentEmail.test.ts` — opt-out tests.
- `app/api/me/notif-prefs/route.ts` — new self-service PATCH (and GET if useful).
- `app/(client)/me/page.tsx` — include `notifPrefs` in member query.
- `app/components/ProfilePanel.tsx` — member toggle + fetch call.
- `app/api/admin/members/route.ts` — GET projection gains `notifPrefs`.
- `app/api/admin/members/[id]/route.ts` — PATCH whitelist gains `notifEmail`.
- `app/components/admin/AdminPanel.tsx` — admin toggle in member-edit modal.

## Rollout

Ship code + deploy Studio schema (the `initialValue`/description change is
Studio-side; the send/UI behavior is app-side and needs no data migration).
Because default is opt-out and no member has opted out yet, behavior is
unchanged for the team until someone toggles off.
