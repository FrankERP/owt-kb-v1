# Review log — serve the theme gallery without a session

**Artifact:** `2026-08-12-public-theme-gallery.md`
**Risk tier:** CRITICAL — two sequential fresh `APPROVED` on byte-identical text.
**Outcome:** APPROVED at rounds 6 and 7, both on `6b75176e7a24859c`. **Rounds: 7.**

## What each round found

| Round | Verdict | The finding |
|---|---|---|
| 1 | CHANGES_REQUIRED | **The plan was arguing against a decision it did not know existed.** `themeGallery.test.ts` is a committed tripwire titled *"it is GATED, and that is the whole auth story"*, whose last assertion is that `routeMatcher.test.ts` contains no `theme-gallery` string — commented *"that entry is the signal, not the fix."* Ship item 3 tripped it by construction |
| 2 | CHANGES_REQUIRED | The parent spec's §6 guard 8 and §8.4 are **normative**, and left standing would instruct the next reader to revert this |
| 3 | CHANGES_REQUIRED | The doc sweep was hand-enumerated and short — again. Replaced with a command and a triage rule |
| 4 | CHANGES_REQUIRED | `routeMatcher.ts` and `proxy.ts` each carry a prose allow-list the sweep is **structurally blind to**, because neither says "gallery". `theme-gallery` would have been the one exclusion with no recorded reason, in the file whose job is recording them |
| 5 | CHANGES_REQUIRED | Same category, more members — the sweep needed a **second axis** for claims about the allow-list. It found `README.md:30` and `ARCHITECTURE.md:26`, which no reviewer had named |
| 6 | **APPROVED** | Ran a third independent sweep; ship table complete |
| 7 | **APPROVED** | Walked the full 33-file runtime closure; the only edge to server code is an erased `import type` |

## The lesson, which this repo has now taught three times

Rounds 2–3 were one defect, and rounds 4–5 were one defect. Both times the fix was
to replace **a list with a command** — and the second time, to add a second axis
because half the claims never used the word the first axis searched for.

The design was never in question. Every round confirmed the regex, the guard and the
inertness. Seven rounds went entirely on *documentation completeness*, in a repo
with an unusually dense web of documents asserting the gate.

## The acceptance gate found something nobody predicted

`visual-verifier`, dispatched anonymously against a production build, confirmed all
six routes serve and the negative cases hold. Then:

| Theme | Text elements | AA failures |
|---|---|---|
| light — swatches, dialog | 62 | **0** |
| light — planner | 49 | 6 |
| **dark — planner** | 49 | **36** |

**The gate's yield is three dark-mode defects that were shipping unmeasured** — not
light-mode ones:

- `text-mono-600` at **2.62:1** in dark, ×17 — every empty seat in the planner
  (`PlannerGrid.tsx:2450`). The light override was tuned; the dark value was not.
- `text-mono-500` at **4.09:1** in dark, ×13.
- `text-negative-fg/70` fails **both** themes (3.91 / 3.98) — at full alpha the role
  passes comfortably in both, so the `/70` modifier is the entire defect, on the
  smallest text in the component.

That is the strongest argument the change could have produced for itself: the
surface was worth exposing because the moment it became measurable, it produced
real defects in the theme that ships today.

The agent also discarded **two** of its own measurement passes — one that composited
all six `.brand-atmosphere` gradient layers at peak alpha simultaneously (a value
that occurs at no real pixel), and one taken at a zero-width viewport. Both
discards are in its report.
