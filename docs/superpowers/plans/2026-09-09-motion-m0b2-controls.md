# Motion M0b-2 — Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every control in the app one primitive each — a segmented control with a sliding thumb, a sliding tab indicator, a switch, a checkbox, a select, a date field, a rolling number — plus a haptics util, migrate the 12 segmented sites, 3 tab bars, 2 switches, 5 checkboxes, 21 selects and 3 date inputs onto them, close the three overlay follow-ups M0b-1 deferred, and ship a `controls` gallery fixture.

**Architecture:** Seven primitives under `app/components/ui/` and one util under `app/utils/`. `SegmentedControl` and `SlidingIndicator` are the only new `motion` consumers (a `layoutId` thumb, which is what M0b-1 paid for `domMax` to have); `Switch` and `NumberRoll` use `m.*` with `initial={false}` so a missing feature chunk still renders the right state; `Checkbox`, `Select` and `DateField` are NEUTRAL modules (no hooks, no `motion`) that wrap the native element in tokenised chrome so every existing test that reaches the native `<input>`/`<select>` stays green. Every site migration is a swap that keeps the site's state, handlers and test-facing names.

**Tech Stack:** Next.js 16, React 19, Tailwind 3.4, `motion` 13.2 (`motion/react-m` hosts, `AnimatePresence`, `layoutId`), `@capacitor/haptics` 8, vitest + @testing-library/react (jsdom per file, `installMotionTestEnv()`), Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — Part I §4 (primitives table), §5.1–§5.8 control rows, §19.1 (bottom tab bar), §19.3 (controls table), Part IV decisions D (haptics) and M (`Select`/`DateField`/`Checkbox`, all native sites), Part VI (cap ruling R, rules inherited), Part VII (deferrals into M0b-2). Inventory the plan argues from: the M0b-2 controls reconnaissance of 2026-09-09 10:10 CST (file:line quoted where it binds).

**Scoping decision recorded here, not in the spec:** §19.3's `Select` row describes a desktop `Menu` popover with type-ahead for >8 options and a native fallback under `(pointer: coarse)`. M0b-2 ships the native half only — the tokenised `<select>` — for every one of the 21 sites. Reason: the sites are keyed by tests on the native element (`querySelector("select")`, `getByLabelText(...)` cast to `HTMLSelectElement`, `fireEvent.change`), the spec itself calls iOS's picker the better phone control, and the popover is a second code path over the same sites that belongs with the Control Room remake (§12.5), where the only >8-option selects live. Recorded in Part VIII at delivery.

## Global Constraints

