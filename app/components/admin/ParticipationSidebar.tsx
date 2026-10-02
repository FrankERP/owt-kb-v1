// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";
import { themeColour } from "@/app/utils/themeColour";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Switch from "@/app/components/ui/Switch";
import NumberRoll from "@/app/components/ui/NumberRoll";

// Six CATEGORICAL hues, keyed by seat. These are consumed as inline `background:`
// values, so they must be COMPLETE colours — a bare triplet would need wrapping and
// `rgb(rgb(...))` is invalid and silently dropped.
const COLORS = {
  lead:      themeColour("--chart-lead-rgb"),
  bgv:       themeColour("--chart-bgv-rgb"),
  coro:      themeColour("--chart-coro-rgb"),
  especial:  themeColour("--chart-especial-rgb"),
  instr:     themeColour("--chart-instr-rgb"),
  foh:       themeColour("--chart-foh-rgb"),
};
type View = "voces" | "instrumentos";

const INCLUDE_SPECIALS_KEY = "owt_participation_include_specials";

function readStoredIncludeSpecials(): boolean {
  try {
    return window.localStorage.getItem(INCLUDE_SPECIALS_KEY) === "true";
  } catch {
    return false; // storage blocked (private mode, policy): start with the default
  }
}

/**
 * One panel's copy of the setting, as an external store for `useSyncExternalStore`.
 *
 * THE RULE: the value changes on exactly two things — the user flipping the
 * switch HERE (`set`), and a `storage` event for this key (or a `clear()`,
 * `key === null`), which means another tab wrote it. Nothing else moves it, and
 * in particular a render never re-reads storage: `getSnapshot` serves the cached
 * value, read once on the client. A getter that read `localStorage` live would
 * let another tab's write surface on whatever unrelated re-render came next,
 * with no event and no user action — a switch that flips on its own.
 *
 * Last write wins, per browser: another tab's event replaces this tab's choice,
 * because the setting is the browser's, not the tab's. The cache is also what
 * holds a flip whose WRITE failed (quota, blocked storage): it flips for this
 * visit and is simply not remembered.
 *
 * Built per mounted panel (`useState` initialiser) so nothing outlives the
 * component. A same-tab write fires no `storage` event, which is why `set`
 * notifies its own subscribers.
 */
function createIncludeSpecialsStore() {
  let value: boolean | null = null; // null: storage not read yet
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== INCLUDE_SPECIALS_KEY && e.key !== null) return;
        value = readStoredIncludeSpecials();
        notify();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: () => (value ??= readStoredIncludeSpecials()),
    set(next: boolean) {
      value = next;
      try {
        window.localStorage.setItem(INCLUDE_SPECIALS_KEY, String(next));
      } catch {
        // Not persisted; the cached value above still holds for this visit.
      }
      notify();
    },
  };
}

/**
 * Whether specials are part of the picture. OFF by default: the solver balances
 * weekend services only, so a CAMP set or a vigil in the count skews who looks
 * like they served. Remembered per browser (see the store above for the rule).
 *
 * Read through `useSyncExternalStore` with an «off» server snapshot — the same
 * family as `AdminRail`'s collapsed flag — so the server render and the
 * hydrating one agree and a stored «on» lands one render later, without a
 * `setState` in an effect.
 */
function useIncludeSpecials(): [boolean, (next: boolean) => void] {
  const [store] = useState(createIncludeSpecialsStore);
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, () => false);
  return [value, store.set];
}

// The box, whoever places it. A const rather than inline because the placement
// half below differs by caller — and `participationAlongside.test.tsx` derives
// the planner column's width floor from THIS string's padding and border.
const ASIDE_BASE = "rounded-xl border border-accent/20 bg-surface-ink-l40-d100-base p-3 self-start";

// The planner's placement, unchanged: it sits in `PlannerGrid`'s left column
// (or stacked under the day cards in «Vista»), where `top-4` was always the
// offset and nothing asked it to stay on screen.
const DEFAULT_PLACEMENT = "lg:sticky lg:top-4";

