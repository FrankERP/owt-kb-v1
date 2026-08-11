"use client";

// Read-only `Integridad de datos` queue (Plan B item 6, plan §"Global integrity
// queue").
//
// Every decision lives in the pure `serviceIntegrityQueue` module; this file only
// loads the three A1 integrity routes independently and renders the result. It
// therefore:
//  - never queries Sanity directly (it consumes `/api/admin/service-integrity/*`,
//    so `protectedReadAudit` needs no new entry);
//  - never mutates anything: entries name the guarded cleanup/support action and
//    hand over the exact ids. There is no free-form Studio mutation here;
//  - never shows zero/clean when an inventory failed — the header says the queue
//    may be incomplete and offers a per-domain retry;
//  - is keyed by explicit document/draft ids, so an `IntegrityIssueTarget` can
//    focus an entry by id (load failure and not-found are distinct outcomes).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import {
  INTEGRITY_ACTION_COPY,
  INTEGRITY_DOMAINS,
  INTEGRITY_DOMAIN_SOURCE,
  INTEGRITY_INCOMPLETE_NOTE,
  INTEGRITY_KIND_LABEL,
  INTEGRITY_QUEUE_TITLE,
  buildIntegrityQueue,
  cardsFromRoleTargets,
  describeIntegrityReason,
  integrityQueueSummary,
  integrityQueueTone,
  resolveIntegrityFocus,
  type IntegrityCardRef,
  type IntegrityDomain,
  type IntegrityQueueEntry,
  type IntegritySourceStates,
} from "./serviceIntegrityQueue";
import type { IntegrityIssueTarget } from "./proposalHandoff";

const DOMAIN_ROUTE: Record<IntegrityDomain, string> = {
  roles: "/api/admin/service-integrity/roles",
  setlists: "/api/admin/service-integrity/setlists",
  proposals: "/api/admin/service-integrity/proposals",
};

const DOMAIN_LABEL: Record<IntegrityDomain, string> = {
  roles: "servicios",
  setlists: "setlists",
  proposals: "propuestas",
};

