# ADR-0034: A dialog effect that moves focus depends on edges only, never on a handler or a ref prop

**Date:** 2026-09-13 · **Status:** Accepted

## Context

The team could not edit their profiles. On a phone the keyboard closed after one
key; on a laptop the caret left the field after one character. Reported
2026-09-13, live for weeks, with all three gates green the whole time.

`CueDialog`'s entry focus — `(focusables(shell)[0] ?? shell).focus()` — shared a
`useEffect` with the Tab/Escape trap, so it inherited that effect's dependency
array:

```
}, [id, isTopLayer, onDismiss, open, top]);
```

`onDismiss` is an inline arrow in most consumers (`onDismiss={() => setOpen(false)}`),
and a new identity on every render; the seven that pass a named handler are not
guaranteed stable either, and nothing in the type or the lint rule asks them to
be. The three surfaces that broke all share
one shape: **the state being typed is declared in the component that renders the
dialog.** So a keystroke re-rendered that component, `onDismiss` changed
identity, the effect re-ran, and focus jumped to the dialog's first control.
iOS closes the soft keyboard when focus leaves a text field.

An audit on the same day found three confirmed cases — `ProfilePanel` (reported),
`LibraryFilters` on `/biblioteca` (nobody reported it), `EditSongButton` — each
demonstrated by running the surface's own test against the pre-fix component.

None of the three gates can see this. `tsc` types an arrow and a `useCallback`
identically, a unit test that never asserts on `document.activeElement` passes
either way — `libraryFilters.test.tsx` was already typing into the broken field —
and `next build` renders nothing.

## Decision

In `app/components/ui/CueDialog.tsx`, an effect that MOVES FOCUS depends on the
presence edge and nothing else.

- **Entry focus** is its own effect, `[open, top]`, and additionally returns
  early when `shell.contains(document.activeElement)` — focus that is already
  inside the dialog has nothing to enter.
- **Layer registration** is `[id, mounted, registerLayer]`. Its *cleanup* is the
  unregister, which the provider follows with a focus restore, so a spurious
  re-run throws focus out of an open dialog — the same class of failure, worse.
  The two ref props it needs are read through a ref mirror refreshed in an
  effect of its own, and the record is handed LIVE VIEWS of that mirror rather
  than the ref objects themselves — the provider dereferences the record only at
  unregister time, so a plain pass-through would have frozen the restore target
  as it was when the dialog opened.
- **The Tab/Escape trap** keeps `onDismiss` in its dependencies. Re-binding a
  listener has no side effect, so unstable identities are harmless there. This
  is the distinction that matters: not "which effect", but "does the effect move
  focus".

Guards are behavioural, one per surface, each verified to fail against the
pre-fix component: `CueDialog.test.tsx` ("CueDialog typing"),
`emailPrefToggles.test.tsx` (the reported `/me` path),
`libraryFilters.test.tsx`, and `editSongButtonTyping.test.tsx`.

## Rejected

**Ask consumers to wrap `onDismiss` in `useCallback`.** It fixes the three known
sites and none of the next ones: a primitive used by every dialog in the app
cannot make its correctness a rule that ~20 call sites must remember, and the
failure is silent, member-facing, and invisible to every gate.

**Satisfy `react-hooks/exhaustive-deps` and keep one effect.** That lint rule is
what the original code was obeying, and obeying it is what shipped the bug: the
array it wants is correct for the listener and wrong for the focus call. Note
that `CueDialog` itself carries no `eslint-disable` — both narrowed effects read
everything else through refs, so the rule is satisfied and a future reader gets
no warning hinting that the arrays are deliberate. The comments are. (The two
disables in this delivery are elsewhere: `ProfilePanel.tsx` and
`AvailabilityCalendar.tsx`.)

**A source-scan guard on the dependency array.** It would pin today's spelling
rather than the property, and break on any harmless edit. The behavioural tests
fail for the real reason instead.

## Consequences

Anyone "fixing" the incomplete dependency arrays in `CueDialog` — including a
future version of the lint rule, which will suggest exactly that — reintroduces a
member-facing outage that no gate reports. The four typing tests are what stands
in the way; do not weaken them to assertions that only check the typed value.

Entry focus no longer fires when focus is already inside the shell, and two
consequences of that are worth stating exactly, because both were measured
rather than reasoned:

- **A focused element removed from inside an open dialog no longer pulls focus
  back to the close button; it lands on `body`.** That is the price of the
  edge-only deps and is accepted: Escape still works (the listener is
  document-capture), and Tab re-enters the dialog because the app root is
  `inert`. It is a behaviour change, not a new bug.
- **The nested case did NOT change**, contrary to what is easy to assume. A
  child dialog's unmount drops focus to `body`, so `contains` is false and entry
  focus re-fires on the `top` flip — the provider's own restore lands one frame
  later and wins, exactly as before.
