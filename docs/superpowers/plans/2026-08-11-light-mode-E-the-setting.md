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
  row E of §11; §12's coverage table; requirements D5, D7, D12, D14, **D15**, D16, D17;
  invariants 14 and 17; assumptions A5 and A6; §9's landmines.
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
| 3 | **`GET /api/me` projection gains `themePref`** — D15's read path | `app/api/me/route.ts` |
| 3b | The `/me` control — **ships in E4, not E3** (see the slice table) | `app/components/ui/ThemeControl.tsx` (new), rendered in `app/(client)/me/page.tsx` |
| 4c | **The one-time legacy reconciliation**, as an inline `<script>` in `<head>` **before `<Provider>`** | `app/(client)/layout.tsx` + `app/(admin)/layout.tsx` — *not* the gallery root layout |
| 4 | The fetch/validate helper and `clearThemeMirror()` — **not** a second store | `app/utils/themePref.ts` (new) |
| 4b | Reads the projection, calls `setTheme`, swaps both `<meta>`s | `app/components/ThemeBootstrap.tsx` (new), mounted in `Provider.tsx` |
| 5 | **`forcedTheme="dark"` removed**, explicit `defaultTheme="dark"` added | `app/utils/Provider.tsx:16` |
| 6 | `themeColor` **swapped client-side on the resolved theme** | `app/components/ThemeBootstrap.tsx` |
| 7 | `appleWebApp.statusBarStyle` — **swapped in `ThemeBootstrap` beside `themeColor`** | `app/components/ThemeBootstrap.tsx` |
| 7b | Capacitor's **native** status bar (`@capacitor/status-bar`) | **deferred with a recorded remnant — that, and only that, is A6** |
| 8 | **Docs, per slice** — §12 assigns them to the owning child | `DATA_MODEL.md` (E1), `API_REFERENCE.md` + `ROUTES.md` (E2), `UTILITIES_AND_COMPONENTS.md` (E3) |

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

**`themePref.ts` must not own storage.** `next-themes` already does both halves —
`setTheme` writes the mirror, its injected script does the pre-hydration seed — so this
file holds only the `GET /api/me` fetch, the `"dark" | "light"` validator, and
`clearThemeMirror()`. A second mirror on a second key is the failure mode to avoid.

**`ThemeBootstrap` mounts inside `Provider.tsx`, not in a layout.** It needs `setTheme`, so
it must sit inside `<ThemeProvider>`. `TextScaleBootstrap` — the shape precedent — is
mounted only at `(client)/layout.tsx:76`, and copying that placement would leave an admin
whose first load of a session is `/admin` on a preference they never fetched. Mounting
inside `Provider` covers both root layouts and correctly excludes the provider-less gallery.

### The mirror is NOT empty today, and `forcedTheme` is the only thing hiding it

**A production theme toggle wrote this exact key for twenty months.**
`app/components/ThemeSwitch.tsx` was `onClick={() => setTheme(isDark ? "light" : "dark")}`,
labelled *"Cambiar a tema claro"*. It shipped in the member navbar until `749588c`
(2026-04-24) and in the **admin** navbar until `33c6e15` (2026-07-16 — under four weeks
ago). Both are ancestors of `main`. The Provider of that era carried no `storageKey`, so it
used next-themes' default — `"theme"`, **the same key E uses** — under a comment reading
*"Light mode is kept intact — the ThemeSwitch toggle still works."*

Today the seed takes its `if (forced) apply(forced)` branch, so that stored value is read
and never applied. **E4 removes the mask.** For any browser holding `theme: "light"` from
that toggle, the seed `localStorage.getItem("theme") || "dark"` returns **`"light"`** —
a stored value beats `defaultTheme` — and `ThemeBootstrap`, correctly per the guard below,
does nothing at all because `themePref` is unset.

That is not the one-frame flash described further down. **It is the terminal state**, until
that member opens `/me` and picks Dark — which writes `themePref` and burns the unset
signal Child F depends on. `clearThemeMirror()` at sign-out does not help: it only governs
mirrors created after E ships.

So **E4 runs a one-time reconciliation — and WHERE it runs is the whole difficulty.**

