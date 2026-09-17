"use client";

// The ONE place the three service-integrity inventories are fetched (R5 ruling 4).
//
// This is `IntegrityQueuePanel`'s own loader, lifted out of it unchanged: the
// three independent domain loads, the `buildIntegrityQueue` derivation, and the
// per-domain retry. It moved because TWO surfaces read the same state now — the
// panel and the rail's Servicios dot — and two callers each mounting their own
// copy would mean two sets of requests that can disagree about whether the
// inventory is clean. `AdminPanel` calls this once, at the top level, so the dot
// is live on every tab rather than only while Servicios is mounted.
//
// Everything it preserves is load-bearing:
//  - the three domains load INDEPENDENTLY, and a failed one is never rendered as
//    an empty one (`sources` keeps `loading`/`error`/`ready` per domain, and the
//    tone reads `unknown` rather than `clean`);
//  - it consumes `/api/admin/service-integrity/*`, never Sanity, so
//    `protectedReadAudit` needs no new entry;
//  - it mutates nothing.
//
// `resolve` is the panel's `onResolved` plumbing with a STABLE identity: the
// panel's focus effect lists it as a dependency, and an inline arrow from
// `AdminPanel` would re-run that effect on every render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import {
  INTEGRITY_DOMAINS,
  INTEGRITY_DOMAIN_SOURCE,
  buildIntegrityQueue,
  cardsFromRoleTargets,
  integrityQueueTone,
  type IntegrityCardRef,
  type IntegrityDomain,
  type IntegrityQueue,
  type IntegritySourceStates,
} from "./serviceIntegrityQueue";
import type { IntegrityTone } from "./AdminRail";

export const INTEGRITY_DOMAIN_ROUTE: Record<IntegrityDomain, string> = {
  roles: "/api/admin/service-integrity/roles",
  setlists: "/api/admin/service-integrity/setlists",
  proposals: "/api/admin/service-integrity/proposals",
};

interface DomainData {
  roles: RoleDomainSummary | null;
  setlists: SetlistDomainSummary | null;
  proposals: ProposalDomainSummary | null;
}

export interface IntegrityQueueState {
  queue: IntegrityQueue;
  /** The three display states — `issues_incomplete` reads as `issues`. */
  tone: IntegrityTone;
  /** The per-domain load states, for explicit-id focus resolution. */
  sources: IntegritySourceStates;
  /** True while any domain is still in flight. */
  loading: boolean;
  /** Re-runs all three inventories. */
  reload: () => void;
  /** Forwards a focus outcome to the caller's handler, with a stable identity. */
  resolve: (outcome: string) => void;
}

export function useIntegrityQueue(
  onResolved?: (outcome: string) => void,
  /**
   * The validated cards currently rendered, so associated issues leave the
   * queue. Omit (or pass `null`) to derive them from A1's own role inventory.
   */
  cards: readonly IntegrityCardRef[] | null = null,
): IntegrityQueueState {
  const [sources, setSources] = useState<IntegritySourceStates>({
    roleTargets: "loading",
    setlistTargets: "loading",
    proposals: "loading",
  });
  const [data, setData] = useState<DomainData>({ roles: null, setlists: null, proposals: null });

  const loadDomain = useCallback(async (domain: IntegrityDomain) => {
    const sourceKey = INTEGRITY_DOMAIN_SOURCE[domain];
    setSources((prev) => ({ ...prev, [sourceKey]: "loading" }));
    try {
      const res = await fetch(INTEGRITY_DOMAIN_ROUTE[domain]);
      if (!res.ok) {
        setData((prev) => ({ ...prev, [domain]: null }));
        setSources((prev) => ({ ...prev, [sourceKey]: "error" }));
        return;
      }
      const body = await res.json();
      setData((prev) => ({ ...prev, [domain]: body }));
      setSources((prev) => ({ ...prev, [sourceKey]: "ready" }));
    } catch {
      // A failed inventory is never rendered as an empty one.
      setData((prev) => ({ ...prev, [domain]: null }));
      setSources((prev) => ({ ...prev, [sourceKey]: "error" }));
    }
  }, []);

  const reload = useCallback(() => {
    for (const domain of INTEGRITY_DOMAINS) void loadDomain(domain);
  }, [loadDomain]);

  useEffect(() => {
    reload();
  }, [reload]);

  const resolvedCards = useMemo(
    () => cards ?? cardsFromRoleTargets(data.roles),
    [cards, data.roles],
  );

  const queue = useMemo(
    () =>
      buildIntegrityQueue({
        sources,
        cards: resolvedCards,
        roles: data.roles,
        setlists: data.setlists,
        proposals: data.proposals,
      }),
    [sources, resolvedCards, data],
  );

  const raw = integrityQueueTone(queue);
  const tone: IntegrityTone = raw === "clean" ? "clean" : raw === "unknown" ? "unknown" : "issues";

  // The latest handler behind a STABLE `resolve`. Written in an effect, not
  // during render (`react-hooks/refs` is an error here, and it is right: a ref
  // written while rendering is a ref read by a render that was thrown away).
  // The one ordering caveat: a CHILD's effect runs before this one, so a child
  // that resolves on its very first commit reaches the handler this hook was
  // mounted with — which is why `AdminPanel` hands it a `useCallback` that never
  // changes rather than an inline arrow.
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);
  const resolve = useCallback((outcome: string) => onResolvedRef.current?.(outcome), []);

  const loading = Object.values(sources).some((state) => state === "loading");

  return { queue, tone, sources, loading, reload, resolve };
}
