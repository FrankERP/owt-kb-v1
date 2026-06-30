# Design — Month-preview view toggle + gated assignment emails

Date: 2026-06-30
Status: Approved (pending spec review)

## Summary

Two independent features for the admin month-generation flow:

- **A. Preview view toggle** — in the month-generation preview, let any admin switch
  between the current editable list (`DraftCardEditor`) and a read-only `DayCard`
  view for easy visual scanning. No backend, no gating.
- **B. Assignment emails** — send a Spanish email to a team member when they are
  newly assigned to a service, mirroring the existing push notifications. During
  this phase, **only Frank (`chikipuas@gmail.com`) ever receives an email**, and
  only when he is one of the assigned people. Built on Resend.

The two features share no code and can ship/verify independently.

---

## Feature A — Preview view toggle (all admins)

### Behavior
- A segmented control in the preview-step header, styled like the existing
  `CalendarView` toggle (`app/components/CalendarView.tsx:79`).
- Two modes, state `const [viewMode, setViewMode] = useState<"edit" | "view">("edit")`:
  - **Editar** (default): the current `DraftCardEditor` list. Unchanged.
  - **Vista**: read-only `DayCard`s (the same component used on the home/calendar/
    me pages — `app/components/DayCard.tsx`).
- The toggle is available to all admins. It does NOT affect creation; "Crear
  servicios" works the same from either view. Swap/skip controls live in the edit
  view only.

### Data transform
`DraftCard` stores member **IDs** (`leads`, `bgvs`, `chorus` as `string[]` of ids;
`instruments`/`foh` as `{instrument|role, personId}`); `DayCard` wants **names/objects**.
Add a pure helper:

```
draftToDayCardProps(draft: DraftCard, members: MemberOption[]): DayCardProps
```

Mapping (using the existing `members` prop on `MonthGenerator`):
- `day`: "Domingo" if `_type === "sunday_role"` else "Sábado"
- `date`: `draft.date`
- `leads`: `draft.leads.map(idToName)` → `string[]`
- `bgvs` / `chorus`: ids → `{ member_name, alias? }` objects (filter missing)
- `instruments`: `{ label: instrument, person: name }[]`
- `fohTeam`: `{ label: role, person: name }[]`

Location: `app/utils/draftToDayCardProps.ts` (pure, unit-tested with vitest).
`DraftCard`/`MemberOption`/`DayCardProps` types imported or mirrored as needed.

### Files touched
- `app/components/admin/MonthGenerator.tsx` — add `viewMode` state, the segmented
  toggle in the preview header, and conditional render (edit list vs DayCard list).
- `app/utils/draftToDayCardProps.ts` — new pure helper.
- `app/utils/__tests__/draftToDayCardProps.test.ts` — new vitest tests.

### Tests (vitest)
- Maps Sunday/Saturday `_type` → correct `day` label.
- Resolves lead ids → names; bgv/chorus ids → `{member_name, alias}` objects.
- Drops ids with no matching member (no crash).
- Maps instruments/foh slots to `{label, person}`.

---

## Feature B — Assignment emails (gated to Frank)

### Architecture — three isolated pieces

1. **`app/utils/email.ts`** — thin Resend wrapper, the ONLY code that talks to Resend.
   - `async function sendEmail({ to, subject, html }): Promise<{ ok: boolean; error?: string }>`
   - Reads `RESEND_API_KEY` and `EMAIL_FROM` from env. If **either** is unset, it
     no-ops and returns `{ ok: false, error: "email disabled" }` (so the feature is
     inert until fully configured).
   - Catches all errors; never throws.

2. **`app/utils/assignmentEmail.ts`** — content + gating, no Resend knowledge beyond
   calling `sendEmail`.
   - `EMAIL_ALLOWLIST: string[]` — lowercased emails permitted to receive mail.
     Currently `["chikipuas@gmail.com"]`. Sourced from an env var
     `EMAIL_ALLOWLIST` (comma-separated) with that default, so un-gating needs no
     code change.
   - `buildAssignmentEmail(member, role, service): { subject, html }` — Spanish
     content (see below). Pure/testable.
   - `async function sendAssignmentEmails(assignments, service): Promise<void>` —
     for each `{ member, role }`, skip if no `member.email` or email not in the
     allowlist; otherwise build + `sendEmail`. Logs failures; never throws.

3. **Hook points** — alongside the existing `sendPush(...)` calls:
   - `app/api/admin/roles/route.ts` (POST, ~line 116): after create, email the
     full set of assigned members.
   - `app/api/admin/roles/[id]/route.ts` (PATCH, ~line 88): email only the
     **newly added** members (`addedAssignees(...)`), mirroring push.
   - Push behavior is unchanged; email runs in parallel and independently.

