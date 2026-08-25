"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTransientValue } from "@/app/utils/useTransientValue";

import {
  HANDOFF_NOTICE,
  resolveProposalHandoff,
  type ProposalFilter,
  type ProposalReviewStatus,
  type ProposalReviewTarget,
} from "./proposalHandoff";
import {
  WIDEN_STEP_MONTHS,
  applyProposalWindow,
  sortProposals,
  widenStepsForTargets,
} from "./proposalListView";
import { serviceTodayIso } from "./serviceReadiness";

/** The four stored statuses, from the shared handoff contract. */
type ProposalStatus = ProposalReviewStatus;

interface ProposalSong {
  _key: string;
  play_key: string;
  song_id: string;
  title: string;
  author: string;
  key: string;
  medley_tag?: string;
}

interface Proposal {
  _id: string;
  /** The revision this card was rendered from — submitted with every transition. */
  _rev: string;
  service_type: "sunday" | "saturday" | "special";
  service_date: string;
  status: ProposalStatus;
  lead_name: string;
  lead_id: string;
  lead_notes?: string;
  team_notes?: string;
  admin_notes?: string;
  submitted_at?: string;
  contributors?: Array<{ id: string; name: string }>;
  songs: ProposalSong[];
}

type ProposalAction = "approve" | "request_changes" | "reopen";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SERVICE_LABEL: Record<string, string> = {
  sunday: "Domingo",
  saturday: "Sábado",
  special: "Especial",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "bg-mono-500/15 text-mono-400 border border-mono-500/30",
  pending: "bg-recency-fg/15 text-recency-strong border border-recency-fg/30",
  approved: "bg-positive-deep/15 text-positive-strong border border-positive-deep/30",
  changes_requested: "bg-negative-strong/15 text-negative-fg border border-negative-strong/30",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  changes_requested: "Cambios",
};