`next-themes` injects its own seed via `dangerouslySetInnerHTML`, so that script executes
in `<head>` **before hydration**. Any React component — `ThemeBootstrap` included — runs
after it. By then the seed has already done `classList.add("light")` and latched
`theme: "light"` into state, and removing the key afterwards **repaints nothing**:
`next-themes` re-reads storage only on the cross-tab `storage` event, never in the tab that
wrote. An earlier revision put this snippet in prose with no file, and the only home it
implied was `ThemeBootstrap`, where it would have left the legacy population on light for
the whole page load and the rest of the SPA session.

**It ships as an inline `<script>` rendered as the FIRST CHILD OF `<body>` in
`(client)/layout.tsx` and `(admin)/layout.tsx`, immediately before `<Provider>`** —
deliberately not in the gallery root layout, which has no provider and no member.

The operative constraint is **document order, not `<head>`**. Neither layout renders a
`<head>` element, and React 19 hoists only `<script async src>`, never inline
`dangerouslySetInnerHTML`. An implementer who reads "in the `<head>`" will add a raw `<head>`
to a root layout and collide with Next's metadata injection. next-themes' own seed is a
plain `React.createElement("script", { dangerouslySetInnerHTML })` inside the provider —
this script sits just above it and therefore runs first.

```
try {
  if (!localStorage.getItem("owt-theme-migrated")) {
    localStorage.removeItem("theme");        // legacy ThemeSwitch value, not a preference
    localStorage.setItem("owt-theme-migrated", "1");
  }
} catch (e) {}
```

**The `try/catch` is not decoration.** `localStorage` *throws* — `SecurityError` with
storage blocked, Safari private mode, some Capacitor WebView configurations — and
`next-themes` wraps every single access for exactly that reason. Without it the script
throws before `setItem`, the migration silently never runs for those members, and they keep
the legacy mirror forever. Because it is its own `<script>` element, a throw here would not
stop hydration — it would just quietly skip the fix.

A **clear**, not a `setTheme("dark")`. Both land the member on dark, but only the clear
preserves the property F depends on: **no mirror means no preference**, so when F changes
the default, a member who never chose anything actually follows it. Writing `"dark"` into
the mirror would pin the whole unset population to dark and quietly defeat F's rollout.

It runs once, so a value E's own control writes afterwards is never touched.

**The test must assert the RESOLVED `documentElement` class after a render**, not the
helper in isolation: a helper-only test passes green while the app paints light, which is
exactly the failure mode above. Chain: a pre-existing `localStorage.theme = "light"` plus an
unset `themePref` ends with `<html class="dark">`, issues **no PATCH**, and leaves
`themePref` unset.

**And the stop-impersonation clear is dropped entirely — it was dead work.** An earlier
revision had `clearThemeMirror()` fire when impersonation ends, reasoning that the admin
would otherwise keep the member's theme until a hard reload. That rationale is false under
E's own read isolation: `ThemeBootstrap` skips the fetch while `isImpersonating`, so the
admin never adopts the member's theme and the mirror holds the **admin's** value throughout.
Worse, the instruction could not be carried out. `ImpersonationBanner.tsx:15-19` calls
`update()`, `router.push("/admin")` and `router.refresh()` — a soft navigation that neither
remounts the provider nor re-seeds — so the clear would have to be paired with `setTheme()`,
and at that moment the admin's own `themePref` has not been fetched (it was deliberately
skipped). There is no argument to pass. `setTheme(undefined)` is the §9 landmine this plan
spends a section on; `setTheme("dark")` silently overrides a Light admin. **Nothing fires at
stop-impersonation.** The admin's theme was never disturbed, so nothing needs restoring.

**And a multi-tab caveat worth stating rather than discovering — it applies to BOTH clears,
the migration one here and `clearThemeMirror()` at sign-out:** the provider's storage
listener is `key === "theme" && (newValue ? set(newValue) : setTheme(default))`, so a
`removeItem` in either place makes every *other* open tab write `theme="dark"` straight back.
Visually safe — dark is the default anyway — but it means "no mirror" is not an absolute
guarantee on a multi-tab device, and **Child F must not treat mirror-absence as
authoritative**; `themePref` being unset is the authoritative signal.

### `setTheme` MUST be guarded, and this is the most dangerous line in Child E

**`next-themes` has no falsy guard on the setter.** Verified in its source:

```
f = useCallback(i => { let c = typeof i === "function" ? i(a) : i;
                       r(c); try { localStorage.setItem(o, c) } catch {} })
```

