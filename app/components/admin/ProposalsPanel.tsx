"use client";

import { useState, useEffect, useCallback } from "react";

type ProposalStatus = "draft" | "pending" | "approved" | "changes_requested";

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
  service_type: "sunday" | "saturday" | "special";
  service_date: string;
  status: ProposalStatus;
  lead_name: string;
  lead_id: string;
  lead_notes?: string;
  admin_notes?: string;
  submitted_at?: string;
  songs: ProposalSong[];
}

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
  draft: "bg-gray-500/15 text-gray-400 border border-gray-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
  approved: "bg-green-500/15 text-green-400 border border-green-500/30",
  changes_requested: "bg-red-500/15 text-red-400 border border-red-500/30",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  changes_requested: "Cambios",
};

const STATUS_ORDER: ProposalStatus[] = ["pending", "changes_requested", "approved", "draft"];

// ─── ProposalCard ─────────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onAction,
}: {
  proposal: Proposal;
  onAction: (id: string, action: "approve" | "request_changes", notes?: string) => Promise<void>;
}) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [adminNotes, setAdminNotes] = useState(proposal.admin_notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = async () => {
    setSubmitting(true);
    await onAction(proposal._id, "approve");
    setSubmitting(false);
  };

  const handleRequestChanges = async () => {
    if (!adminNotes.trim()) return;
    setSubmitting(true);
    await onAction(proposal._id, "request_changes", adminNotes);
    setSubmitting(false);
    setRequestingChanges(false);
  };

  const inputCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors placeholder:text-gray-600";

  return (
    <div className="rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#003572]/10 dark:border-[#00bfff]/10">
        <div>
          <p className="font-display text-base font-semibold">
            {SERVICE_LABEL[proposal.service_type]} · {capitalize(formatDate(proposal.service_date))}
          </p>
          <p className="font-body text-sm text-[#00bfff]">{proposal.lead_name}</p>
        </div>
        <span className={`font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[proposal.status]}`}>
          {STATUS_LABEL[proposal.status]}
        </span>
      </div>

      {/* Songs */}
      <div className="px-4 py-3 space-y-1.5">
        {proposal.songs.length === 0 && (
          <p className="font-body text-sm text-gray-500 italic">Sin canciones</p>
        )}
        {proposal.songs.map((song, i) => {
          const nextSong = proposal.songs[i + 1];
          const linkedNext = !!song.medley_tag && !!nextSong?.medley_tag && song.medley_tag === nextSong.medley_tag;
          const linkedPrev = i > 0 && !!song.medley_tag && proposal.songs[i - 1].medley_tag === song.medley_tag;
          return (
            <div key={song._key}>
              <div className={`flex items-center gap-3 ${song.medley_tag ? "pl-2 border-l-2 border-[#00bfff]/40" : ""}`}>
                <span className="font-label text-xs text-gray-500 w-4 text-right shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-body text-sm font-semibold truncate">{song.title}</span>
                  <span className="font-body text-xs text-gray-400 ml-2 truncate">{song.author}</span>
                </div>
                {linkedPrev && (
                  <span className="font-label text-[8px] uppercase tracking-widest text-[#00bfff]/60 shrink-0">medley</span>
                )}
                <span className="font-label text-xs px-2 py-0.5 rounded-full border border-[#00bfff]/20 text-[#00bfff] shrink-0">
                  {song.play_key}
                </span>
              </div>
              {linkedNext && <div className="h-1" />}
            </div>
          );
        })}
      </div>

      {/* Lead notes */}
      {proposal.lead_notes && (
        <div className="px-4 pb-3">
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Notas del líder</p>
          <p className="font-body text-sm text-gray-300 whitespace-pre-wrap">{proposal.lead_notes}</p>
        </div>
      )}

      {/* Previous admin notes (when showing changes_requested) */}
      {proposal.status === "changes_requested" && proposal.admin_notes && !requestingChanges && (
        <div className="px-4 pb-3">
          <p className="font-label text-[10px] uppercase tracking-widest text-red-400 mb-1">Tus comentarios anteriores</p>
          <p className="font-body text-sm text-red-300 whitespace-pre-wrap">{proposal.admin_notes}</p>
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
                  className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRequestChanges}
                  disabled={submitting || !adminNotes.trim()}
                  className="flex-1 py-2 rounded-lg bg-red-800/60 hover:bg-red-700/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
                >
                  {submitting ? "Enviando…" : "Solicitar cambios"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setRequestingChanges(true)}
                className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-red-400 hover:text-red-400 transition-colors"
              >
                Solicitar cambios
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting || proposal.songs.length === 0}
                className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {submitting ? "Aprobando…" : "Aprobar"}
              </button>
            </div>
          )}
        </div>
      )}

      {proposal.status === "approved" && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/20 bg-green-500/5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <p className="font-label text-[10px] uppercase tracking-widest text-green-400">Setlist publicado</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ProposalsPanel() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<ProposalStatus | "all">("pending");

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

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

  const handleAction = async (
    id: string,
    action: "approve" | "request_changes",
    notes?: string
  ) => {
    try {
      const res = await fetch(`/api/admin/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNotes: notes }),
      });
      if (res.ok) {
        showToast(action === "approve" ? "Setlist publicado" : "Cambios solicitados");
        await load();
      } else {
        showToast("Error al procesar", false);
      }
    } catch {
      // Never reject: the caller (ProposalCard) resets its submitting flag after
      // this resolves, so a thrown network error must not strand the button.
      showToast("Error de conexión", false);
    }
  };

  const FILTER_TABS: { id: ProposalStatus | "all"; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "pending", label: "Pendientes" },
    { id: "changes_requested", label: "En revisión" },
    { id: "approved", label: "Aprobadas" },
    { id: "draft", label: "Borradores" },
  ];

  const sorted = [...proposals].sort((a, b) => {
    const oi = STATUS_ORDER.indexOf(a.status);
    const oj = STATUS_ORDER.indexOf(b.status);
    if (oi !== oj) return oi - oj;
    return a.service_date.localeCompare(b.service_date);
  });

  const visible = filter === "all" ? sorted : sorted.filter(p => p.status === filter);

  const pendingCount = proposals.filter(p => p.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 w-fit">
        {FILTER_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`relative font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
              filter === id
                ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB] dark:text-[#00bfff]"
                : "text-gray-500 hover:text-[#00bfff]"
            }`}
          >
            {label}
            {id === "pending" && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 text-black font-bold text-[9px] flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="h-40 rounded-xl bg-[#003572]/10 dark:bg-[#00bfff]/5 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-xl px-4 py-3">{error}</p>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="text-center py-12 space-y-1">
          <p className="font-body text-sm text-gray-500">
            {filter === "all" ? "No hay propuestas todavía." : `Sin propuestas en esta categoría.`}
          </p>
          <p className="font-body text-xs text-gray-500/80">
            Los líderes proponen setlists desde su perfil; aparecerán aquí para revisión.
          </p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {visible.map(p => (
            <ProposalCard key={p._id} proposal={p} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl border font-label text-xs uppercase tracking-widest shadow-xl ${
          toast.ok
            ? "bg-[#003572] dark:bg-[#0a1929] border-[#00bfff]/30"
            : "bg-red-900/80 border-red-500/30"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