- Browser floor **iOS 15 / Safari 15** (ADR-0030): no `@starting-style`, `:has()`, scroll-driven animations, `AbortSignal.timeout`, `findLast`, `structuredClone`, no `@property`.
- Only `transform` and `opacity` animate. `Collapse`'s height is the one existing exception; nothing here adds another.
- `motion/*` imports only under `app/components/ui/**`, `app/utils/motion*`, and exactly `app/(gallery)/theme-gallery/[theme]/GalleryMotion.tsx` (`motionImportBoundary.test.ts`). **A gallery fixture may not import `motion`.** Hosts come from `motion/react-m` (`import * as m from "motion/react-m"`).
- Every `m.*` element renders its `initial` values until the async feature chunk arrives: primitives that render ALREADY-SELECTED state on first paint (`Switch` knob, `SegmentedControl` thumb, `NumberRoll` current value) use `initial={false}`. No `appear`/mount-time animation above the fold.
- A Server Component may never CALL a value from a `"use client"` module (ADR-0028). `Checkbox`, `Select`, `DateField` are neutral (no `"use client"`, no hooks) and may be rendered anywhere; the rest are `"use client"` and rendered as JSX only.
- New colour in a rule body is a composed token at every `--warning-glow` touch point (`app/brand.css` `:root` + `.light`, `tailwind.config.ts` key, `eslint.config.mjs` alternation, `tokenLayer.test.ts` `COMPOSED`, `brandCss.test.ts` count 96→97); never bump the `tokenLayer` rule-body pin (69). **Nothing in this plan needs a new token** — every primitive uses existing utilities (`bg-accent/15`, `bg-surface-accent-solid`, `text-on-fill`, `border-surface-accent-30`, `bg-surface-raised-alt`). A task that finds it needs one stops and reports.
- Every new non-test file under `app/**` and every `brand.css` edit regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` in the same commit: `node scripts/colour-inventory.mjs`.
- `rawMotionLiterals.test.ts` pins `transition-all` 13 / `duration-N` 12 outside `ui/` with equality. Task 3 removes two `duration-150` sites: lower `rawDuration` to 10 in that commit. Any task that removes another lowers the pin in the same commit; never raise.
- `labelBudget.test.ts` pins six strings (`>Cue<` 0, `>Servicio<` 1, `Índice musical` 1, `títulos` 1, `Backstage operations` 1, `Acceso autorizado` 1). The gallery fixture must not use any of them.
- `themeGallery.test.ts` pins four fixtures and their hermetic rules (no `useSession`/`next-auth`/`fetch(`/Sanity/`process.env`/`next/headers`/`"use server"`). Task 13 raises it to five and adds `ControlsFixture` to the hermetic list.
- `cueDialogMount.test.ts` baseline 11 and `dialogSemantics.test.ts` floor 2 are untouched by this plan.
- Accessible names and roles that tests key on are contracts: `role="switch"` + `aria-checked` + `aria-label` on both switches; `getByLabelText("Omitir <date>")`, `getByRole("checkbox", { name: "Ana" })`, `getByLabelText("Sección"|"Primer servicio"|"Segundo servicio"|"Fecha del servicio especial")` cast to `HTMLSelectElement`; `container.querySelector("select")` reaching `MonthGenerator`'s Mes select first; `aria-current="page"` on the admin tab. Segmented sites CHANGE role from `button`/`aria-pressed` to `radio`/`aria-checked`; the four tests that key on the old role are updated in the same task (listed per task).
- Haptics: `haptic()` is best-effort, fire-and-forget (`void haptic("light")`), a no-op on web and in tests; never awaited in a handler's critical path.
- Conventional commits; no AI attribution or `Co-Authored-By`. Gates before done: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). Two vitest files flake under the full parallel run (issue #51: `MonthGenerator.create.test.tsx`, `proposalUnsavedGuard.test.tsx`) — rerun in isolation, never loosen.
- Bundle: first-load cap **+25 kB gz** over the pre-M0a baseline (`/` 77.3 kB, `/admin` 301.7 kB) and the async feature chunk **≤ 40 kB gz** (ruling R). Task 13 measures with the method `docs/MOTION.md` §Bundle records and adds the row.
- Docs travel with the code: `docs/MOTION.md` primitives table, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` AND `AGENTS.md` (byte-identical hunks — `agentDocsParity.test.ts`), `docs/MOBILE.md` (haptics), spec Part VIII at delivery.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `app/utils/haptics.ts` + `__tests__/haptics.test.ts`; `package.json`; `ios/App/CapApp-SPM/Package.swift`; `docs/MOBILE.md` | `haptic(kind)` util, plugin install, native sync, docs | 1 |
| `app/components/ui/SegmentedControl.tsx` + test | radiogroup with roving arrows and a `layoutId` thumb | 2 |
| `ThemeControl.tsx`, `TextSizeControl.tsx`, `CalendarView.tsx`, `AuthorSearchList.tsx`, `TagSearchList.tsx`; `rawMotionLiterals.test.ts` | five member-facing segmented sites | 3 |
| `admin/AdminPanel.tsx` (Tipo/Rol, A→Z, `MinistryScopeBar`), `admin/ProposalsPanel.tsx`, `ChordChart.tsx`, `admin/ParticipationSidebar.tsx` + four tests | six admin/song segmented sites | 4 |
| `app/components/ui/SlidingIndicator.tsx` + test; `admin/AdminPanel.tsx` `TabBar`, `SectionNav.tsx`, `BottomNav.tsx` | sliding indicator, active-into-view, three tab bars | 5 |
| `app/components/ui/Switch.tsx` + test; `ui/EmailPrefToggles.tsx`, `ChordChart.tsx` | spring knob switch | 6 |
| `app/components/ui/Checkbox.tsx` + test; `admin/PlannerGrid.tsx`, `admin/AdminPanel.tsx`, `admin/MonthGenerator.tsx` ×3 | drawn checkbox over a native input | 7 |
| `app/components/ui/Select.tsx` + test; `AvailabilityCalendar.tsx` ×2, `admin/AdminPanel.tsx` ×2, `admin/MonthCalendar.tsx`, `kids/KidsAvailabilityPanel.tsx`, `kids/PairRoster.tsx` ×3 | tokenised native select, nine sites | 8 |
| `admin/MonthGenerator.tsx` ×13 | the generator's selects | 9 |
| `app/components/ui/DateField.tsx` + test; `CalendarView.tsx`, `admin/PlannerGrid.tsx`, `admin/MonthGenerator.tsx` | tokenised date/month input with month steppers | 10 |
| `app/components/ui/NumberRoll.tsx` + test; `NextServiceHero.tsx`, `admin/ServiceReadinessCard.tsx`, `admin/ParticipationSidebar.tsx`, `ChordChart.tsx` | digit crossfade | 11 |
| `ui/CueDialog.tsx`, `ui/Menu.tsx`, `ui/Toast.tsx` + tests | Menu Escape inside a dialog; persistent live region; sheet variant fixed at open | 12 |
| `app/(gallery)/theme-gallery/[theme]/[fixture]/{page.tsx,fixtures/ControlsFixture.tsx}`; `themeGallery.test.ts`; `docs/MOTION.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md`, `AGENTS.md` | `controls` fixture, docs, bundle row | 13 |
| `preview`, PR, spec Part VIII | delivery | 14 |

---

### Task 1: `haptics` util and the native plugin

**Files:**
- Create: `app/utils/haptics.ts`, `app/utils/__tests__/haptics.test.ts`
- Modify: `package.json` (dependency), `ios/App/CapApp-SPM/Package.swift` (regenerated by `npx cap sync`), `docs/MOBILE.md`

**Interfaces:**
- Consumes: `isNativeApp()` from `app/utils/native.ts`.
- Produces: `haptic(kind?: HapticKind): Promise<void>` with `HapticKind = "light" | "medium" | "selection"`; default `"light"`. Later tasks call `void haptic("light")` on a toggle flip / thumb move and `void haptic("selection")` on a tab press.

- [ ] **Step 1: Install the plugin and sync iOS**

```bash
npm install @capacitor/haptics@^8
npx cap sync ios
git status --short ios/
```

Expected: `package.json` and `package-lock.json` change; `ios/App/CapApp-SPM/Package.swift` gains a `CapacitorHaptics` package line beside `CapacitorTextZoom`. If `npx cap sync ios` fails on this machine, stop and report the error verbatim — do not hand-edit `Package.swift` (its header says the CLI manages it).

- [ ] **Step 2: Write the failing test**

`app/utils/__tests__/haptics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const impact = vi.fn(async () => {});
const selectionChanged = vi.fn(async () => {});
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact, selectionChanged },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM" },
}));
const isNativeApp = vi.fn(() => false);
vi.mock("../native", () => ({ isNativeApp: () => isNativeApp() }));

describe("haptic()", () => {
  beforeEach(() => { impact.mockClear(); selectionChanged.mockClear(); isNativeApp.mockReturnValue(false); });

  it("is a no-op on the web — the plugin module is never touched", async () => {
    const { haptic } = await import("../haptics");
    await haptic("light");
    expect(impact).not.toHaveBeenCalled();
  });

  it("fires a light impact on native by default", async () => {
    isNativeApp.mockReturnValue(true);
    const { haptic } = await import("../haptics");
    await haptic();
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("maps selection to selectionChanged and medium to a medium impact", async () => {
    isNativeApp.mockReturnValue(true);
    const { haptic } = await import("../haptics");
    await haptic("selection");
    await haptic("medium");
    expect(selectionChanged).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith({ style: "MEDIUM" });
  });

  it("swallows a plugin failure — a haptic never breaks the handler that asked for it", async () => {
    isNativeApp.mockReturnValue(true);
    impact.mockRejectedValueOnce(new Error("no engine"));
    const { haptic } = await import("../haptics");
    await expect(haptic("light")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run app/utils/__tests__/haptics.test.ts`
Expected: FAIL — cannot resolve `../haptics`.

- [ ] **Step 4: Write the util**

`app/utils/haptics.ts`:

```ts
// Haptic feedback (spec decision D). Native only: on the web and under jsdom
// `isNativeApp()` is false and the plugin module is never imported, so the web
// bundle carries none of it. Best effort — a handler that asks for a tap must
// never wait on it or fail because of it. Call as `void haptic("light")`.
import { isNativeApp } from "./native";

export type HapticKind = "light" | "medium" | "selection";

let pluginPromise: Promise<typeof import("@capacitor/haptics")> | null = null;

export async function haptic(kind: HapticKind = "light"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    pluginPromise ??= import("@capacitor/haptics");
    const { Haptics, ImpactStyle } = await pluginPromise;
    if (kind === "selection") await Haptics.selectionChanged();
    else await Haptics.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    // A device without an engine, or the plugin missing from a stale native
    // build — either way the interaction already happened. Nothing to do.
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run app/utils/__tests__/haptics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Document the plugin**

In `docs/MOBILE.md`, replace the Phase 1 status line `Remaining local setup: CocoaPods (iOS) and JDK 17 + Android Studio (Android).` with `Remaining local setup: Xcode (iOS plugins resolve through Swift Package Manager — there is no Podfile) and JDK 17 + Android Studio (Android).` and add, before `## Notes`:

```markdown
## Native plugins in use

| Plugin | Used by | Web behaviour |
|---|---|---|
| `@capacitor/text-zoom` | `app/utils/textZoom.ts` | falls back to a CSS scale |
| `@capgo/capacitor-social-login` | `app/utils/native.ts` | not loaded |
| `@capacitor/haptics` | `app/utils/haptics.ts` — `haptic("light")` on a toggle flip or a segmented thumb move, `haptic("selection")` on a tab press (spec decision D) | no-op: `isNativeApp()` is false, the module is never imported |

### Adding a plugin

1. `npm install <plugin>` — the dependency goes in `package.json` like any other.
2. `npx cap sync ios` — regenerates `ios/App/CapApp-SPM/Package.swift` (managed by the
   CLI, never hand-edited) so Xcode resolves the plugin's Swift package from
   `node_modules`. Commit the regenerated file: `ios/` is committed on purpose.
3. Import the plugin LAZILY behind `isNativeApp()` (`app/utils/native.ts` is the
   pattern) so the web bundle and SSR never see it.
4. A new native plugin means a new iOS build before the team's installed app has it;
   until then the util must degrade silently — `haptic()` swallows the failure.
```

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/utils/haptics.ts app/utils/__tests__/haptics.test.ts && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/haptics.test.ts`
Expected: clean, all pass.

```bash
git add package.json package-lock.json ios/App/CapApp-SPM/Package.swift app/utils/haptics.ts app/utils/__tests__/haptics.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json docs/MOBILE.md
git commit -m "feat(motion): haptic() util behind @capacitor/haptics, no-op on web

Spec decision D. The plugin loads lazily behind isNativeApp() so the web bundle
never sees it; failures are swallowed because the tap already happened. iOS
Package.swift regenerated by cap sync; MOBILE.md gains the plugin table and the
add-a-plugin steps (SwiftPM, not CocoaPods)."
```

---

### Task 2: `SegmentedControl`

**Files:**
- Create: `app/components/ui/SegmentedControl.tsx`, `app/components/ui/__tests__/SegmentedControl.test.tsx`

**Interfaces:**
- Consumes: `motion/react-m` (`m.span`), `SPRINGS.settle` from `app/utils/motionPresets.ts`, `haptic` from Task 1.
- Produces:

```ts
export type SegmentedOption<V extends string> = {
  value: V;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text (e.g. "D · versión 1 de 2"). */
  ariaLabel?: string;
  /** A count badge drawn at the option's corner (Propuestas → Pendientes). */
  badge?: number;
  /** aria-busy on that option while a write is in flight (ThemeControl). */
  busy?: boolean;
};
export type SegmentedControlProps<V extends string> = {
  /** Accessible name of the group. Pass exactly one of `label` / `labelledBy`. */
  label?: string;
  labelledBy?: string;
  /** `null` = nothing selected yet (ThemeControl before the projection lands). */
  value: V | null;
  onChange: (value: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  size?: "sm" | "md";
  /** `outline`: tinted thumb, bordered pills (default). `filled`: solid accent thumb, joined bar. */
  tone?: "outline" | "filled";
  /** Additive utilities on the group element only. */
  className?: string;
};
export default function SegmentedControl<V extends string>(props: SegmentedControlProps<V>): JSX.Element;
```

Semantics: `role="radiogroup"`; each option is `<button type="button" role="radio" aria-checked>`; the checked option is the only tab stop (`tabIndex={0}`, others `-1`); ArrowRight/ArrowDown select the next (wrapping), ArrowLeft/ArrowUp the previous, Home/End the ends — selection follows focus, as native radios do. The thumb is one `m.span` with a shared `layoutId` rendered inside whichever option is checked, so it slides between them under `domMax`'s layout projection; under reduced motion `MotionConfig reducedMotion="user"` (already in `MotionProvider`) makes it jump.

- [ ] **Step 1: Write the failing test**

`app/components/ui/__tests__/SegmentedControl.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MotionProvider from "../MotionProvider";
import SegmentedControl from "../SegmentedControl";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

const OPTIONS = [
  { value: "calendar", label: "Calendario" },
  { value: "list", label: "Lista" },
  { value: "agenda", label: "Agenda" },
] as const;

function mount(value: "calendar" | "list" | "agenda" | null, onChange = vi.fn()) {
  render(
    <MotionProvider>
      <SegmentedControl label="Vista" value={value} onChange={onChange} options={OPTIONS} />
    </MotionProvider>,
  );
  return onChange;
}

describe("SegmentedControl", () => {
  it("is a radiogroup whose checked option is the only tab stop", () => {
    mount("list");
    const group = screen.getByRole("radiogroup", { name: "Vista" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects on click and reports the value", () => {
    const onChange = mount("calendar");
    fireEvent.click(screen.getByRole("radio", { name: "Lista" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("arrows move the selection with wrap; Home/End jump; focus follows", () => {
    const onChange = mount("agenda");
    const last = screen.getByRole("radio", { name: "Agenda" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("calendar");
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("list");
    fireEvent.keyDown(last, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("calendar");
    fireEvent.keyDown(last, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("agenda");
  });

  it("renders no thumb and no tab stop when nothing is selected yet", () => {
    mount(null);
    expect(document.querySelector("[data-segmented-thumb]")).toBeNull();
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("draws the thumb inside the checked option only", () => {
    mount("list");
    const thumbs = document.querySelectorAll("[data-segmented-thumb]");
    expect(thumbs).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Lista" }).contains(thumbs[0])).toBe(true);
  });

  it("uses ariaLabel, badge and busy per option", () => {
    render(
      <MotionProvider>
        <SegmentedControl
          label="Filtro"
          value="pending"
          onChange={() => {}}
          options={[
            { value: "all", label: "Todas" },
            { value: "pending", label: "Pendientes", badge: 3, busy: true },
          ]}
        />
      </MotionProvider>,
    );
    const pending = screen.getByRole("radio", { name: /Pendientes/ });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.textContent).toContain("3");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/ui/__tests__/SegmentedControl.test.tsx`
Expected: FAIL — cannot resolve `../SegmentedControl`.

- [ ] **Step 3: Write the primitive**

`app/components/ui/SegmentedControl.tsx`:

```tsx
"use client";

// The ONE segmented control (spec §4, §19.3): CALENDARIO / LISTA, POPULAR / A–Z,
// TIPO / ROL, A→Z / Z→A, theme, text size, proposal filters, chart tabs. Radio
// semantics — one of these, not N toggles — with the thumb as a single
// `layoutId` element that slides to whichever option is checked. That is the
// layout projection M0b-1 switched the feature chunk to `domMax` for.
//
// `value: null` is a real state (ThemeControl before the projection lands): no
// thumb, and the FIRST option is the tab stop so the keyboard can still enter.

import { useId, type KeyboardEvent } from "react";
import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";
import { haptic } from "@/app/utils/haptics";

export type SegmentedOption<V extends string> = {
  value: V;
  label: React.ReactNode;
  ariaLabel?: string;
  badge?: number;
  busy?: boolean;
};

export type SegmentedControlProps<V extends string> = {
  label?: string;
  labelledBy?: string;
  value: V | null;
  onChange: (value: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  size?: "sm" | "md";
  tone?: "outline" | "filled";
  className?: string;
};

const SIZE = {
  sm: "px-3 py-1.5 text-[11px]",
  md: "px-4 py-2 text-xs",
} as const;

const GROUP = {
  outline: "flex flex-wrap gap-2",
  filled: "inline-flex overflow-hidden rounded-lg border border-surface-accent-30",
} as const;

const OPTION = {
  outline: "rounded-full border border-surface-accent-l25-d20 text-mono-500 hover:border-accent/50 hover:text-accent aria-checked:border-accent aria-checked:text-accent",
  filled: "text-mono-500 hover:text-ink-muted aria-checked:text-on-fill border-l border-surface-accent-30 first:border-l-0",
} as const;

const THUMB = {
  outline: "rounded-full bg-accent/10",
  filled: "bg-surface-accent-solid",
} as const;

export default function SegmentedControl<V extends string>({
  label,
  labelledBy,
  value,
  onChange,
  options,
  size = "md",
  tone = "outline",
  className = "",
}: SegmentedControlProps<V>) {
  const layoutId = useId();
  const index = options.findIndex((o) => o.value === value);

  const select = (next: number) => {
    const opt = options[(next + options.length) % options.length];
    if (!opt || opt.value === value) return;
    void haptic("light");
    onChange(opt.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const from = index >= 0 ? index : i;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = from + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = from - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(next);
    // Selection follows focus, as native radios do; the radio we move to is the
    // one that becomes the tab stop on the next render.
    const target = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[
      (next + options.length) % options.length
    ];
    target?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`${GROUP[tone]} ${className}`.trim()}
    >
      {options.map((o, i) => {
        const checked = i === index;
        // With nothing selected the first option carries the tab stop.
        const tabStop = index >= 0 ? checked : i === 0;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            aria-busy={o.busy || undefined}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative select-none font-label uppercase tracking-widest transition-colors duration-fast ease-out-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base ${SIZE[size]} ${OPTION[tone]} ${o.busy ? "opacity-60" : ""}`}
          >
            {checked && (
              <m.span
                data-segmented-thumb=""
                aria-hidden
                layoutId={layoutId}
                initial={false}
                transition={SPRINGS.settle}
                className={`absolute inset-0 -z-10 ${THUMB[tone]}`}
              />
            )}
            <span className="relative">{o.label}</span>
            {o.busy && <span className="sr-only"> — guardando</span>}
            {typeof o.badge === "number" && o.badge > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-recency-fg text-[10px] font-bold text-scrim">
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

Note the `-z-10` thumb needs the button to establish stacking: `relative` is on the button, and the label span is `relative` so it paints above the thumb. Verify in the gallery fixture (Task 13) that the label is legible in both tones.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run app/components/ui/__tests__/SegmentedControl.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Guards, inventory, commit**

Run: `npx tsc --noEmit && npx eslint app/components/ui/SegmentedControl.tsx app/components/ui/__tests__/SegmentedControl.test.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/motionImportBoundary.test.ts`
Expected: clean.

```bash
git add app/components/ui/SegmentedControl.tsx app/components/ui/__tests__/SegmentedControl.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): SegmentedControl — one radiogroup with a sliding layoutId thumb

Spec §4/§19.3. Arrow keys move the selection with wrap and focus follows, the
checked option is the only tab stop, and null means nothing chosen yet. The
thumb is one m.span with a shared layoutId, so domMax slides it between
options; reduced motion makes it jump."
```

---

### Task 3: Segmented sites A — theme, text size, calendar view, library sort

**Files:**
- Modify: `app/components/ui/ThemeControl.tsx:89-123`, `app/components/TextSizeControl.tsx:28-47`, `app/components/CalendarView.tsx:163-188`, `app/components/AuthorSearchList.tsx:43-51`, `app/components/TagSearchList.tsx:107-123`, `app/utils/__tests__/rawMotionLiterals.test.ts:13`

**Interfaces:**
- Consumes: `SegmentedControl` from Task 2. Each site keeps its state variable, setter and side effects exactly as they are.

- [ ] **Step 1: ThemeControl**

Replace the `<div role="radiogroup" …>…</div>` block (the `OPTIONS.map` of buttons) with:

```tsx
      {/* A radiogroup, not three toggles — SegmentedControl owns the semantics.
          `loaded` still gates everything: before the projection lands nothing is
          selected (`value={null}`). "Not known yet" is not "follows the system". */}
      <SegmentedControl
        labelledBy="tema-h"
        value={loaded ? (pref ?? "system") : null}
        onChange={(v) => void choose(v)}
        options={OPTIONS.map((o) => ({ value: o.value, label: o.label, busy: saving === o.value }))}
      />
```

Add `import SegmentedControl from "@/app/components/ui/SegmentedControl";`. Keep the guard in `choose()` (a second tap while saving is ignored) — the primitive already ignores a tap on the checked option.

- [ ] **Step 2: TextSizeControl**

Replace the `<div className="flex flex-wrap gap-2">…</div>` block with:

```tsx
      <SegmentedControl
        label="Tamaño de texto"
        value={mode}
        onChange={choose}
        options={PRESETS.map((p) => ({ value: p.mode, label: p.label }))}
      />
```

Add the import. `TextScaleMode` is a string union, so `V` infers.

- [ ] **Step 3: CalendarView view toggle**

Replace the `{/* View toggle */}` block's inner `<div className="flex rounded-lg border …">…</div>` with:

```tsx
        <SegmentedControl
          label="Vista"
          tone="filled"
          value={view}
          onChange={setView}
          options={[
            { value: "calendar", label: "Calendario" },
            { value: "list", label: "Lista" },
          ]}
        />
```

Keep the outer `<div className="flex justify-center mb-8">`. Add the import.

- [ ] **Step 4: AuthorSearchList and TagSearchList**

In both, replace the `<div className="flex rounded-lg border …">` / `<div className="brand-search-console flex overflow-hidden">` sort block (the `(["popular", "alpha"] as SortMode[]).map(...)`) with:

```tsx
          <SegmentedControl
            label="Ordenar"
            size="sm"
            tone="filled"
            value={sort}
            onChange={setSort}
            options={[
              { value: "popular", label: "Popular" },
              { value: "alpha", label: "A–Z" },
            ]}
          />
```

Add the import in both. These two blocks carried the only `duration-150` literals this task removes.

- [ ] **Step 5: Lower the raw-motion pin**

In `app/utils/__tests__/rawMotionLiterals.test.ts` change `const BASELINE = { transitionAll: 13, rawDuration: 12 };` to `rawDuration: 10` and extend the comment: `// Audited 2026-09-08 after M0a Task 8; rawDuration 12→10 on 2026-09-09 (M0b-2 Task 3: the Popular/A–Z pills became SegmentedControl). LOWER freely; never raise.`

Run: `npx vitest run app/utils/__tests__/rawMotionLiterals.test.ts`
Expected: PASS. If it reports a different count, the count is the truth: set the pin to what it reports and say so in the commit body.

- [ ] **Step 6: Run the tests that touch these sites**

Run: `npx vitest run app/utils/__tests__/themeBootstrapBehaviour.test.tsx app/utils/__tests__/themePrefModule.test.ts "app/(client)/me" app/components/__tests__`
Expected: PASS. `themePrefModule.test.ts` reads `ThemeControl.tsx` as text — if it asserts on a string the migration removed (e.g. `role="radio"`), update that assertion to the new source (`SegmentedControl`) and say so in the commit body; the behaviour it protects (no write on mount) is untouched.

- [ ] **Step 7: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/components/ui/ThemeControl.tsx app/components/TextSizeControl.tsx app/components/CalendarView.tsx app/components/AuthorSearchList.tsx app/components/TagSearchList.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts`

```bash
git add -A app/components/ui/ThemeControl.tsx app/components/TextSizeControl.tsx app/components/CalendarView.tsx app/components/AuthorSearchList.tsx app/components/TagSearchList.tsx app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): theme, text size, calendar view and library sort are SegmentedControls

Five sites, three of them aria-pressed toggles pretending to be radios. State,
setters and side effects are untouched; ThemeControl keeps value=null until the
projection lands. rawDuration pin 12→10 (the two duration-150 pills are gone)."
```

---

### Task 4: Segmented sites B — admin filters, proposals, chart tabs, participation view

**Files:**
- Modify: `app/components/admin/AdminPanel.tsx:126-158` (`MinistryScopeBar`), `:1067-1081` (Tipo/Rol), `:1104-1118` (A→Z/Z→A); `app/components/admin/ProposalsPanel.tsx:658-688`; `app/components/ChordChart.tsx:142-161`; `app/components/admin/ParticipationSidebar.tsx:68-73`
- Tests: `app/components/admin/__tests__/memberListMinistryScope.test.tsx:51-60`, `app/components/admin/__tests__/proposalsPanelHandoff.test.tsx:78,139`, `app/components/__tests__/ChordChart.accessibility.test.tsx:9-27`, `app/components/admin/__tests__/participationAlongside.test.tsx:636-642`

**Interfaces:**
- Consumes: `SegmentedControl`. Roles change from `button`+`aria-pressed` to `radio`+`aria-checked` at every site; the four tests above are updated in this task.

- [ ] **Step 1: Update the four tests first (they must fail, then pass)**

`memberListMinistryScope.test.tsx`: change `const scopeButton = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });` to `screen.getByRole("radio", …)` and every `getAttribute("aria-pressed")` on it to `"aria-checked"`.

`proposalsPanelHandoff.test.tsx`: change `const tab = (label: string) => screen.getByRole("button", { name: label });` to `getByRole("radio", { name: new RegExp(`^${label}`) })` (the Pendientes radio's name now includes its badge count).

`ChordChart.accessibility.test.tsx` first case: `getByRole("radio", { name: "D · versión 1 de 2" })` and `"aria-checked"` in all four assertions.

`participationAlongside.test.tsx:636-642`: replace `const select = rail.querySelector("select") as HTMLSelectElement;` with `const select = rail.querySelector('[role="radiogroup"]') as HTMLElement;` (the following `expect(header.contains(select))` stays true). Keep the variable name so the diff is one line.

Run: `npx vitest run app/components/admin/__tests__/memberListMinistryScope.test.tsx app/components/admin/__tests__/proposalsPanelHandoff.test.tsx app/components/__tests__/ChordChart.accessibility.test.tsx app/components/admin/__tests__/participationAlongside.test.tsx`
Expected: FAIL on the role queries.

- [ ] **Step 2: MinistryScopeBar**

Replace the returned `<div className="brand-search-console …">…</div>` with:

```tsx
  return (
    <SegmentedControl
      label="Ministerio"
      tone="filled"
      className="brand-search-console self-start"
      value={value}
      onChange={onChange}
      options={MINISTRY_SCOPES.map((s) => ({
        value: s,
        label: (
          <>
            {MINISTRY_SCOPE_LABEL(s)}
            <span className="ml-1.5 opacity-60">{s === "all" ? total : counts[s]}</span>
          </>
        ),
      }))}
    />
  );
```

- [ ] **Step 3: Tipo/Rol and A→Z/Z→A**

Replace the `{/* Filter by: type | role */}` block with:

```tsx
          <SegmentedControl
            label="Filtrar por"
            tone="filled"
            className="brand-search-console shrink-0"
            value={filterKey}
            onChange={(k) => { setFilterKey(k); setFilterValue(""); }}
            options={[
              { value: "type", label: "Tipo" },
              { value: "role", label: "Rol" },
            ]}
          />
```

and the `{/* Sort direction */}` block with:

```tsx
          <SegmentedControl
            label="Orden"
            tone="filled"
            className="brand-search-console shrink-0"
            value={sortDir}
            onChange={setSortDir}
            options={[
              { value: "asc", label: "A→Z" },
              { value: "desc", label: "Z→A" },
            ]}
          />
```

Add one import at the top of `AdminPanel.tsx`.

- [ ] **Step 4: ProposalsPanel filter**

Replace the `{/* Filter tabs */}` `<div className="flex flex-wrap gap-1 p-1 …">…</div>` with:

```tsx
      <SegmentedControl
        label="Filtrar propuestas"
        tone="filled"
        className="w-fit"
        value={filter}
        onChange={(id) => {
          // A manual filter change is the user taking over: drop the handoff
          // highlight/notice so nothing stale stays on screen.
          setFilter(id);
          setHighlightIds([]);
          setConflictKey(null);
          setHandoffNotice(null);
          scrollTargetRef.current = null;
        }}
        options={FILTER_TABS.map(({ id, label }) => ({
          value: id,
          label,
          badge: id === "pending" ? pendingCount : undefined,
        }))}
      />
```

The old `absolute -top-1 -right-1 … bg-recency-fg` badge span is deleted — the primitive draws it.

- [ ] **Step 5: ChordChart chart tabs**

Replace the `{/* Chart tabs */}` inner `<div className="flex flex-wrap gap-2">…</div>` with:

```tsx
        <SegmentedControl
          label="Versión"
          value={String(activeIdx)}
          onChange={(v) => handleTabChange(Number(v))}
          options={charts.map((c, i) => ({
            value: String(i),
            label: c.key || `Tonalidad ${i + 1}`,
            ariaLabel: `${c.key || `Tonalidad ${i + 1}`} · versión ${i + 1} de ${charts.length}`,
          }))}
        />
```

(`V` must be a string union; the index is stringified at the boundary.)

- [ ] **Step 6: ParticipationSidebar view**

Replace the `<select value={view} …>…</select>` with:

```tsx
        <SegmentedControl
          label="Ver participaciones por"
          size="sm"
          tone="filled"
          className="mt-2"
          value={view}
          onChange={setView}
          options={[
            { value: "voces", label: "Voces" },
            { value: "instrumentos", label: "Instrumentos" },
          ]}
        />
```

The `min-h-[44px]` touch-target comment above it stays true for the radios on a phone only at `size="md"`; keep `size="sm"` (the rail is narrow) and note in the comment that the 44 px target returns with the Control Room remake's rail.

- [ ] **Step 7: Tests, guards, commit**

Run: `npx vitest run app/components/admin app/components/__tests__/ChordChart.accessibility.test.tsx app/utils/__tests__/rawMotionLiterals.test.ts`
Expected: PASS (rerun `MonthGenerator.create.test.tsx` alone if it flakes — issue #51). If `rawMotionLiterals` reports a lower count (this task removes `transition-colors`, which is not counted; a `transition-all` would be), lower the pin and say so.

Run: `npx tsc --noEmit && npx eslint app/components/admin/AdminPanel.tsx app/components/admin/ProposalsPanel.tsx app/components/ChordChart.tsx app/components/admin/ParticipationSidebar.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts`

```bash
git add -A app/components/admin/AdminPanel.tsx app/components/admin/ProposalsPanel.tsx app/components/ChordChart.tsx app/components/admin/ParticipationSidebar.tsx app/components/admin/__tests__ app/components/__tests__/ChordChart.accessibility.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): admin filters, proposal tabs, chart versions and the participation view are SegmentedControls

Six sites; four of them had no accessible state at all. Roles move from
button/aria-pressed to radio/aria-checked, and the four tests that keyed on the
old role follow. The participation rail's <select> becomes a two-option
segmented control, which is what it was."
```

---

### Task 5: `SlidingIndicator` and the three tab bars

**Files:**
- Create: `app/components/ui/SlidingIndicator.tsx`, `app/components/ui/__tests__/SlidingIndicator.test.tsx`
- Modify: `app/components/admin/AdminPanel.tsx:570-597` (`TabBar`), `app/components/SectionNav.tsx`, `app/components/BottomNav.tsx:99-119`

**Interfaces:**
- Consumes: `m.span`, `SPRINGS.settle`, `haptic`.
- Produces:

```ts
/** One shared-layoutId element; render it inside the ACTIVE item only. */
export default function SlidingIndicator(props: { id: string; variant?: "pill" | "underline" | "dot"; className?: string }): JSX.Element;
/** Ref callback: scrolls the node into view (inline centre) whenever `active` is true. */
export function useActiveIntoView(active: boolean): (node: HTMLElement | null) => void;
```

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MotionProvider from "../MotionProvider";
import SlidingIndicator, { useActiveIntoView } from "../SlidingIndicator";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

function Bar({ active }: { active: "a" | "b" }) {
  return (
    <MotionProvider>
      <div>
        {(["a", "b"] as const).map((id) => (
          <Item key={id} id={id} active={active === id} />
        ))}
      </div>
    </MotionProvider>
  );
}
function Item({ id, active }: { id: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <button ref={ref} type="button" data-item={id} className="relative">
      {id}
      {active && <SlidingIndicator id="bar" />}
    </button>
  );
}

describe("SlidingIndicator", () => {
  it("renders exactly one indicator, inside the active item, aria-hidden", () => {
    const { rerender } = render(<Bar active="a" />);
    let ind = document.querySelectorAll("[data-sliding-indicator]");
    expect(ind).toHaveLength(1);
    expect(document.querySelector('[data-item="a"]')?.contains(ind[0])).toBe(true);
    expect(ind[0].getAttribute("aria-hidden")).toBe("true");
    rerender(<Bar active="b" />);
    ind = document.querySelectorAll("[data-sliding-indicator]");
    expect(ind).toHaveLength(1);
    expect(document.querySelector('[data-item="b"]')?.contains(ind[0])).toBe(true);
  });

  it("scrolls the newly active item into view, inline centre", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(<Bar active="a" />);
    rerender(<Bar active="b" />);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ inline: "center", block: "nearest" }));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/ui/__tests__/SlidingIndicator.test.tsx`
Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the primitive**

```tsx
"use client";

// The sliding active marker for tab bars (spec §4 `Tabs`, §19.1, §19.3): the
// admin TabBar, the song page's SectionNav, the phone's BottomNav. Render ONE
// inside the active item; the shared layoutId makes domMax slide it there.
// Semantics stay on the items (aria-current) — the indicator is decoration.

import { useCallback, useEffect, useRef } from "react";
import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";

const VARIANT = {
  pill: "absolute inset-0 -z-10 rounded-lg bg-accent/15 shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.15)]",
  underline: "absolute inset-x-0 bottom-0 h-0.5 bg-accent",
  dot: "absolute left-1/2 top-1 h-1 w-6 -translate-x-1/2 rounded-full bg-accent",
} as const;

export default function SlidingIndicator({
  id,
  variant = "pill",
  className = "",
}: {
  id: string;
  variant?: keyof typeof VARIANT;
  className?: string;
}) {
  return (
    <m.span
      data-sliding-indicator=""
      aria-hidden
      layoutId={id}
      initial={false}
      transition={SPRINGS.settle}
      className={`${VARIANT[variant]} ${className}`.trim()}
    />
  );
}

/**
 * Ref callback for a tab-bar item: when it becomes active it scrolls itself to
 * the centre of a horizontally scrolling bar. `behavior` honours reduced motion.
 */
export function useActiveIntoView(active: boolean): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !nodeRef.current) return;
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nodeRef.current.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [active]);
  return useCallback((node: HTMLElement | null) => { nodeRef.current = node; }, []);
}
```

- [ ] **Step 4: Run the test to see it pass**

Expected: PASS, 2 tests.

- [ ] **Step 5: Admin TabBar**

In `AdminPanel.tsx` `TabBar`, extract the item so it can use the hook, and put the indicator inside the active button:

```tsx
function TabItem({ id, label, active, onChange }: { id: Tab; label: string; active: boolean; onChange: (t: Tab) => void }) {
  const ref = useActiveIntoView(active);
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => { void haptic("selection"); onChange(id); }}
      className={`relative font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
        active ? "text-accent" : "text-ink-dim hover:bg-accent/[0.04] hover:text-ink"
      }`}
    >
      {active && <SlidingIndicator id="admin-tabs" />}
      <span className="relative">{label}</span>
    </button>
  );
}

function TabBar({ active, onChange, role }: { active: Tab; onChange: (t: Tab) => void; role: OWTRole }) {
  const visible = visibleAdminTabs(role);
  return (
    <div className="relative">
      <div className="overflow-x-auto -mx-2 px-2 pb-1">
        <div className="brand-admin-tabs flex min-w-full w-max gap-1 rounded-xl p-1.5">
          {visible.map(({ id, label }) => (
            <TabItem key={id} id={id} label={label} active={active === id} onChange={onChange} />
          ))}
        </div>
      </div>
      {/* Scroll-fade hint (mobile, where tabs overflow) */}
      <div className="md:hidden pointer-events-none absolute top-0 right-0 bottom-1 w-8 bg-gradient-to-l from-surface-base to-transparent" />
    </div>
  );
}
```

Imports: `SlidingIndicator, { useActiveIntoView }` and `haptic`. `adminTabUrl.test.tsx` keys on `aria-current` and button names — unchanged.

- [ ] **Step 6: SectionNav**

Replace the `<a …>` map with an `Item` that carries the underline:

```tsx
function Item({ id, label, active }: { id: string; label: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <a
      ref={ref}
      href={`#${id}`}
      aria-current={active ? "location" : undefined}
      className={`relative font-label text-xs uppercase tracking-widest px-4 py-3 transition-colors whitespace-nowrap shrink-0 ${
        active ? "text-accent" : "text-mono-500 dark:text-mono-400 hover:text-accent dark:hover:text-accent"
      }`}
    >
      {label}
      {active && <SlidingIndicator id="section-nav" variant="underline" />}
    </a>
  );
}
```

and render `{sections.map((s) => <Item key={s.id} id={s.id} label={s.label} active={active === s.id} />)}`. The `border-b-2` classes go (the underline is the indicator now). `SwatchesFixture.tsx` renders `SectionNav` inside `GalleryMotion`, which provides features synchronously — no change there.

- [ ] **Step 7: BottomNav**

In the `tabs.map` Link, add the dot indicator and the icon lift, and a haptic on press:

```tsx
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => { void haptic("selection"); setMoreOpen(false); }}
              aria-current={active ? "page" : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                active ? "text-accent" : "text-mono-500 hover:text-mono-300"
              }`}
            >
              {active && <SlidingIndicator id="bottom-nav" variant="dot" />}
              <span className={`transition-transform duration-fast ease-out-brand ${active ? "-translate-y-0.5" : ""}`}>{tab.icon}</span>
              <span className="font-label text-[10px] uppercase tracking-widest">{tab.label}</span>
            </Link>
```

`BottomNav` is in `dialogSemantics.test.ts`'s `NOT_A_DIALOG` exemption; nothing here touches the scrim.

- [ ] **Step 8: Tests, guards, commit**

Run: `npx vitest run app/components/admin/__tests__/adminTabUrl.test.tsx app/components/__tests__ app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/motionImportBoundary.test.ts app/utils/__tests__/dialogSemantics.test.ts && npx tsc --noEmit && npx eslint app/components/ui/SlidingIndicator.tsx app/components/admin/AdminPanel.tsx app/components/SectionNav.tsx app/components/BottomNav.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts`

```bash
git add -A app/components/ui/SlidingIndicator.tsx app/components/ui/__tests__/SlidingIndicator.test.tsx app/components/admin/AdminPanel.tsx app/components/SectionNav.tsx app/components/BottomNav.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): SlidingIndicator — the admin tabs, SectionNav and BottomNav slide their active marker

One shared-layoutId span rendered inside the active item; aria-current stays
on the items. The active tab scrolls itself to the centre of an overflowing
bar (reduced motion: instant). BottomNav lifts the active icon 2px and taps
the haptic engine on press (spec §19.1)."
```

---

### Task 6: `Switch`

**Files:**
- Create: `app/components/ui/Switch.tsx`, `app/components/ui/__tests__/Switch.test.tsx`
- Modify: `app/components/ui/EmailPrefToggles.tsx:133-143`, `app/components/ChordChart.tsx:216-231`

**Interfaces:**
- Produces:

```ts
export default function Switch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Exactly one of these names the switch. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  size?: "sm" | "md";   // sm: h-5 w-9 knob 16px (ChordChart); md: h-6 w-11 knob 20px (EmailPrefToggles)
  className?: string;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MotionProvider from "../MotionProvider";
import Switch from "../Switch";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("Switch", () => {
  it("is a named role=switch that reports the flipped value", () => {
    const onChange = vi.fn();
    render(<MotionProvider><Switch aria-label="Mostrar acordes" checked={false} onChange={onChange} /></MotionProvider>);
    const sw = screen.getByRole("switch", { name: "Mostrar acordes" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<MotionProvider><Switch aria-label="Setlist" checked disabled onChange={onChange} /></MotionProvider>);
    fireEvent.click(screen.getByRole("switch", { name: "Setlist" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the knob at its resting position without waiting for the feature chunk", () => {
    render(<MotionProvider><Switch aria-label="On" checked onChange={() => {}} /></MotionProvider>);
    const knob = document.querySelector<HTMLElement>("[data-switch-knob]")!;
    expect(knob.style.transform).toMatch(/translateX\(20px\)/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — cannot resolve `../Switch`.

- [ ] **Step 3: Write the primitive**

```tsx
"use client";

// The ONE switch (spec §4, §19.3): EmailPrefToggles' knob promoted, with a spring
// and a haptic on the flip. Keeps the a11y contract the two sites' tests pin —
// role=switch, aria-checked, a name from aria-label — and stays a <button>, so
// Space/Enter toggle and `disabled` drops it from the tab order.
//
// `initial={false}`: the knob renders at its resting position on first paint,
// before the async feature chunk arrives — a switch that shows "off" for a
// beat while it is "on" is a lie, not a loading state.

import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";
import { haptic } from "@/app/utils/haptics";

const SIZE = {
  sm: { track: "h-5 w-9", knob: "h-4 w-4", travel: 16 },
  md: { track: "h-6 w-11", knob: "h-5 w-5", travel: 20 },
} as const;

export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className = "",
  ...aria
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const s = SIZE[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={() => { void haptic("light"); onChange(!checked); }}
      className={`relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-base ease-out-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:opacity-50 ${s.track} ${
        checked ? "bg-accent" : "bg-mono-500/70"
      } ${className}`.trim()}
    >
      <m.span
        data-switch-knob=""
        aria-hidden
        initial={false}
        animate={{ x: checked ? s.travel : 0 }}
        transition={SPRINGS.pop}
        className={`pointer-events-none block rounded-full bg-white shadow-sm ${s.knob}`}
      />
    </button>
  );
}
```

- [ ] **Step 4: Run the test to see it pass** — PASS, 3 tests. If the third assertion fails because `initial={false}` in jsdom writes `transform: translateX(20px) translateZ(0)` or `none`, assert with `toMatch(/20px/)` and say so.

- [ ] **Step 5: Migrate EmailPrefToggles**

Replace the `<button type="button" role="switch" …>…</button>` with:

```tsx
            <Switch
              aria-label={row.label}
              checked={on}
              disabled={disabled || busyField === row.field}
              onChange={(next) => onToggle(row.field, next)}
            />
```

Import `Switch from "./Switch"`. Run `npx vitest run app/components/__tests__/emailPrefToggles.test.tsx` — PASS unchanged.

- [ ] **Step 6: Migrate ChordChart "Mostrar acordes"**

Replace that `<button type="button" role="switch" …>…</button>` with:

```tsx
            <Switch
              size="sm"
              aria-label="Mostrar acordes"
              checked={showChords}
              onChange={setShowChords}
            />
```

Run `npx vitest run app/components/__tests__/ChordChart.accessibility.test.tsx` — PASS unchanged.

- [ ] **Step 7: Guards and commit**

Run: `npx tsc --noEmit && npx eslint app/components/ui/Switch.tsx app/components/ui/EmailPrefToggles.tsx app/components/ChordChart.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/rawMotionLiterals.test.ts`

```bash
git add -A app/components/ui/Switch.tsx app/components/ui/__tests__/Switch.test.tsx app/components/ui/EmailPrefToggles.tsx app/components/ChordChart.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Switch — EmailPrefToggles' knob as a primitive with a spring and a haptic

Both switches keep role=switch, aria-checked and their names, so their tests
run unchanged. The knob renders at rest with initial={false}: a switch must
not read off while the feature chunk is still loading."
```

---

### Task 7: `Checkbox`

**Files:**
- Create: `app/components/ui/Checkbox.tsx`, `app/components/ui/__tests__/Checkbox.test.tsx`
- Modify: `app/components/admin/PlannerGrid.tsx:2346-2356`, `app/components/admin/AdminPanel.tsx:1217-1223`, `app/components/admin/MonthGenerator.tsx:466`, `:853-856`, `:3793-3799`

**Interfaces:**
- Produces (NEUTRAL module — no hooks, no `motion`, safe in Server Components):

```ts
export default function Checkbox(props: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children"> & {
  /** Visible label. When omitted, pass `aria-label`. */
  children?: React.ReactNode;
  tone?: "accent" | "negative";
  /** Additive utilities on the wrapping <label>. */
  className?: string;
}): JSX.Element;
```

The native `<input type="checkbox">` stays in the DOM (`sr-only peer`), so `getByRole("checkbox")`, `getByLabelText`, `.checked`, `fireEvent.click` and `onChange(e.target.checked)` all keep working. The drawn 20 px box and the check mark are CSS (`peer-checked:` scale 0→1 over `duration-base`).

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Checkbox from "../Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a real native checkbox named by its visible label", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.checked);
    render(<Checkbox checked={false} onChange={onChange}>Omitir</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Omitir" });
    expect(screen.getByLabelText("Omitir")).toBe(box);
    fireEvent.click(box);
    expect(onChange).toHaveReturnedWith(true);
  });

  it("takes aria-label when there is no visible label, and forwards disabled", () => {
    render(<Checkbox aria-label="Omitir 2026-09-13" checked disabled onChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: "Omitir 2026-09-13" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it("draws the mark with a transform-only reveal, never display", () => {
    render(<Checkbox checked onChange={() => {}}>Sí</Checkbox>);
    const box = document.querySelector("[data-checkbox-box]")!;
    const mark = document.querySelector("[data-checkbox-mark]")!;
    expect(box.className).toMatch(/peer-checked:\[&>svg\]:scale-100/);
    expect(mark.getAttribute("class")).toMatch(/\bscale-0\b/);
    expect(box.className + mark.getAttribute("class")).not.toMatch(/peer-checked:block|hidden/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — cannot resolve.

- [ ] **Step 3: Write the primitive**

```tsx
// The ONE checkbox (spec §19.3, decision M). NEUTRAL — no hooks, no motion — so a
// Server Component may render it. The native input stays (sr-only) and does all
// the work: name, keyboard, checked, disabled, form participation, and every
// test that reaches a checkbox by role or label. The box is drawn beside it and
// the mark scales in over --motion-base; only transform animates.
//
// Tailwind's `peer-*` variants match SIBLINGS of the input, so the reveal is
// written on the box span and reaches the svg through an arbitrary variant:
// `peer-checked:[&>svg]:scale-100`. No `:has()` anywhere — the floor bans it.
// `stroke="currentColor"` with `text-on-fill` on the svg: `var()` is not
// substituted inside SVG presentation attributes (CLAUDE.md, Colour tokens).

import type { ComponentPropsWithoutRef, ReactNode } from "react";

const TONE = {
  accent: "peer-checked:border-accent peer-checked:bg-accent",
  negative: "peer-checked:border-negative-fg peer-checked:bg-negative-fg",
} as const;

export default function Checkbox({
  children,
  tone = "accent",
  className = "",
  ...input
}: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children"> & {
  children?: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 ${className}`.trim()}>
      <input type="checkbox" className="peer sr-only" {...input} />
      <span
        aria-hidden
        data-checkbox-box=""
        className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-surface-accent-30 bg-transparent transition-colors duration-fast ease-out-brand peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-checked:[&>svg]:scale-100 ${TONE[tone]}`}
      >
        <svg
          data-checkbox-mark=""
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5 scale-0 text-on-fill transition-transform duration-base ease-out-brand"
        >
          <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children && <span className="min-w-0">{children}</span>}
    </label>
  );
}
```

- [ ] **Step 4: Run the test to see it pass** — PASS, 3 tests.

- [ ] **Step 5: Migrate the five sites**

PlannerGrid `!stored` block:

```tsx
        <Checkbox
          className="font-label text-[10px] uppercase tracking-widest text-mono-500"
          checked={skipped || blockCopy !== null}
          disabled={blockCopy !== null}
          onChange={onToggleSkip}
          aria-label={`Omitir ${column.date}`}
        >
          Omitir
        </Checkbox>
```

(`aria-label` wins the accessible name over the visible text, exactly as today — `getByLabelText("Omitir <date>")` keeps matching.)

AdminPanel kill switch:

```tsx
                      <Checkbox
                        tone="negative"
                        checked={m.disabled === true}
                        disabled={submitting}
                        onChange={(e) => handleDisableAccess(m._id, e.target.checked)}
                      >
                        <span className="font-body text-xs text-mono-400">Deshabilitar acceso (kill switch)</span>
                      </Checkbox>
```

(Decision O's confirm-in-a-row-menu is Control Room work; only the control changes here.)

MonthGenerator pool row (`:466`): keep the outer `<label …>` styling by moving it onto the primitive —

```tsx
          <Checkbox
            key={m._id}
            className={`w-full px-2 py-1 text-xs transition-colors ${config[field].includes(m._id) ? "bg-accent/10" : "hover:bg-accent/5"}`}
            checked={config[field].includes(m._id)}
            onChange={() => onToggle(m._id)}
          >
            <span className="font-body">{dn(m)}</span>
          </Checkbox>
```

MonthGenerator rule member list (`:853-856`) — same shape with `checked={selected.includes(name)}` and its functional `setSelected`. MonthGenerator clear-month (`:3793-3799`): `<Checkbox className="items-start font-body text-xs text-mono-300" checked={clearIncludePublished} disabled={clearing} onChange={(event) => setClearIncludePublished(event.target.checked)}><span>Incluir …</span></Checkbox>` keeping the existing inner `<span>` text verbatim.

Import `Checkbox from "@/app/components/ui/Checkbox"` in the three files.

- [ ] **Step 6: Tests, guards, commit**

Run: `npx vitest run app/components/admin` (rerun `MonthGenerator.create.test.tsx` alone if it flakes) — every `getByLabelText("Omitir …")`, `getByRole("checkbox", { name: "Ana" })`, `within(label).getByRole("checkbox")`, `getByLabelText(/Incluir 1 servicio publicado/)` must pass unchanged.

Run: `npx tsc --noEmit && npx eslint app/components/ui/Checkbox.tsx app/components/admin/PlannerGrid.tsx app/components/admin/AdminPanel.tsx app/components/admin/MonthGenerator.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/clientBoundary.test.ts`

```bash
git add -A app/components/ui/Checkbox.tsx app/components/ui/__tests__/Checkbox.test.tsx app/components/admin/PlannerGrid.tsx app/components/admin/AdminPanel.tsx app/components/admin/MonthGenerator.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Checkbox — a drawn box over the native input, five sites migrated

Neutral module: the native input stays sr-only and keeps every test that
reaches a checkbox by role or label. The mark scales in over --motion-base.
The kill switch takes the negative tone; its confirm is Control Room work."
```

---

### Task 8: `Select` and nine sites

**Files:**
- Create: `app/components/ui/Select.tsx`, `app/components/ui/__tests__/Select.test.tsx`
- Modify: `app/components/AvailabilityCalendar.tsx:378-393` (2), `app/components/admin/AdminPanel.tsx:409-413` and `:1084-1101` (2), `app/components/admin/MonthCalendar.tsx:382-396`, `app/components/kids/KidsAvailabilityPanel.tsx:195-207`, `app/components/kids/PairRoster.tsx:146-158`, `:172-…`, `:250-264` (3)

**Interfaces:**
- Produces (NEUTRAL module):

```ts
export default function Select(props: Omit<ComponentPropsWithoutRef<"select">, "className"> & {
  /** Visible label rendered above; wires htmlFor/id. When omitted, pass aria-label. */
  label?: ReactNode;
  size?: "sm" | "md";
  /** Additive utilities on the outer wrapper. */
  className?: string;
  children: ReactNode;   // <option> elements, verbatim from the site
}): JSX.Element;
```

The native `<select>` is the control; chrome is a wrapper with the tokenised border, focus glow and a chevron. Every test that does `querySelector("select")`, `getByLabelText(...)` → `HTMLSelectElement`, `fireEvent.change`, `.value`, `.disabled` keeps working. `id` is generated only when `label` is given and no `id` is passed: use `useId`? No — neutral module, no hooks. Require `id` when `label` is passed (TypeScript: `label` and `id` together), else the site passes `aria-label`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Select from "../Select";

afterEach(cleanup);

describe("Select", () => {
  it("is the native select, named by its label, changing through onChange", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLSelectElement>) => e.target.value);
    render(
      <Select id="mes" label="Mes" value="1" onChange={onChange}>
        <option value="1">Enero</option>
        <option value="2">Febrero</option>
      </Select>,
    );
    const sel = screen.getByLabelText("Mes") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("1");
    fireEvent.change(sel, { target: { value: "2" } });
    expect(onChange).toHaveReturnedWith("2");
  });

  it("takes aria-label without a visible label and forwards disabled", () => {
    render(
      <Select aria-label="Fecha del servicio especial" value="a" disabled onChange={() => {}}>
        <option value="a">A</option>
      </Select>,
    );
    const sel = screen.getByLabelText("Fecha del servicio especial") as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    expect(document.querySelector("select")).toBe(sel);
  });

  it("draws a chevron that is not in the accessibility tree", () => {
    render(<Select aria-label="X" value="a" onChange={() => {}}><option value="a">A</option></Select>);
    expect(document.querySelector("[data-select-chevron]")?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run it to see it fail** — cannot resolve.

- [ ] **Step 3: Write the primitive**

```tsx
// The ONE select (spec §19.3, decision M) — the NATIVE half. The element stays a
// <select>: iOS's picker wheel is the better phone control, and every test that
// reaches one by label or querySelector keeps working. What changes is the
// chrome: tokenised border, focus glow, a drawn chevron over the hidden native
// arrow. The desktop Menu popover with type-ahead (>8 options) is Control Room
// work and is recorded as such in the spec's Part VIII.
//
// NEUTRAL — no hooks — so pass `id` with `label` (the label needs htmlFor) or
// name the control with `aria-label`.

import type { ComponentPropsWithoutRef, ReactNode } from "react";

const SIZE = {
  sm: "px-2 py-1 pr-7 text-[11px]",
  md: "px-3 py-2 pr-9 text-sm",
} as const;

type Base = Omit<ComponentPropsWithoutRef<"select">, "className" | "children"> & {
  size?: keyof typeof SIZE;
  className?: string;
  children: ReactNode;
};
type Props = (Base & { label: ReactNode; id: string }) | (Base & { label?: undefined });

export default function Select({ label, size = "md", className = "", children, ...select }: Props) {
  return (
    <div className={`block ${className}`.trim()}>
      {label && (
        <label htmlFor={select.id} className="mb-1 block font-label text-[10px] uppercase tracking-widest text-mono-500">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          {...select}
          className={`w-full appearance-none rounded-lg border border-surface-accent-30 bg-surface-raised-alt font-body text-ink transition-[border-color,box-shadow] duration-fast ease-out-brand focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${SIZE[size]}`}
        >
          {children}
        </select>
        <svg
          data-select-chevron=""
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mono-500"
        >
          <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to see it pass** — PASS, 3 tests.

- [ ] **Step 5: Migrate the nine sites**

Each site keeps its `value`, `onChange`, `disabled`, options and label text; only the element and its class string change. Patterns:

AvailabilityCalendar (both selects; no label today → `aria-label`):

```tsx
            <Select aria-label="Día de la semana" value={recurDow} onChange={e => setRecurDow(Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
            </Select>
            <Select aria-label="Cada cuántas semanas" value={recurInterval} onChange={e => setRecurInterval(Number(e.target.value))}>
              <option value={1}>Cada semana</option>
              <option value={2}>Cada 2 semanas</option>
              <option value={4}>Cada 4 semanas</option>
            </Select>
```

AdminPanel "Rol" (`:409-413`, an unlinked `<label>` today): give it `id="member-role"` and `label="Rol"`, delete the loose `<label>`. AdminPanel filter value (`:1084-1101`): `<Select aria-label={filterKey === "type" ? "Tipo" : "Rol"} className="min-w-[120px] flex-1" value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>…options verbatim…</Select>`.

MonthCalendar special date: `<Select aria-label="Fecha del servicio especial" value={openDate} onChange={…verbatim…}>{days.map(…)}</Select>` — `getByLabelText("Fecha del servicio especial")` in `MonthCalendar.test.tsx:92,139` and `MonthGenerator.create.test.tsx:141` keep matching.

KidsAvailabilityPanel: it already has `<label htmlFor="kids-availability-member">` — move the label text into `label=` with `id="kids-availability-member"` and delete the standalone label. PairRoster's three selects: same — `id` + `label` where a `htmlFor` label exists; the sr-only "Sala de {name}" becomes `aria-label={`Sala de ${name}`}`.

- [ ] **Step 6: Tests, guards, commit**

Run: `npx vitest run app/components/admin/__tests__/MonthCalendar.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx app/components/kids app/components/__tests__` — PASS (isolation rerun for the #51 flake).

Run: `npx tsc --noEmit && npx eslint app/components/ui/Select.tsx app/components/AvailabilityCalendar.tsx app/components/admin/AdminPanel.tsx app/components/admin/MonthCalendar.tsx app/components/kids/KidsAvailabilityPanel.tsx app/components/kids/PairRoster.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/clientBoundary.test.ts`

```bash
git add -A app/components/ui/Select.tsx app/components/ui/__tests__/Select.test.tsx app/components/AvailabilityCalendar.tsx app/components/admin/AdminPanel.tsx app/components/admin/MonthCalendar.tsx app/components/kids app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Select — tokenised chrome over the native select, nine sites migrated

The element stays a <select> (iOS's picker is the better phone control and the
tests reach it by label), so the change is chrome: border, focus glow, drawn
chevron. Two AvailabilityCalendar selects gain the accessible names they lacked."
```

---

### Task 9: `Select` in MonthGenerator (13 sites)

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx:596, 660-666, 673-679, 705-711, 713-720, 795, 801, 808, 868, 3291, 3460, 3586, 3592, 3599`

**Interfaces:** consumes `Select` from Task 8. `selCls` (`:1877`) is deleted once no `<select>` uses it; `inCls` stays (inputs).

- [ ] **Step 1: Migrate every `<select className={selCls} …>`**

Rules for this file, so the tests keep their hooks:
- The "Mes" select (`:3291`) must remain the FIRST `<select>` in the document (`container.querySelector("select")` in four test files). It is rendered in the `config` step before any other select; the `Select` wrapper does not change document order. Give it `id="mg-month"` and `label="Mes"`, deleting the loose `<label>`; same for "Año" if it is a select (it is a number input — leave it).
- "Tipo" (`:3460`): the wrapping `<label>` becomes `<Select id="mg-create-type" label="Tipo" …>`.
- "Sección" / "Primer servicio" / "Segundo servicio" (`:3586-3599`): `getByLabelText` in `MonthGenerator.stored.test.tsx:450-912` casts to `HTMLSelectElement` and reads `.value`/`.disabled` — `Select` with `id`+`label` gives the same association through `htmlFor`.
- The rule-editor selects (`:596–868`) have `<p>` captions ("Persona", "Persona A/B") or none: use `aria-label` with the caption text, and delete a `<p>` only when the `label` prop replaces it visually.

Each site: `<Select {...same value/onChange/disabled} size="md" aria-label|id+label>…options verbatim…</Select>`.

- [ ] **Step 2: Remove `selCls`**

Delete `const selCls = …` at `:1877` when `grep -n selCls` finds no other use.

- [ ] **Step 3: Tests, guards, commit**

Run: `npx vitest run app/components/admin` (isolation rerun for the #51 flake). `npx tsc --noEmit && npx eslint app/components/admin/MonthGenerator.tsx && npx vitest run app/utils/__tests__/rawMotionLiterals.test.ts`

```bash
git add app/components/admin/MonthGenerator.tsx
git commit -m "feat(motion): MonthGenerator's thirteen selects are the Select primitive

The Mes select stays first in the document — four test files reach it with
querySelector('select'). Sección / Primer servicio / Segundo servicio keep
their label association through htmlFor. selCls is gone."
```

---

### Task 10: `DateField`

**Files:**
- Create: `app/components/ui/DateField.tsx`, `app/components/ui/__tests__/DateField.test.tsx`
- Modify: `app/components/CalendarView.tsx:145-150`, `app/components/admin/PlannerGrid.tsx:2320-2327`, `app/components/admin/MonthGenerator.tsx:3468`

**Interfaces:**
- Produces (NEUTRAL module; steppers are plain `Button`s whose handlers the client parent supplies):

```ts
export default function DateField(props: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children"> & {
  kind: "date" | "month";
  label?: ReactNode;        // with `id`, wires htmlFor; else pass aria-label
  size?: "sm" | "md";
  className?: string;
  /** Month strip: prev/next icon buttons around the input. `onStep(-1|1)` is the parent's job. */
  onStep?: (delta: -1 | 1) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DateField from "../DateField";

afterEach(cleanup);

describe("DateField", () => {
  it("is the native date input, named by its label", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.value);
    render(<DateField kind="date" id="f" label="Fecha" value="2026-09-13" onChange={onChange} />);
    const input = screen.getByLabelText("Fecha") as HTMLInputElement;
    expect(input.type).toBe("date");
    fireEvent.change(input, { target: { value: "2026-09-14" } });
    expect(onChange).toHaveReturnedWith("2026-09-14");
  });

  it("month kind with onStep draws Anterior/Siguiente and reports the delta", () => {
    const onStep = vi.fn();
    render(<DateField kind="month" aria-label="Ir al mes" value="2026-09" onChange={() => {}} onStep={onStep} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([-1, 1]);
    expect((screen.getByLabelText("Ir al mes") as HTMLInputElement).type).toBe("month");
  });

  it("forwards min, max and disabled to the input", () => {
    render(<DateField kind="date" aria-label="F" value="2026-09-01" min="2026-09-01" max="2026-09-30" disabled onChange={() => {}} />);
    const input = screen.getByLabelText("F") as HTMLInputElement;
    expect(input.min).toBe("2026-09-01");
    expect(input.max).toBe("2026-09-30");
    expect(input.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — cannot resolve.

- [ ] **Step 3: Write the primitive**

```tsx
// The ONE date/month field (spec §19.3, decision M). NEUTRAL. The input stays
// native — the OS picker is the control — and the chrome is tokenised. In month
// kind an optional stepper pair turns it into the month strip the schedule page
// uses; the parent owns what a step means (a router push, a state change).

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Button from "./Button";

const SIZE = {
  sm: "px-1.5 py-1 text-[11px]",
  md: "px-3 py-1.5 text-xs",
} as const;

export default function DateField({
  kind,
  label,
  size = "md",
  className = "",
  onStep,
  ...input
}: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children"> & {
  kind: "date" | "month";
  label?: ReactNode;
  size?: keyof typeof SIZE;
  className?: string;
  onStep?: (delta: -1 | 1) => void;
}) {
  const field = (
    <input
      type={kind}
      {...input}
      className={`min-w-0 rounded-lg border border-surface-accent-30 bg-transparent font-label text-ink-muted transition-[border-color,box-shadow] duration-fast ease-out-brand focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${SIZE[size]} ${onStep ? "" : "w-full"}`}
    />
  );
  return (
    <div className={`block ${className}`.trim()}>
      {label && (
        <label htmlFor={input.id} className="mb-1 block font-label text-[10px] uppercase tracking-widest text-mono-500">
          {label}
        </label>
      )}
      {onStep ? (
        <div className="inline-flex items-center gap-1">
          <Button variant="icon" aria-label="Mes anterior" onClick={() => onStep(-1)}>
            <span aria-hidden>‹</span>
          </Button>
          {field}
          <Button variant="icon" aria-label="Mes siguiente" onClick={() => onStep(1)}>
            <span aria-hidden>›</span>
          </Button>
        </div>
      ) : (
        field
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to see it pass** — PASS, 3 tests.

- [ ] **Step 5: Migrate the three sites**

CalendarView (`:145-150`): the `<label><span className="sr-only">Ir al mes</span><input type="month" …/></label>` becomes

```tsx
        <DateField
          kind="month"
          aria-label="Ir al mes"
          value={anchorMonth}
          onChange={(e) => { if (e.target.value) router.push(scheduleHref(e.target.value)); }}
          onStep={(d) => {
            const [y, mo] = anchorMonth.split("-").map(Number);
            const next = new Date(y, mo - 1 + d, 1);
            router.push(scheduleHref(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`));
          }}
        />
```

PlannerGrid (`:2320-2327`): the `<label>Fecha<input type="date" …/></label>` becomes `<DateField kind="date" size="sm" id={`col-date-${column.columnId}`} label="Fecha" value={column.date} disabled={readOnly || mutationLocked || !!storedDateBlockedReason} title={storedDateBlockedReason ?? undefined} onChange={(event) => onStoredHeaderChange?.(column.columnId, { date: event.target.value })} />`. The label's `font-label text-[9px]` sizing is now the primitive's `text-[10px]` — accepted.

MonthGenerator (`:3468`): `<DateField kind="date" id="mg-create-date" label="Fecha" value={createDate} disabled={storedMutationLocked} min={…verbatim…} max={…verbatim…} onChange={(event) => setCreateDate(event.target.value)} />`, deleting the wrapping `<label>` and `inCls` on this input only.

- [ ] **Step 6: Tests, guards, commit**

Run: `npx vitest run app/components/admin/__tests__/PlannerGrid.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx app/components/__tests__ && npx tsc --noEmit && npx eslint app/components/ui/DateField.tsx app/components/CalendarView.tsx app/components/admin/PlannerGrid.tsx app/components/admin/MonthGenerator.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/clientBoundary.test.ts`

```bash
git add -A app/components/ui/DateField.tsx app/components/ui/__tests__/DateField.test.tsx app/components/CalendarView.tsx app/components/admin/PlannerGrid.tsx app/components/admin/MonthGenerator.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): DateField — tokenised native date/month input; the schedule month gets steppers

Three sites. The schedule's month input becomes a strip with Mes anterior /
Mes siguiente; the planner column and the generator's create date keep their
native pickers under the house chrome."
```

---

### Task 11: `NumberRoll`

**Files:**
- Create: `app/components/ui/NumberRoll.tsx`, `app/components/ui/__tests__/NumberRoll.test.tsx`
- Modify: `app/components/NextServiceHero.tsx:36-38`, `app/components/admin/ServiceReadinessCard.tsx:285-289`, `app/components/admin/ParticipationSidebar.tsx:125`, `app/components/ChordChart.tsx:200-211`

**Interfaces:**
- Produces:

```ts
export default function NumberRoll(props: { value: string | number; className?: string }): JSX.Element;
```

Old value rises out, new value rises in (spec §4). `AnimatePresence mode="popLayout"` with `initial={false}`; the host is an inline-grid so both values stack in one cell and the width holds. Text content is the value; nothing else is announced.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MotionProvider from "../MotionProvider";
import NumberRoll from "../NumberRoll";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("NumberRoll", () => {
  it("renders the value as text", () => {
    render(<MotionProvider><NumberRoll value="En 4 días" /></MotionProvider>);
    expect(screen.getByText("En 4 días")).toBeTruthy();
  });

  it("swaps to the new value and drops the old one", async () => {
    const { rerender } = render(<MotionProvider><NumberRoll value={3} /></MotionProvider>);
    rerender(<MotionProvider><NumberRoll value={4} /></MotionProvider>);
    expect(screen.getByText("4")).toBeTruthy();
    // skipAnimations is on under the test env, so the exit completes synchronously.
    expect(screen.queryByText("3")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail** — cannot resolve.

- [ ] **Step 3: Write the primitive**

```tsx
"use client";

// A number (or short label) that changes in place (spec §4): the old value rises
// out, the new one rises in. NextServiceHero's countdown, the readiness card's
// relative day, the participation total, ChordChart's capo readout. Both values
// share one grid cell so the width never jumps; `initial={false}` so the first
// paint is the value, not an animation.

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export default function NumberRoll({ value, className = "" }: { value: string | number; className?: string }) {
  const key = String(value);
  return (
    <span className={`inline-grid overflow-hidden align-baseline ${className}`.trim()}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={key}
          initial={{ y: "0.6em", opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
          exit={{ y: "-0.6em", opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
          className="[grid-area:1/1] block"
        >
          {key}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
```

- [ ] **Step 4: Run the test to see it pass** — PASS, 2 tests. If the second case finds "3" still mounted (popLayout keeps the exiting node until its exit completes and `skipAnimations` did not collapse it), wrap the assertion in `await waitFor(() => expect(screen.queryByText("3")).toBeNull())` and say so in the commit body.

- [ ] **Step 5: Migrate the four sites**

NextServiceHero: `{countdownText && (<span className="shrink-0 rounded-full …">{countdownText}</span>)}` → same span with `<NumberRoll value={countdownText} />` as its child. ServiceReadinessCard: `<span className="font-label text-[11px] …">{identity.relative}</span>` → child becomes `<NumberRoll value={identity.relative} />`. ParticipationSidebar `Row`: `<div className="text-xl font-medium text-ink-muted min-w-[24px] text-right">{value}</div>` → child `<NumberRoll value={value} />`. ChordChart capo readout: wrap the ternary's string in `<NumberRoll value={capo.fret === 0 ? \`Acordes abiertos (${capo.shapeKey})\` : \`Capo ${capo.fret} · formas de ${capo.shapeKey}\`} />`.

`ServiceReadinessCard` and `ParticipationSidebar` are client components already (`"use client"` at top — verify; if a file is a Server Component, NumberRoll may still be rendered as JSX, never called).

- [ ] **Step 6: Tests, guards, commit**

Run: `npx vitest run app/components/__tests__ app/components/admin/__tests__/participationAlongside.test.tsx app/components/admin/__tests__/serviceReadiness* && npx tsc --noEmit && npx eslint app/components/ui/NumberRoll.tsx app/components/NextServiceHero.tsx app/components/admin/ServiceReadinessCard.tsx app/components/admin/ParticipationSidebar.tsx app/components/ChordChart.tsx && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/motionImportBoundary.test.ts`

```bash
git add -A app/components/ui/NumberRoll.tsx app/components/ui/__tests__/NumberRoll.test.tsx app/components/NextServiceHero.tsx app/components/admin/ServiceReadinessCard.tsx app/components/admin/ParticipationSidebar.tsx app/components/ChordChart.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): NumberRoll — countdown, relative day, participation total and capo readout roll

Old value rises out, new rises in, both in one grid cell so nothing reflows.
initial={false}: first paint is the value."
```

---

### Task 12: Overlay follow-ups from M0b-1

**Files:**
- Modify: `app/components/ui/CueDialog.tsx:222-242` (Escape), `:262-267` (`sheetMotion`); `app/components/ui/Toast.tsx:105-138`; tests `app/components/ui/__tests__/CueDialog.test.tsx`, `app/components/ui/__tests__/Toast.test.tsx`

**Interfaces:** none new. Three behaviours change:
1. Escape inside an open `Menu` that lives inside a `CueDialog` closes the MENU, not the dialog; the next Escape closes the dialog.
2. The toast stack's live region exists before any toast does.
3. A sheet decides "sheet or card" when it OPENS and keeps it until it closes.

- [ ] **Step 1: Write the failing tests**

Append to `CueDialog.test.tsx`:

```tsx
  it("lets a Menu inside the dialog own Escape: first closes the menu, second the dialog", () => {
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open title="Detalle" onDismiss={onDismiss}>
            <Menu label="Más" trigger={<button type="button">Más acciones</button>}>
              <MenuItem onSelect={() => {}}>Uno</MenuItem>
            </Menu>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "Uno" });
    fireEvent.keyDown(item, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledWith("escape");
  });

  it("decides sheet-or-card when it opens and keeps it while open", () => {
    // Opens as a phone sheet (matchMedia false), then the viewport crosses 640px:
    // the handle keeps its drag until the dialog closes.
    const onDismiss = vi.fn();
    const { rerender } = render(
      <MotionProvider><CueDialogProvider>
        <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}><button>Ok</button></CueDialog>
      </CueDialogProvider></MotionProvider>,
    );
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: (query: string) => ({ matches: query === "(min-width: 640px)", media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
    });
    try {
      rerender(
        <MotionProvider><CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle (re-render)" onDismiss={onDismiss}><button>Ok</button></CueDialog>
        </CueDialogProvider></MotionProvider>,
      );
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 400, isPrimary: true });
    } finally {
      Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original });
    }
    expect(onDismiss).toHaveBeenCalledWith("drag");
  });
```

(Import `Menu, { MenuItem }` from `../Menu` at the top of the test file.) The Escape sequence in the first case: the dialog's capture-phase listener runs first; it must IGNORE an Escape whose target sits inside an open menu (or on a trigger with `aria-expanded="true"`), so React's bubble handler in `Menu` gets it and closes.

Append to `Toast.test.tsx`:

```tsx
  it("keeps a polite live region mounted with zero toasts, so the first toast is announced", () => {
    render(<ToastProvider><span /></ToastProvider>);
    const region = document.querySelector('[data-toast-root] [role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector('[data-toast-root] [role="alert"]')).not.toBeNull();
  });
```

Run both files — the three new cases FAIL.

- [ ] **Step 2: CueDialog — Escape yields to an open menu**

In the `onKeyDown` inside the focus effect, before the Escape branch:

```ts
      if (event.key === "Escape") {
        // A Menu open inside this dialog owns Escape (M0b-1 deferral): this
        // listener is capture-phase on document and would otherwise eat the key
        // before the menu's bubble handler ever sees it.
        const t = event.target as Element | null;
        if (t?.closest('[role="menu"], [aria-haspopup="menu"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss("escape");
        return;
      }
```

- [ ] **Step 3: CueDialog — variant fixed at open**

Replace the render-time `sheetMotion` expression with a value captured when `open` flips true:

```ts
  // Sheet or card is decided when the dialog OPENS and held until it closes: a
  // resize across 640px mid-dialog must not swap the exit animation or drop the
  // drag handlers under a finger. `useMemo` keyed on `open` re-evaluates only on
  // that edge (M0b-1 deferral: "the 640px variant fixed at dialog open").
  const sheetMotion = useMemo(
    () =>
      mode === "sheet" &&
      (typeof window === "undefined" ||
        typeof window.matchMedia !== "function" ||
        !window.matchMedia("(min-width: 640px)").matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is the intended edge
    [mode, open],
  );
```

If the existing test "gives a sheet the card's motion on a ≥640px viewport" installs its matchMedia override BEFORE render, it still passes (the memo runs on mount with `open` true).

- [ ] **Step 4: Toast — persistent regions**

Replace `ToastViewport` with:

```tsx
function ToastViewport({ items, onDismiss }: { items: ToastRecord[]; onDismiss: (id: string) => void }) {
  const lastError = [...items].reverse().find((t) => t.tone === "error");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-4"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px))" }}
    >
      {/* A region that exists before its text is what gets announced. Errors are
          mirrored into an assertive region that is likewise always mounted. */}
      <span role="alert" className="sr-only">{lastError?.message ?? ""}</span>
      <AnimatePresence>
        {items.map((t) => (
          <m.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-surface-raised-alt px-5 py-3 font-label text-xs uppercase tracking-widest text-ink shadow-xl ${
              t.tone === "error" ? "border-negative-border/60" : "border-accent/30"
            }`}
          >
            <span className="min-w-0">{t.message}</span>
            {t.action && (
              <Button variant="ghost" size="sm" onClick={() => { t.action?.onClick(); onDismiss(t.id); }}>
                {t.action.label}
              </Button>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

The per-toast `role`/`aria-live` are removed. If an existing Toast test asserts `getByRole("alert")` on the toast element itself, point it at the mirrored region's text instead and say so.

- [ ] **Step 5: Run, docs line, commit**

Run: `npx vitest run app/components/ui/__tests__ app/utils/__tests__/dialogSemantics.test.ts && npx tsc --noEmit && npx eslint app/components/ui/CueDialog.tsx app/components/ui/Toast.tsx`

In `docs/MOTION.md` line 89 (the CueDialog row) replace the sentence beginning `A \`Menu\` inside a \`CueDialog\` is unsupported in M0b-1:` through `is M0b-2 work.` with: `A \`Menu\` inside a \`CueDialog\` owns Escape: the dialog's capture-phase listener yields when the key's target is inside an open menu or on its expanded trigger, so the first Escape closes the menu and the second the dialog (M0b-2). The sheet/card decision is taken when the dialog OPENS and held until it closes.` Also amend the same row's earlier clause `decided once per render from \`matchMedia\` (fixed for the dialog's life; a resize across the breakpoint keeps the variant it opened with)` to `decided when the dialog opens (\`useMemo\` on the \`open\` edge) and held until it closes`.

```bash
git add app/components/ui/CueDialog.tsx app/components/ui/Toast.tsx app/components/ui/__tests__/CueDialog.test.tsx app/components/ui/__tests__/Toast.test.tsx docs/MOTION.md
git commit -m "fix(motion): a Menu inside a dialog owns Escape; toast regions persist; sheet variant fixed at open

Three M0b-1 deferrals. The dialog's capture listener yields Escape to an open
menu; the toast viewport is a polite region with an always-mounted assertive
mirror for errors, so the first toast is announced; sheet-or-card is decided
on the open edge, not per render."
```

---

### Task 13: `controls` gallery fixture, docs, bundle

**Files:**
- Create: `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/ControlsFixture.tsx`
- Modify: `app/(gallery)/theme-gallery/[theme]/[fixture]/page.tsx:29,59-64`, `app/utils/__tests__/themeGallery.test.ts:134,144-150`, `docs/MOTION.md` (primitives table, Bundle table), `docs/UTILITIES_AND_COMPONENTS.md:332-335`, `CLAUDE.md:210-235` and `AGENTS.md` (same hunk)

- [ ] **Step 1: Update the gallery test first**

`themeGallery.test.ts:134`: `'["swatches", "dialog", "planner", "kids-planner", "controls"] as const'` and the case title `…and five fixtures`. Add `"ControlsFixture"` to `names`. Run it — FAIL.

- [ ] **Step 2: Write the fixture**

```tsx
"use client";

// Controls fixture — every control primitive in every state, both themes (spec
// §5.11). Hermetic: no session, no fetch, no Sanity, no env. Mounts its own
// ToastProvider (the gallery mounts no Provider) and fires three toasts on
// mount so the stack is PRESENT for the capture. GalleryMotion (layout.tsx)
// provides motion features synchronously and skips animations under
// data-motion="off", so every frame here is final.

import { useEffect, useState } from "react";
import Button from "@/app/components/ui/Button";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Switch from "@/app/components/ui/Switch";
import Checkbox from "@/app/components/ui/Checkbox";
import Select from "@/app/components/ui/Select";
import DateField from "@/app/components/ui/DateField";
import NumberRoll from "@/app/components/ui/NumberRoll";
import Collapse from "@/app/components/ui/Collapse";
import { ToastProvider, useToast } from "@/app/components/ui/Toast";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-label text-[10px] uppercase tracking-[0.24em] text-accent">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Toasts() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ message: "Guardado", tone: "ok", hold: true });
    toast({ message: "Sin conexión", tone: "error", hold: true });
    toast({ message: "Deshacer", tone: "info", hold: true, action: { label: "Deshacer", onClick: () => {} } });
  }, [toast]);
  return null;
}

function Controls() {
  const [seg, setSeg] = useState<"a" | "b" | "c">("b");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [sel, setSel] = useState("2");
  const [date, setDate] = useState("2026-09-13");
  const [n, setN] = useState(4);
  const [open, setOpen] = useState(true);
  return (
    <div data-gallery-surface="controls" className="space-y-10">
      <Row title="Botones">
        <Button variant="primary">Primario</Button>
        <Button variant="secondary">Secundario</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="danger">Peligro</Button>
        <Button variant="icon" aria-label="Icono">×</Button>
        <Button variant="pill" active>Píldora activa</Button>
        <Button variant="pill">Píldora</Button>
        <Button variant="primary" busy busyLabel="Guardando…">Guardar</Button>
        <Button variant="secondary" disabled>Deshabilitado</Button>
        <Button variant="primary" size="lg">Grande (44px)</Button>
      </Row>
      <Row title="Segmentado">
        <SegmentedControl label="Contorno" value={seg} onChange={setSeg} options={[{ value: "a", label: "Uno" }, { value: "b", label: "Dos" }, { value: "c", label: "Tres", badge: 3 }]} />
        <SegmentedControl label="Relleno" tone="filled" value={seg} onChange={setSeg} options={[{ value: "a", label: "Calendario" }, { value: "b", label: "Lista" }, { value: "c", label: "Agenda", busy: true }]} />
        <SegmentedControl label="Vacío" size="sm" value={null} onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />
      </Row>
      <Row title="Interruptor">
        <Switch aria-label="Encendido" checked={on} onChange={setOn} />
        <Switch aria-label="Apagado" checked={!on} onChange={(v) => setOn(!v)} />
        <Switch aria-label="Pequeño" size="sm" checked={on} onChange={setOn} />
        <Switch aria-label="Deshabilitado" checked disabled onChange={() => {}} />
      </Row>
      <Row title="Casilla">
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>Marcada</Checkbox>
        <Checkbox checked={!checked} onChange={(e) => setChecked(!e.target.checked)}>Sin marcar</Checkbox>
        <Checkbox tone="negative" checked onChange={() => {}}>Negativa</Checkbox>
        <Checkbox checked disabled onChange={() => {}}>Deshabilitada</Checkbox>
      </Row>
      <Row title="Selector y fecha">
        <Select id="g-sel" label="Mes" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="1">Enero</option><option value="2">Febrero</option><option value="3">Marzo</option>
        </Select>
        <Select aria-label="Pequeño" size="sm" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="1">Uno</option><option value="2">Dos</option>
        </Select>
        <DateField kind="date" id="g-date" label="Fecha" value={date} onChange={(e) => setDate(e.target.value)} />
        <DateField kind="month" aria-label="Mes" value="2026-09" onChange={() => {}} onStep={() => {}} />
      </Row>
      <Row title="Número">
        <span className="font-display text-3xl text-accent"><NumberRoll value={n} /></span>
        <Button variant="secondary" size="sm" onClick={() => setN((v) => v + 1)}>+1</Button>
        <span className="rounded-full border border-positive-fg/25 px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-positive-fg"><NumberRoll value={`En ${n} días`} /></span>
      </Row>
      <Row title="Desplegable">
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Alternar</Button>
        <Collapse open={open} id="g-collapse" className="w-full rounded-lg border border-surface-accent-30 p-4 text-sm">Contenido desplegado.</Collapse>
      </Row>
      <Toasts />
    </div>
  );
}

export function ControlsFixture() {
  return (
    <ToastProvider>
      <Controls />
    </ToastProvider>
  );
}
```

Check `Collapse`'s real props before writing (`open`, `id?`, `className?`, `children` per the M0b-1 recon). None of the six label-budget strings appear here.

- [ ] **Step 3: Register it**

`page.tsx`: `const FIXTURES = ["swatches", "dialog", "planner", "kids-planner", "controls"] as const;`, `import { ControlsFixture } from "./fixtures/ControlsFixture";`, and `{fixture === "controls" && <ControlsFixture />}` in the switch.

Run: `npx vitest run app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/labelBudget.test.ts app/utils/__tests__/motionImportBoundary.test.ts` — PASS.

- [ ] **Step 4: Look at it**

Run: `npx next build && npx next start -p 3011` in the background, open `http://localhost:3011/theme-gallery/dark/controls` and `/theme-gallery/light/controls` in the Browser pane, screenshot both. Check: segmented labels legible over the thumb in both tones; the switch knob on the right when on; the checkbox mark visible; the select chevron not overlapping text; the three toasts stacked. Fix what is wrong in the primitive, not the fixture. Stop the server.

- [ ] **Step 5: Bundle row**

Follow `docs/MOTION.md` §Bundle "How it is measured" exactly on this tree (`next build`, gzip level 9 over the manifests). Add a row `**M0b-2 tree** (this branch, `<sha>`)` with First Load JS shared, `/`, `/admin`, and the async chunk. The deltas vs "Before M0a" must stay ≤ +25 kB gz on `/` and `/admin`, and the chunk ≤ 40 kB gz. If either is exceeded, STOP and report the numbers — do not trim primitives to fit.

- [ ] **Step 6: Docs**

`docs/MOTION.md` primitives table: delete the line `M0b also adds: …` and add rows, one per primitive, same column shape as the existing ones:

```markdown
| `SegmentedControl` | client | the ONE segmented control — `role="radiogroup"`, arrows move the selection with wrap and focus follows, the checked option is the sole tab stop; `value={null}` means nothing chosen yet (no thumb). The thumb is one `layoutId` span (what `domMax` is for). Sizes `sm`/`md`; tones `outline` (bordered pills) / `filled` (joined bar, solid thumb). `badge` and `busy` per option. Never `aria-pressed` toggles for a one-of-N choice. |
| `SlidingIndicator` / `useActiveIntoView` | client | the active marker for tab bars (admin `TabBar`, `SectionNav`, `BottomNav`): render ONE inside the active item; variants `pill`/`underline`/`dot`. Semantics stay on the items (`aria-current`). The hook scrolls the active item to the centre of an overflowing bar. |
| `Switch` | client | the ONE switch — `role="switch"`, `aria-checked`, a `<button>`; knob springs (`SPRINGS.pop`) with `initial={false}` so the first paint is the real state; haptic on flip. Sizes `sm`/`md`. |
| `Checkbox` | neutral | the ONE checkbox — the native input stays (`sr-only peer`) and does the work; the box is drawn, the mark scales in over `base`. `tone="negative"` for the kill switch. Name it with `children` or `aria-label`. |
| `Select` | neutral | the ONE select — the native `<select>` under tokenised chrome and a drawn chevron. `label` + `id` (wires `htmlFor`) or `aria-label`. The desktop `Menu` popover with type-ahead is Control Room work (spec Part VIII). |
| `DateField` | neutral | the ONE date/month input — native under tokenised chrome; `kind="month"` with `onStep` draws «Mes anterior» / «Mes siguiente» icon buttons (the schedule's month strip). |
| `NumberRoll` | client | a value that changes in place: old rises out, new rises in, both in one grid cell. `initial={false}`. |
| `haptic(kind)` (`app/utils/haptics.ts`) | neutral | `"light"` (default) on a toggle flip or thumb move, `"selection"` on a tab press, `"medium"` reserved for drop landing (M-planner). Native only; no-op on web; never awaited in a handler. |
```

`docs/UTILITIES_AND_COMPONENTS.md`: add matching rows after the `Collapse` row (same `[C]`/`[N]` tag convention the file uses — copy the neighbours). `CLAUDE.md` "Reusable utils" paragraph: after the `Collapse` entry add `` `SegmentedControl` (`app/components/ui/SegmentedControl.tsx` — every one-of-N choice; never `aria-pressed` toggles), `SlidingIndicator` (tab bars), `Switch`, `Checkbox`, `Select`, `DateField` (native controls under house chrome — never a bare `<select>`/`<input type="checkbox|date|month">` in `app/**`), `NumberRoll`, `haptic()` (`app/utils/haptics.ts` — native only, fire-and-forget) ``. Apply the byte-identical hunk to `AGENTS.md`. Run `npx vitest run app/utils/__tests__/agentDocsParity.test.ts`.

- [ ] **Step 7: Guards and commit**

Run: `npx tsc --noEmit && npx eslint "app/(gallery)" docs 2>/dev/null; npx eslint "app/(gallery)/theme-gallery" && node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/labelBudget.test.ts app/utils/__tests__/agentDocsParity.test.ts`

```bash
git add -A "app/(gallery)/theme-gallery" app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json docs/MOTION.md docs/UTILITIES_AND_COMPONENTS.md CLAUDE.md AGENTS.md
git commit -m "feat(motion): controls gallery fixture, primitive docs, bundle row

Every control primitive in every state under both themes, hermetic, with its
own ToastProvider. MOTION.md, UTILITIES_AND_COMPONENTS.md and the agent docs
carry the seven primitives and haptic(); the bundle ledger gains the M0b-2 row."
```

---

### Task 14: Delivery

**Files:** none new; `docs/superpowers/specs/2026-09-08-premium-motion-design.md` gains Part VIII.

- [ ] **Step 1: Full gates on the branch tip**

`npx tsc --noEmit && npx vitest run && npx eslint .` — 0 errors. Rerun the two #51 files in isolation if they flake; record the SHA and the counts.

- [ ] **Step 2: Whole-branch code review**

Dispatch a fresh `code-reviewer` (most capable model) over `main..HEAD` with the docs-audit and worklog-completeness checklists; fix; scoped re-review of the fix range; gates again on the final tree. The last worklog entry before the merge must be a verification.

- [ ] **Step 3: Spec Part VIII**

Append `# Part VIII — M0b-2 shipped` naming the branch, range, the seven primitives and `haptic()`, the site counts migrated (12 segmented, 3 tab bars, 2 switches, 5 checkboxes, 21 selects, 3 date inputs), the three overlay follow-ups closed, the bundle row, and the deferrals: the desktop `Select` popover (→ Control Room, §12.5), the kill-switch confirm (decision O → Control Room), `SongSheet`'s hand-rolled header (→ M1), the 12-key transposer strip (→ Song page, decision K), `ServicesPanel`'s multi-select month pills (not a segmented control; → §12.5).

- [ ] **Step 4: Push order**

Push the branch; merge into `preview`, push; `deploy-verifier` (alias + SHA on `dev-owt-backstage.vercel.app`); `scripts/dev-verify.ts` captures: `/me` phone (theme + text size), `/schedule` phone (view toggle, month strip), `/admin?tab=services` desktop (tab indicator, month pills), `/admin?tab=proposals` (filter with badge), a song with charts (chart versions, switch), plus `/theme-gallery/dark/controls`; dispatch `visual-verifier` on the captures (HR's re-open trigger). Open the PR to `main`, wait for `gates`, STOP for Frank's look. Merge only on Frank's word; verify the production alias after; worklog batch; delete the SDD workspace; update memory.

---

## Self-review (done while writing)

- **Spec coverage.** §4 rows: SegmentedControl (T2–4), Tabs/SlidingIndicator (T5), NumberRoll (T11), Switch (T6), haptics (T1); §19.3: Segmented (T3–4), Admin tab bar (T5), `<select>` (T8–9, native half — scoping recorded), date/month (T10), Checkbox (T7), Switch (T6), Dot pager (no pager exists — recon), Month pills (multi-select; deferred, named in Part VIII); §19.1 bottom tab bar pill + haptic (T5); Part VII deferrals into M0b-2: Menu Escape, 640 px variant (T12), controls fixture (T13). Decision D (T1), decision M (T7–10; 21 selects + 5 checkboxes + 3 dates = 29 of the 39 native sites; the other 10 are the radio trio and number/text inputs outside M0b-2's primitives — named in Part VIII).
- **Placeholders.** None: every step carries code or an exact edit; the two "verify before writing" notes (Collapse props, Toast test's alert assertion) name the file and what to look for.
- **Type consistency.** `SegmentedControl<V extends string>` with `value: V | null` used at every site with string-union state; `ChordChart` stringifies its index at the boundary. `Switch.onChange(next: boolean)`; `Checkbox`/`Select`/`DateField` forward native `onChange(e)` — sites keep `e.target.checked` / `e.target.value`. `haptic(kind)` returns `Promise<void>`, always `void`ed. `SlidingIndicator({ id, variant })` + `useActiveIntoView(active)` used identically in T5's three sites. `NumberRoll({ value })` string or number.
