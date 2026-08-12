# Implementation Plan E: Light mode — the setting

## Original request

> "bring light mode back." — Child E of the approved parent scope spec.

The child that makes light mode **reachable**. Children A–D built the tokens, migrated
2,397 colour decisions and designed 90 light counterparts; every one of them shipped
inert behind `forcedTheme="dark"`. E removes that line and gives members a control.

No secrets, credentials or personal data appear here.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Requirement source:** [parent scope spec](../specs/2026-08-07-light-mode-member-first-scope.md),
  row E of §11; requirements D5, D7, D12, D14, D16, D17; assumptions A5 and A6.
- **Risk tier: CRITICAL — two sequential fresh `APPROVED` verdicts on byte-identical text.**
  Not because it is large; it is the smallest child by line count. Because it:
  - ships a **mutating production write route** (`PATCH /api/me/theme`) against the real
    Sanity dataset, and
  - flips a **trust-adjacent default** for every member at once — the change is invisible
    in review and total in effect.
- **Safe ending state:** light mode reachable, **unset resolves to Dark**, so a member who
  never opens the control sees exactly what they see today.
- **Rollback:** re-add `forcedTheme="dark"` — one line, instant, no data migration. The
  `themePref` field can stay; it is inert while forced.

## What ships

| # | Change | File |
|---|---|---|
| 1 | `themePref` field on `teamMember` | `sanity/schemas/worshipTeam.ts` |
| 2 | `PATCH /api/me/theme` — a member writes their own preference | `app/api/me/theme/route.ts` (new) |
| 3 | **`GET /api/me` projection gains `themePref`** — D15's read path | `app/api/me/route.ts` |
| 3b | The `/me` control | `app/components/ui/ThemeControl.tsx` (new), rendered in `app/(client)/me/page.tsx` |
| 4 | `localStorage` mirror + pre-hydration paint | `app/utils/themePref.ts` (new), `app/components/ThemeBootstrap.tsx` (new) |
| 5 | **`forcedTheme="dark"` removed**, explicit `defaultTheme="dark"` added | `app/utils/Provider.tsx:16` |
| 6 | `themeColor` **stays static**, remnant recorded — invariant 17's own fallback | *(no change; see below)* |
| 7 | iOS status bar | **deferred with a recorded remnant — see A6 below** |

## The default is `"dark"`, and it must be written explicitly

`next-themes` computes `defaultTheme = enableSystem ? "system" : "light"`. Today
`enableSystem={false}` and `forcedTheme="dark"` masks the result. **Remove `forcedTheme`
without adding `defaultTheme="dark"` and every member with no stored preference resolves
to LIGHT on their next page load** — the entire team, silently, with no control touched.

The parent spec calls this out at §12 and it is the single highest-consequence line in
this child. `defaultTheme="dark"` is not a nicety; it is what makes E's blast radius zero
for anyone who does not opt in.

**A test asserts it**, and asserts it by reading `Provider.tsx` rather than by rendering,
because a rendering test passes just as happily with `forcedTheme` still present.

## The server value needs a way DOWN, not just up

An earlier revision of this plan called `themePref` the source of truth and shipped only
the write route. **`GET /api/me` does not project `themePref`** — verified — and
`TextScaleBootstrap`, the named precedent, reads `localStorage` only. Following it
"exactly" would have produced a **device-local preference with a write-only server
field**: the plan's own "follows the member across devices" claim, unimplementable.

Parent §12 assigns E "`GET /api/me` projection + write route (D15)", and D15 is explicit
that the projection is the mechanism and that a JWT claim is **not** an acceptable
substitute — the session carries a 30-second-TTL `{_id, disabled, role}` projection and
nothing more.

So: the projection gains `themePref`, and `ThemeBootstrap` **calls `setTheme()`** with what
it reads. Writing `localStorage` alone does not repaint the current tab — `next-themes`
only listens for `storage` events, which fire cross-tab, never in the tab that wrote.

**UNSET MUST STAY DISTINGUISHABLE, and F depends on it** (invariant 14). The control
renders a fourth state — no preference yet — and **must not write `themePref` on mount, on
first render, or on any path a member has not explicitly clicked.** `TextSizeControl`
initialises to a concrete default, so following it here would write `"dark"` the moment
someone opens `/me`, destroying F's staged rollout for that member with no way to detect
it. A test asserts no mount path issues a PATCH.

