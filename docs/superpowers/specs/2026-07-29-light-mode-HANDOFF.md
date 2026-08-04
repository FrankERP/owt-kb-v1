# Handoff — Light mode via role-based design tokens

**For:** a fresh agent session (Codex) picking this up cold.
**Repo:** `owt-kb-v1` · **Branch at handoff:** `fix/rail-escapes-admin-shell` @ `2f3e1f3`
**Spec:** `docs/superpowers/specs/2026-07-29-light-mode-role-tokens-design.md` (v23, 2,247 lines, committed)

---

## Paste this into Codex

> You are picking up a light-mode migration for `owt-kb-v1`, a Spanish-language Next.js 16 /
> Sanity app for a church worship team. Read
> `docs/superpowers/specs/2026-07-29-light-mode-role-tokens-design.md` in full before
> writing any code — it is long (2,247 lines) but §11 is review history you can skim; §1
> through §8 are operative.
>
> **Your task is Phase 0 only** (§4 Phase 0). Do not start Phase 1a. Phase 0 is
> verification scaffolding — it ships no user-visible change and must leave
> `npx tsc --noEmit`, `npm test`, and `npx eslint .` (0 errors) all green.
>
> Phase 0's deliverables, in order:
> 1. **The colour inventory script** — this is the first and most important deliverable.
>    Everything else in the spec is written against its output. It scans
>    `app/**/*.{tsx,ts,mjs,css}` minus `__tests__` and emits every colour decision with
>    file, utility and pairing context: bracketed hex, bare hex, raw palette classes,
>    `white`/`black`, `rgb()`/`rgba()`/`hsl()` literals, colour inside arbitrary values
>    with no `#`, `.tsx` arbitrary values referencing `var(--brand-*)`, inline styles, SVG
>    attributes, runtime colour maps, and the retired `brand-<colour>` Tailwind keys.
>    Commit its output as a snapshot keyed on **file + normalised utility + value multiset,
>    never line numbers**, guarded by a vitest sync test in `app/utils/__tests__/`.
> 2. **Regenerate §1.1, §1.6, §3.2b and §3.3 in the spec from that output.** Every
>    hand-count in this document has been wrong at least once, including at lines it
>    explicitly cited. Treat all of them as provisional until your script replaces them.
> 3. The palette-family shade analysis (§3.1a) — the role vocabulary is a **floor**, and
>    Decision 3's count is provisional until this runs.
> 4. The `redesign/explore` / `7af69d8` review (it decides the `:root` polarity that
>    Phase 1a bakes in — do not skip it as history).
> 5. The theme gallery, the second Playwright config, the `.light { color-scheme }` branch,
>    the `SECRETS.md` entry, the `ROUTES.md` row, and the Playwright-configs ADR.
>
> **Non-negotiables while you work:**
> - `CLAUDE.md` is authoritative and overrides your defaults. Read it first. Note
>   especially: never add AI/Claude attribution or `Co-Authored-By` trailers to commits;
>   conventional commits; work on a branch.
> - The done-gate is `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors**.
>   Warnings are a deliberate backlog.
> - Do not write to production Sanity. Phase 0 needs no Sanity writes at all.
> - The spec's guard assertions are **staged**. Assertions (iii) and (vi) bind at the 1a
>   merge, not Phase 0 — landing them early makes Phase 0 fail its own gate.
>
> **What the spec gets wrong, and how to treat it:** across 30 adversarial review rounds it
> enshrined three reasons that were false even though their conclusions held, and one claim
> generalised from a single file. Each was caught by a reviewer, not the author. So: when
> the spec explains *why* something is true, verify the mechanism before you rely on it.
> When it enumerates sites or counts, regenerate them. The architecture has held up; the
> arithmetic and the citations have not.
>
> Report back with the inventory's actual numbers versus the spec's, and a list of every
> §1.1/§1.6/§3.3 row your script contradicts.

---

## State at handoff

| | |
|---|---|
| Spec revision | **v23**, committed at `1097714` + `2f3e1f3` |
| Adversarial review | **30 rounds.** Round 25 was the only `APPROVED` |
| Sign-off | **Not achieved.** The bar is two fresh reviewers approving byte-identical text; rounds 26–30 each found further blockers, resetting the streak |
| Code written | **None.** No phase has started |
| Baseline (§1.0a) | 1,245 bracketed hex / 47 `.tsx` files / 249 `dark:` on this branch |
| `brand.css` | 65 `var(--brand-*)` lines, 0 hex literals — **unchanged all session**, and every guard assertion is written against it |

## What is decided

Settled by the user during grilling, and by the review rounds since:

- **Role-based tokens** as the anti-drift mechanism — components stop naming palettes, so a new panel is light-correct by construction. This is what makes the revival different from the one ADR-0008 buried.
- **Counterpart design**, not mechanical inversion. Glow has no light equivalent.
- **Two token layers** — base roles as `rgb(var(--x-rgb) / <alpha-value>)`, plus ~14 pre-multiplied composed tokens for the 169 pairs whose alpha varies per theme. Mechanics harvested from `redesign/explore`.
- **`#00bfff` is the accent**; `--brand-beam` `#12C8F4` is retired.
- **`themePref` on `teamMembers`**, server-persisted, member-only, never in `MemberForm`. Delivered by a fresh `GET /api/me`.
- **Dark stays in `:root`**, light under `.light` — deliberately inverting Cantoral's polarity, because Backstage ships unset→Dark.
- **Unset → Dark at ship**, staged to Follow System in Phase 4 after a volunteer week.
- Out of scope, documented: `/studio` internals, email templates, the manifest splash, `mobile/fallback`, raster brand assets.

## What is genuinely open

1. Per-family mapping of ~837 palette classes + `white`/`black`. `red` → `negative-*` is settled; `yellow`/`orange`/`amber` is not.
2. The mapping table itself — Phase 0's output, reviewed before any file changes.
3. **The `(admin)`/`/studio` chrome decision — blocks the 1a merge.**
4. Placement and copy of the Phase 4 Spanish announcement.

## Two things worth knowing before you commit to this

**The scope is far beyond the original ask.** The user asked to "bring light mode back". The
measured surface is ~2,310 colour decisions across six phases. §10 argues the cheap revival
away on ADR-0008 grounds and the argument is sound — but the smaller option has never been
priced next to this one. That conversation may be worth having before Phase 1a.

**The repo is moving.** `HEAD` advanced four times mid-review and a `SeatBoard` feature
landed carrying 39 new hex literals. Phase 1a is a ~2,300-site rewrite aimed at a target
under active development, and it will collide. Sequencing it against other feature work is
a scheduling decision, not a technical one.