`setTheme(undefined)` therefore stores the **string `"undefined"`**.

**The damage is deferred, and describing it as immediate is misleading enough to matter.**
`applyTheme` opens `let c = i; if (!c) return;`, so the calling session adds no bad class
and looks fine. The poison is what was *persisted*: on the **next** load the seed reads
`localStorage.getItem("theme") || defaultTheme`, `"undefined"` is truthy and wins, and the
applier does `classList.add("undefined")` — removing `dark`. An implementer who tests the
immediate claim sees nothing happen and may conclude the trap is not real.

**`themePref` is unset for the entire team on the day E ships** — invariant 14 requires
that absence be the normal state — so an unguarded bootstrap would put every member into
a themeless document. With `tailwind.config.ts:10` at `darkMode: "class"` and **94 `dark:`
utilities still live**, they all stop applying at once. And per `CLAUDE.md`, a `dark:` base
at specificity (0,2,0) *masks* bare `hover:`/`focus:` utilities, so this is not a missing
colour — it changes which rules win. Child B paid for that lesson with 39 real bugs.

**So `ThemeBootstrap` calls `setTheme` only when the projection returns the literal
`"dark"` or `"light"`, and does nothing at all otherwise.** A test asserts that an
absent, `null` or unrecognised `themePref` produces **no `setTheme` call and no
`localStorage` write**. The existing "no mount path issues a PATCH" test does not cover
this — that is the server store, this is the browser one, and they fail independently.

The parent records this landmine in §9. An earlier revision of this plan cited §9 for the
`enableSystem` trap and missed the `setTheme` one sitting beside it.

**UNSET MUST STAY DISTINGUISHABLE, and F depends on it** (invariant 14). The control has
**three** states — Dark, Light, and no preference yet — and **must not write `themePref` on mount, on
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
  route test pins it.

  **The READ side needs the same isolation, and §12's row covers both.** `ThemeBootstrap`
  fetches `GET /api/me`, which during impersonation returns the *impersonated* member's
  record — so without a guard the admin's browser adopts and mirrors someone else's theme.
  `ThemeBootstrap` skips the fetch entirely when `isImpersonating`.

  **One read, not two.** `ThemeBootstrap` and the `/me` control both need the member's
current `themePref`, and both would otherwise issue their own `GET /api/me` — a duplicated
Sanity round-trip on the one page where they coexist. The control takes its initial value
from the resolved theme `next-themes` already holds (which the bootstrap has by then set),
and issues no read of its own.

**The bootstrap's skip is only sound if its fetch waits for the session.** `ThemeBootstrap` gates on
  `useSession().status === "authenticated"` rather than firing on bare mount: while status is
  `"loading"` the `isImpersonating` flag is not yet readable, and a fetch issued in that
  window bypasses the isolation the row promises.

  With the control hidden and the fetch skipped, an impersonating admin simply keeps their
  own theme. An earlier revision said "the theme still applies locally for the impersonating
  admin", which contradicted hiding the control — with it hidden there is nothing to toggle.

- **Sign-out clears the `localStorage` mirror — at all FOUR call sites.** An earlier
  revision said "the sign-out handler", singular. There are four, and the two most-used are
  not the one an implementer would guess:

  | Site | |
  |---|---|
  | `app/components/BottomNav.tsx:88` | mobile "Salir" — the most-used path on phones |
  | `app/components/NavMenu.tsx:159` | desktop menu |
  | `app/components/SignOutButton.tsx:8` | |
  | `app/(client)/auth/not-a-member/page.tsx:21` | |

  **There is no precedent to copy:** `grep -rn removeItem app` returns nothing, and
  `textZoom.ts` — the named precedent — never clears at all.

  So `themePref.ts` exports **`clearThemeMirror()`** and **exactly those four sites call
  it** — *not* the stop-impersonating handler, for the reasons given above: with the read
  isolated there is nothing of the member's to clear, and no argument to hand `setTheme()`.
  `next-themes` owns the key `"theme"`.

  **This gets a guard, not just a mention.** The source-scan test asserts the call count is
  exactly **four**, so a later hand cannot quietly add a fifth at the impersonation handler.
  It also asserts that no file
  containing `signOut(` lacks the clear — the same shape as the `Provider.tsx` source-text
  test, and for the same reason: the failure is silent. Shipped without it, a member who
  signs out on the mobile nav leaves `theme=light` behind; the next member signs in, the
  seed paints light, and `ThemeBootstrap` correctly does nothing because their `themePref`
  is unset. That falsifies E's safe ending state, and their only escape is to pick Dark —
  which writes `themePref` and destroys the unset signal **Child F depends on**.