## The write route

`PATCH /api/me/theme`, modelled on `app/api/me/notif-prefs/route.ts` — the repo's only
member-writes-own-preference route, and the shape D7 mandates following.

```
requireActiveSession()  ->  401 if absent
body: { theme: "dark" | "light" }        <- NOT "system"; see E-Q1
validate against that literal set  ->  400 on anything else
reject if session.user.isImpersonating   ->  403
writeClient.patch(session.user.sanityId).set({ themePref: theme }).commit()
```

- **Self-write only, with one real exception that must be handled.** The document id comes
  from `session.user.sanityId`, never from the body, so no member can address another
  member's record by crafting a request.

  **But impersonation rewrites that id.** `auth.ts:182` sets `token.sanityId = target._id`
  and `auth.ts:263` surfaces it, so a super-admin who toggles the theme while impersonating
  writes the IMPERSONATED member's `themePref` to production Sanity — a persistent
  cross-member write from a UI action that looks local. Parent §12 assigns E
  "impersonation isolation" and an earlier revision of this plan claimed self-write safety
  without qualification, which was simply false.

  **The route rejects the write when `session.user.isImpersonating` is true** (403), and a
  route test pins it. The theme still applies locally for the impersonating admin — it just
  never persists to the impersonated member's record.

- **Sign-out clears the `localStorage` mirror**, and so does stopping impersonation.
  Otherwise a shared device carries the previous member's theme into the next session.
- **No `revalidate*` call, and that is deliberate.** `CLAUDE.md`'s cache invariant covers
  routes that mutate **content**; `themePref` is per-member chrome that no ISR page renders.
  Calling `revalidateServiceViews()` here would invalidate the whole schedule for a colour
  change. **Stated rather than omitted**, because "a mutating route with no revalidate" is
  exactly the shape that invariant exists to catch, and a reviewer should see it was
  considered.
- **The client handler** follows the mutation-handler invariant: `try`/`catch`/`finally`,
  checks `res.ok`, resets its loading flag, never closes as success on failure.

## Persistence, and why `localStorage` is not the source of truth

Two stores, and the split matters:

| Store | Role | Why |
|---|---|---|
| `themePref` on `teamMember` | **source of truth** | Follows the member across devices, and is what D7 asks for |
| `localStorage` | **paint cache** | `next-themes` needs the value BEFORE hydration or the page flashes the wrong theme |

`ThemeBootstrap` reads `themePref` from the `GET /api/me` projection and calls
`setTheme()` — **not** a bare `localStorage` write, which would not repaint the current
tab, since `next-themes` only listens for cross-tab `storage` events. `next-themes` writes
the mirror itself as a side effect of `setTheme`.

**The first-paint claim, stated accurately.** On a device with no mirror, the first paint
uses `defaultTheme="dark"` and corrects once the session resolves — a flash toward dark,
which is the safe direction because it matches what ships today. **But that is only true of
a fresh device.** A member who chose Light on device A and has an unrelated mirror on
device B sees a flash toward light on B until the projection lands. An earlier revision
claimed "never toward light", which was stronger than the mechanism supports.

## `themeColor` and the native shell

`(client)/layout.tsx:47` pins `themeColor: "#010b17"`, and **it stays pinned.**

An earlier revision made it an OS-keyed media array. That is not one of the two outcomes
invariant 17 sanctions, and it **regresses the default member**: someone on a light-OS
device who never touches the control — the common case, since iOS defaults to light —
would get `#eef3f9` browser chrome around a still-dark app. That directly contradicts
this plan's own safe-ending-state claim, and the earlier text described the mismatch
backwards, citing the rare dark-OS-forcing-light case instead.

Invariant 17 permits exactly two things: a client-side `<meta>` swap, or leave it static
and record the remnant. **E takes the second.** The chrome stays `#010b17` for everyone,
which is what ships today, so a member who opts into Light gets dark browser chrome around
a light page — visible, cosmetic, and strictly better than changing it for people who
opted into nothing. `appleWebApp.statusBarStyle` stays `"black-translucent"` for the same
reason; §12 couples them to the same requirement.

**Recorded remnant for F:** the `<meta>` swap is the exact fix, and F is where it belongs,
because F is where the default moves and the chrome question becomes load-bearing.

### A6: the iOS status bar is deferred, with the remnant recorded

