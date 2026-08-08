# ADR-0015: A third root layout, at a dynamic segment

**Date:** 2026-08-08 · **Status:** Accepted

## Context

The theme gallery (Child A2) must render **both** themes while `forcedTheme="dark"` is still
in force in `app/utils/Provider.tsx` — that is its entire purpose, since Child D designs the
light values long before Child E exposes the setting.

`app/(gallery)/theme-gallery/[theme]/layout.tsx` looks like a mistake: a root layout nested
four segments deep, inside a route group, at a dynamic segment. It is the only arrangement
that works, and this record exists so nobody "tidies" it upward.

## Decision

The gallery's root layout sits **at** the `[theme]` dynamic segment.

## Why no other arrangement works

1. **It cannot live under `app/(client)`.** next-themes 0.4.6 compiles a nested
   `ThemeProvider` to a literal pass-through — `useContext(L) ? Fragment : X`. A nested
   provider is ignored, so `forcedTheme="dark"` is un-overridable from inside `(client)`, and
   the gallery could only ever render dark.
2. **It cannot sit above `[theme]`.** Next 16 passes a layout only the params from the root
   segment down to *that* layout. A layout at `app/(gallery)/layout.tsx` is two segments above
   `[theme]` and receives `{}` — it could not read the theme it exists to apply.
3. **A layout with no `layout.js` above it IS a root layout.** There is no `app/layout.tsx`,
   and `(admin)` and `(client)` are already sibling root layouts, so a third is structurally
   ordinary here even though its depth is not.

Verified empirically on `next@16.2.12` during review: the structure builds, prerenders every
enumerated segment, and emits `<html class="dark">` / `<html class="light">`.

## Consequences

- The gallery duplicates the shell both real root layouts carry. That is deliberate — it must
  not import `app/utils/Provider`, which renders `ActivityPing` and fetches on mount.
- Its `<body>` must carry `brand-atmosphere … bg-brand-blackout`, because `.brand-atmosphere`
  is the opaque page wash and 14 of the 15 colour-carrying `.brand-*` classes are
  alpha-composited over it. Without it every baseline is wrong in a way a reviewer cannot see.
- `dynamicParams = false` alongside `generateStaticParams` is required: `generateStaticParams`
  alone does not 404, and an unlisted segment would reflect arbitrary input into a root
  `class` attribute.
