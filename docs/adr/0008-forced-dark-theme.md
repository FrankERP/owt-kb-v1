# ADR-0008: Force dark mode app-wide

**Date:** 2026-06-06 (default) → 2026-07-16 (forced) · **Status:** Superseded by [ADR-0016](0016-light-mode-revived-by-tokenisation.md) on 2026-08-12

## Context

Light mode was never dropped on aesthetic grounds. It stopped being **maintained**:
as new admin panels and features shipped, they were built and reviewed in dark
only, so the light palette drifted further out of date with every release. The
choice was between spending time keeping two palettes correct, or shipping
features — and features won.

Forcing dark was the honest way to close that gap: better to render one palette
that is right than to expose a light mode that looks broken on half the app.

## Decision

`app/utils/Provider.tsx:16`:

```tsx
<ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false}>
```

`forcedTheme` overrides both user and system preference. `640ae71` (2026-06-06)
made dark the default; `33c6e15` (2026-07-16, the Backstage identity refresh)
hardened it and deleted `app/components/ThemeSwitch.tsx`.

## Rejected

**Shipping a light mode that was only partly maintained.** A theme toggle that
produces unreadable contrast on newer panels is worse than no toggle — it looks
like a bug to every member who finds it, and generates support questions instead
of value.

**Keeping both palettes current as features shipped.** Rejected on time, not on
merit. This is the constraint that changed.

## Consequences

The 2026-06-06 commit claimed "light mode is preserved (ThemeSwitch still
works)." That stopped being true on 2026-07-16 and the hardening commit recorded
no reason — this record was originally filed as a gap and closed on 2026-07-29
by the author.

**Reviving light mode — measured scope as of 2026-07-29:**

| Surface | State |
|---|---|
| `app/brand.css` | 11 custom properties, **no light branch at all** — no `prefers-color-scheme`, no `.light`, no `:root[data-theme]`. Needs a second set of values. |
| Components with `dark:` variants | 38 files, 251 occurrences — these have a light path already, though it is untested since June. |
| `.tsx` files with **no** `dark:` variant | 47. Some legitimately need none (layout-only, logic-only); the rest are the drift described above and are the real work. |
| `ThemeSwitch` | Deleted in `33c6e15`; recover the original with `git show 33c6e15^:app/components/ThemeSwitch.tsx`. |

The lever itself is one line — remove `forcedTheme="dark"` from `Provider.tsx`
and decide whether `enableSystem` comes back. Do that **last**: until the 47
untreated files are handled, flipping it re-exposes exactly the broken state
this ADR exists to prevent.

### Superseded (2026-08-12) — the precondition was met, and the constraint changed

**Child E4 removed `forcedTheme="dark"`.** The condition this ADR set was
satisfied rather than ignored: the light-mode revival programme's Children A–D
built a token layer, migrated 2,397 colour decisions onto it, and designed 90
light counterparts, so the 47 untreated files above are treated. Child D's visual
pass on the real components caught the two defects that survived the migration.

Two things keep the flip from meaning "everyone gets light". Child E adds an
explicit `defaultTheme="dark"` — `next-themes` resolves an unset default to
`"light"` under `enableSystem={false}`, so without it the whole team would flip
silently — and a one-time reconciliation clears the legacy `ThemeSwitch` mirror
this ADR's own table points at. A member who never opens the new `/me` control
sees exactly what they saw before.

`enableSystem` has **not** come back; Child F owns that decision.

**Child F completed the delivery** on 2026-08-12: `enableSystem` is now `true` and the
default is Follow System, so a member who has never chosen follows their device.

**This ADR is superseded in full by [ADR-0016](0016-light-mode-revived-by-tokenisation.md)**,
which records what actually changed — colour was tokenised, so the drift mechanism this ADR
described is removed rather than out-run — and why a partial-surface revival was specified,
reviewed and rejected (parent spec §4.1). Read 0016 first; this file is kept for the history
of *why dark-only was right in July 2026*, which it still is.

Related and **not** in scope: email templates are deliberately light and stay
that way regardless of what the app does — see `CLAUDE.md` (Known landmines) and
`docs/NOTIFICATIONS.md`. Five attempts to hold a dark palette against Outlook
for Mac failed.
