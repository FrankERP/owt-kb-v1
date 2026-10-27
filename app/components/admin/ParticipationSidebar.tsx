// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";
import { themeColour } from "@/app/utils/themeColour";
import { SHEET_TITLE } from "@/app/utils/homeHero";
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
/**
 * The Servicios board's box: none (phase 5 of the «millones» pass, 2026-10-27).
 * There the chart is the board's first column with a section title, hairline
 * rows and whitespace, like every member screen before it; the planner keeps
 * `ASIDE_BASE`, whose padding and border `participationAlongside.test.tsx`
 * derives the planner column's floor from.
 */
const BOARD_BASE = "self-start";

/**
 * The planner's placement: `PlannerGrid`'s left column (or stacked under the day
 * cards in «Vista»). The COLUMN is what sticks — `PlannerGrid` puts `xl:sticky`
 * on the flex item, because an aside sticky inside a column exactly its own
 * height has nowhere to travel (the old `lg:sticky lg:top-4` here never moved).
 * What this half owns is the height: from `xl`, where the column sits beside the
 * grid, the aside is capped at the viewport under the navbar — the same offset
 * the column's sticky top adds, `--impersonation-offset` included — less 5.5rem:
 * 1.5rem of breath plus room for «Editar mes»'s sticky save bar or create mode's
 * «Cuenta» control above the chart, whichever this planner has. Under the cap
 * the aside is a flex column and the rows list (`PLANNER_LIST`) is the scroller.
 * Below `xl` nothing is capped: the chart stacks after the grid and the PAGE
 * scrolls, so a phone never gets a scroller inside a scroller.
 */
const DEFAULT_PLACEMENT =
  "xl:flex xl:flex-col xl:max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-var(--impersonation-offset)-5.5rem)] xl:overflow-y-auto";

/**
 * The Servicios board's placement (ADR-0044): the chart stays in view while the
 * cards scroll the PAGE. The top is the admin rail's own sticky top — the navbar
 * is `lg:h-24`, so `top-4` would park the chart UNDER it — and
 * `servicesBoard.test.tsx` reads `AdminRail.tsx` to keep the two identical. The
 * height cap is that same offset — `--impersonation-offset` included, subtracted
 * in the same term order the test derives — plus a 1.5rem breath, so a month
 * with many members scrolls inside the chart instead of pushing its bottom
 * off-screen.
 * Only `lg`: below it the board is one column and the chart is placed LAST,
 * folded behind a «Participaciones» toggle (`ServicesPanel`'s `data-board-chart`).
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

// The board's rows scroller: below `lg` its own 60vh cap, from `lg` it fills the
// capped aside instead (`min-h-0` so a flex item may shrink below its rows).
const LIST_BASE = "space-y-0 max-h-[60vh] overflow-y-auto pr-0.5";
const BOARD_LIST = `${LIST_BASE} lg:min-h-0 lg:flex-1 lg:max-h-none`;

// The planner's rows list: no cap of its own below `xl` (see DEFAULT_PLACEMENT),
// the one scroller of the capped aside from `xl`. `participationAlongside.test.tsx`
// reads its `pr-0.5` into the column's width floor — the 2px a scrollbar may take.
const PLANNER_LIST = "space-y-0 pr-0.5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto";

/**
 * The member bar's width, in px, as an INLINE style: it cannot shrink, which is
 * what makes it the floor `participationAlongside.test.tsx` derives the planner
 * column's width from (it reads this constant). 220 since the «Editar mes»
 * redesign widened the column to 300.
 */
const BAR_W = 220;

/** Someone the month could have counted, for «Sin participar este mes». */
export interface ParticipationPoolMember {
  id: string;
  name: string;
  /** Their Tipo can put them in a voice seat (Lead, BGV, Coro). */
  voces: boolean;
  /** Their Tipo can put them on an instrument or FOH. */
  instrumentos: boolean;
  /** Marked unavailable on every service of the month — the reason they are here. */
  unavailable: boolean;
}

const decimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/**
 * Saturday SERVICES per member, voice seats only — «1 en sábado» on the caption.
 * Counted here rather than added to `computeParticipation`, whose shape is also
 * the MCP's `get_participation` answer: its Saturday chorus is folded into
 * `coro`, so its own fields cannot say this, and a caption is not a reason to
 * change a wire format.
 */
