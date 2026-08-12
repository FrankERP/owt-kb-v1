# Implementation Plan F: Light mode — the staged rollout

## Original request

> "bring light mode back." — Child F of the approved parent scope spec, and the last of six.

Children A–E built the tokens, migrated 2,397 colour decisions, designed 90 light
counterparts, and made the theme **reachable**. F moves the default for anyone who
never chose: unset stops meaning *dark* and starts meaning *follow the device*.

No secrets, credentials or personal data appear here.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Requirement source:** [parent scope spec](../specs/2026-08-07-light-mode-member-first-scope.md)
  — the Child F row of §8 (`:311`); §12's rows at `:611`, `:612`, `:613`; §9's `enableSystem`
  landmine (`:543-548`); Q2 (`:622`); §14's supersession requirement (`:626-630`) and the
  §4.1 record it must carry (`:85-110`).
- **Risk tier: STANDARD — one fresh cold `APPROVED`.** The parent assigns it (`:311`) and
  the criteria agree: F changes no server writer, no schema, no auth boundary, no data
  migration, and performs no irreversible remote action. **Rollback is one constant.**
  That said, the blast radius is stated honestly rather than minimised: this is the
  highest-*visibility* change of the whole programme, because `themePref` is unset for
  very nearly the entire team and F is what makes their phones follow iOS.
- **Safe ending state:** every member who has chosen keeps exactly what they chose; every
  member who has not follows their device, and can still pin either theme at `/me`.
- **Rollback:** move the three default copies back to `"dark"` and **leave `enableSystem`
  true** — see **Rollback is not one line any more**, below. Taking `enableSystem` back as
  well is a four-step sequence involving a client-side reconciliation that must *deploy*
  first; improvised, it lands every Seguir-sistema member in a class-less document.

## What ships