/**
 * The Servicios board's placement (ADR-0044): the chart stays in view while the
 * cards scroll the PAGE. The top is the admin rail's own sticky top — the navbar
 * is `lg:h-24`, so `top-4` would park the chart UNDER it — and
 * `servicesBoard.test.tsx` reads `AdminRail.tsx` to keep the two identical. The
 * height cap is that same offset — `--impersonation-offset` included, subtracted
 * in the same term order the test derives — plus a 1.5rem breath, so a month
 * with many members scrolls inside the chart instead of pushing its bottom
 * off-screen.
 * Only `lg`: below it the board is one column and the chart simply stacks.
 * Exported so the Servicios fallback `<aside>` shares the spelling.
 *
 * Under the cap the aside is a flex COLUMN and the rows list (`BOARD_LIST`) is
 * the one scroller that takes whatever height the header and legend leave, so
 * those stay in view and only the members move. Two nested scrollers — the
 * aside's and the list's own `max-h-[60vh]` — let the header scroll away inside
 * the aside on any viewport shorter than ~640px. The aside keeps its own
 * `overflow-y-auto` only so the header and legend stay reachable when the cap is
 * shorter than they are (a viewport ≤ ~260px tall at `lg`): there the list
 * shrinks to nothing and its rows are out of reach. Accepted — no real window is
 * 1024px wide and that short.
 */
export const BOARD_STICKY = "lg:sticky lg:top-[calc(6rem+env(safe-area-inset-top)+var(--impersonation-offset))]";
const BOARD_PLACEMENT = `${BOARD_STICKY} lg:flex lg:flex-col lg:max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-var(--impersonation-offset)-1.5rem)] lg:overflow-y-auto`;

// The rows' scroller. The planner renders `LIST_BASE` alone, unchanged —
// `participationAlongside.test.tsx` reads its `pr-0.5` into the column's width
// floor. On the board, from `lg`, it drops its own 60vh cap and fills the capped
// aside instead (`min-h-0` so a flex item may shrink below its rows).
const LIST_BASE = "space-y-0 max-h-[60vh] overflow-y-auto pr-0.5";
const BOARD_LIST = `${LIST_BASE} lg:min-h-0 lg:flex-1 lg:max-h-none`;