// ─── ProposalCard ─────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onAction,
  highlighted,
  register,
}: {
  proposal: Proposal;
  onAction: (
    proposal: Proposal,
    action: ProposalAction,
    notes?: string,
  ) => Promise<{ ok: boolean; conflict: boolean }>;
  /** True when a `ProposalReviewTarget` handoff resolved to this exact id. */
  highlighted?: boolean;
  register?: (el: HTMLDivElement | null) => void;
}) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [adminNotes, setAdminNotes] = useState(proposal.admin_notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  // A 409 means the reviewed revision is stale: keep this card (and its open
  // panel) exactly as it is and require a reload before reviewing again.
  const [conflict, setConflict] = useState(false);

  // Co-leads who edited the shared proposal, besides the creator shown above.
  const coContributors = (proposal.contributors ?? [])
    .filter(c => c.id && c.id !== proposal.lead_id && c.name)
    .map(c => c.name);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const res = await onAction(proposal, "approve");
      if (res.conflict) setConflict(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!adminNotes.trim()) return;
    setSubmitting(true);
    try {
      const res = await onAction(proposal, "request_changes", adminNotes);
      if (res.conflict) { setConflict(true); return; }
      // Only collapse the panel on a real success — never on a rejected review.
      if (res.ok) setRequestingChanges(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setSubmitting(true);
    try {
      const res = await onAction(proposal, "reopen", adminNotes.trim() || undefined);
      if (res.conflict) { setConflict(true); return; }
      if (res.ok) setReopening(false);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-placeholder";

  return (
    <div
      ref={register}
      tabIndex={-1}
      aria-current={highlighted ? "true" : undefined}
      className={`min-w-0 rounded-xl border bg-accent-deep/5 dark:bg-accent/5 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        highlighted
          ? "border-accent shadow-[0_0_0_1px_rgb(var(--accent-rgb)/0.45)]"
          : "border-edge-accent-subtle"
      }`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-accent/10">
        <div>
          <p className="font-display text-base font-semibold">
            {SERVICE_LABEL[proposal.service_type]} · {capitalize(formatDate(proposal.service_date))}
          </p>
          <p className="font-body text-sm text-accent">
            {proposal.lead_name}
            {coContributors.length > 0 && (
              <span className="text-mono-400"> · con {coContributors.join(", ")}</span>
            )}
          </p>
        </div>
        <span className={`font-label text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[proposal.status]}`}>
          {STATUS_LABEL[proposal.status]}
        </span>
      </div>

      {/* Songs */}
      <div className="px-4 py-3 space-y-1.5">
        {proposal.songs.length === 0 && (
          <p className="font-body text-sm text-mono-500 italic">Sin canciones</p>
        )}
        {proposal.songs.map((song, i) => {
          const nextSong = proposal.songs[i + 1];
          const linkedNext = !!song.medley_tag && !!nextSong?.medley_tag && song.medley_tag === nextSong.medley_tag;
          const linkedPrev = i > 0 && !!song.medley_tag && proposal.songs[i - 1].medley_tag === song.medley_tag;
          return (
            <div key={song._key}>
              <div className={`flex items-center gap-3 ${song.medley_tag ? "pl-2 border-l-2 border-accent/40" : ""}`}>
                <span className="font-label text-xs text-mono-500 w-4 text-right shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                  {song.author && (
                    <p className="font-body text-xs text-mono-400 truncate">{song.author}</p>
                  )}
                </div>
                {linkedPrev && (
                  <span className="font-label text-[10px] uppercase tracking-widest text-accent/70 shrink-0">medley</span>
                )}
                <span className="font-label text-xs px-2 py-0.5 rounded-full border border-accent/20 text-accent shrink-0">
                  {song.play_key}
                </span>
              </div>
              {linkedNext && <div className="h-1" />}
            </div>
          );
        })}
      </div>

      {/* Team message */}
      {proposal.team_notes && (
        <div className="px-4 pb-3">
          <div className="p-3 rounded-lg border border-accent/20 bg-accent/5">
            <p className="font-label text-[11px] uppercase tracking-widest text-accent mb-1">Mensaje para el equipo</p>
            <p className="font-body text-sm text-mono-300 whitespace-pre-wrap">{proposal.team_notes}</p>
          </div>
        </div>
      )}

      {/* Private lead notes */}
      {proposal.lead_notes && (
        <div className="px-4 pb-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 mb-1">Notas privadas para revisión</p>
          <p className="font-body text-sm text-mono-300 whitespace-pre-wrap">{proposal.lead_notes}</p>
        </div>
      )}

      {/* Previous admin notes (when showing changes_requested) */}
      {proposal.status === "changes_requested" && proposal.admin_notes && !requestingChanges && (
        <div className="px-4 pb-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-negative-fg mb-1">Tus comentarios anteriores</p>
          <p className="font-body text-sm text-negative-muted whitespace-pre-wrap">{proposal.admin_notes}</p>
        </div>
      )}

      {/* Stale-review banner (409). The card keeps exactly what was reviewed. */}
      {conflict && (
        <div className="px-4 pb-3">
          <div className="rounded-lg border border-recency-fg/40 bg-recency-fg/10 px-3 py-2">
            <p className="font-label text-[11px] uppercase tracking-widest text-recency-strong">Propuesta actualizada</p>
            <p className="font-body text-sm text-recency-faint/90">
              Cambió mientras la revisabas. Recarga las propuestas y vuelve a revisar.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      {(proposal.status === "pending" || proposal.status === "changes_requested") && (
        <div className="px-4 pb-4 space-y-3">
          {requestingChanges ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                className={`${inputCls} resize-none`}
                rows={3}
                placeholder="Explica qué debe cambiar el líder…"
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setRequestingChanges(false)}
                  className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRequestChanges}
                  disabled={submitting || conflict || !adminNotes.trim()}
                  className="flex-1 py-2 rounded-lg bg-negative-surface/60 hover:bg-negative-border/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
                >
                  {submitting ? "Enviando…" : "Solicitar cambios"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setRequestingChanges(true)}
                className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-negative-fg dark:hover:border-surface-accent-30 hover:text-negative-fg transition-colors"
              >
                Solicitar cambios
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting || conflict || proposal.songs.length === 0}
                className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {submitting ? "Aprobando…" : "Aprobar"}
              </button>
            </div>
          )}
        </div>
      )}

      {proposal.status === "approved" && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-positive-deep/20 bg-positive-deep/5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-positive-strong shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <p className="font-label text-[11px] uppercase tracking-widest text-positive-strong">Setlist publicado</p>
          </div>

          {/* Re-open for revision. Sends the shared proposal back to
              changes_requested; the live setlist stays until re-approval. */}
          {reopening ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                className={`${inputCls} resize-none`}
                rows={3}
                placeholder="¿Qué debe ajustarse? (opcional)"
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setReopening(false)}
                  className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReopen}
                  disabled={submitting || conflict}
                  className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
                >
                  {submitting ? "Reabriendo…" : "Reabrir"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReopening(true)}
              className="w-full py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-400 hover:border-accent dark:hover:border-surface-accent-30 hover:text-accent transition-colors"
            >
              Reabrir para ajustes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface ProposalsPanelProps {
  /**
   * A transient `ProposalReviewTarget` set by a service card. It is resolved by
   * EXACT id against the already-loaded response — this panel never rebuilds a
   * target key, re-groups records, or chooses a canonical proposal.
   */
  target?: ProposalReviewTarget | null;
  /** Reports the resolution outcome; a successful `focus` consumes the target. */
  onResolved?: (outcome: string) => void;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function ProposalsPanel({ target = null, onResolved }: ProposalsPanelProps = {}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToastValue] = useTransientValue<{ msg: string; ok: boolean } | null>(null, 3000);
  const [filter, setFilter] = useState<ProposalFilter>("pending");
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  // How far back the archive window reaches, in `WIDEN_STEP_MONTHS` steps. 0 is
  // "this month onwards"; a handoff to an older proposal widens it on its own.
  const [windowSteps, setWindowSteps] = useState(0);
  // "Today" as a calendar day in the app timezone — never a bare `new Date()`.
  const todayIso = useMemo(() => serviceTodayIso(), []);
  const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
  const scrollTargetRef = useRef<string | null>(null);

  const showToast = (msg: string, ok = true) => setToastValue({ msg, ok });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proposals");
      if (!res.ok) throw new Error();
      setProposals(await res.json());
    } catch {
      setError("No se pudieron cargar las propuestas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Proposal handoff (plan §"Proposal handoff") ───────────────────────────
  // Exact-id resolution inside the already-loaded response. A load failure is a
  // distinct outcome from not-found, and only a successful focus consumes the
  // transient target — so a remount cannot resurrect an obsolete highlight.
  const handoffContext = useMemo(
    () => ({
      state: (loading ? "loading" : error ? "error" : "ready") as
        | "loading"
        | "ready"
        | "error",
      records: proposals.map((p) => ({ id: p._id, status: p.status as string | null })),
      currentFilter: filter,
    }),
    [loading, error, proposals, filter],
  );

  useEffect(() => {
    // A cleared target must NOT wipe the highlight: the target is consumed the
    // moment focus succeeds, while the revealed filter/highlight belongs to this
    // panel from then on (a manual filter change or a reload drops it).
    if (!target) return;
    const result = resolveProposalHandoff(target, handoffContext);
    if (result.outcome === "waiting") return;
    if (result.outcome === "load_failed") {
      setHandoffNotice(HANDOFF_NOTICE.load_failed);
      onResolved?.(result.outcome);
      return;
    }
    if (result.outcome === "not_found") {
      setHandoffNotice(HANDOFF_NOTICE.not_found);
      onResolved?.(result.outcome);
      return;
    }
    if (result.nextFilter !== filter) setFilter(result.nextFilter);
    // The handoff only adjusts the STATUS filter, so an approved/draft target
    // older than the window would be consumed while its card was never
    // rendered. Widen far enough to render it BEFORE the scroll effect runs.
    setWindowSteps((steps) => widenStepsForTargets(todayIso, steps, proposals, result.ids));
    setHighlightIds(result.ids);
    setConflictKey(result.conflictKey);
    setHandoffNotice(result.changed ? HANDOFF_NOTICE.changed : null);
    // Scroll/focus in a follow-up effect: a filter change only reveals the card
    // on the NEXT render, so the node may not exist yet.
    scrollTargetRef.current = result.ids[0];
    onResolved?.(result.outcome);
    // `filter` is read through `handoffContext`; listing it again would re-run
    // the effect on the filter change this effect itself performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, handoffContext, onResolved]);

  // Reveal the focused card once it is actually rendered. Keyboard focus moves to
  // it (the card is `tabIndex={-1}` with a visible focus ring), and the scroll
  // respects `prefers-reduced-motion`.
  useEffect(() => {
    const id = scrollTargetRef.current;
    if (!id) return;
    const el = cardRefs.current.get(id);
    if (!el) return;
    scrollTargetRef.current = null;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlightIds, filter, proposals, windowSteps]);

  const ACTION_TOAST: Record<ProposalAction, string> = {
    approve: "Setlist publicado",
    request_changes: "Cambios solicitados",
    reopen: "Propuesta reabierta",
  };

  const handleAction = async (
    proposal: Proposal,
    action: ProposalAction,
    notes?: string
  ): Promise<{ ok: boolean; conflict: boolean }> => {
    try {
      const res = await fetch(`/api/admin/proposals/${proposal._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // `rev` is the revision this card was REVIEWED at — not a fresh server
        // read — so a concurrent lead edit is rejected instead of published.
        body: JSON.stringify({ action, rev: proposal._rev, adminNotes: notes }),
      });
      if (res.ok) {
        showToast(ACTION_TOAST[action]);
        await load();
        return { ok: true, conflict: false };
      }
      if (res.status === 409) {
        // The reviewed view is stale: keep the card as-is and require a reload.
        showToast("La propuesta cambió — recarga", false);
        return { ok: false, conflict: true };
      }
      showToast("Error al procesar", false);
      return { ok: false, conflict: false };
    } catch {
      // Never reject: the caller (ProposalCard) resets its submitting flag after
      // this resolves, so a thrown network error must not strand the button.
      showToast("Error de conexión", false);
      return { ok: false, conflict: false };
    }
  };

  const FILTER_TABS: { id: ProposalFilter; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "pending", label: "Pendientes" },
    { id: "changes_requested", label: "En revisión" },
    { id: "approved", label: "Aprobadas" },
    { id: "draft", label: "Borradores" },
  ];

  const sorted = sortProposals(proposals);

  const inFilter = filter === "all" ? sorted : sorted.filter(p => p.status === filter);

  // The window is applied AFTER the status filter, so the hidden count always
  // describes the tab on screen. `pending` / `changes_requested` are never
  // windowed (see `proposalListView.ts`), so the badge below can never disagree.
  const { visible, hiddenCount, canWiden } = applyProposalWindow(inFilter, todayIso, windowSteps);

  const pendingCount = proposals.filter(p => p.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border border-edge-accent-subtle w-fit">
        {FILTER_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => {
              // A manual filter change is the user taking over: drop the handoff
              // highlight/notice so nothing stale stays on screen.
              setFilter(id);
              setHighlightIds([]);
              setConflictKey(null);
              setHandoffNotice(null);
              scrollTargetRef.current = null;
            }}
            className={`relative font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
              filter === id
                ? "bg-surface-accent-solid text-on-fill"
                : "text-mono-500 hover:text-accent"
            }`}
          >
            {label}
            {id === "pending" && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-recency-fg text-scrim font-bold text-[10px] flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Handoff notice: a changed / missing / unloadable target, never silent. */}
      {handoffNotice && (
        <p
          role="status"
          className="rounded-xl border border-recency-fg/40 bg-recency-fg/10 px-4 py-3 font-body text-sm text-recency-faint/90 [overflow-wrap:anywhere]"
        >
          {handoffNotice}
        </p>
      )}

      {/* A1's own grouping-conflict result, revealed as itself — not regrouped. */}
      {conflictKey && highlightIds.length > 0 && (
        <div
          role="status"
          className="min-w-0 rounded-xl border border-negative-strong/40 bg-negative-strong/10 px-4 py-3"
        >
          <p className="font-label text-[11px] uppercase tracking-widest text-negative-fg">
            Propuestas en conflicto
          </p>
          <p className="font-body text-sm text-negative-soft/90 [overflow-wrap:anywhere]">
            Este servicio tiene más de una propuesta válida ({highlightIds.length}). Resuélvelo antes
            de publicar.
          </p>
          <p className="mt-1 font-mono text-[11px] text-negative-soft/75 [overflow-wrap:anywhere]">
            {conflictKey} · {highlightIds.join(" · ")}
          </p>
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="h-40 rounded-xl bg-surface-accent-wash animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-xl px-4 py-3">{error}</p>
      )}

      {!loading && !error && visible.length === 0 && hiddenCount === 0 && (
        <div className="text-center py-12 space-y-1">
          <p className="font-body text-sm text-mono-500">
            {filter === "all" ? "No hay propuestas todavía." : `Sin propuestas en esta categoría.`}
          </p>
          <p className="font-body text-xs text-mono-500">
            Los líderes proponen setlists desde su perfil; aparecerán aquí para revisión.
          </p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {visible.map(p => (
            <ProposalCard
              key={p._id}
              proposal={p}
              onAction={handleAction}
              highlighted={highlightIds.includes(p._id)}
              register={(el) => cardRefs.current.set(p._id, el)}
            />
          ))}
        </div>
      )}

      {/* Archive window: what the date window is hiding, and how to see more.
          Only `approved` / `draft` can ever land here. */}
      {!loading && !error && canWiden && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge-accent-subtle px-4 py-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
            {hiddenCount === 1
              ? "1 propuesta anterior oculta"
              : `${hiddenCount} propuestas anteriores ocultas`}
          </p>
          <button
            onClick={() => setWindowSteps(s => s + 1)}
            className="px-4 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-400 hover:border-accent dark:hover:border-surface-accent-30 hover:text-accent transition-colors"
          >
            {`Ver ${WIDEN_STEP_MONTHS} meses más`}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl border font-label text-xs uppercase tracking-widest shadow-xl ${
          toast.ok
            ? "bg-surface-raised-alt border-accent/30"
            : "bg-negative-surface-deep/80 border-negative-strong/30"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
