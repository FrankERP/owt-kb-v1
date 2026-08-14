// Modal-overlay a11y guard.
//
// WHY THIS EXISTS
// ---------------
// The submit-confirmation modal in `ProposalEditor` — the last gate before a
// co-lead sends a setlist proposal — shipped as a bare styled <div>. No
// `role="dialog"`, no accessible name, no focus trap, no Escape. A screen reader
// announced nothing; Tab walked straight out of the confirmation and back into
// the song list and the very button that opened it, so a member could reorder
// the setlist, or fire submit a second time, while being asked to confirm the
// first.
//
// Two other scrim overlays got it right (`CueDialog`, `SongFormModal`), as does
// `PlannerGrid`'s full-screen view by a different route — it stacks, but is
// opaque and makes its siblings `inert`, so it draws no scrim and is not what
// this scan checks. A house pattern existed; that is why the gap survived:
// there was a house pattern and nothing that made a new overlay follow it. This
// file is that thing. Fixing the one instance without it just means the next
// overlay starts the cycle over.
//
// THE RULE. A full-bleed scrim (`inset-0` + `bg-scrim`) that is CLICKABLE is a
// dismissable backdrop, which means something is stacked over still-present page
// content. That thing must therefore carry dialog semantics AND move focus. A
// scrim with no `onClick` is decoration (an avatar's hover veil) and is ignored.
//
// WHAT THIS DOES NOT CLAIM. It is a source scan, not a render. It proves the
// file that draws a dismissable scrim also contains dialog semantics and a focus
// trap — not that they are wired to each other, that the label is meaningful, or
// that Escape is handled. It catches the systematic omission, not the local
// mistake. `useFocusTrap`'s own behaviour is tested in `useFocusTrap.test.tsx`.
//
// Two limits worth naming rather than discovering. Checks are per FILE, so a
// second, non-conformant overlay added to a file that already contains a good one
// passes on the first one's attributes. And detection is keyed to the literal
// `bg-scrim` token plus `onClick`: a scrim painted with another class, or
// dismissed via `onPointerDown`, is invisible to this scan. It catches the
// overlay someone forgets to make a dialog, not every conceivable overlay.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_DIR = path.join(REPO_ROOT, "app");

/**
 * Overlays that draw a dismissable scrim but are deliberately NOT dialogs. Each
 * entry needs a reason, because "add it to the list" is how a guard like this
 * rots into decoration.
 */
const NOT_A_DIALOG: Record<string, string> = {
  "components/BottomNav.tsx":
    "A disclosure sheet, not a modal: the panel it dims is `inert` when closed, " +
    "so its controls leave the tab order and the a11y tree without a trap. " +
    "Trapping focus in a nav sheet would be wrong, not missing.",
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * The single JSX opening tag containing `at`: back to the nearest `<`, forward
 * to the first `>` at brace depth 0. The depth check is what keeps the arrow in
 * `onClick={() => …}` from being read as the end of the tag — and what keeps the
 * scan tight enough that an avatar's hover veil is not merged with a sibling
 * button's onClick, which a fixed-width window around the match does do.
 */
function enclosingTag(source: string, at: number): string {
  const start = source.lastIndexOf("<", at);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** True when `source` draws at least one full-bleed scrim that is itself clickable. */
function hasDismissableScrim(source: string): boolean {
  for (const m of source.matchAll(/bg-scrim/g)) {
    const tag = enclosingTag(source, m.index);
    if (tag.includes("inset-0") && tag.includes("onClick")) return true;
  }
  return false;
}

const DIALOG_ROLE = /role=("|')(dialog|alertdialog)\1/;
// Either the shared hook or the primitive it is built on — `CueDialog` uses the
// primitive directly because it also traps focus for portalled satellite nodes.
const FOCUS_MANAGED = /useFocusTrap|trapTabTarget/;

describe("every dismissable overlay is a real dialog", () => {
  const overlays = tsxFiles(APP_DIR)
    .map((file) => ({ file, rel: path.relative(APP_DIR, file), source: readFileSync(file, "utf8") }))
    .filter(({ source }) => hasDismissableScrim(source));

  it("finds the overlays at all (a scan that matches nothing proves nothing)", () => {
    expect(overlays.length).toBeGreaterThanOrEqual(4);
  });

  it("declares dialog semantics and manages focus, or is an exempt non-dialog", () => {
    const violations = overlays
      .filter(({ rel }) => !(rel in NOT_A_DIALOG))
      .flatMap(({ rel, source }) => {
        const missing: string[] = [];
        if (!DIALOG_ROLE.test(source)) missing.push('role="dialog"');
        if (!/aria-modal/.test(source)) missing.push("aria-modal");
        if (!/aria-labelledby|aria-label=/.test(source)) missing.push("an accessible name");
        if (!FOCUS_MANAGED.test(source)) missing.push("focus management");
        return missing.length ? [`${rel} is missing ${missing.join(", ")}`] : [];
      });
    expect(violations).toEqual([]);
  });

  it("keeps the exemption list honest — an entry that no longer matches is dead", () => {
    const seen = new Set(overlays.map((o) => o.rel));
    const stale = Object.keys(NOT_A_DIALOG).filter((rel) => !seen.has(rel));
    expect(stale).toEqual([]);
  });
});
