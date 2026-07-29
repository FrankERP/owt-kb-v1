# ADR-0008: Force dark mode app-wide

**Date:** 2026-06-06 (default) → later hardened to forced · **Status:** Rationale not recorded

## Context

`app/utils/Provider.tsx:16` sets:

```tsx
<ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false}>
```

`forcedTheme` overrides any user or system preference — the app cannot render
light, and `next-themes` ignores attempts to switch.

## Decision

Dark-only. Components still carry `dark:` Tailwind variants throughout (15
component files), which are now effectively unconditional.

## Rejected

The 2026-06-06 commit (`640ae71`) made dark the **default** and disabled system
detection, and explicitly noted at the time that "light mode is preserved
(ThemeSwitch still works)."

That is no longer true. The theme is now *forced*, and `ThemeSwitch` no longer
exists anywhere in `app/`. **The commit that hardened default → forced, and the
one that removed the switch, record no reason.**

## Consequences

⚠️ **This ADR is a known gap, written to mark it rather than to explain it.**
The decision is real and load-bearing, but the rationale was never written down
and is not reconstructable from the code.

If you remember why — light mode looked wrong on stage, the team asked for it,
the palette was too costly to maintain in two modes — replace this section and
set the status to `Accepted`. Until then, treat "let's re-enable light mode" as
an open question rather than a settled one.

Related and separate: **email templates are deliberately light**, which is *not*
an inconsistency with this decision. See `CLAUDE.md` (Known landmines) and
`docs/NOTIFICATIONS.md` — five attempts to hold a dark palette against Outlook
for Mac failed, and client dark-mode transforms assume email is light.