- **E's 403 is deliberately STRICTER than the repo precedent, and that is not an
  inconsistency to reconcile.** `PATCH /api/me` (alias, email) already writes to the
  impersonated member's record with no such guard. E does not follow it because a theme is
  a preference an admin has no reason to set on someone's behalf, where a name correction
  plausibly is. Stated so a later reviewer does not "fix" the difference.
- **The control hides itself during impersonation** rather than rendering a button that
  always 403s. The mutation-handler invariant requires a failure be surfaced, and a red
  toast on every impersonated toggle is a worse outcome than not offering the control.
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
| `themePref` on `teamMembers` | **source of truth** | Follows the member across devices, and is what D7 asks for |
| `localStorage` | **paint cache** | `next-themes` needs the value BEFORE hydration or the page flashes the wrong theme |

`ThemeBootstrap` reads `themePref` from the `GET /api/me` projection and calls
`setTheme()` — **not** a bare `localStorage` write, which would not repaint the current
tab, since `next-themes` only listens for cross-tab `storage` events. `next-themes` writes
the mirror itself as a side effect of `setTheme`.

**The first-paint claim, stated accurately.** On a device with no mirror, the first paint
uses `defaultTheme="dark"` and stays there — with `themePref` unset the projection lands
and changes nothing, which is correct. A member who chose Light on device A and lands on a
mirror-less device B **sees dark for one paint, then repaints to light** — `ThemeBootstrap`
reads the literal `themePref` and calls `setTheme("light")`. An earlier revision claimed
they "see dark until they choose again", which contradicted this plan's own read path.

**The consequence is a repaint on every sign-in, and it is accepted rather than hidden.**
`clearThemeMirror()` at the four sign-out sites (`BottomNav.tsx:88`, `NavMenu.tsx:159`,
`SignOutButton.tsx:8`, `(client)/auth/not-a-member/page.tsx:21`) leaves every device
mirror-less at the next sign-in, so a Light member gets a dark→light flash after hydration each time they sign in.
That is the price of the clear, which exists so a shared device never shows member A's theme
to member B. Both paths repaint — without the clear B sees A's theme and then flips, with it
B sees dark and then flips — so the clear adds no repaint to the shared case; it moves the
cost onto every sign-in in exchange for never showing one member another's setting. **The
trade is deliberate.** Sign-in is rare next to page loads, where the mirror does its job and
the first paint is already right. If the flash proves objectionable in use, the fix is a
server-rendered class and belongs to Child F, not here. An earlier revision claimed a "flash toward light … until the
projection lands", which described a correction that does not happen for an unset member.

## `themeColor` and the native shell

**`ThemeBootstrap` swaps `<meta name="theme-color">` on the RESOLVED theme.** The static
`themeColor: "#010b17"` in `(client)/layout.tsx:47` stays as the server-rendered initial
value, which is what an unset member keeps.

**Both swaps must null-guard, because on admin routes the meta does not exist.**
`(admin)/layout.tsx` exports **no `viewport` at all** — there is no `<meta name="theme-color">`
on any admin page — while `ThemeBootstrap` mounts inside `Provider`, which both layouts use.
An unguarded `.setAttribute` on a `null` query result throws *inside the bootstrap*, taking
the `setTheme` call down with it and disabling the member's theme on every admin page. Query,
skip if absent, never create.

**`appleWebApp.statusBarStyle` is swapped the same way, and it is in scope.** It is the
static `"black-translucent"` at `(client)/layout.tsx:31` and `(admin)/layout.tsx:26`. An
earlier revision deferred it by citing **A6**, which is a different thing entirely: A6 is
Capacitor's **native** `@capacitor/status-bar` plugin, and §12 lists that as its own row.
`apple-mobile-web-app-status-bar-style` is a DOM meta under invariant 17's ordinary
constraint, and §5's escape clause is conditional on a child that *cannot* meet it without a
session read in a shared layout — a precondition this plan already demolishes for
`themeColor`, since `ThemeBootstrap` holds the resolved theme client-side. The same argument
carries. **Uncertainty recorded rather than argued away:** whether an *installed* iOS PWA
re-reads that meta after standalone launch is unverified — no device was available. Swapping
it costs one guarded line; if iOS ignores the runtime change, nothing is worse than the
deferral, and the browser-tab case is fixed either way.

