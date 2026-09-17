"use client";

import { useState, useEffect, useCallback, useReducer, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import ServicesPanel from "./ServicesPanel";
import ActivityPanel from "./ActivityPanel";
import ContentPanel from "./ContentPanel";
import AvailabilityPanel from "./AvailabilityPanel";
import ProposalsPanel from "./ProposalsPanel";
import IntegrityQueuePanel from "./IntegrityQueuePanel";
import AdminRail, { ADMIN_TAB_ICON } from "./AdminRail";
import { useIntegrityQueue } from "./useIntegrityQueue";
import { ServiceHandoffProvider, type ServiceHandoffApi } from "./serviceHandoffContext";
import {
  reduceReviewTarget,
  type AdminReviewTarget,
  type AdminTabId,
  type IntegrityIssueTarget,
  type ProposalReviewTarget,
} from "./proposalHandoff";
import { visibleAdminTabs } from "./adminTabs";
import MembersPanel from "./MembersPanel";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

// ─── Tab nav ──────────────────────────────────────────────────────────────────
// The tab union lives beside the transient handoff target (`proposalHandoff`), so
// one reducer owns both and a manual tab change cannot leave a stale target.
// The bar itself is `AdminRail` now: a vertical rail at `lg`, the underline strip
// below it (R5 ruling 3).
type Tab = AdminTabId;

// ─── Main panel ───────────────────────────────────────────────────────────────
export default function AdminPanel({
  role = "super-admin",
  initialTab,
  tabNamedInUrl = false,
}: {
  role?: OWTRole;
  /** Resolved from `?tab=` on the server; see `adminTabs.resolveAdminTab`. */
  initialTab?: Tab;
  /** True only when the URL actually named that tab, rather than falling back. */
  tabNamedInUrl?: boolean;
}) {
  const { data: session } = useSession();
  const viewerId = session?.user?.sanityId ?? null;
  const firstTab = visibleAdminTabs(role)[0]?.id ?? "content";
  // `{ tab, target }` in ONE reducer: a manual tab change always clears the
  // transient handoff target, and a successful focus consumes it, so a remount
  // can never resurrect an obsolete filter/highlight.
  const [review, dispatchReview] = useReducer(reduceReviewTarget, {
    tab: initialTab ?? firstTab,
    target: null,
  });
  const tab = review.tab;
  const setTab = useCallback(
    (next: Tab) => dispatchReview({ type: "select_tab", tab: next }),
    [],
  );

  // A soft navigation re-renders this panel in place with a new `initialTab`
  // rather than remounting it, and `useReducer`'s initial value is read once.
  //
  // Gated on `tabNamedInUrl`, which is the difference between "the URL asked
  // for a tab" and "the server fell back to one". Without that gate the same
  // gesture had two outcomes: tapping "Admin" in the nav sent the admin back to
  // Miembros or left them where they were, depending only on how they had
  // arrived at /admin minutes earlier — invisible to them, and it also cleared
  // any pending handoff target. Now a link that NAMES a tab moves the panel,
  // and a link to plain /admin is the no-op it looks like; the effect below
  // keeps the address bar honest either way.
  //
  // Adjusted during render, the documented React pattern for a changed prop, so
  // it costs no extra commit.
  //
  // Seeded from `initialTab` only when the URL NAMED it. Seeding from a
  // fallback would record a tab no URL ever asked for: open bare /admin, click
  // Actividad, then follow a colleague's link to `?tab=members` — the value
  // matches the fallback recorded on arrival, so the link would visibly do
  // nothing. Remaining edge, accepted: following the same named tab twice after
  // moving away by hand cannot be told apart by value, and telling it apart
  // needs a per-navigation nonce that is not worth its weight here.
  const [lastResolvedTab, setLastResolvedTab] = useState(tabNamedInUrl ? initialTab : undefined);
  if (tabNamedInUrl && initialTab !== undefined && initialTab !== lastResolvedTab) {
    setLastResolvedTab(initialTab);
    dispatchReview({ type: "select_tab", tab: initialTab });
  }

  /**
   * Keep `?tab=` in step with the visible tab, so a reload or a Back into
   * /admin lands where the admin was instead of on the first tab. Before this
   * the tab lived only in the reducer, and an admin deep in Servicios who
   * refreshed was dropped to Miembros mid-task.
   *
   * `history.replaceState`, deliberately, not the router:
   *   - `router.push` would make Back walk the tabs one by one, so leaving
   *     /admin would take as many presses as tabs visited.
   *   - `router.replace` re-renders the route segment; this panel fetches the
   *     member list and holds filters, and re-running that on every tab press
   *     is a real cost for a purely local change.
   * Rewriting the current entry keeps the URL honest for reload and Back
   * without any navigation at all. The panel itself creates no history entries;
   * the router still creates one per nav-menu tap, all carrying this same URL,
   * so a Back press out of /admin may need repeating after several taps.
   *
   * PASSING THE EXISTING `history.state` IS DELIBERATE, and it has a cost worth
   * knowing before anyone "fixes" it. Next patches `replaceState` and returns
   * early when the state carries `__NA`, which every app-router entry does — so
   * `applyUrlFromHistoryPushReplace` is skipped and the router's `canonicalUrl`
   * keeps saying `/admin`. Consequence: `useSearchParams()` under /admin will
   * NOT see this param. Read the tab from the `initialTab` prop, which the
   * server resolved, and never from that hook.
   *
   * Passing `null` would let Next sync — it would NOT lose the router's own
   * state, since `copyNextJsInternalHistoryState` copies `__NA` and the
   * internals tree back off the current entry — but it dispatches
   * ACTION_RESTORE, which in Next 16 runs `startPPRNavigation` and
   * `spawnDynamicRequests`, falling back to a full page load when the former
   * returns null. That is a server round-trip on this dynamic, auth-gated route
   * for EVERY tab press: the exact cost this approach exists to avoid, paid
   * every time instead of never. Read out of
   * `next/dist/client/components/app-router.js` and `restore-reducer.js` in the
   * vendored copy, not the changelog.
   *
   * NO DEPENDENCY ARRAY, deliberately. Because `canonicalUrl` stays stale, any
   * router commit while the admin stays on this page makes `HistoryUpdater`
   * rewrite the address bar back to plain `/admin`. Keyed on `[tab]` this
   * effect would not re-run and the param would be lost until the next tab
   * press — including on the plain path where the admin picks a tab by click
   * and then taps "Admin" in the nav. Re-asserting on every render costs one
   * URL parse and returns immediately when the param already matches, and it
   * cannot loop: the write reaches no React state, precisely because of the
   * `__NA` skip above.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === tab) return;
    url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  });
  const onReviewResolved = useCallback(
    (outcome: string) => dispatchReview({ type: "resolved", outcome }),
    [],
  );
  const handoff = useMemo<ServiceHandoffApi>(
    () => ({
      openProposalReview: (target: ProposalReviewTarget) =>
        dispatchReview({ type: "open_target", target }),
      openIntegrityIssue: (target: IntegrityIssueTarget) =>
        dispatchReview({ type: "open_target", target }),
      openReviewTarget: (target: AdminReviewTarget | null) => {
        if (target) dispatchReview({ type: "open_target", target });
      },
      clearReviewTarget: () => dispatchReview({ type: "clear" }),
    }),
    [],
  );
  const proposalTarget = review.target?.kind === "proposal_review" ? review.target : null;
  const integrityTarget = review.target?.kind === "integrity_issue" ? review.target : null;
  const railTabs = useMemo(
    () => visibleAdminTabs(role).map((t) => ({ ...t, icon: ADMIN_TAB_ICON[t.id] })),
    [role],
  );
  // ONE integrity load for the page (R5 ruling 4), at the top level rather than
  // inside the Servicios branch: the rail's dot has to be live on every tab, and
  // two callers fetching their own copy could disagree about whether the
  // inventory is clean.
  //
  // Gated on the TAB, not on a role list: the three routes are Servicios' own,
  // so a `content-editor`, who has no Servicios tab, would otherwise take three
  // 403s on every /admin load for a dot that is never rendered for them. One
  // predicate decides both, and it is the same one that builds the rail.
  const showsServices = useMemo(() => railTabs.some((t) => t.id === "services"), [railTabs]);
  const integrity = useIntegrityQueue({ enabled: showsServices, onResolved: onReviewResolved });
  // Entering Servicios re-reads the inventory. The queue is loaded once per
  // mount otherwise (`docs/SERVICE_READINESS_UI.md`), and a manager who fixes a
  // document in Studio and comes back to the tab should not have to find
  // «Recargar» to see it. Deliberately NOT on first mount — `reload` already ran
  // there, and a second pass would be three duplicate requests on every load.
  const reloadIntegrity = integrity.reload;
  const prevTabRef = useRef(tab);
  useEffect(() => {
    const previous = prevTabRef.current;
    prevTabRef.current = tab;
    if (tab === "services" && previous !== "services") reloadIntegrity();
  }, [tab, reloadIntegrity]);
  // ── One tree, not six ────────────────────────────────────────────────────
  // Every tab used to `return` early with its OWN <TabBar> and its own
  // `brand-surface` panel box. One tab bar renders now, the body is keyed by
  // tab, and the boxes are gone (ADR-0035) — the cards inside a panel are the
  // only frames left on this page.

  const body = (() => {
    switch (tab) {
      case "services":
        return (
          <ServiceHandoffProvider value={handoff}>
            <div className="min-w-0 space-y-4">
              {/* Read-only global integrity queue: issues no validated card owns. */}
              <IntegrityQueuePanel
                queue={integrity.queue}
                tone={integrity.tone}
                sources={integrity.sources}
                reload={integrity.reload}
                target={integrityTarget}
                onResolved={integrity.resolve}
              />
              <ServicesPanel />
            </div>
          </ServiceHandoffProvider>
        );
      case "proposals":
        return (
          <ServiceHandoffProvider value={handoff}>
            <ProposalsPanel target={proposalTarget} onResolved={onReviewResolved} viewerId={viewerId} />
          </ServiceHandoffProvider>
        );
      case "availability":
        return <AvailabilityPanel />;
      case "activity":
        return <ActivityPanel />;
      case "content":
        return <ContentPanel canDelete={role === "super-admin" || role === "admin"} />;
      default:
        // The Miembros body is its OWN component since R5 Task 3 — it holds the
        // member list, every member write and four dialogs, and it renders only
        // on this tab (Task 6 mounts it behind `next/dynamic`).
        return <MembersPanel role={role} />;
    }
  })();

  return (
    // `--admin-rail-w` (200px by default) is the rail's column: `app/brand.css`
    // drops it to 56px while the planner is open, so the widened frame's
    // arithmetic has ONE number for the rail rather than two that can drift.
    // `space-y-6` is the phone's gap between the strip and the body — below `lg`
    // this is a plain block and the grid's `gap` does not apply.
    <div className="mt-6 space-y-6 lg:grid lg:grid-cols-[var(--admin-rail-w,200px)_1fr] lg:gap-8 lg:space-y-0">
      <AdminRail
        tabs={railTabs}
        active={tab}
        onChange={setTab}
        integrityTone={integrity.tone}
        integrityCount={integrity.queue.count}
      />
      {/* `key={tab}`: the incoming panel MOUNTS and fades in rather than the
          outgoing one being held alive beside it. These panels are thousands of
          lines each and only the active one is ever mounted. */}
      <div key={tab} className="brand-admin-workspace min-w-0 animate-fade-in">
        {body}
      </div>
    </div>
  );
}