### Role resolution
Each assigned member maps to the role they fill: Lead / BGV / Coro / an instrument
label / a FOH label. The route already separates `leads`/`bgvs`/`chorus`/
`instruments`/`foh`, so role is known per member. Member name/email/alias are
fetched from Sanity (the route already resolves member docs for push; reuse that).
**One email per member per service:** if a member holds more than one role in the
same service (e.g. BGV + an instrument), send a single email listing all their
roles, not one per role.

### Email content (Spanish)
- Subject: `Asignación — {Domingo|Sábado} {d MMM}` (e.g. `Asignación — Domingo 5 jul`).
- Body: greeting with `alias || member_name`, the role + service + date, and a
  button/link to view the service in the app (the same deep-link `path` the push
  notification uses; `app/utils/push.ts`).
- Minimal, well-formed HTML (inline styles). No external template engine for now.

Example:
```
Asunto: Asignación — Domingo 5 jul

Hola Frank,
Estás asignado como Líder el Domingo 5 jul.
[ Ver servicio → ]
```

### Gating (the safety guarantee)
`sendAssignmentEmails` sends ONLY to allowlisted emails. With the default
allowlist (`chikipuas@gmail.com`), assigning Frank + others emails only Frank.
This is enforced in code regardless of Resend domain config. Un-gating = widen
`EMAIL_ALLOWLIST` (env), or later swap the allowlist check for each member's
`notifPrefs.email` preference.

### Schema (forward-looking, no UI yet)
Add `email` (boolean, `initialValue: false`) to the existing `notifPrefs` object on
the `teamMembers` schema (`sanity/schemas/worshipTeam.ts`). Not read yet — reserved
for the future "email / push / both" settings, which is a separate spec. Adding it
now avoids a later migration. Requires a Studio schema deploy.

### Files touched
- `app/utils/email.ts` — new Resend wrapper.
- `app/utils/assignmentEmail.ts` — new content + gating.
- `app/utils/__tests__/assignmentEmail.test.ts` — new vitest tests (Resend mocked).
- `app/api/admin/roles/route.ts` — add `sendAssignmentEmails` after create.
- `app/api/admin/roles/[id]/route.ts` — add `sendAssignmentEmails` for added members.
- `sanity/schemas/worshipTeam.ts` — add `notifPrefs.email` field.
- `package.json` — add `resend` dependency.
- `.env.local` (+ Vercel env) — `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_ALLOWLIST`.

### Tests (vitest, Resend mocked — no real sends)
- `buildAssignmentEmail` produces correct subject/role/date for Sunday and Saturday.
- `sendAssignmentEmails` calls `sendEmail` for an allowlisted recipient.
- `sendAssignmentEmails` does NOT call `sendEmail` for a non-allowlisted recipient
  (the core safety assertion) or one with no email.
- `sendEmail` no-ops when `RESEND_API_KEY` is unset.

---

## Manual setup (Frank, when ready)

- **Now (gated test):** create a free Resend account with `chikipuas@gmail.com`;
  provide `RESEND_API_KEY`. Set `EMAIL_FROM="Oasis Worship <onboarding@resend.dev>"`.
  Resend's shared sender can deliver to the account owner's own address — exactly
  the gated phase. No DNS changes.
- **Later (un-gate to the team):** verify a **subdomain** of oasis.mx in Resend
  (e.g. `send.oasis.mx`) to avoid touching the church's main `contacto@oasis.mx`
  mail. Add the DNS records Resend provides (SPF/DKIM on the subdomain), switch
  `EMAIL_FROM` to e.g. `Equipo Oasis <equipo@send.oasis.mx>`, and widen
  `EMAIL_ALLOWLIST` (or switch to `notifPrefs.email`).

## Non-goals (explicitly out of scope)
- Notification-preferences settings UI (email/push/both) — future spec.
- Emailing anyone other than Frank in this phase.
- Reminder/digest emails, setlist-change emails — only assignment emails.
- Changing or removing push notifications.

## Risks / mitigations
- **Accidental send to the team:** mitigated by the in-code allowlist, independent
  of Resend domain state. Unit test asserts non-allowlisted recipients are dropped.
- **Email failure blocking role creation:** mitigated — all email work is wrapped
  in try/catch and runs after the Sanity write; failures only log.
- **Touching the church's main email domain:** mitigated by using a dedicated
  subdomain for Resend verification, not the apex `oasis.mx`.