`@capacitor/status-bar` is **not in `package.json`** — verified. The parent's A6 gives an
explicit fallback: ship without the plugin, leave the native bar at its `Info.plist`
default, record it as a known remnant, and **do not let it block the delivery**. E takes
that fallback. `appleWebApp.statusBarStyle: "black-translucent"` stays on both layouts and
is wrong in light on a native build; the web surface is unaffected.

## Slicing

E is **not** atomic. The setting is only reachable once step 5 lands, so everything before
it ships inert and independently revertible.

| Slice | Content | Reachable? |
|---|---|---|
| **E1** | `themePref` schema field + Studio deploy | no |
| **E2** | `PATCH /api/me/theme` + its route test | no — nothing calls it |
| **E3** | `GET /api/me` projection, `themePref.ts`, `ThemeBootstrap`, the `/me` control | no — `forcedTheme` still wins |
| **E4** | **Remove `forcedTheme`, add `defaultTheme="dark"`, theme-responsive `themeColor`** | **YES** |

**E4 is the whole risk.** E1–E3 are additive and could sit on `main` for a week harmlessly.
A reviewer should spend their attention there and treat E1–E3 as ordinary work.

## Verification

- **A test reads `Provider.tsx` and asserts `defaultTheme="dark"` is present and
  `forcedTheme` is absent.** Source-text, not rendered — see above.
- Route tests mirroring `notifPrefsRoute.test.ts`: 401 unauthenticated, 400 on an invalid
  theme, self-id only, happy path writes the field.
- The `/me` control's handler: `res.ok` checked, flag reset in `finally`, failure surfaced.
- **Browser, both themes, on the real components** — the pass that found the two defects D
  shipped. Specifically an open `CueDialog` and `PlannerGrid` full-screen, which the parent
  names as acceptance criteria (§4.4).
- **A test that no mount path writes `themePref`** — invariant 14's "unset stays
  distinguishable", which F depends on.
- **A route test for the impersonation rejection**, since that claim is the one a
  Critical-tier reviewer should not have to take on trust.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors, per slice.
- **Two stale comments to update in the same delivery**, per CLAUDE.md's currency rule:
  `app/(gallery)/theme-gallery/[theme]/layout.tsx:10-14` and
  `app/utils/__tests__/themeGallery.test.ts:98-100` both justify their design "while
  `forcedTheme` is still in force". The reasoning survives E4 — the nested-provider
  pass-through is independent of `forcedTheme` — but the sentences go stale the moment it
  lands.
- **Name the read path the control initialises from.** `/me` carries
  `export const revalidate = 60`, so "no ISR page renders `themePref`" must be checkable
  rather than asserted: the control initialises from the client-side `GET /api/me` fetch,
  not from the server-rendered page, which is why the no-`revalidate` argument holds.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **`defaultTheme` omitted** | The whole team silently flips to light | Asserted by a source-text test; called out as E4's first line |
| A member's preference leaks across accounts | The id would have to come from the body | It comes from the session; a route test pins it |
| The `/me` control writes but the UI does not follow | Two stores can disagree | `next-themes`' `setTheme` drives the paint; the route is fire-and-forget with an error path |
| Light mode is reachable before it is *good* | D's visual pass found 2 real defects; there may be more | The browser gate is per-slice, and F stages the default separately |
| 57 sites remain sub-AA in **both** themes | Pre-existing debt surfaced by D's audit | **Explicitly out of scope** — named in F's backlog, not silently inherited |

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **E-Q1** | Does the `/me` control offer three options or two? | **RESOLVED — two: Dark and Light** | An earlier revision defaulted to three, which ships a silent failure. With `enableSystem={false}`, `next-themes` treats `"system"` as `i==="system"&&n&&(...)` — the `n` is `enableSystem` — so it adds a literal `system` class and NO `light`/`dark` class. The member picks "Follow System", the app stays dark forever, `themePref` reads `"system"` in Sanity, and nothing logs. Parent §9 names this exact trap and §12 assigns the `enableSystem` flip to **F**. `"system"` stays out of the accepted literal set until F owns it |
| **E-Q2** | Does the `(admin)` chrome get its own control? | **No** | No — D14 says admin follows the theme, one preference for both |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Critical tier: **two sequential fresh `APPROVED` verdicts on byte-identical text.** This
document is **not** authorization to implement.
