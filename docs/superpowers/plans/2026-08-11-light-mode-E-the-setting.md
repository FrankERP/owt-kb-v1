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
| 3 | The `/me` control | `app/components/ui/ThemeControl.tsx` (new), rendered in `app/(client)/me/page.tsx` |
| 4 | `localStorage` mirror + pre-hydration paint | `app/utils/themePref.ts` (new), `app/components/ThemeBootstrap.tsx` (new) |
| 5 | **`forcedTheme="dark"` removed**, explicit `defaultTheme="dark"` added | `app/utils/Provider.tsx:16` |
| 6 | `themeColor` becomes theme-responsive | `app/(client)/layout.tsx:47`, `app/(admin)/layout.tsx` |
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

## The write route

`PATCH /api/me/theme`, modelled on `app/api/me/notif-prefs/route.ts` — the repo's only
member-writes-own-preference route, and the shape D7 mandates following.

```
requireActiveSession()  ->  401 if absent
body: { theme: "dark" | "light" | "system" }
validate against that literal set  ->  400 on anything else
writeClient.patch(session.user.sanityId).set({ themePref: theme }).commit()
```

- **Self-write only.** The document id comes from `session.user.sanityId`, never from the
  body. A member cannot write another member's preference because the id is never an input.
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

`ThemeBootstrap` mirrors the server value into `localStorage` on mount, following
`TextScaleBootstrap` exactly. On a fresh device the first paint uses the default (`dark`)
and corrects after the session resolves — **a one-frame flash toward dark, never toward
light**, which is the safe direction.

## `themeColor` and the native shell

`(client)/layout.tsx:47` pins `themeColor: "#010b17"`. Next.js accepts an array with
`media` conditions, so it becomes:

```
themeColor: [
  { media: "(prefers-color-scheme: dark)",  color: "#010b17" },
  { media: "(prefers-color-scheme: light)", color: "#eef3f9" },
]
```

**This keys off the OS preference, not our `themePref`** — a static export cannot read a
per-member value. So a member who forces Light on a dark-OS device gets dark browser
chrome around a light page. **Accepted, and recorded here as a known cosmetic mismatch**
rather than discovered later; making it exact requires a client-side `<meta>` swap, which
is Child F's call if anyone minds.

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
| **E3** | `themePref.ts`, `ThemeBootstrap`, the `/me` control | no — `forcedTheme` still wins |
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
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors, per slice.

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
| **E-Q1** | Does the `/me` control offer three options (Dark / Light / Follow System) or two? | **No** | Three. `system` costs one extra literal and is what F moves the default to |
| **E-Q2** | Does the `(admin)` chrome get its own control? | **No** | No — D14 says admin follows the theme, one preference for both |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Critical tier: **two sequential fresh `APPROVED` verdicts on byte-identical text.** This
document is **not** authorization to implement.