export function ParticipationSidebar({
  roles,
  monthLabel,
  placement = "default",
}: {
  roles: ParticipantRole[];
  monthLabel: string;
  /** `"board"` only from `ServicesPanel`; the planner keeps the default. */
  placement?: "default" | "board";
}) {
  const [view, setView] = useState<View>("voces");
  const [includeSpecials, setIncludeSpecials] = useIncludeSpecials();
  const switchLabelId = useId();
  // A special is `_type === "special_role"`, the same discriminator
  // `computeParticipation` itself branches on. Dropping the ROLE (not just the
  // `especial` bucket) is what keeps a special's instrument and FOH seats out
  // of the week counts too.
  const all = useMemo(
    () => computeParticipation(includeSpecials ? roles : roles.filter(r => r._type !== "special_role")),
    [roles, includeSpecials],
  );

  const rows = useMemo(() => {
    if (view === "voces") {
      return all.filter(r => r.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    }
    return all
      .filter(r => r.instrWeeks > 0 || r.fohWeeks > 0)
      .sort((a, b) => (b.instrWeeks + b.fohWeeks) - (a.instrWeeks + a.fohWeeks) || a.name.localeCompare(b.name));
  }, [all, view]);

  const max = view === "voces"
    ? Math.max(1, ...rows.map(r => r.total))
    : Math.max(1, ...rows.map(r => r.instrWeeks + r.fohWeeks));

  const legend: readonly (readonly [string, string])[] = view === "voces"
    ? [
        ["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro],
        ...(includeSpecials ? [["Especial", COLORS.especial] as const] : []),
      ]
    : [["Instr", COLORS.instr], ["FOH", COLORS.foh]];

  return (
    <aside className={`${ASIDE_BASE} ${placement === "board" ? BOARD_PLACEMENT : DEFAULT_PLACEMENT}`}>
      {/*
        The header is a COLUMN, not a row. That is still load-bearing for the
        gutter placement, not styling.

        Side by side (the original `flex justify-between`, back when this was a
        `<select>`) the header demanded the title's ~131px PLUS the control's
        intrinsic width — a `<select>` is as wide as its widest option, and
        "Instrumentos" made that 112px. Measured in a real browser that came to
        262px of content inside a 216px column: the control's right edge landed
        47px past it and printed itself over the planner grid — the exact
        overlap the column's width floor exists to prevent.

        Stacked, each row asks for the WIDER of the two rather than their sum
        (~131px), which is why the column stayed a fix even after the `<select>`
        became a `SegmentedControl` (M0b-2). The control's own `max-w-full`
        caps it at the header's content box so a future option list wider than
        the column can't reopen the same overflow the stack was built to close.
        See `CHART_COLUMN_WIDTH` in `PlannerGrid.tsx`, whose floor is derived
        from this file's own rows — this header is the half of that derivation
        no arithmetic can see, and `participationAlongside.test.tsx` pins it
        structurally for that reason.

        The 44px touch-target this used to guarantee (`min-h-[44px]` on the old
        `<select>`) returns with the Control Room rail remake; `size="sm"` here
        is deliberately below it because this rail is narrow.
      */}
      <div data-rail-header className="mb-1">
        <p className="font-label text-xs uppercase tracking-widest text-accent">Participaciones</p>
        <p className="text-xs text-mono-500">{monthLabel}</p>
        <SegmentedControl
          label="Ver participaciones por"
          size="sm"
          tone="filled"
          className="mt-2 max-w-full"
          value={view}
          onChange={setView}
          options={[
            { value: "voces", label: "Voces" },
            { value: "instrumentos", label: "Instrumentos" },
          ]}
        />
        {/*
          After the control, never before it: `participationAlongside.test.tsx`
          pins that the SegmentedControl follows the header's opening tag. The
          row's class deliberately does not begin `flex items-center gap-` —
          that test reads the FIRST such class in this file as the member row's
          gap, and this one is not it.

          A <label>, so the whole row is the tap target on a phone — the
          36x20 switch alone is a small thing to hit. The label's own click
          never re-fires a click that began on the switch it wraps.
        */}
        <label className="mt-2 flex cursor-pointer items-center justify-between py-1">
          <span id={switchLabelId} className="text-xs text-mono-500">Incluir especiales</span>
          <Switch
            size="sm"
            aria-labelledby={switchLabelId}
            checked={includeSpecials}
            onChange={setIncludeSpecials}
            className="ml-2"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-accent/15 mb-1">
        {legend.map(([l, c]) => (
          <span key={l} className="text-xs text-mono-500 inline-flex items-center gap-1">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-mono-500 py-3 text-center">
          {view === "voces" ? "Sin participaciones en voces." : "Sin participaciones en instrumentos / FOH."}
        </p>
      )}

      <div className={placement === "board" ? BOARD_LIST : LIST_BASE}>
        {rows.map(r => <Row key={r.id} r={r} max={max} view={view} includeSpecials={includeSpecials} />)}
      </div>
    </aside>
  );
}

function Row({ r, max, view, includeSpecials }: { r: MemberParticipation; max: number; view: View; includeSpecials: boolean }) {
  const value = view === "voces" ? r.total : r.instrWeeks + r.fohWeeks;
  const barW = Math.round((value / max) * 150);
  const u = value > 0 ? barW / value : 0;
  const seg = (n: number, c: string) => n > 0
    ? <span style={{ display: "inline-block", height: 8, width: Math.round(n * u), background: c }} /> : null;

  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-accent/10">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink-muted truncate">{r.name}</div>
        <div className="text-xs text-mono-500">
          {view === "voces"
            ? <>Líder {r.sunLead}·{r.satLead}  ·  BGV {r.sunBGV}·{r.satBGV}  ·  Coro {r.coro}{includeSpecials && <>  ·  Especial {r.especial}</>}</>
            : <>Instrumentos {r.instrWeeks} sem  ·  FOH {r.fohWeeks} sem</>}
        </div>
        <div className="mt-1 rounded overflow-hidden flex" style={{ width: 150, background: themeColour("--accent-rgb", 0.08) }}>
          {view === "voces"
            ? <>{seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}{includeSpecials && seg(r.especial, COLORS.especial)}</>
            : <>{seg(r.instrWeeks, COLORS.instr)}{seg(r.fohWeeks, COLORS.foh)}</>}
        </div>
      </div>
      <div className="text-xl font-medium text-ink-muted min-w-[24px] text-right">
        <NumberRoll value={value} />
      </div>
    </div>
  );
}