| # | Change | File |
|---|---|---|
| 1 | **`enableSystem={true}`** and **`defaultTheme="system"`** | `app/utils/Provider.tsx` |
| 2 | `"system"` joins the accepted literal set — **and the `ThemePref` TYPE widens with it**, rippling through `ThemeBootstrap`'s context, `ThemeControl`'s `OPTIONS` and the route's `satisfies`. `tsc` finds every site | `app/utils/themePref.ts` |
| 3 | The repair's fallback moves `"dark"` → `"system"` | `app/components/ThemeBootstrap.tsx` |
| 4 | The migration script's `catch` resolves the OS instead of hardcoding dark | `app/utils/themePref.ts` |
| 5 | A third option, **"Seguir sistema"**, and it becomes the *unset* rendering | `app/components/ui/ThemeControl.tsx` |
| 6 | The Spanish announcement — an in-app banner on `/me` (Q2's bounded default). **Ships in F2, with the flip that makes its copy true** | `app/components/ui/ThemeAnnouncement.tsx` (new), rendered in `app/(client)/me/page.tsx` |
| 7 | **ADR-0008 superseded in full**, carrying the §4.1 record | `docs/adr/0008-forced-dark-theme.md` + a new ADR |

Documentation, same delivery:

| # | Doc change | Where |
|---|---|---|
| D-a | `themePref` gains `"system"` as a legal value | `DATA_MODEL.md` |
| D-b | The route's literal set gains `"system"` | `API_REFERENCE.md` |
| D-c | The provider stack line, and the default | `UTILITIES_AND_COMPONENTS.md` + `CLAUDE.md`/`AGENTS.md` (**both**, same commit) |
| D-d | Parent §12's three F rows and §14 marked delivered | the parent scope spec |
| D-e | The provider-stack line's "dark-default" | `ROUTES.md:23` — named in §12's docs row and missed by the first draft of this table |

## The `enableSystem` flip is the whole mechanism, not a label

**With `enableSystem={false}`, "system" is not a theme — it is a typo that paints nothing.**
`applyTheme` is `i === "system" && n && (c = x())` where `n` is `enableSystem`; with `n`
false the resolution never runs, and the applier then does
`classList.remove("light","dark")` followed by `classList.add("system")`. The document ends
with **no theme class at all**, all 94 `dark:` utilities stop applying, and nothing logs.
Parent §9:543-548 names this exactly, and it is why Child E kept `"system"` out of the
accepted literal set: E could not have offered the option safely.

**With `enableSystem={true}` it works at both moments that matter**, verified in
`next-themes` 0.4.6 source:

```
seed:      u && r === "system" ? a() : r        // u = enableSystem, a() = matchMedia
applyTheme: i === "system" && n && (c = x())    // resolves before the class is added
themes:     n ? [...d, "system"] : d
```

So a stored or defaulted `"system"` is resolved **at seed time, pre-hydration**, by
`matchMedia("(prefers-color-scheme: dark)")` — the first paint is already correct, with no
flash — and the class that lands is the resolved `dark` or `light`, never a literal
`system`. The flip is a prerequisite for the default move, not a cosmetic companion to it.

## The default moves in THREE places, and Child E left a note saying so

`useTheme()` exposes no `defaultTheme`, so E could not share one constant. The dark default
therefore exists three times, and **F must move all three or the rollout is partial in a way
no test would catch**:

| # | Site | Today | After F |
|---|---|---|---|
| 1 | `Provider.tsx` — `defaultTheme` | `"dark"` | `"system"` |
| 2 | `ThemeBootstrap` — the unset-with-a-mirror repair | `setTheme("dark")` | `setTheme("system")` |
| 3 | `themePref.ts` — the migration script's `catch` | `classList.add("dark")` | resolve the OS, below |

**Miss #2 and the rollout silently excludes the members it was most designed for.** That
repair fires when a member has no `themePref` but *does* have a mirror — the legacy
`ThemeSwitch` cohort, and anyone whose mirror was written back by another tab. Left at
`"dark"`, it would re-pin exactly those members to dark on every load, against the new
default, while everyone else moved to system. The cohort is invisible from the outside and
the suite stays green.

**Miss #3 and storage-blocked browsers stay dark forever.** That `catch` covers the
population for whom `localStorage` throws, where next-themes' own seed also fails and adds
no class at all.

### The migration script's `catch` must resolve the OS, and can

It is a pre-hydration inline script, so it cannot read `themePref` — but `matchMedia` is
available, which is the same call next-themes' own seed makes:

```
catch (e) {
  document.documentElement.classList.add(
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light"
  );
}
```

The `window.matchMedia &&` guard is not decoration: this runs inside a `catch` whose whole
purpose is coping with hostile browser environments, and a throw here would leave the
document class-less — the exact failure the line exists to prevent.

## `"system"` becomes a legal stored value, and what that means for `themePref`

`isThemePref` gains `"system"`, and because `PATCH /api/me/theme` validates only through
that helper, the route moves with it — no second edit. A member who picks **Seguir sistema**
stores `themePref: "system"` — that is a *choice*, recorded as one.

**One thing does not move for free:** the route's 400 body is the hardcoded string
`'theme must be "dark" or "light"'`, which `isThemePref` does not drive. It is a fourth copy
of the literal set and goes stale silently — not a behaviour bug, just a lie in an error
message. F derives it from the accepted set instead.

**After F, unset and `"system"` behave identically, and that convergence is the point.**
Invariant 14 existed so that F could tell "never chose" from "chose dark"; once the default
IS system, both unset and `"system"` follow the device. The invariant has discharged its
purpose rather than been violated, and this plan is where that is written down so a later
reader does not think the distinction was lost by accident.

**The distinction still has one job left:** a member who explicitly picks Seguir sistema is
recorded as having made a choice, which is what makes the announcement dismissible per
member (below) and what would let a future default move — if there ever is one — leave them
alone.

**No data migration.** Nothing writes `"system"` into any existing document; the field stays
unset for everyone who does not touch the control. That is deliberate and is what keeps
rollback cheap.

## The control gains a third option, and unset now renders as it

`ThemeControl` currently has three *states* but two *buttons* — Dark, Light, and a
neither-selected rendering for unset. F adds the third button and **binds unset to it**:

| `themePref` | Rendering after F |
|---|---|
| unset | **Seguir sistema** shown as selected |
| `"system"` | **Seguir sistema** shown as selected |
| `"dark"` / `"light"` | that button selected |

This is the one place F may *not* simply follow Child E's shape. E was emphatic that unset
must render as neither-selected, because showing a concrete default would have invited a
member to "confirm" it and burn the unset signal. **After F that reasoning inverts:** unset
genuinely means follow-system, so rendering it as Seguir sistema is honest rather than
misleading, and there is no longer a cohort to protect. Stated at length because a reviewer
who has read E's plan will otherwise flag it as a regression.

`loaded` still gates the render: before the projection lands, nothing is selected. That is
unchanged and still correct — "not known yet" is not "follows the system".

## The announcement (Q2)

Parent Q2's bounded default is *"In-app banner on `/me`, drafted at F"*, and F takes it.

- **Placement:** top of `/me`. Note the control renders at `me/page.tsx:438`, **below the
  service cards, the availability calendar and `ProfilePanel`** — on a phone that is most of
  a page away, so "Elígelo aquí abajo" would be a small lie. The banner's last clause is an
  anchor link to the control (`#tema`), and the control's `<section>` carries that `id`.
- **Dismissal is per member and client-side.** A `localStorage` flag
  (`owt-theme-announced`), wrapped in `try`/`catch` like every other storage access in this
  programme, and treated as "not dismissed" on a throw — a member seeing the banner twice is
  a far better failure than a sign-out-style break. **It does not touch `themePref`**, and
  no path from the banner writes the member document.
- **Copy** (Spanish, matching the app's register):

  > **Ahora puedes elegir el tema.** La app sigue el modo claro u oscuro de tu teléfono.
  > ¿Prefieres uno fijo? [Elígelo aquí](#tema).

- **It is not an email.** The notification system sends real mail to the real team; a theme
  change does not warrant one, and nothing in this plan touches `sweepOutbox`,
  `wantsNotification` or any template.

## Rollback is not one line any more

The parent's rollback column says *"Revert the default constant"*, written before Child E
existed. **That is now incomplete in a way that would hurt.** Reverting only
`Provider.tsx` while `enableSystem` stays `true` leaves the other two default copies on
`"system"` and any member who chose Seguir sistema holding a stored `"system"` — which is
still legal and still resolves. Fine. But reverting `enableSystem` to `false` while stored
`"system"` values remain is the §9 landmine in its purest form: **every member who chose
Seguir sistema lands in a class-less document**, silently.

**So the rollback is ordered, and the order is the point:**

1. Revert `defaultTheme` to `"dark"` and the two other default copies with it.
2. Leave **`enableSystem={true}`**. It is harmless with a dark default, and it is the only
   thing keeping stored `"system"` values renderable.
3. Only if `enableSystem` must also go back — and this is the step that turns a rollback
   into an incident if improvised:

   **Migrating Sanity is necessary and NOT sufficient, because the seed does not read
   Sanity.** The pre-hydration seed is
   `let r = localStorage.getItem(s) || n, y = u && r === "system" ? a() : r` — it consults
   the **`localStorage` mirror**. `setTheme("system")` writes `"system"` into that mirror,
   and nothing clears it except sign-out or the unset repair. So a `--apply` script that
   rewrites every `themePref: "system"` to `"dark"` and then flips `enableSystem` still
   leaves those browsers seeding `"system"` with `u` now false → `classList.add("system")`
   after stripping `light`/`dark`. The class-less document, silently, on first paint. The
   exact failure this section exists to prevent.

   **And the mirror population is strictly LARGER than the chose-system population.** The
   storage listener is `c.newValue ? r(c.newValue) : f(u)`: when any tab removes the key —
   a sign-out elsewhere, or `ThemeBootstrap`'s own `clearThemeMirror()` — every other open
   tab writes `defaultTheme` back, which after F2 is `"system"`, **for members who never
   chose anything.** A Sanity-only migration cannot see them at all.

   So the order is:

   a. Bump `THEME_MIGRATED_KEY` to `owt-theme-migrated-v2` and extend
      `THEME_MIGRATION_SCRIPT` to normalise a `"system"` mirror to the reverted default.
      Because the key changed, it re-runs once per browser.
   b. **Ship and deploy (a), and let it reach the team**, before touching `enableSystem`.
   c. Migrate `themePref: "system"` → `"dark"` in Sanity — a `--apply`-guarded script under
      `scripts/`, run with `node --env-file=.env.local`, production writes needing explicit
      user consent per CLAUDE.md.
   d. Only now flip `enableSystem` to `false`.

   Steps (a) and (b) are the ones an improvised rollback skips, and skipping them is what
   produces the class-less document. Written here so it never has to be worked out under
   pressure.

**One cosmetic consequence of a step-1/2 rollback, stated so it is not mistaken for a bug:**
F2 binds *unset* to a selected **Seguir sistema** button. Revert the default to `"dark"` and
unset means dark again, while the control still shows Seguir sistema as chosen. It
self-corrects the moment the member taps anything, and stored `"system"` still resolves
because step 2 leaves `enableSystem` true. Fixing the label is a fourth edit, and worth
making if the rollback is expected to last more than a day.

## Slicing

| Slice | Content | Visible? |
|---|---|---|
| **F1** | `"system"` joins the accepted literal set — **nothing else** | no — invisible; no UI offers the value and no default produces it |
| **F2** | **The default moves**: `enableSystem={true}`, `defaultTheme="system"`, the other two copies, **the third button, and the announcement** | **YES — the whole team** |
| **F3** | ADR supersession + the doc pass | no |

**F1 is one line, and everything else waits for the flip.** Two things had to be pulled out
of it, for the same reason twice:

- **The third button.** Offering Seguir sistema before `enableSystem` is true is the §9
  landmine — the member picks it, the app paints nothing, Sanity stores `"system"`, and
  nothing logs.
- **The announcement.** Its copy says *"La app sigue el modo claro u oscuro de tu
  teléfono"*, which is simply **false until F2 lands**, and F1 withholds the button, so a
  member who reads it cannot even act on it. `/me` is exactly where members go, so "inert
  unless they open `/me`" is not inertness for a banner that lives on `/me`.

Both land in F2, with the flip that makes them true — the same shape as Child E holding its
control back until the `forcedTheme` removal.

**F1's inertness is a UI claim, not a route claim, and that gap is closed by shipping F1 and
F2 in the same deploy.** Widening `isThemePref` also widens `PATCH /api/me/theme`, so between
the two slices an authenticated member could hand-craft `{"theme":"system"}`; `ThemeBootstrap`
would then `setTheme("system")` with `enableSystem` still false, and that member is
persistently in the class-less document. It takes a deliberate `curl` by a volunteer, so it is
not a production risk — but the honest fix is free: **F1 and F2 merge together.** They are
separated for reviewability and revert granularity, not for independent release.

## Verification

- **Source-text on `Provider.tsx`:** `enableSystem={true}` and `defaultTheme="system"`.
- **A guard that all THREE default copies agree** — the guard Child E's plan asked F to
  have, and the one that catches the silent partial rollout. **It cannot assert a single
  shared literal**, because after F site 3 encodes the default as a `matchMedia` resolution
  rather than a string. So it asserts, per site: (1) `Provider.tsx` declares
  `defaultTheme="system"`; (2) `ThemeBootstrap`'s repair calls `setTheme("system")`; (3) the
  migration script's `catch` resolves via `matchMedia` and hardcodes **no** theme literal.
  Written this way it still fails the moment one site is left behind, which is the whole
  job.
- **The four existing guards F must INVERT, named so they are expected rather than
  debugged.** They fail the instant F2 lands, loudly, which is correct — but an implementer
  should know they are the plan working, not a regression:
  **Six, not four**, and two of them invert at **F1** rather than F2:

  | Guard | Inverts at |
  |---|---|
  | `themePrefModule.test.ts:75` — `"system"` is rejected | **F1** |
  | `themeRoute.test.ts:88-90` — the route 400s on `"system"` | **F1** |
  | `themePrefModule.test.ts:175-178` — "drops an unrecognised stored value", whose fixture *is* `themePref: "system"` | **F1** |
  | `themeWiring.test.ts:29` — `defaultTheme="dark"` | F2 |
  | `themeWiring.test.ts:46` — `enableSystem={false}` (its message already says "Child F owns that flip") | F2 |
  | `themePrefModule.test.ts:100-104` — the `catch` adds `"dark"` | F2 |

  So **F1 is not literally one line** — it is one behavioural line plus three guard
  inversions. Said plainly, because an implementer told to expect four failures and shown
  six will start looking for a regression that is not there.
- **`isThemePref("system")` is true**, and the route accepts it (a route test), and rejects
  everything else still.
- **The control renders Seguir sistema as selected for BOTH unset and `"system"`**, and
  still renders nothing as selected while `loaded` is false.
- **The announcement never writes `themePref`** — the same shape as E's "no mount path
  issues a PATCH" guard, and the same reason.
- **A storage-blocked case for the announcement's dismissal flag**, following the pattern
  the sign-out clear needed.
- **Browser, both themes, and the OS switch itself:** with the device set to light and to
  dark, an unset member follows each; a member who chose Claro stays light with the device
  dark. **`/me`, one `(admin)` route, `/posts/[slug]`, an open `CueDialog`, a full-screen
  `PlannerGrid`** — Child E could not run this pass (every route is session-gated and it
  had no credentials), so **F inherits it in full** and it is the acceptance gate, not a
  formality.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors, per slice.
- **The stale claims F creates.** Child E learned this the hard way over four rounds: a
  claim F falsifies need not contain the word `defaultTheme`, and a list assembled from
  memory is always short. So the sweep is the command, and the list below is its **output**:

  ```
  grep -rn -i "dark-default\|unset member\|resolves to dark\|unset resolves\|dark-mode only\|Two client-side storage keys\|defaultTheme\|forcedTheme" app CLAUDE.md AGENTS.md docs/*.md docs/adr/*.md
  ```

  **On ONE line, deliberately.** Wrapped, the embedded newline becomes part of an
  alternative: `ugrep` errors outright, and GNU grep silently never matches
  `Two client-side storage keys`, dropping row 11 without a word. A sweep that is the
  mechanism has to be a command that runs.

  Note `docs/adr/*.md` explicitly — the earlier pattern's `docs/*.md` does not descend, and
  the superseded record lives there. Dated design records under `docs/superpowers/` stay
  historical, as in E.

  | # | Site | Why F falsifies it |
  |---|---|---|
  | 1 | `CLAUDE.md:8` + `AGENTS.md:8` | "unset resolves to dark". **Both, same commit** — `agentDocsParity.test.ts` |
  | 2 | `app/brand.css:363-364` | "unset still resolves to dark, so nobody who opts into nothing sees a change" |
  | 3 | `docs/ROUTES.md:23` | "ThemeProvider **dark-default**". §12's docs row names `ROUTES.md`, and this was missing from the doc table entirely — now **D-e** |
  | 4 | `app/(client)/layout.tsx:45` | "it is what an unset member keeps" — after F an unset member on a light device does not keep it |
  | 5 | `app/components/ThemeBootstrap.tsx:126-127` | "an unset member (who resolves to dark)" |
  | 6 | `app/components/ThemeBootstrap.tsx:115` | "the THIRD copy of the dark default" — the copies survive, their *value* does not |
  | 7 | `app/utils/Provider.tsx:18-34` | the whole `defaultTheme="dark"` rationale block, including its rollback note |
  | 8 | `app/utils/themePref.ts:66,74` | the `catch`-body rationale and "Child F must change all three", now past tense |
  | 9 | `app/components/ui/ThemeControl.tsx:51` | "an unset member is never overridden" |
  | 10 | `docs/UTILITIES_AND_COMPONENTS.md:147` | **already stale since E4** — still lists `forcedTheme="dark"` on the provider stack. D-c rewrites the line; fixed deliberately rather than incidentally |
  | 11 | `docs/UTILITIES_AND_COMPONENTS.md:182` | "**Two** client-side storage keys" — F adds `owt-theme-announced` as a third |

  **Two more that this pattern cannot reach, and no pattern reliably would** — found by
  reading the files F edits rather than by grepping:

  | # | Site | Why |
  |---|---|---|
  | 12 | `ThemeBootstrap.tsx:94-97` | "Only ever the literal `"dark"` or `"light"`. An unrecognised value never reaches `setTheme`" — false once `"system"` is legal |
  | 13 | `Provider.tsx:23` | names `providerTheme.test.ts`, **a file that does not exist** — the guard is in `themeWiring.test.ts`. Stale from Child E; inside the block row 7 rewrites anyway |

  The lesson from E's four rounds on this holds: the grep catches what it can name, and the
  rest comes from reading every file the delivery touches.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **One of the three default copies is missed** | They cannot share a constant; `useTheme()` exposes no `defaultTheme` | The three-way agreement guard |
| **`enableSystem` flipped back with stored `"system"` values** | Class-less document, silently — §9's landmine | The ordered rollback above |
| The third option ships before the flip | Same landmine, from the other direction | It lands in F2, not F1 |
| The team is surprised by their phones changing | ~40 volunteers, mostly on phones | The announcement, and the choice is one tap away |
| A stale `"dark"` mirror pins a member against the new default | Another tab can write one back | E's every-load repair already handles it — **once #2 moves to `"system"`** |

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **F-Q1** | Does the announcement need a dismissal at all, or does it live permanently above the control? | **No** | Dismissible, client-side flag. A permanent banner on a page members visit often becomes furniture. |
| **F-Q2** | Should F also announce in the team's WhatsApp? | **No — out of scope** | The in-app banner is what Q2 scopes. An outbound message to the real team is the user's to send, not this delivery's. |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Standard tier: **one fresh cold `APPROVED`.** This document is **not** authorization to
implement.
