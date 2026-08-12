# Implementation Plan E: Light mode — the setting

## Original request

> "bring light mode back." — Child E of the approved parent scope spec.

The child that makes light mode **reachable**. Children A–D built the tokens, migrated
2,397 colour decisions and designed 90 light counterparts; every one of them shipped
inert behind `forcedTheme="dark"`. E removes that line and gives members a control.

No secrets, credentials or personal data appear here.

## Status and contract

- **Document status:** Draft — not reviewed, not approved, not authorization to implement.
- **Requirement source:** [parent scope spec](../specs/2026-08-07-light-mode-member-first-scope.md)
  — the Child E row of §8's table (`:299`); §12's coverage table; requirements D5, D7, D12,
  D11, D14, **D15**; invariants **13**, 14, 16, 17 and **18**; assumptions A5 and A6; §9's landmines.
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
| 1 | `themePref` on `teamMembers` — **no `initialValue`**, `hidden: true` | `sanity/schemas/worshipTeam.ts` |
| 2 | `PATCH /api/me/theme` — a member writes their own preference | `app/api/me/theme/route.ts` (new) |
| 3 | **`GET /api/me` projection gains `themePref`** — additive, D15's read path | `app/api/me/route.ts` |
| 4 | The fetch/validate helper, `clearThemeMirror()`, `THEME_MIGRATION_SCRIPT` — **not** a second store, and **no `"use client"`** | `app/utils/themePref.ts` (new) |
| 5 | Wraps `children`, reads the projection, calls `setTheme`, exposes the literal via context, swaps the `theme-color` `<meta>` | `app/components/ThemeBootstrap.tsx` (new), mounted in `Provider.tsx` |
| 6 | The one-time legacy reconciliation — an inline `<script>` as the **first child of `<body>`, immediately before `<Provider>`**; ships in **E3**, with `defaultTheme` | `app/(client)/layout.tsx` + `app/(admin)/layout.tsx` — *not* the gallery root layout |
| 7 | The `/me` control | `app/components/ui/ThemeControl.tsx` (new), rendered in `app/(client)/me/page.tsx` |
| 8a | **Explicit `defaultTheme="dark"` added** — lands in **E3**, ahead of the removal | `app/utils/Provider.tsx:16` |
| 8b | **`forcedTheme="dark"` removed** — E4, the whole risk | `app/utils/Provider.tsx:16` |
| 9 | `appleWebApp.statusBarStyle` — **stays `black-translucent`**, recorded remnant (geometry, not colour) | unchanged |
| 10 | Capacitor's **native** status bar (`@capacitor/status-bar`) | deferred with a recorded remnant — that, and only that, is A6 |

Documentation, in the same delivery:

