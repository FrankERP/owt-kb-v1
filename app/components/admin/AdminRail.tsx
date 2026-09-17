"use client";

// The Control Room's section nav (R5 ruling 3).
//
// ONE component, two layouts, because they are one control: a vertical RAIL in
// the 200px column the admin grid reserves at `lg`, and below `lg` the
// horizontal underline STRIP the page has always had. Both are always in the
// DOM and CSS picks one (`hidden lg:flex` / `lg:hidden`) — a JS media query
// would render the wrong one on the first paint of a server-rendered page.
//
// The two `SlidingIndicator` ids differ ON PURPOSE. The indicator is a shared
// `layoutId`: one id across both layouts would make the pill and the underline
// the same projected element, and at the breakpoint (or on a resize) it would
// animate from the strip's position to the rail's across the page. Two ids, two
// independent markers, each confined to the layout that can see it.
//
// The rail COLLAPSES to icons while the planner is open (`app/brand.css`,
// `.brand-admin-frame:has(.planner-wide)`): the labels go `display: none`, which
// takes them out of the accessibility tree too — so every item carries an
// explicit `aria-label`, collapsed or not, and the label is also where the
// Servicios item states its integrity count for a screen reader. The visible
// dot is decoration (`aria-hidden`).

import type { AdminTabId } from "./proposalHandoff";
import SlidingIndicator, { useActiveIntoView } from "../ui/SlidingIndicator";
import { haptic } from "@/app/utils/haptics";

/** The three states the integrity queue can be in. `unknown` never reads clean. */
export type IntegrityTone = "clean" | "unknown" | "issues";

export interface AdminRailTab {
  id: AdminTabId;
  label: string;
  icon: React.ReactNode;
}

const ITEM =
  "relative flex select-none items-center gap-3 rounded-lg px-4 min-h-[44px] font-label text-xs uppercase tracking-widest " +
  "transition-[color,background-color,transform] duration-fast ease-out-brand " +
  "active:translate-y-px active:scale-[0.985] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base";

const ITEM_TONE = (active: boolean) =>
  active ? "text-accent" : "text-ink-dim hover:bg-accent/[0.04] hover:text-ink";

export default function AdminRail({
  tabs,
  active,
  onChange,
  integrityTone,
  integrityCount = 0,
}: {
  tabs: ReadonlyArray<AdminRailTab>;
  active: AdminTabId;
  onChange: (id: AdminTabId) => void;
  integrityTone: IntegrityTone;
  integrityCount?: number;
}) {
  const select = (id: AdminTabId) => {
    void haptic("selection");
    onChange(id);
  };

  /** The Servicios item says its integrity state in its name, not only in colour. */
  const nameOf = (tab: AdminRailTab) => {
    if (tab.id !== "services" || integrityTone === "clean") return tab.label;
    if (integrityTone === "unknown") return `${tab.label}, integridad desconocida`;
    const n = integrityCount;
    return `${tab.label}, ${n} ${n === 1 ? "problema" : "problemas"} de integridad`;
  };

  const dotOf = (tab: AdminRailTab) =>
    tab.id === "services" ? <IntegrityDot tone={integrityTone} count={integrityCount} /> : null;

  return (
    <>
      {/* ≥ lg: the rail. Sticky under the navbar, in the grid's first column. */}
      <nav
        aria-label="Secciones"
        data-admin-rail=""
        className="brand-admin-rail sticky top-[calc(6rem+env(safe-area-inset-top))] hidden flex-col gap-1 self-start lg:flex"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={active === tab.id ? "page" : undefined}
            aria-label={nameOf(tab)}
            onClick={() => select(tab.id)}
            className={`${ITEM} ${ITEM_TONE(active === tab.id)}`}
          >
            {active === tab.id && <SlidingIndicator id="admin-rail" variant="pill" />}
            <span aria-hidden="true" className="relative shrink-0">
              {tab.icon}
            </span>
            <span data-rail-label className="relative min-w-0 truncate">
              {tab.label}
            </span>
            {dotOf(tab)}
          </button>
        ))}
      </nav>

      {/* < lg: today's underline strip, unchanged in behaviour. */}
      <div className="relative lg:hidden" data-admin-tabs="bar">
        <div className="-mx-2 overflow-x-auto px-2 pb-1">
          <div className="flex w-max min-w-full gap-1">
            {tabs.map((tab) => (
              <StripItem
                key={tab.id}
                active={active === tab.id}
                label={tab.label}
                name={nameOf(tab)}
                dot={dotOf(tab)}
                onSelect={() => select(tab.id)}
              />
            ))}
          </div>
        </div>
        {/* Scroll-fade hint (phone, where the tabs overflow) */}
        <div className="pointer-events-none absolute bottom-1 right-0 top-0 w-8 bg-gradient-to-l from-surface-base to-transparent md:hidden" />
      </div>
    </>
  );
}

function StripItem({
  active,
  label,
  name,
  dot,
  onSelect,
}: {
  active: boolean;
  label: string;
  name: string;
  dot: React.ReactNode;
  onSelect: () => void;
}) {
  const ref = useActiveIntoView(active);
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={name}
      onClick={onSelect}
      className={`${ITEM} whitespace-nowrap ${ITEM_TONE(active)}`}
    >
      {active && <SlidingIndicator id="admin-strip" variant="underline" />}
      <span data-rail-label className="relative">
        {label}
      </span>
      {dot}
    </button>
  );
}

/**
 * Three states, never two: nothing at all when the inventory is proven clean, a
 * dim `?` when a domain failed or is still loading, the count when there are
 * real issues. A clean-looking nothing on an unproven inventory is the one
 * reading this control must never produce.
 */
function IntegrityDot({ tone, count }: { tone: IntegrityTone; count: number }) {
  if (tone === "clean") return null;
  return (
    <span
      data-integrity={tone}
      aria-hidden="true"
      className={`relative ml-auto shrink-0 font-label text-[11px] tabular-nums ${
        tone === "unknown" ? "text-ink-dim" : "text-negative-fg"
      }`}
    >
      {tone === "unknown" ? "?" : count}
    </span>
  );
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * One glyph per tab, declared once. House glyphs: the same 24-viewBox stroked
 * outlines the admin table's own icons use, at 20px.
 */
export const ADMIN_TAB_ICON: Record<AdminTabId, React.ReactNode> = {
  members: (
    <svg {...ICON_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  services: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  ),
  proposals: (
    <svg {...ICON_PROPS}>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M5.5 5h13l2.5 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" />
    </svg>
  ),
  availability: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  activity: (
    <svg {...ICON_PROPS}>
      <path d="M3 12h4l3 7 4-14 3 7h4" />
    </svg>
  ),
  content: (
    <svg {...ICON_PROPS}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
};