This plan reached the right answer by two wrong routes before this one, and both are worth
recording because they are opposite errors:

- An **OS-keyed `media` array** regresses the default member. Someone on a light-OS
  device who never touches the control — the common case, iOS defaults to light — would
  get `#eef3f9` chrome around a still-dark app.
- **Leaving it static** looked like invariant 17's sanctioned fallback, but that fallback
  is *conditional*: §5 permits it only for "a child that CANNOT meet it without a session
  read in a shared layout". E ships `ThemeBootstrap`, a client component that already holds
  the resolved theme, so no session read in any layout is required and **the precondition
  is not met.** §12 assigns E "theme-responsive `themeColor` + `statusBarStyle`, client-side
  only". An earlier revision also cited a Child C lint `ignores` entry "written to expire
  here"; **no such entry exists** — `eslint.config.mjs:59-64` ignores only
  `app/**/__tests__/**` and `app/utils/emailShell.ts`, and row exemptions carry an inline
  disable rather than a whole-file ignore (`:69-72`). The conclusion rests on parent
  §5:188-190 and §12 alone, which is enough.

Keying on the RESOLVED theme has neither problem: unset resolves to dark, so the swap
writes `#010b17` and nothing changes for anyone who opted into nothing.

**The light value is `#eef3f9`** — `--surface-base`'s light triplet, the page wash itself.
Written as a hex literal in `ThemeBootstrap.tsx` it trips Child C's
`Literal[value=/#[0-9a-fA-F]{6}\b/]` clause, which is error-level across `app/**/*.tsx`.
Use the inline `eslint-disable-next-line` with a reason, exactly as the rule's own message
sanctions and as `(client)/layout.tsx:47` already does — a `<meta>` content attribute
cannot take a `var()`.

`appleWebApp.statusBarStyle` **is swapped, not deferred** — see the section above. An
earlier revision said here that it "stays `black-translucent`" because "A6's fallback covers
it", which contradicted that section outright and dropped a §12 row. A6 is a different
thing, and only that thing:

### A6: the NATIVE iOS status bar is deferred, with the remnant recorded

**A6 is `@capacitor/status-bar`, the native plugin — not the PWA meta.** The plugin is
**not in `package.json`** (verified). The parent's A6 gives an explicit fallback: ship
without it, leave the native bar at its `Info.plist` default, record a known remnant, and
**do not let it block the delivery**. E takes that fallback. The web and PWA surfaces are
unaffected, because `apple-mobile-web-app-status-bar-style` is handled by `ThemeBootstrap`
under invariant 17 and is §12's own separate row.

**That remnant has a destination.** Parent §5:202 asserts the `Info.plist` value "is
overridden at runtime by Child E's status-bar work" — which stays false for the *native*
bar whichever way the meta goes. E's docs pass corrects that line rather than leaving the
parent claiming something the delivery did not do.

## The schema field must have NO `initialValue`

Every neighbouring preference in `sanity/schemas/worshipTeam.ts` carries one —
`initialValue: true` at `:75`, `:80`, `:87`. Copying that habit here would write a default
on Studio document creation and **breach invariant 14 before a member ever opens the
control**, taking F's staged rollout with it.

`themePref` is a bare `string` with no `initialValue`, and `hidden: true` — following
`deviceTokens` at `:60` — so it stays out of Studio's member form. It is a client
preference, not something an admin sets on someone's behalf, which is the same reasoning
behind the route's 403 under impersonation.

## Slicing

E is **not** atomic. The setting is only reachable once step 5 lands, so everything before
it ships inert and independently revertible.

| Slice | Content | Reachable? |
|---|---|---|
| **E1** | `themePref` schema field + Studio deploy | no |
| **E2** | `PATCH /api/me/theme` + its route test | no — nothing calls it |
| **E3** | `GET /api/me` projection, `themePref.ts`, `ThemeBootstrap` — **not the control** | no — genuinely inert |
| **E4** | **Remove `forcedTheme`, add `defaultTheme="dark"`**; the `/me` control (item 3b); the legacy-mirror reconciliation script (item 4c); the client-side `themeColor` + `statusBarStyle` swaps | **YES** |