| # | Doc change | Where |
|---|---|---|
| D-a | `themePref` field | `DATA_MODEL.md` (E1) |
| D-b | The write route (E2); **the projection's new field (E3, with the code)**; **`ROUTES.md:18-23`'s enumeration of what `(client)/layout.tsx` mounts gains the reconciliation `<script>` (E3)** — documenting it at E2 would describe a field the endpoint does not yet return | `API_REFERENCE.md` + `ROUTES.md` |
| D-c | `themePref.ts` + `ThemeBootstrap` (E3); `ThemeControl` (E4) | `UTILITIES_AND_COMPONENTS.md` |
| D-d | The two client-side keys — `"theme"` (next-themes' mirror) and `owt-theme-migrated` (the one-time flag). Neither is a secret; both are persistent state a later hand would otherwise "clean up" | `UTILITIES_AND_COMPONENTS.md`, beside `themePref` |
| D-e | **ADR-0008 interim Consequences note** — precondition met, lever pulled in E4; full supersession stays Child F's | `docs/adr/0008-forced-dark-theme.md` (E4) |
| D-f | Parent §5:188-190 + its §12 row **amended** with the `statusBarStyle` geometry constraint and remnant; parent §5:202 corrected; `§5:181`'s stale `(client)/layout.tsx:42` corrected to `:47`; the present-tense `forcedTheme` statements at **§3:43** and **§12:591** updated in the same pass | the parent scope spec |
| D-g | The two PWA remnants recorded together — `statusBarStyle` and `manifest.webmanifest`'s `theme_color` | `UTILITIES_AND_COMPONENTS.md` |
| D-i | **`CLAUDE.md:8` + `AGENTS.md:8` — "Dark-mode only."** becomes flatly false at E4. **Both files, same commit**: `app/utils/__tests__/agentDocsParity.test.ts` asserts they are byte-identical outside the title and the Continuous-improvement section, so editing one turns `npm test` red | **E4** |
| D-h | **Four** stale `forcedTheme` statements — see Verification for the full list and the method | gallery layout, `themeGallery.test.ts`, `UTILITIES_AND_COMPONENTS.md`, **`app/brand.css:362`** |

## The default is `"dark"`, and it must be written explicitly

`next-themes` computes `defaultTheme = enableSystem ? "system" : "light"`. Today
`enableSystem={false}` and `forcedTheme="dark"` masks the result. **Remove `forcedTheme`
without adding `defaultTheme="dark"` and every member with no stored preference resolves
to LIGHT on their next page load** — the entire team, silently, with no control touched.

The parent calls this out at §12 and it is the single highest-consequence line in this
child. `defaultTheme="dark"` is what makes E's blast radius zero for anyone who does not
opt in.

**A test asserts it by reading `Provider.tsx` as source text**, not by rendering — a
rendering test passes just as happily with `forcedTheme` still present. The same test
asserts `ThemeBootstrap` is mounted and wraps `children`: drop the mount and every member
silently loses their theme with nothing failing.

**`defaultTheme="dark"` lands in E3, one slice AHEAD of the removal**, and the guard splits
with it: E3 asserts `defaultTheme="dark"` is present, E4 asserts `forcedTheme` is absent.
Two reasons, and the second is a defect the obvious ordering would have shipped.

The first is ordinary risk management: the highest-consequence line in the child gets to be
green and observed on production for a slice before the line that makes it matter.

The second is that **`forcedTheme` does not reach `resolvedTheme`**, so E3 is not inert
without it. In `next-themes` 0.4.6:

```
resolvedTheme: a === "system" ? T : a      // a = useState(() => Z(storageKey, defaultTheme))
Z = (e, s) => { … n = localStorage.getItem(e) || void 0 … return n || s }
useEffect(() => { S(e ?? a) }, [e, a])     // e = forcedTheme — the APPLIED CLASS only
```

`resolvedTheme` is the state, seeded from `localStorage.getItem("theme") || defaultTheme`;
`forcedTheme` short-circuits only what gets applied to the document. With `defaultTheme`
still unset during E3 it computes to `"light"`, so for every member with no mirror — after
the reconciliation, essentially the whole team — **`resolvedTheme === "light"` while the page
paints dark.** A `theme-color` swap keyed on the resolved theme would then write `#eef3f9`
into production markup rendering a dark app: light browser and PWA chrome around a dark page,
for everyone, for as long as E3 sits on `main` before E4. `main` is production and slices
merge periodically, so that is the expected path.

Landing `defaultTheme="dark"` in E3 fixes that for the mirror-**less** member. It does not
fix the member holding a legacy mirror, because `Z()` reads `localStorage.getItem(key) ||
defaultTheme` and **a stored value beats `defaultTheme`** — the same rule this plan relies on
two sections down. For a browser carrying `theme: "light"` from the old `ThemeSwitch`,
`resolvedTheme === "light"` in E3 no matter what `defaultTheme` says, and the swap writes
`#eef3f9` on a dark page for exactly the cohort the mirror section is about.

**So the reconciliation script ships in E3 as well, alongside `ThemeBootstrap`.** That is
safe and is in fact the better home for it: while `forcedTheme` still wins the paint, the
clear is completely invisible — it removes a key that is not being applied — and its
`owt-theme-migrated` flag means it does not run again in E4. It also means the legacy cohort
is already reconciled *before* the unmasking rather than in the same breath as it.

With both in E3, `resolvedTheme` is `"dark"` for every member **whose mirror the script
actually cleared** — no such mirror survives it, and `defaultTheme` answers — so the swap
writes back `#010b17`, the value already in the markup, and E3 is inert. **One cohort escapes
the script and is handled separately**: a browser whose mirror is re-poisoned by another tab
across the deploy boundary. See the multi-tab section, which is where that is closed.

**Within E4, the ordering constraint disappears with it.** Had the script stayed in E4, it
would have had to land in the same commit as the `forcedTheme` removal or before it; a build
carrying the removal without the script strands the legacy cohort in light. Shipping it a
slice earlier removes that trap rather than documenting it.

## Two stores, and why `localStorage` is not the source of truth

| Store | Role | Why |
|---|---|---|
| `themePref` on `teamMembers` | **source of truth** | Follows the member across devices; what D7 asks for |
| `localStorage` (`next-themes`' `"theme"`) | **paint cache** | `next-themes` needs the value BEFORE hydration or the page flashes the wrong theme |

`GET /api/me` does not project `themePref` today, and `TextScaleBootstrap` — the named
shape precedent — reads `localStorage` only. Following it exactly would produce a
device-local preference with a write-only server field. Parent §12 assigns E "`GET /api/me`
projection + write route (D15)", and D15 is explicit that the projection is the mechanism
and a JWT claim is **not** an acceptable substitute — the session carries a 30-second-TTL
`{_id, disabled, role}` projection and nothing more.

So the projection gains `themePref` **additively** — the route keeps all eight fields it
returns today (`docs/API_REFERENCE.md:226`, "GET own member doc (incl. `hasPassword`)").
Narrowing it to the one field would silently void a documented endpoint that **nothing in
`app/` currently GETs**, so no test and no gate would catch the regression.

**The per-load cost is named, not fixed here.** `ThemeBootstrap` mounts in the root
`Provider`, so this fetch runs on every full page load for every member —
`requireActiveSession` → `isMemberActive`, plus a Sanity fetch — to read one string. If it
proves to matter, the answer is a **separate narrow reader**, never a narrowing of the
shared route. Measured in F.

`ThemeBootstrap` **calls `setTheme()`** with what it reads. A bare `localStorage` write
would not repaint the current tab: `next-themes` only listens for `storage` events, which
fire cross-tab, never in the tab that wrote.

**`themePref.ts` must not own storage.** `next-themes` already does both halves — `setTheme`
writes the mirror, its injected script does the pre-hydration seed — so this file holds only
the `GET /api/me` fetch, the `"dark" | "light"` validator, `clearThemeMirror()`, and the
migration script constant. A second mirror on a second key is the failure mode to avoid.

**`themePref.ts` must NOT carry `"use client"`.** Both root layouts are Server Components
importing `THEME_MIGRATION_SCRIPT` from it; under a client boundary that export becomes a
client *reference* rather than a string and the `<script>` renders nothing usable.
`app/utils/textZoom.ts`, the precedent, correctly omits the directive. Neither guard below
would catch a stray one — the source scan greps for an identifier, the jsdom test imports
outside any RSC boundary. **So it gets its own one-line source-text assertion** — that
`themePref.ts`'s first non-comment line is not `"use client"`. Cheap, and it closes the one
constraint that would otherwise rest on discipline.

**`ThemeBootstrap` mounts inside `Provider.tsx`, not in a layout.** It needs `setTheme`, so
it must sit inside `<ThemeProvider>`. `TextScaleBootstrap` is mounted only at
`(client)/layout.tsx:76`, and copying that placement would leave an admin whose first load
of a session is `/admin` on a preference they never fetched. Mounting inside `Provider`
covers both root layouts and correctly excludes the provider-less gallery.

**It wraps `children` and exposes the literal `themePref` through context.** The `/me`
control needs that value and must not issue a second `GET /api/me`; props cannot carry it
because `ThemeControl` renders from `app/(client)/me/page.tsx`, several layers below
`Provider`. The source-text guard asserts the wrapping shape, not merely that the component
is mounted.

## `setTheme` MUST be guarded — the most dangerous line in Child E

`next-themes` has no falsy guard on the setter:

```
f = useCallback(i => { let c = typeof i === "function" ? i(a) : i;
                       r(c); try { localStorage.setItem(o, c) } catch {} })
```

`setTheme(undefined)` therefore stores the **string `"undefined"`**, and **the damage is
deferred**. `applyTheme` opens `let c = i; if (!c) return;`, so the calling session adds no
bad class and looks fine. The poison is what was persisted: on the **next** load the seed
reads `localStorage.getItem("theme") || defaultTheme`, `"undefined"` is truthy and wins, and
the applier does `classList.add("undefined")` — removing `dark`. An implementer who tests
for an immediate symptom sees nothing and may conclude the trap is not real.

**`themePref` is unset for the entire team on the day E ships** — invariant 14 requires that
absence be the normal state — so an unguarded bootstrap would put every member into a
themeless document. With `tailwind.config.ts:10` at `darkMode: "class"` and **94 `dark:`
utilities still live** (`grep -rEho 'dark:[a-zA-Z-]+' app --include='*.tsx' --include='*.ts'
--include='*.css' | wc -l`), they all stop applying at once. Per `CLAUDE.md`, a `dark:` base
at specificity (0,2,0) *masks* bare `hover:`/`focus:` utilities, so this is not a missing
colour — it changes which rules win. Child B paid for that lesson with 39 real bugs.

**So `ThemeBootstrap` calls `setTheme` only when the projection returns the literal `"dark"`
or `"light"`, and does nothing at all otherwise.** A test asserts that an absent, `null` or
unrecognised `themePref` produces **no `setTheme` call and no `localStorage` write**. The
"no mount path issues a PATCH" test does not cover this — that is the server store, this is
the browser one, and they fail independently.

**Unset must stay distinguishable** (invariant 14). The control has **three** states — Dark,
Light, and no preference yet — and **must not write `themePref` on mount, on first render, or
on any path a member has not explicitly clicked.** `TextSizeControl` initialises to a
concrete default; following it here would write `"dark"` the moment someone opens `/me`,
destroying F's staged rollout for that member with no way to detect it.

## The mirror is NOT empty today, and `forcedTheme` is the only thing hiding it

**A production theme toggle wrote this exact key for twenty months.**
`app/components/ThemeSwitch.tsx` was `onClick={() => setTheme(isDark ? "light" : "dark")}`,
labelled *"Cambiar a tema claro"*. It shipped in the member navbar until `749588c`
(2026-04-24) and in the **admin** navbar until `33c6e15` (2026-07-16 — under four weeks
ago). Both are ancestors of `main`. The Provider of that era carried no `storageKey`, so it
used next-themes' default — `"theme"`, **the same key E uses** — under a comment reading
*"Light mode is kept intact — the ThemeSwitch toggle still works."*

Today the seed takes its `if (forced) apply(forced)` branch, so that stored value is read and
never applied. **E4 removes the mask.** For any browser holding `theme: "light"` from that
toggle, the seed `localStorage.getItem("theme") || "dark"` returns **`"light"`** — a stored
value beats `defaultTheme` — and `ThemeBootstrap`, correctly per the guard above, does
nothing because `themePref` is unset.

That is not a one-frame flash. **It is the terminal state**, until that member opens `/me`
and picks Dark — which writes `themePref` and burns the unset signal Child F depends on.
`clearThemeMirror()` at sign-out does not help: it only governs mirrors created after E ships.

### Where the reconciliation runs is the whole difficulty

`next-themes` injects its seed via `dangerouslySetInnerHTML`, so that script executes
**before hydration**. Any React component — `ThemeBootstrap` included — runs after it. By
then the seed has already done `classList.add("light")` and latched `theme: "light"` into
state, and removing the key afterwards **repaints nothing**.

**The script ships as the FIRST CHILD OF `<body>` in `(client)/layout.tsx` and
`(admin)/layout.tsx`, immediately before `<Provider>`** — deliberately not the gallery root
layout, which has no provider and no member.

The operative constraint is **document order, not `<head>`**. Neither layout renders a
`<head>` element, and React 19 hoists only `<script async src>`, never inline
`dangerouslySetInnerHTML`. next-themes' own seed is a plain
`React.createElement("script", { dangerouslySetInnerHTML })` inside the provider; this
script sits just above it and therefore runs first.

```
try {
  if (!localStorage.getItem("owt-theme-migrated")) {
    localStorage.removeItem("theme");        // legacy ThemeSwitch value, not a preference
    localStorage.setItem("owt-theme-migrated", "1");
  }
} catch (e) {
  document.documentElement.classList.add("dark");
}
```

**The `try` is required and the `catch` body is load-bearing — for two different reasons.**

`localStorage` *throws*: `SecurityError` with storage blocked, Safari private mode, some
Capacitor WebView configurations. `next-themes` wraps every access for exactly that reason.
Without the `try`, the script throws before `setItem` and the migration silently never runs
for those members, who keep the legacy mirror forever.

The `catch` body covers a hazard **E4 creates**, not one the migration creates. Today
`forcedTheme` makes next-themes' seed take the `if (forced)` branch, which touches no
storage, so `dark` always lands. With `forcedTheme` gone the seed takes the
`try { localStorage.getItem(…) … apply }` branch — **and the whole apply sits inside that
try.** For the same storage-blocked population the pre-hydration document then gets neither
`dark` nor `light`: all 94 `dark:` utilities stop applying at once and the bare
`hover:`/`focus:` rules they were masking come unmasked. It self-corrects at hydration — a
flash, not a terminal state — but it is one line to prevent in a script both layouts already
render ahead of the seed.

**The `removeItem` is unconditional, and that is a requirement rather than a convenience.**
The rule is: **clear any value this codebase did not write**, not "clear `light`".

The reason is what an unrecognised value costs. `"system"` is the worst case and is reachable
in principle — the Provider before `749588c` was a bare `<ThemeProvider attribute="class">`
with no `enableSystem={false}`, and next-themes defaults it **true** — though no shipped code
path is known to have written it, so the cohort may well be empty. It does not need to be
non-empty for the rule to hold. Under today's `enableSystem={false}` such a value resolves to
`classList.add("system")` with `light` and `dark` both stripped: a **class-less document**, not
merely a light one, which is §9's silent-failure landmine in its purest form. The same is true
of any other junk in that key.

So an implementer "tightening" this to `if (v === "light") removeItem(…)` would look more
careful and be strictly less safe.

**A clear, not a `setTheme("dark")`.** Both land the member on dark, but only the clear
preserves the property F depends on: **no mirror means no preference**, so when F changes the
default, a member who never chose anything actually follows it. Writing `"dark"` into the
mirror would pin the whole unset population to dark and quietly defeat F's rollout. It runs
once, so a value E's own control writes afterwards is never touched.

**It ships as an exported constant so it can be both guarded and executed.** `themePref.ts`
exports `THEME_MIGRATION_SCRIPT`; both layouts render
`<script dangerouslySetInnerHTML={{ __html: THEME_MIGRATION_SCRIPT }} />`. Written out twice
by hand, an implementer can add it to `(client)` and forget `(admin)`, shipping a terminal
light state on admin routes with a green suite.

**Two guards, because one cannot do the job alone.** React sets inline scripts via
`innerHTML`, and per the HTML spec scripts inserted that way **do not execute** — under
`@testing-library/react` neither this script nor next-themes' own seed ever runs, so a
render-only test exercises the effect path and fails for reasons unrelated to the shipped
code. So:

1. **A source-text guard** that *both* layouts render `THEME_MIGRATION_SCRIPT`, as the first
   child of `<body>`, before `<Provider>`.
2. **A jsdom chain test** that `eval`s the exported constant — the same string the layouts
   render, not a copy — then renders, then asserts the **resolved `documentElement` class**,
   never the helper's return value in isolation (a helper-only assertion passes green while
   the app paints light). Chain: a pre-existing `localStorage.theme = "light"` plus an unset
   `themePref` ends with `<html class="dark">`, issues **no PATCH**, and leaves `themePref`
   unset. It needs a per-file `// @vitest-environment jsdom` pragma — `vitest.config.ts:14`
   sets `environment: "node"` globally and its own comment warns a DOM test must set jsdom
   up itself.

### The multi-tab caveat

The provider's storage listener is
`key === "theme" && (newValue ? set(newValue) : setTheme(defaultTheme))`, so a `removeItem`
makes every *other* open tab write its `defaultTheme` straight back. **What that value is
depends on which bundle the other tab is running, and at exactly one moment it is `"light"`.**

- **`clearThemeMirror()` at sign-out** — every tab is on E3-or-later, `defaultTheme="dark"`,
  so the writeback is `"dark"`. Visually safe; dark is the default anyway.
- **The migration script** — this is the dangerous one. It runs **once per browser, on the
  first document load after E3 deploys**, so any other tab still open is by construction
  running the **pre-E3** bundle, where `Provider.tsx` passes `enableSystem={false}` and no
  `defaultTheme` and the listener's `setTheme(defaultTheme)` is therefore
  **`setTheme("light")`** — which writes `theme="light"` straight back into the key the
  script just cleared.

That member is then worse off than before: `resolvedTheme === "light"` in E3 while
`forcedTheme` paints dark, so the `theme-color` swap writes `#eef3f9` onto a dark page; and at
E4 they are terminally stranded in light — the exact failure the reconciliation exists to
prevent — with `owt-theme-migrated` already `"1"`, so the script can never repair it. The
cohort is the legacy-mirror population intersected with "had a tab open across one deploy",
which on a phone-first PWA is not hypothetical. (`removeItem` on an absent key fires no
storage event, so mirror-less members are untouched; this is specific to the legacy cohort.)

**So the one-shot flag is not the durable guarantee — `ThemeBootstrap` is.** The invariant is
re-asserted on every load rather than once per browser:

> when the projection returns **unset** and a mirror is nonetheless present, `ThemeBootstrap`
> calls `setTheme("dark")` and then `clearThemeMirror()`, in that order.

**It is the literal `"dark"`, not a read of `defaultTheme`, because `useTheme()` does not
expose one.** Its context value is `{theme, setTheme, forcedTheme, resolvedTheme, themes,
systemTheme}`. So this is a **second copy of the default**, and the E3 source-text guard pins
the first as a literal in `Provider.tsx`, which forecloses sharing a constant between them.
That is acceptable for E, where the default is dark in both places by construction — but
**Child F changes the default, and must change it in both**, or the repair will pin members to
dark exactly as F is trying to move them off it.

The order matters. `setTheme("dark")` first makes next-themes' own state truthful and paints
the correct class; `clearThemeMirror()` then removes the key it just wrote, so the member ends
on dark with **no mirror** — the property F depends on. Doing only the `removeItem` would
leave next-themes holding `"light"` internally, and doing only the `setTheme` would pin the
unset population to a `"dark"` mirror and quietly defeat F's rollout.

This costs an unset member with no mirror nothing: the condition is never true for them. It
subsumes the flag for repair purposes — a re-poisoned mirror is cleared on the very next load
— while the pre-hydration script still earns its place, because without it the legacy member
sees a light **first paint** before any React code runs.

**Child F must still not treat mirror-absence as authoritative**; `themePref` being unset is
the authoritative signal.

## The write route

`PATCH /api/me/theme`, modelled on `app/api/me/notif-prefs/route.ts` — the repo's only
member-writes-own-preference **route**, so its 401/400/self-id shape is what this one copies.

**D7's named precedent is a different thing and is honoured elsewhere.** D7 points at
`TextSizeControl.tsx` + `app/utils/textZoom.ts` + `TextScaleBootstrap` — the preference
*plumbing*, not the route — and this plan follows it in the bootstrap's mount placement, the
no-`"use client"` constraint on `themePref.ts`, and the deliberate, stated divergence from
`TextSizeControl`'s concrete-default initialisation. D7 says that precedent is
localStorage-only and that server persistence "is the only intended difference", which is
exactly the split in the two-stores table above.

```
requireActiveSession()  ->  401 if absent
body: { theme: "dark" | "light" }        <- NOT "system"; see E-Q1
validate against that literal set  ->  400 on anything else
reject if session.user.isImpersonating   ->  403
writeClient.patch(session.user.sanityId).set({ themePref: theme }).commit()
```

- **Self-write only.** The document id comes from `session.user.sanityId`, never from the
  body, so no member can address another member's record by crafting a request.

- **But impersonation rewrites that id.** `auth.ts:182` sets `token.sanityId = target._id`
  and `auth.ts:263` surfaces it, so a super-admin who toggles the theme while impersonating
  would write the IMPERSONATED member's `themePref` to production Sanity — a persistent
  cross-member write from a UI action that looks local. Parent §12 assigns E "impersonation
  isolation". **The route returns 403 when `session.user.isImpersonating` is true**, and a
  route test pins it.

- **The read side needs the same isolation, and §12's row covers both.** `ThemeBootstrap`
  fetches `GET /api/me`, which during impersonation returns the *impersonated* member's
  record — so without a guard the admin's browser adopts and mirrors someone else's theme.
  `ThemeBootstrap` skips the fetch entirely when `isImpersonating`, and **gates on
  `useSession().status === "authenticated"`** rather than firing on bare mount: while status
  is `"loading"` the flag is not yet readable, and a fetch issued in that window bypasses the
  isolation.

- **The control hides itself during impersonation** rather than rendering a button that
  always 403s. The mutation-handler invariant requires a failure be surfaced, and a red toast
  on every impersonated toggle is a worse outcome than not offering the control. With the
  control hidden and the fetch skipped, an impersonating admin simply keeps their own theme,
  and nothing fires when impersonation ends — there is nothing of the member's to clear.

- **E's 403 is deliberately STRICTER than the repo precedent, and that is not an
  inconsistency to reconcile.** `PATCH /api/me` (alias, email) already writes to the
  impersonated member's record with no such guard. E does not follow it because a theme is a
  preference an admin has no reason to set on someone's behalf, where a name correction
  plausibly is.

  **That rationale must land somewhere a maintainer will look, not only in this plan.** It is
  exactly CLAUDE.md's "code that looks like a bug but isn't" shape. It goes in the route's own
  row in `API_REFERENCE.md` and as a one-line comment beside the check in the route, so the
  person tempted to "harmonise" the two endpoints reads it first.

- **No `revalidate*` call, and that is deliberate.** `CLAUDE.md`'s cache invariant covers
  routes that mutate **content**; `themePref` is per-member chrome that no ISR page renders.
  `/me` carries `export const revalidate = 60`, and the control initialises from
  `ThemeBootstrap`'s client-side fetch rather than from the server-rendered page, so the
  argument is checkable rather than asserted. Calling `revalidateServiceViews()` here would
  invalidate the whole schedule for a colour change. Stated rather than omitted, because "a
  mutating route with no revalidate" is exactly the shape that invariant exists to catch.
  **That invariant is 18, and the parent points it at Child E** (spec `:262`), so it is
  answered here by number rather than only in substance.

## The `/me` control

**It binds to the LITERAL `themePref` from `ThemeBootstrap`'s context — never to the resolved
theme.** Parent §12:594 is "`/me` control bound to **server** `themePref`" and §9:529-531
says the requirement holds "because the client seed is not the source of truth". Three
independent reasons:

- **The resolved theme cannot express the third state.** It is `"dark"` for an explicit-Dark
  member *and* for an unset one. A control sourced from it is structurally incapable of the
  three states invariant 14 is about.
- **It displays the wrong value in a real race.** `ThemeControl` and `ThemeBootstrap` mount in
  the same paint and the fetch is async, so a Light member opening `/me` would see the control
  read `"dark"` — the pre-fetch value — and **one click would write `themePref: "dark"` over
  their real preference** from a stale display.
- **The round-trip it would save is one request, not a duplication.** `ProfilePanel` PATCHes
  `/api/me` (`:122`) and never GETs it; there is no existing client read to piggyback on.

**The control writes BEFORE it paints, and the order is not a style preference.**
`ThemeControl` awaits the PATCH and calls `setTheme` only on `res.ok`; on failure it surfaces
the error and paints nothing. An optimistic paint would be **unrecoverable**: a
`setTheme("light")` whose PATCH then fails leaves `localStorage.theme = "light"` while
`themePref` stays unset, and the unset guard — required, so an unset member is never
overridden — means no later load can correct it. That is the identical terminal chain as the
legacy mirror. The cost of the safe order is a round-trip's latency before the paint; the cost
of the fast order is a member permanently stuck in a theme they did not persist.

**The handler** follows the mutation-handler invariant: `try`/`catch`/`finally`, checks
`res.ok`, resets its loading flag, never closes as success on failure.

**The one-way door is deliberate.** E ships no route that can return `themePref` to unset, so
a member who ever touches the control leaves Child F's default-unset cohort permanently. This
is the intended shape — an explicit choice should outrank a later default — but it is a
decision, not an oversight, and F must plan for a cohort that only ever shrinks.

## Sign-out clears the mirror — at all FOUR call sites

| Site | |
|---|---|
| `app/components/BottomNav.tsx:88` | mobile "Salir" — the most-used path on phones |
| `app/components/NavMenu.tsx:159` | desktop menu |
| `app/components/SignOutButton.tsx:8` | |
| `app/(client)/auth/not-a-member/page.tsx:21` | |

**There is no precedent to copy:** `grep -rn removeItem app` returns nothing, and
`textZoom.ts` never clears at all. So `themePref.ts` exports **`clearThemeMirror()`** and
**exactly those four sites call it** — not the stop-impersonating handler. `next-themes` owns
the key `"theme"`.

**This gets a guard, not just a mention.** A source-scan test asserts the call count is
exactly **four** and that no file containing `signOut(` lacks the clear — **scanning `app/`
with `app/**/__tests__/**` excluded**, since a mocked `signOut(` inside a test file would
otherwise fail the second assertion for a reason that has nothing to do with the invariant — the same shape as
the `Provider.tsx` source-text test, and for the same reason: the failure is silent. Shipped
without it, a member who signs out on the mobile nav leaves `theme=light` behind; the next
member signs in, the seed paints light, and `ThemeBootstrap` correctly does nothing because
their `themePref` is unset. That falsifies E's safe ending state, and their only escape is to
pick Dark — which destroys the unset signal **Child F depends on**.

**Its failure message must say "a new sign-out path needs `clearThemeMirror()` — add the
call, then update this count"**, not just report 5 ≠ 4 — otherwise the day a legitimate fifth
sign-out entry appears, someone bumps the number and the guard becomes decoration.

**The guarantee is partial, and stated as such.** The clear fires only on those four explicit
paths; a session that simply expires, or a browser closed without signing out, still leaves
member A's mirror for member B. "No leak through sign-out", not "no leak ever" — and the
residue self-corrects the moment B's projection lands.

## First paint, and the repaint this buys

On a device with no mirror the first paint uses `defaultTheme="dark"` and stays there: with
`themePref` unset the projection lands and changes nothing, which is correct.

A member who chose Light on device A and lands on a mirror-less device B **sees dark for one
paint, then repaints to light** — `ThemeBootstrap` reads the literal `themePref` and calls
`setTheme("light")`.

**Because `clearThemeMirror()` runs at sign-out, every device is mirror-less at the next
sign-in** — so a Light member gets that dark→light flash after hydration each time they sign
in. **The trade is deliberate.** Both paths repaint: without the clear, B sees A's theme and
then flips; with it, B sees dark and then flips. The clear adds no repaint to the shared-device
case, it moves the cost onto every sign-in in exchange for never showing one member another's
setting. Sign-in is rare next to page loads, where the mirror does its job and the first paint
is already right. If the flash proves objectionable in use, the fix is a server-rendered class
and belongs to Child F.

## `themeColor` and the native shell

**`ThemeBootstrap` swaps `<meta name="theme-color">` on the RESOLVED theme.** The static
`themeColor: "#010b17"` in `(client)/layout.tsx:47` stays as the server-rendered initial
value, which is what an unset member keeps. Keying on the resolved theme means unset resolves
to dark, the swap writes `#010b17`, and nothing changes for anyone who opted into nothing.

Two rejected alternatives, opposite errors, both worth recording:

- An **OS-keyed `media` array** regresses the default member. Someone on a light-OS device who
  never touches the control — the common case, iOS defaults to light — would get `#eef3f9`
  chrome around a still-dark app.
- **Leaving it static** looked like invariant 17's sanctioned fallback, but §5:186-187 permits
  that only for "a child that CANNOT meet it without a session read in a shared layout". E
  ships `ThemeBootstrap`, a client component that already holds the resolved theme, so no
  session read in any layout is required and **the precondition is not met.**

**The swap must null-guard, because `(admin)/layout.tsx` exports no `viewport`.** There is no
`<meta name="theme-color">` on any admin page, while `ThemeBootstrap` mounts inside `Provider`,
which both layouts use. An unguarded `.setAttribute` on a `null` query result throws *inside
the bootstrap*, taking the `setTheme` call down with it and disabling the member's theme on
every admin page. Query, skip if absent, never create.

**The light value is `#eef3f9`** — `--surface-base`'s light triplet, the page wash itself.
Written as a hex literal in `ThemeBootstrap.tsx` it trips Child B's
`Literal[value=/#[0-9a-fA-F]{6}\b/]` clause (`eslint.config.mjs:73`), error-level across
`app/**/*.tsx`. Use the inline `eslint-disable-next-line` with a reason, exactly as the rule's
own message sanctions and as `(client)/layout.tsx:47` already does — a `<meta>` content
attribute cannot take a `var()`.

### `appleWebApp.statusBarStyle` stays `black-translucent` — the reason is geometry

It sits at `(client)/layout.tsx:31` and `(admin)/layout.tsx:26`. `black-translucent` is
exactly what makes the WebView extend under the iOS status bar, and that is what gives
`env(safe-area-inset-top)` a non-zero value — `(client)/layout.tsx:35-37` documents
`viewportFit: "cover"` as its activator. Three components consume it: `Navbar.tsx:18`,
`CueDialog.tsx:236`, `PlannerGrid.tsx:1769`.

The only light-appropriate values (`default`, `black`) are **non-translucent**, so honouring a
runtime swap collapses the inset to zero and **moves all three** — a visible layout jump on
every toggle in an installed PWA. That is a geometry change wearing a colour change's clothes,
and it does not belong to a colour child.

**The cost is stated honestly:** in an installed iOS PWA in light mode the status-bar glyphs
stay white over a light wash and are hard to read. That is a real defect. It is narrower than
a layout jump on every toggle, and its fix is the iOS work, where the safe-area padding can
move in the same change.

**§12 assigns E "theme-responsive `themeColor` + `statusBarStyle`, client-side only". E ships
the first half and answers the second with a recorded remnant — by AMENDING the parent, not
by claiming a clause.** §5:186-187's fallback is conditional on a child that *cannot* meet the
requirement, and E can: it declines for geometry reasons the parent does not currently name.
So item D-f amends §5:188-190 and its §12 row, and the half-row is visibly answered rather
than quietly dropped.

### A6: the NATIVE iOS status bar is deferred, with the remnant recorded

**A6 is `@capacitor/status-bar`, the native plugin — not the PWA meta.** The plugin is **not
in `package.json`** (verified). The parent's A6 gives an explicit fallback: ship without it,
leave the native bar at its `Info.plist` default, record a known remnant, and do not let it
block the delivery. E takes that fallback.

Parent §5:202 asserts the `Info.plist` value "is overridden at runtime by Child E's status-bar
work" — false for the native bar whichever way the meta goes. E's docs pass corrects that line
rather than leaving the parent claiming something the delivery did not do.

**One more remnant belongs beside it.** Parent §5:200 already rules `manifest.webmanifest`'s
`theme_color: "#010b17"` permanently out of scope — a manifest is read at install time and
cannot follow a runtime theme. Not E's to fix, but E is the child that makes light reachable,
so E's docs record that an **installed PWA keeps dark chrome in light mode**, in the same
paragraph as the `statusBarStyle` remnant, so the next reader finds them together.

## ADR-0008: an interim note in E, supersession in F

`docs/adr/0008-forced-dark-theme.md` is **Status: Accepted — being revisited**, its Decision
block quotes `<ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false}>`
verbatim (`:21`), and its Consequences say the lever "is one line — remove `forcedTheme="dark"`
from `Provider.tsx`" and **"Do that last: until the 47 untreated files are handled, flipping
it re-exposes exactly the broken state this ADR exists to prevent"** (`:54`).

E4 *is* that flip. Left alone, the repo's own decision record would describe a line that no
longer exists and warn against the change that shipped — and CLAUDE.md tells the next reader
to **"read the relevant ADR before 'fixing' something that looks wrong"**, so a stale 0008
would actively mislead them into thinking E4 was the mistake.

**But supersession is Child F's.** §12:602 is `| ADR-0008 superseded | F | — |` and §14:626
reads "ADR-0008 is superseded **fully** on completion of Child F". §14:628-630 attaches a
content requirement E cannot satisfy — the superseding record must also capture §4.1, that a
partial-surface revival was specified, reviewed and rejected because an unthemed island cannot
be contained against body-level portals. That is F's story.

**So E writes an interim note in 0008's Consequences and leaves the status alone**, recording
that the precondition was **met, not ignored** — A–D treated the untreated files, D's visual
pass caught the two remaining defects, and E ships the explicit `defaultTheme="dark"` that
keeps the flip from meaning "everyone gets light" — and that the lever was pulled in E4 with
full supersession pending F.

**One mechanical constraint:** `adrIndex.test.ts:36` matches
`\*\*Date:\*\*.+\*\*Status:\*\*` with no `s` flag, so `**Date:** … **Status:**` must stay on a
single line.

## The schema field must have NO `initialValue`

Every neighbouring preference in `sanity/schemas/worshipTeam.ts` carries one —
`initialValue: true` at `:75`, `:80`, `:87`. Copying that habit here would write a default on
Studio document creation and **breach invariant 14 before a member ever opens the control**,
taking F's staged rollout with it.

**E1 ends in a Studio schema deploy, which is a remote mutation and is named as such.** The
parent counts "an irreversible Studio schema deploy" among the reasons E is Critical
(spec `:302-303`), and CLAUDE.md gates remote-mutating actions. Concretely: it is run against
the **production dataset** — the only one this project has — by the operator running the
delivery, using the repo's `sanity:deploy-schema` path, and what "undoes" it is redeploying a
schema without the field. **Nothing is written to any document by the deploy itself**, which
is the whole reason this particular remote mutation is low-risk: a hidden `string` with no
`initialValue` adds a field definition and touches no data. Stated rather than assumed,
because "irreversible remote action" is a category the reader should not have to size for
themselves.

`themePref` is a bare `string` with no `initialValue`, and `hidden: true` — following
`deviceTokens` at `:60` — so it stays out of Studio's member form.

**That `hidden: true` is also how invariant 13 is met** (`themePref` is member-only and never
appears in `MemberForm`, per D11). The admin panel's form is hand-written in
`app/components/admin/AdminPanel.tsx`, so the invariant additionally requires simply **not
adding a field there** — an omission rather than a change, which is the kind of requirement
that is met by accident and broken by accident. Named so it is auditable. It is a client preference,
not something an admin sets on someone's behalf, which is the same reasoning behind the
route's 403 under impersonation.

## Slicing

E is **not** atomic. The setting is only reachable once the `forcedTheme` removal lands, so
everything before it ships inert and independently revertible.

| Slice | Content | Reachable? |
|---|---|---|
| **E1** | `themePref` schema field + Studio deploy | no |
| **E2** | `PATCH /api/me/theme` + its route test | no — nothing calls it |
| **E3** | **`defaultTheme="dark"`**; the **legacy-mirror reconciliation script**; `GET /api/me` projection, `themePref.ts`, `ThemeBootstrap` including its `theme-color` swap — **not the control** | no — inert, *because* those first two land here |
| **E4** | **Remove `forcedTheme`**; the `/me` control; the ADR note and doc amendments | **YES** |

E1–E3 are inert — with the one multi-tab exception the storage-listener section closes via
`ThemeBootstrap`'s every-load repair. A schema field nothing reads, a route nothing calls, and a bootstrap whose
`setTheme` is overridden by `forcedTheme`. Its `theme-color` swap writes back `#010b17` —
**but only because `defaultTheme="dark"` AND the reconciliation script both ship in the same
slice.** Either one alone leaves `resolvedTheme` reading `"light"` on a dark page, for the
mirror-less and legacy cohorts respectively; see above. E3 still gets a browser check rather
than being waved through as untestable, and that check must include a browser seeded with
`localStorage.theme = "light"` — a reviewer's own browser almost certainly has no legacy
mirror, so the cohort that matters is invisible unless it is created deliberately.

**The control and the unmasking land in the same merge, because a control that ships earlier is
not harmless.** `/me` is the ordinary member profile page and E2's route is live by then, so in
that window a member would open `/me`, pick Light, get a `200`, see **nothing change**, and now
have `themePref: "light"` persisted — invariant 14's unset state destroyed, with no route that
can unset it, in exchange for a control that looks broken. This repo merges to `main`
periodically and `main` is production, so that is the expected path rather than a hypothetical.

## Verification

**Every guard lives under `app/`** — utility guards in `app/utils/__tests__/`, route guards
beside their named precedent in `app/api/__tests__/` (`notifPrefsRoute.test.ts`). Both are
inside `vitest.config.ts`'s `app/**` glob; a test written outside `app/**`, `scripts/**` or
`e2e/**` never runs and never fails, which is §9's landmine and would silently void the
highest-consequence assertion in this child.

- **Source-text on `Provider.tsx`, split across the two slices that change it:** E3 asserts
  `defaultTheme="dark"` is present and that `ThemeBootstrap` is mounted and wraps `children`;
  **E4 asserts `forcedTheme` is absent.** Written as one test it could not be green in E3,
  where `forcedTheme` is still deliberately there.
- **Route tests** mirroring `notifPrefsRoute.test.ts`: 401 unauthenticated, 400 on an invalid
  theme, self-id only, happy path writes the field, **403 under impersonation** — that last is
  the claim a Critical-tier reviewer should not have to take on trust.
- **`GET /api/me` projects `themePref`**, and still returns its other fields. If the projection
  line is dropped the bootstrap reads `undefined`, correctly does nothing, and every symptom
  reads as "this member has no preference".
- **Schema source-scan: `themePref` has no `initialValue`** (E1). Every other guard here checks
  that no *client* path writes the field, but an `initialValue` breaches invariant 14 with no
  client code running at all — Sanity would stamp every member document and F's cohort would be
  empty before F begins.
- **No mount path writes `themePref`** and **no mount path issues a PATCH**.
- **An absent / `null` / unrecognised `themePref` produces no `setTheme` and no `localStorage`
  write — WHEN no mirror is present.** That is the ordinary unset case and it must stay inert.
- **An unset `themePref` WITH a mirror present clears it** — `setTheme(defaultTheme)` then
  `clearThemeMirror()`, ending on dark with no mirror. This is the durable repair for a
  re-poisoned mirror and the two assertions must be written as one pair, or a later hand
  reading only the first will "fix" the second into inertness.
- **An unset `themePref` renders the control in its neither-selected state** and issues no PATCH.
- **A failed PATCH leaves both stores untouched** — mirror unchanged, `themePref` unchanged.
- **`clearThemeMirror()` is called at exactly four sites**, with the remediation-shaped failure
  message above.
- **The migration script's two guards** — source-text in both layouts, and the jsdom chain test.
- **`CLAUDE.md` and `AGENTS.md` no longer say "Dark-mode only."** and remain byte-identical
  outside the two sections `agentDocsParity.test.ts` exempts — that guard turns `npm test` red
  if only one is edited, which is the desired behaviour and worth expecting rather than
  debugging.
- **`themePref.ts`'s first non-comment line is not `"use client"`** — a one-line source-text
  assertion, because both root layouts import `THEME_MIGRATION_SCRIPT` from it as Server
  Components and neither of the two guards above would catch a stray directive.
- **Browser, both themes, on the real components** — the pass that found the two defects D
  shipped. An open `CueDialog` and `PlannerGrid` full-screen, which the parent names as
  acceptance criteria (§4.4); **one `(admin)` route**, since §12 notes `(admin)/layout.tsx` "can
  only follow the theme at E, when `forcedTheme` goes", making E the first moment admin chrome is
  observable in light at all; **one look at `/studio`**, which inherits the admin `Provider` —
  Studio's own theming is out of scope (D10) and the look is to confirm that decision is
  *survivable* rather than merely declared; and **`/posts/[slug]`**, where §12 marks Child B's
  typography and `dark:prose-invert` row "E verifies on device" and where the unstyled-lyrics
  regression §9 warns about would show.
- `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors, per slice.
- **Four stale `forcedTheme` statements**, per CLAUDE.md's currency rule — separate from the
  ADR note (D-e) and the parent amendments (D-f). The list is the implementer's checklist, so
  it enumerates **`forcedTheme` statements only**, and is exhaustive for those within a named
  scope: shipped code and **live reference docs**.

  **A grep for `forcedTheme` structurally cannot find every stale claim, which is why D-i is a
  separate row.** `CLAUDE.md:8` and `AGENTS.md:8` describe the stack as **"Dark-mode only."** —
  a sentence containing no `forcedTheme` token, in the most canonical live reference doc the
  repo has, asserting a property E4 destroys. Parent invariant 4 ("Documentation current in the
  same delivery; no stale 'not released' claims") is one of the repository invariants where
  violating any fails the delivery.

  **It is E's, not B's or F's.** §12:604 assigns B "CLAUDE.md + AGENTS.md **invariants**,
  mirrored" — a different row — and B could not have touched this sentence anyway, since light
  was still unreachable then. F's rows are the `enableSystem` flip, the default move, the
  announcement and the ADR supersession. **Reachability changes at E4 and nowhere else.**
  `grep -rn forcedTheme app docs` returns roughly seventeen further hits, all in **dated
  design records**: the two design specs, the parent scope spec, and review logs. Those are
  historical by nature and are left alone for the same reason as ADR-0015 below — rewriting a
  record of what was decided under the conditions of its day falsifies the history. The one
  exception is the parent scope spec, which E is already amending under **D-f**; its
  present-tense statements at **`§3:43`** and `§12:591` are updated there, in that pass, not here.
  1. `app/(gallery)/theme-gallery/[theme]/layout.tsx:10-14` and
  2. `app/utils/__tests__/themeGallery.test.ts:98-100` — both justify their design "while
     `forcedTheme` is still in force". The reasoning survives E4, since the nested-provider
     pass-through is independent of `forcedTheme`, but the sentences go stale the moment it lands.
  3. `docs/UTILITIES_AND_COMPONENTS.md:146-150` — states the provider carries `forcedTheme="dark"`
     and that "Child E must add `defaultTheme="dark"` explicitly": a correct instruction that
     becomes a false description the moment it is followed.
  4. **`app/brand.css:362`** — *"STILL UNREACHABLE. Child E removes `forcedTheme="dark"`; until
     then these values are inert and only the theme gallery renders them."* A present-tense
     "not released" claim sitting inside the `.light` block itself, which is the exact shape
     CLAUDE.md's currency rule requires removing when a release advances.

  **`docs/adr/0015-gallery-root-layout.md:7,23` is deliberately left alone.** It says the
  gallery "must render **both** themes while `forcedTheme="dark"` is still in force" — but an
  ADR is a dated record of why a decision was made under the conditions of its day, not a
  description of current state. Rewriting it would falsify the history. The interim note in
  0008 (D-e) is the place a reader learns the condition ended. Stated so the next reviewer
  sees it was considered rather than missed.

## Risks

| Risk | Why it is real | Mitigation |
|---|---|---|
| **`defaultTheme` omitted** | The whole team silently flips to light | Source-text test; called out as E4's first line |
| A member's preference leaks across accounts | The id would have to come from the body | It comes from the session; a route test pins it |
| A super-admin writes a member's theme | Impersonation rewrites `session.user.sanityId` | 403 on write, fetch skipped on read, control hidden |
| The control writes but the UI does not follow | Two stores can disagree | **PATCH first, `setTheme` only on `res.ok`** — never optimistic |
| A legacy mirror strands a member in light | A real toggle wrote that key until 2026-07-16 | The one-time reconciliation script, with two guards |
| Light mode is reachable before it is *good* | D's visual pass found 2 real defects; there may be more | The browser gate is per-slice, and F stages the default separately |
| 57 sites remain sub-AA in **both** themes | Pre-existing debt surfaced by D's audit | **Explicitly out of scope** — named in F's backlog, not silently inherited |

## Open questions

| # | Question | Blocking? | Bounded default |
|---|---|---|---|
| **E-Q1** | Does the `/me` control offer three options or two? | **RESOLVED — two: Dark and Light** | With `enableSystem={false}`, `next-themes` treats `"system"` as `i==="system" && n && (…)` — the `n` is `enableSystem` — so it adds a literal `system` class and NO `light`/`dark` class. The member picks "Follow System", the app stays dark forever, `themePref` reads `"system"` in Sanity, and nothing logs. Parent §9 names this trap and §12 assigns the `enableSystem` flip to **F**. `"system"` stays out of the accepted literal set until F owns it |
| **E-Q2** | Does the `(admin)` chrome get its own control? | **RESOLVED — no** | D14 says admin follows the theme; one preference for both |

---

**Terminal state: READY_FOR_ADVERSARIAL_REVIEW.**

Critical tier: **two sequential fresh `APPROVED` verdicts on byte-identical text.** This
document is **not** authorization to implement.