function saturdayServices(roles: ParticipantRole[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of roles) {
    if (r._type !== "saturday_role") continue;
    const ids = new Set([...(r.leads ?? []), ...(r.bgvs ?? []), ...(r.chorus ?? [])].map(m => m._id));
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export function ParticipationSidebar({
  roles,
  monthLabel,
  placement = "default",
  selectedId = null,
  onSelect,
  pool,
}: {
  roles: ParticipantRole[];
  monthLabel: string;
  /** `"board"` only from `ServicesPanel`; the planner keeps the default. */
  placement?: "default" | "board";
  /** The member whose chips the grid outlines — the planner's, never the board's. */
  selectedId?: string | null;
  /** Given ⇒ each name is a toggle that picks (or, again, drops) that member. */
  onSelect?: (id: string | null) => void;
  /** Given ⇒ «Sin participar este mes» lists who in it has no seat of the shown kind. */
  pool?: readonly ParticipationPoolMember[];
}) {
  const [view, setView] = useState<View>("voces");
  const [includeSpecials, setIncludeSpecials] = useIncludeSpecials();
  const switchLabelId = useId();
  // A special is `_type === "special_role"`, the same discriminator
  // `computeParticipation` itself branches on. Dropping the ROLE (not just the
  // `especial` bucket) is what keeps a special's instrument and FOH seats out
  // of the week counts too.
  const counted = useMemo(
    () => (includeSpecials ? roles : roles.filter(r => r._type !== "special_role")),
    [roles, includeSpecials],
  );
  const all = useMemo(() => computeParticipation(counted), [counted]);
  const saturdays = useMemo(() => saturdayServices(counted), [counted]);

  const rows = useMemo(() => {
    if (view === "voces") {
      return all.filter(r => r.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    }
    return all
      .filter(r => r.instrWeeks > 0 || r.fohWeeks > 0)
      .sort((a, b) => (b.instrWeeks + b.fohWeeks) - (a.instrWeeks + a.fohWeeks) || a.name.localeCompare(b.name));
  }, [all, view]);

  const valueOf = (r: MemberParticipation) => (view === "voces" ? r.total : r.instrWeeks + r.fohWeeks);
  const max = Math.max(1, ...rows.map(valueOf));
  // Among the people who served, not the whole roster: «is this one above or
  // below the others who are serving» is the question the marker answers, and
  // the roster's idle half has its own list below. Two rows at least, or the
  // marker only restates the one bar it sits on.
  const average = rows.length >= 2 ? rows.reduce((n, r) => n + valueOf(r), 0) / rows.length : null;

  // «Sin participar» is judged on EVERY service of the month, specials included
  // whatever the switch says: someone who only sang at a vigil did participate,
  // and listing them as idle would be the one wrong answer this list can give.
  const idle = useMemo(() => {
    if (!pool) return [];
    const served = new Set(
      computeParticipation(roles)
        .filter(r => (view === "voces" ? r.total > 0 : r.instrWeeks + r.fohWeeks > 0))
        .map(r => r.id),
    );
    return pool
      .filter(p => (view === "voces" ? p.voces : p.instrumentos) && !served.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pool, roles, view]);

  const legend: readonly (readonly [string, string])[] = view === "voces"
    ? [
        ["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro],
        ...(includeSpecials ? [["Especial", COLORS.especial] as const] : []),
      ]
    : [["Instr", COLORS.instr], ["FOH", COLORS.foh]];

  return (
    <aside className={`${placement === "board" ? BOARD_BASE : ASIDE_BASE} ${placement === "board" ? BOARD_PLACEMENT : DEFAULT_PLACEMENT}`}>
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
        <p className={SHEET_TITLE}>Participaciones</p>
        <p className="mt-1 font-body text-sm text-ink-dim">{monthLabel}</p>
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

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-ink/[0.10] mb-1">
        {legend.map(([l, c]) => (
          <span key={l} className="text-xs text-mono-500 inline-flex items-center gap-1">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
        {average !== null && (
          <span data-average className="text-xs text-mono-500 inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-[11px] w-0.5 rounded-full bg-ink-muted" />
            Promedio {decimal.format(average)}
          </span>
        )}
        {onSelect && rows.length > 0 && (
          <span className="basis-full text-xs text-mono-500">Toca un nombre para verlo en el mes.</span>
        )}
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-mono-500 py-3 text-center">
          {view === "voces" ? "Sin participaciones en voces." : "Sin participaciones en instrumentos / FOH."}
        </p>
      )}

      <div className={placement === "board" ? BOARD_LIST : PLANNER_LIST}>
        {rows.map(r => (
          <Row
            key={r.id}
            r={r}
            max={max}
            average={average}
            view={view}
            includeSpecials={includeSpecials}
            saturdays={saturdays.get(r.id) ?? 0}
            selected={selectedId === r.id}
            onSelect={onSelect}
            board={placement === "board"}
          />
        ))}
        {idle.length > 0 && (
          <div data-idle-pool className="mt-2 pt-2">
            <p className="font-label text-xs uppercase tracking-widest text-mono-500">
              Sin participar este mes · {idle.length}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {idle.map((p, i) => (
                <span key={p.id} data-idle-member={p.id}>
                  {p.name}
                  {p.unavailable && <span className="text-mono-500"> (no disponible)</span>}
                  {i < idle.length - 1 && ", "}
                </span>
              ))}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

/** «1 Líder · 2 BGV · 1 en sábado»: what the bar is made of, zeros left out. */
function caption(r: MemberParticipation, view: View, includeSpecials: boolean, saturdays: number): string {
  const parts = view === "voces"
    ? [
        [r.sunLead + r.satLead, "Líder"],
        [r.sunBGV + r.satBGV, "BGV"],
        [r.coro, "Coro"],
        [includeSpecials ? r.especial : 0, "Especial"],
        [saturdays, "en sábado"],
      ] as const
    : [
        [r.instrWeeks, "sem instrumento"],
        [r.fohWeeks, "sem FOH"],
      ] as const;
  return parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ");
}

function Row({ r, max, average, view, includeSpecials, saturdays, selected, onSelect, board }: {
  r: MemberParticipation;
  max: number;
  average: number | null;
  view: View;
  includeSpecials: boolean;
  saturdays: number;
  selected: boolean;
  onSelect?: (id: string | null) => void;
  /** On the Servicios board the row is a hairline of the «millones» pass (15 px name, display-face count); the planner keeps its compact row. */
  board?: boolean;
}) {
  const value = view === "voces" ? r.total : r.instrWeeks + r.fohWeeks;
  const barW = Math.round((value / max) * BAR_W);
  const u = value > 0 ? barW / value : 0;
  const seg = (n: number, c: string) => n > 0
    ? <span style={{ display: "inline-block", height: 8, width: Math.round(n * u), background: c }} /> : null;
  const nameClass = board
    ? "block max-w-full truncate text-left font-body text-[15px] font-semibold text-ink"
    : "block max-w-full truncate text-left text-[13px] font-medium text-ink-muted";

  return (
    <div
      data-member-row={r.id}
      data-selected={selected ? "true" : undefined}
      className={`flex items-center gap-2.5 ${board ? "py-2 border-b border-ink/[0.08]" : "py-1 border-b border-accent/10"} ${selected ? "bg-accent/10" : ""}`}
    >
      <div className="flex-1 min-w-0">
        {onSelect ? (
          // A bare <button>, not `Button`: that primitive is a padded, centred
          // control (semibold since 2026-10-27) and this is a member's NAME,
          // which must read exactly like the board's plain one. A toggle, so
          // `aria-pressed` carries the state a sighted admin reads off the tint.
          <button
            type="button"
            aria-pressed={selected}
            title={selected ? "Quitar el resaltado" : "Resaltar en el mes"}
            onClick={() => onSelect(selected ? null : r.id)}
            className={`${nameClass} rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${selected ? "text-accent" : ""}`}
          >
            {r.name}
          </button>
        ) : (
          <div className={nameClass}>{r.name}</div>
        )}
        <div className="text-xs text-mono-500 truncate">{caption(r, view, includeSpecials, saturdays)}</div>
        <div className="relative mt-1 rounded overflow-hidden flex" style={{ width: BAR_W, background: themeColour("--accent-rgb", 0.08) }}>
          {view === "voces"
            ? <>{seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}{includeSpecials && seg(r.especial, COLORS.especial)}</>
            : <>{seg(r.instrWeeks, COLORS.instr)}{seg(r.fohWeeks, COLORS.foh)}</>}
          {average !== null && (
            <span
              aria-hidden="true"
              data-average-marker
              className="absolute inset-y-0 w-0.5 bg-ink-muted"
              style={{ left: Math.min(BAR_W - 2, Math.round((average / max) * BAR_W)) }}
            />
          )}
        </div>
      </div>
      <div className={`${board ? "font-display text-[22px] font-semibold" : "text-xl font-medium"} text-ink-muted min-w-[24px] text-right`}>
        <NumberRoll value={value} />
      </div>
    </div>
  );
}