**The control writes BEFORE it paints, and the order is not a style preference.**
`ThemeControl` awaits the PATCH and calls `setTheme` only on `res.ok`; on failure it
surfaces the error and paints nothing. An optimistic paint would be **unrecoverable**: a
`setTheme("light")` whose PATCH then fails leaves `localStorage.theme = "light"` while
`themePref` stays unset, and `ThemeBootstrap`'s unset guard — which this plan requires, so
that an unset member is never overridden — means no later load can ever correct it. That is
the identical terminal chain this plan proves for `setTheme(undefined)` and for the legacy
mirror. The cost of the safe order is a round-trip's latency before the paint; the cost of
the fast order is a member permanently stuck in a theme they did not persist.

**E4 is the whole risk**, and it now carries the `/me` control as well as the
`forcedTheme` removal — **because a control that ships before E4 is not harmless.**

An earlier revision put `ThemeControl` in E3 and claimed E1–E3 "could sit on `main` for a
week harmlessly". They could not. `/me` is the ordinary member profile page and E2's route
is live by then, so in that window a member opens `/me`, picks Light, gets a `200`, sees
**nothing change**, and now has `themePref: "light"` persisted — invariant 14's unset state
destroyed, with no route that can unset it, in exchange for a control that looks broken.

**That one-way door survives into E4 and is deliberate.** E ships no route that can return
`themePref` to unset, so a member who ever touches the control leaves Child F's
default-unset cohort permanently. This is the intended shape — an explicit choice should
outrank a later default — but it is a decision, not an oversight, and F must plan for a
cohort that only ever shrinks.
This repo merges to `main` periodically and `main` is production, so that is the expected
path rather than a hypothetical.

E1–E3 are now genuinely inert: a schema field nothing reads, a route nothing calls, and a
bootstrap whose `setTheme` is overridden by `forcedTheme`. **The control and the unmasking
land in the same merge.**

## Verification

- **A test reads `Provider.tsx` and asserts `defaultTheme="dark"` is present and
  `forcedTheme` is absent.** Source-text, not rendered — see above.
- Route tests mirroring `notifPrefsRoute.test.ts`: 401 unauthenticated, 400 on an invalid
  theme, self-id only, happy path writes the field.
- **A test that `GET /api/me` actually projects `themePref`.** The four above cover the
  `PATCH` only. If the projection line is dropped, the bootstrap reads `undefined`, correctly
  does nothing, and every symptom reads as "this member has no preference" — the silent-
  failure shape this plan guards against everywhere else. Assert the field is in the response
  for a member who has one.
- The `/me` control's handler: `res.ok` checked, flag reset in `finally`, failure surfaced.
- **A test that a FAILED PATCH leaves both stores untouched** — the mirror unchanged and
  `themePref` unchanged. See the ordering rule below; this is the guard on it.
- **Browser, both themes, on the real components** — the pass that found the two defects D
  shipped. An open `CueDialog` and `PlannerGrid` full-screen, which the parent names as
  acceptance criteria (§4.4), **plus one `(admin)` route** — §12 notes `(admin)/layout.tsx`
  "can only follow the theme at E, when `forcedTheme` goes", making E the first moment admin
  chrome is observable in light at all — **and `/posts/[slug]`**: §12 marks Child B's typography and
  `dark:prose-invert` row "E verifies on device", and that route is where the unstyled-lyrics
  regression §9 warns about would show.
- **Every guard below lives under `app/`** — utility guards in `app/utils/__tests__/`, route
  guards beside their named precedent in `app/api/__tests__/` (`notifPrefsRoute.test.ts`).
  Both are inside the `app/**` glob, which is the whole of the constraint. `vitest.config.ts`
  includes only
  `app/**`, `scripts/**` and `e2e/**`, so a test written outside those roots never runs and
  never fails — §9's landmine, and it would silently void the highest-consequence assertion
  in this child.
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
| The `/me` control writes but the UI does not follow | Two stores can disagree | **PATCH first, `setTheme` only on `res.ok`** — never optimistic; see below |
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