interface DomainData {
  roles: RoleDomainSummary | null;
  setlists: SetlistDomainSummary | null;
  proposals: ProposalDomainSummary | null;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface IntegrityQueuePanelProps {
  /**
   * The validated cards currently rendered, so associated issues leave the queue.
   * Omit (or pass `null`) to derive them from A1's own role inventory; pass an
   * explicit array — including `[]` — to override that.
   */
  cards?: readonly IntegrityCardRef[] | null;
  /** A transient integrity target to reveal by explicit id. */
  target?: IntegrityIssueTarget | null;
  /** Called with the focus outcome; a successful `focus` consumes the target. */
  onResolved?: (outcome: string) => void;
}

export default function IntegrityQueuePanel({
  cards = null,
  target = null,
  onResolved,
}: IntegrityQueuePanelProps) {
  const [sources, setSources] = useState<IntegritySourceStates>({
    roleTargets: "loading",
    setlistTargets: "loading",
    proposals: "loading",
  });
  const [data, setData] = useState<DomainData>({ roles: null, setlists: null, proposals: null });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [focusKeys, setFocusKeys] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const entryRefs = useRef(new Map<string, HTMLLIElement | null>());
  const scrollTargetRef = useRef<string | null>(null);

  const loadDomain = useCallback(async (domain: IntegrityDomain) => {
    const sourceKey = INTEGRITY_DOMAIN_SOURCE[domain];
    setSources((prev) => ({ ...prev, [sourceKey]: "loading" }));
    try {
      const res = await fetch(DOMAIN_ROUTE[domain]);
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

  const loadAll = useCallback(() => {
    for (const domain of INTEGRITY_DOMAINS) void loadDomain(domain);
  }, [loadDomain]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  const tone = integrityQueueTone(queue);

  // ── Explicit-id focus for a transient integrity target ────────────────────
  useEffect(() => {
    // A cleared target must not wipe the reveal: focus consumes the target, and
    // the expanded/highlighted entry belongs to this panel from then on.
    if (!target) return;
    const result = resolveIntegrityFocus(target.ids, queue, sources);
    if (result.outcome === "waiting") return;
    if (result.outcome === "load_failed") {
      setNotice("No se pudo cargar el inventario de integridad. Vuelve a intentarlo.");
      onResolved?.(result.outcome);
      return;
    }
    if (result.outcome === "not_found") {
      setNotice(
        `Estos ids ya no están en el inventario: ${result.missingIds.join(", ") || "(sin ids)"}.`,
      );
      onResolved?.(result.outcome);
      return;
    }
    setOpen(true);
    setFocusKeys(result.keys);
    setExpanded((prev) => {
      const next = { ...prev };
      for (const key of result.keys) next[key] = true;
      return next;
    });
    setNotice(
      result.missingIds.length > 0
        ? `Algunos ids ya no están en el inventario: ${result.missingIds.join(", ")}.`
        : null,
    );
    // Defer the reveal: the section only un-hides on the NEXT render, and a hidden
    // element cannot take focus.
    scrollTargetRef.current = result.keys[0];
    onResolved?.(result.outcome);
    // `queue`/`sources` are the resolution inputs; `onResolved` is stable enough.
  }, [target, queue, sources, onResolved]);

  useEffect(() => {
    const key = scrollTargetRef.current;
    if (!key || !open) return;
    const el = entryRefs.current.get(key);
    if (!el) return;
    scrollTargetRef.current = null;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, [focusKeys, open, queue]);

  const toneStyle =
    tone === "clean"
      ? "border-green-500/25 text-green-400"
      : tone === "unknown"
        ? "border-yellow-500/30 text-yellow-400"
        : "border-red-500/30 text-red-400";

  return (
    <section
      aria-labelledby="integrity-queue-title"
      className="min-w-0 rounded-xl border border-edge-accent-subtle"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="integrity-queue-body"
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span
            aria-hidden="true"
            className={`font-label text-xs transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▸
          </span>
          <span className="min-w-0">
            <span
              id="integrity-queue-title"
              className="block font-label text-xs uppercase tracking-widest"
            >
              {INTEGRITY_QUEUE_TITLE}
            </span>
            <span className="block font-body text-xs text-gray-400">
              {integrityQueueSummary(queue)}
            </span>
          </span>
        </button>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${toneStyle}`}
        >
          {tone === "clean" ? "OK" : tone === "unknown" ? "?" : queue.count}
        </span>
        <button
          type="button"
          onClick={loadAll}
          className="min-h-[44px] shrink-0 rounded-lg border border-surface-accent-30 px-3 font-label text-[11px] uppercase tracking-widest text-gray-400 transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Recargar
        </button>
      </div>

      {/* Honest partial-source state: never a clean zero. */}
      {queue.incomplete && (
        <div className="mx-3 mb-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 sm:mx-4">
          <p className="font-body text-xs text-yellow-200/90">{INTEGRITY_INCOMPLETE_NOTE}</p>
          <ul className="mt-1 space-y-0.5">
            {queue.unproven.map((u) => (
              <li key={u.source} className="font-body text-xs text-yellow-200/70">
                {u.state === "loading" ? "Cargando" : "Falló"}:{" "}
                {DOMAIN_LABEL[
                  INTEGRITY_DOMAINS.find((d) => INTEGRITY_DOMAIN_SOURCE[d] === u.source) ?? "roles"
                ]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p
          role="status"
          className="mx-3 mb-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 font-body text-xs text-accent sm:mx-4"
        >
          {notice}
        </p>
      )}

      <div id="integrity-queue-body" hidden={!open}>
        {queue.count === 0 ? (
          <p className="px-3 pb-3 font-body text-xs text-gray-500 sm:px-4">
            {queue.incomplete
              ? "No se encontraron problemas en los dominios que sí se pudieron leer."
              : "Ningún documento quedó fuera de un servicio válido."}
          </p>
        ) : (
          <ul className="space-y-2 px-3 pb-3 sm:px-4">
            {queue.entries.map((entry) => (
              <QueueEntry
                key={entry.key}
                entry={entry}
                expanded={!!expanded[entry.key]}
                focused={focusKeys.includes(entry.key)}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }))
                }
                register={(el) => entryRefs.current.set(entry.key, el)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QueueEntry({
  entry,
  expanded,
  focused,
  onToggle,
  register,
}: {
  entry: IntegrityQueueEntry;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
  register: (el: HTMLLIElement | null) => void;
}) {
  const bodyId = `integrity-entry-${entry.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <li
      ref={register}
      tabIndex={-1}
      className={`min-w-0 rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        focused
          ? "border-accent bg-accent/10"
          : "border-edge-accent-subtle bg-surface-accent-l5-d3"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex min-h-[44px] w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="font-body text-sm font-semibold [overflow-wrap:anywhere]">
          {INTEGRITY_KIND_LABEL[entry.kind]}
        </span>
        <span className="font-mono text-[11px] text-gray-400 [overflow-wrap:anywhere]">
          {entry.ids.join(" · ") || "(sin id)"}
        </span>
      </button>

      <div id={bodyId} hidden={!expanded} className="space-y-1.5 px-3 pb-3">
        <Row label="Tipo" value={entry.kind} mono />
        <Row label="Dominio" value={DOMAIN_LABEL[entry.domain]} />
        {entry.targetKey && <Row label="Objetivo" value={entry.targetKey} mono />}
        <Row
          label="Motivo"
          value={entry.reasons.map(describeIntegrityReason).join(" · ") || "sin detalle"}
        />
        {entry.relatedIds.length > 0 && (
          <Row label="Ids relacionados" value={entry.relatedIds.join(" · ")} mono />
        )}
        <p className="rounded-lg border border-accent/20 bg-accent/5 px-2.5 py-2 font-body text-xs text-accent/90 [overflow-wrap:anywhere]">
          {INTEGRITY_ACTION_COPY[entry.action]}
        </p>
      </div>
    </li>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="min-w-0 font-body text-xs text-gray-400 [overflow-wrap:anywhere]">
      <span className="font-label uppercase tracking-widest text-gray-500">{label}: </span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </p>
  );
}
