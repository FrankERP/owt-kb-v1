"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { ProposalStatus } from "@/app/utils/interface";
import { normalizeMedleyTags } from "@/app/utils/medley";
import { ChainLinkIcon } from "@/app/components/ChainLinkIcon";

const uid = () => Math.random().toString(36).slice(2, 9);

interface SongResult {
  _id: string;
  title: string;
  author: string;
  key: string;
  previous_keys: string[];
}

interface ProposalSong {
  songId: string;
  title: string;
  author: string;
  key: string;
  play_key: string;
  previous_keys?: string[];
  medley_tag?: string;
}

// The single shared proposal for the service (one doc all leads co-edit).
interface SharedProposal {
  _id: string;
  _rev: string;
  status: ProposalStatus;
  lead_notes?: string;
  team_notes?: string;
  admin_notes?: string;
  createdById?: string;
  contributors?: Array<{ id: string; name: string }>;
  songs?: Array<{
    song_id: string;
    title: string;
    author: string;
    key: string;
    play_key: string;
    medley_tag?: string;
  }>;
}

interface RoleDoc {
  _id: string;
  _type: string;
  week?: string;
  date?: string;
  service_name?: string;
  service_type: "sunday" | "saturday" | "special";
  service_date: string;
}

interface Props {
  roleDoc: RoleDoc;
  proposal: SharedProposal | null;
  currentUserId: string;
}

// ─── Key options ─────────────────────────────────────────────────────────────

const KEY_OPTIONS = [
  "A", "Am", "Bb", "Bbm", "B", "Bm", "C", "Cm",
  "C#", "C#m", "D", "Dm", "Eb", "Ebm", "E", "Em",
  "F", "Fm", "F#", "F#m", "G", "Gm", "Ab", "Abm",
];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente de revisión",
  approved: "Aprobada",
  changes_requested: "Cambios solicitados",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "bg-mono-500/15 text-mono-400 border border-mono-500/30",
  pending: "bg-recency-fg/15 text-recency-strong border border-recency-fg/30",
  approved: "bg-positive-deep/15 text-positive-strong border border-positive-deep/30",
  changes_requested: "bg-negative-strong/15 text-negative-fg border border-negative-strong/30",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatServiceDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProposalEditor({ roleDoc, proposal, currentUserId }: Props) {
  const router = useRouter();

  const [songs, setSongs] = useState<ProposalSong[]>(() => {
    if (!proposal?.songs?.length) return [];
    return proposal.songs.map(s => ({
      songId: s.song_id,
      title: s.title,
      author: s.author,
      key: s.key,
      play_key: s.play_key || s.key,
      medley_tag: s.medley_tag,
    }));
  });

  const [leadNotes, setLeadNotes] = useState(proposal?.lead_notes ?? "");
  const [teamNotes, setTeamNotes] = useState(proposal?.team_notes ?? "");
  const [status, setStatus]       = useState<ProposalStatus>(proposal?.status ?? "draft");
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [staleReload, setStaleReload] = useState(false);

  // The doc revision for optimistic concurrency. MUST track the live prop (not a
  // one-time initializer): after a 409 the reload banner calls router.refresh(),
  // which re-runs the server component and delivers a fresh _rev — we re-seed
  // from it here so the next save carries the current revision, not a stale one.
  const [rev, setRev] = useState<string | null>(proposal?._rev ?? null);
  useEffect(() => { setRev(proposal?._rev ?? null); }, [proposal?._rev]);

  // The observed proposal id travels with the revision: after a first save the
  // shared proposal exists, so the next save must observe it as a singleton even
  // before router.refresh() re-delivers the prop.
  const [proposalId, setProposalId] = useState<string | null>(proposal?._id ?? null);
  useEffect(() => { if (proposal?._id) setProposalId(proposal._id); }, [proposal?._id]);

  // Other leads who have edited this shared proposal (exclude me).
  const otherContributors = (proposal?.contributors ?? [])
    .filter(c => c.id && c.id !== currentUserId)
    .map(c => c.name)
    .filter(Boolean);

  // Drag-and-drop
  const dragIdx    = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const onDragStart = (idx: number) => { dragIdx.current = idx; setDraggingIdx(idx); };
  const onDragOver  = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const onDrop      = (targetIdx: number) => {
    const from = dragIdx.current;
    if (from === null || from === targetIdx) { setDragOverIdx(null); return; }
    setSongs(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(targetIdx, 0, item);
      // Reordering can break a medley apart or interleave two — re-derive tags.
      return normalizeMedleyTags(next, uid);
    });
    dragIdx.current = null;
    setDraggingIdx(null);
    setDragOverIdx(null);
  };
  const onDragEnd = () => { dragIdx.current = null; setDraggingIdx(null); setDragOverIdx(null); };

  const moveSong = (from: number, to: number) => {
    setSongs(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return normalizeMedleyTags(next, uid);
    });
  };

  // Precondition: idxB === idxA + 1 (the toggle sits between consecutive rows).
  const toggleMedleyLink = (idxA: number, idxB: number) => {
    setSongs(prev => {
      const next = prev.map(e => ({ ...e }));
      const a = next[idxA];
      const b = next[idxB];
      if (a.medley_tag && b.medley_tag && a.medley_tag === b.medley_tag) {
        // Already linked — split at this boundary.
        const tag = a.medley_tag;
        const group = next.reduce<number[]>((acc, e, i) => e.medley_tag === tag ? [...acc, i] : acc, []);
        const splitPos = group.indexOf(idxB);
        const left = group.slice(0, splitPos);
        const right = group.slice(splitPos);
        if (left.length < 2) left.forEach(i => { next[i].medley_tag = undefined; });
        if (right.length >= 2) {
          const t = uid();
          right.forEach(i => { next[i].medley_tag = t; });
        } else {
          right.forEach(i => { next[i].medley_tag = undefined; });
        }
      } else {
        // Link them — merge groups or create a new tag.
        const aTag = a.medley_tag;
        const bTag = b.medley_tag;
        if (aTag && bTag) {
          next.forEach(e => { if (e.medley_tag === bTag) e.medley_tag = aTag; });
        } else if (aTag) {
          b.medley_tag = aTag;
        } else if (bTag) {
          a.medley_tag = bTag;
        } else {
          const t = uid();
          a.medley_tag = t;
          b.medley_tag = t;
        }
      }
      return next;
    });
  };

  // Key picker
  const [keyPickerIdx, setKeyPickerIdx] = useState<number | null>(null);
  const keyPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (keyPickerIdx === null) return;
    const handler = (e: MouseEvent) => {
      if (keyPickerRef.current && !keyPickerRef.current.contains(e.target as Node)) {
        setKeyPickerIdx(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [keyPickerIdx]);

  // Song search
  const [searchQuery, setSearchQuery]   = useState("");
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [searching, setSearching]       = useState(false);
  const [showSearch, setShowSearch]     = useState(false);
  const searchRef    = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/me/songs?q=${encodeURIComponent(q)}`);
        // Guard against a non-array body (e.g. a 401/500 { error } object): storing
        // it and calling .map() on render would white-screen the editor and lose
        // the in-progress setlist. Fall back to an empty result set instead.
        const data: unknown = res.ok ? await res.json() : null;
        setSearchResults(Array.isArray(data) ? (data as SongResult[]) : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => { search(searchQuery); }, [searchQuery, search]);

  useEffect(() => {
    if (!showSearch && searchResults.length === 0) search("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch]);

  const addSong = (song: SongResult) => {
    if (songs.some(s => s.songId === song._id)) return;
    setSongs(prev => [...prev, {
      songId: song._id,
      title: song.title,
      author: song.author,
      key: song.key,
      play_key: song.key,
      previous_keys: song.previous_keys,
    }]);
    setShowSearch(false);
    setSearchQuery("");
  };

  // Removing a song can orphan its medley partner — re-normalize tags.
  const removeSong = (idx: number) => setSongs(prev => normalizeMedleyTags(prev.filter((_, i) => i !== idx), uid));

  const setPlayKey = (idx: number, play_key: string) => {
    setSongs(prev => prev.map((s, i) => i === idx ? { ...s, play_key } : s));
    setKeyPickerIdx(null);
  };

  const save = async (submitStatus: "draft" | "pending") => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: roleDoc._id,
          // The observed state of the ONE shared proposal for this service. The
          // server refuses the save unless it is still exactly this (or, for
          // `none`, unless no proposal exists yet — the deterministic-id create
          // is then the mutex between co-leads). Service type/date are derived
          // server-side from the authorized role, never sent from here.
          observed: proposalId && rev
            ? { state: "single", id: proposalId, rev }
            : { state: "none" },
          songs: songs.map(s => ({ songId: s.songId, play_key: s.play_key, medley_tag: s.medley_tag })),
          leadNotes,
          teamNotes,
          status: submitStatus,
        }),
      });

      // 409 = someone else changed the shared proposal since we loaded it (or it
      // was approved). Do NOT clear the editor — surface a non-destructive reload
      // banner so the lead can copy anything unsaved before reloading.
      if (res.status === 409) {
        setStaleReload(true);
        return;
      }
      if (!res.ok) throw new Error();
      const data: { _id?: string; status: ProposalStatus; _rev?: string | null } = await res.json();
      setStatus(data.status);
      if (data._id) setProposalId(data._id);
      // No fresh revision means the next save cannot be guarded: force a reload
      // rather than let it fall back to an unguarded observation.
      if (data._rev) setRev(data._rev);
      else setStaleReload(true);
      showToast(submitStatus === "pending" ? "Propuesta enviada" : "Borrador guardado");
      router.refresh();
    } catch {
      showToast("Error al guardar", false);
    } finally {
      setSaving(false);
    }
  };

  const isApproved  = status === "approved";
  const serviceLabel =
    roleDoc.service_type === "sunday"   ? "Domingo" :
    roleDoc.service_type === "saturday" ? "Sábado"  :
    (roleDoc.service_name ?? "Servicio Especial");

  const inputCls = "w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-placeholder";

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/me")}
          className="flex items-center gap-1.5 font-label text-xs uppercase tracking-widest text-mono-500 hover:text-accent transition-colors mb-5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Volver
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">Propuesta de Setlist</h1>
            <p className="font-body text-sm text-mono-400 mt-1">
              {serviceLabel} · {capitalize(formatServiceDate(roleDoc.service_date))}
            </p>
          </div>
          <span className={`font-label text-xs uppercase tracking-widest px-3 py-1.5 rounded-full shrink-0 ${STATUS_STYLE[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {/* Shared-proposal contributors — this is ONE setlist all leads co-edit */}
      {otherContributors.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/20 bg-accent/5">
          <UserIcon />
          <p className="font-body text-xs text-accent">
            Propuesta compartida · editada también por {otherContributors.join(", ")}
          </p>
        </div>
      )}

      {/* Stale-reload banner (409: a co-lead changed the shared proposal, or it
          was approved). Non-destructive — the editor keeps the lead's unsaved work. */}
      {staleReload && (
        <div className="rounded-xl border border-recency-fg/40 bg-recency-fg/10 p-4 space-y-2">
          <p className="font-label text-xs uppercase tracking-widest text-recency-strong">Propuesta actualizada</p>
          <p className="font-body text-sm text-recency-faint/90">
            Otro líder actualizó esta propuesta compartida (o ya fue aprobada). Recarga para ver
            los cambios antes de volver a guardar.
          </p>
          <button
            type="button"
            onClick={() => { setStaleReload(false); router.refresh(); }}
            className="mt-1 py-2 px-4 rounded-lg border border-recency-fg/40 font-label text-xs uppercase tracking-widest text-recency-soft hover:bg-recency-fg/10 transition-colors"
          >
            Recargar
          </button>
        </div>
      )}

      {/* Admin notes banner (changes requested) */}
      {status === "changes_requested" && proposal?.admin_notes && (
        <div className="rounded-xl border border-negative-strong/30 bg-negative-strong/10 p-4 space-y-1">
          <p className="font-label text-xs uppercase tracking-widest text-negative-fg">Comentarios del admin</p>
          <p className="font-body text-sm text-negative-muted whitespace-pre-wrap">{proposal.admin_notes}</p>
        </div>
      )}

      {/* Song list */}
      <div className="space-y-3">
        <h2 className="font-label text-xs uppercase tracking-widest text-mono-500">Lista de canciones</h2>

        {songs.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-3 text-mono-600">
            <MusicIcon />
            <p className="font-body text-sm text-center">
              Agrega canciones usando el buscador abajo.
            </p>
          </div>
        )}

        {songs.length > 0 && (
        <div>
        {songs.map((song, idx) => {
          const nextSong = songs[idx + 1];
          const linked = !!song.medley_tag && !!nextSong?.medley_tag && song.medley_tag === nextSong.medley_tag;
          const inMedley = !!song.medley_tag;
          return (
          <Fragment key={song.songId}>
          <div
            draggable={!isApproved}
            onDragStart={() => onDragStart(idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDrop={() => onDrop(idx)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${idx > 0 ? "mt-1.5" : ""} ${
              dragOverIdx === idx && draggingIdx !== idx
                ? "border-accent/60 bg-accent/10 scale-[1.01]"
                : draggingIdx === idx
                ? "opacity-30"
                : inMedley
                ? "border-accent/30 bg-accent/[0.07]"
                : "border-edge-accent-subtle bg-accent/5"
            } ${!isApproved ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            {/* Drag handle (desktop) */}
            {!isApproved && (
              <span className="text-mono-400 shrink-0 select-none hidden md:inline-flex">
                <GripIcon />
              </span>
            )}

            {/* Up / down buttons (mobile fallback for DnD) */}
            {!isApproved && (
              <div className="flex flex-col gap-0.5 shrink-0 md:hidden">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); moveSong(idx, idx - 1); }}
                  disabled={idx === 0}
                  className="p-1 rounded text-mono-400 hover:text-accent disabled:opacity-20 disabled:cursor-default"
                  aria-label="Mover arriba"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); moveSong(idx, idx + 1); }}
                  disabled={idx === songs.length - 1}
                  className="p-1 rounded text-mono-400 hover:text-accent disabled:opacity-20 disabled:cursor-default"
                  aria-label="Mover abajo"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            )}

            {/* Position */}
            <span className="font-label text-xs text-mono-500 w-5 text-center shrink-0">{idx + 1}</span>

            {/* Song info */}
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold truncate">{song.title}</p>
              <p className="font-body text-xs text-mono-400 truncate">{song.author}</p>
              {!!song.previous_keys?.length && (
                <p className="font-body text-xs text-mono-500 mt-0.5">
                  Tonos anteriores: <span className="text-accent/80">{song.previous_keys.join(" · ")}</span>
                </p>
              )}
            </div>

            {/* Custom key picker */}
            {!isApproved && (
              <div
                className="relative shrink-0"
                ref={keyPickerIdx === idx ? keyPickerRef : undefined}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setKeyPickerIdx(keyPickerIdx === idx ? null : idx); }}
                  onMouseDown={e => e.stopPropagation()}
                  className="font-label text-xs px-2.5 py-1 rounded-lg border border-accent/20 hover:border-accent/50 text-accent transition-colors min-w-[2.75rem] text-center"
                >
                  {song.play_key}
                </button>
                {keyPickerIdx === idx && (
                  <div className="absolute right-0 top-full mt-1.5 z-30 bg-surface-overlay-deepest border border-accent/20 rounded-xl shadow-2xl p-2.5 min-w-[9rem]">
                    <div className="grid grid-cols-4 gap-1">
                      {KEY_OPTIONS.map(k => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setPlayKey(idx, k)}
                          className={`font-label text-[11px] px-1.5 py-1.5 rounded-lg transition-colors ${
                            k === song.play_key
                              ? "bg-accent/20 text-accent"
                              : "text-mono-400 hover:bg-accent/10 hover:text-accent"
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isApproved && (
              <span className="font-label text-xs px-2 py-0.5 rounded-full border border-accent/20 text-accent shrink-0">
                {song.play_key}
              </span>
            )}

            {/* Remove */}
            {!isApproved && (
              <button
                type="button"
                onClick={() => removeSong(idx)}
                className="p-1.5 rounded-lg text-mono-500 hover:text-negative-fg hover:bg-negative-strong/10 transition-colors shrink-0"
                title="Quitar"
              >
                <XIcon />
              </button>
            )}
          </div>

          {/* Medley link toggle between consecutive songs */}
          {idx < songs.length - 1 && !isApproved && (
            <div className="-my-0.5 flex items-center justify-center relative z-10">
              <button
                type="button"
                onClick={() => toggleMedleyLink(idx, idx + 1)}
                title={linked ? "Desagrupar medley" : "Agrupar en medley"}
                aria-label={linked ? "Desagrupar medley" : "Agrupar en medley"}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${
                  linked
                    ? "border-accent/30 bg-surface-base text-accent/70"
                    : "border-dashed border-mono-700/40 bg-surface-base text-mono-600/50 hover:border-accent/30 hover:text-accent/50"
                }`}
              >
                <ChainLinkIcon strokeWidth={linked ? 2.5 : 1.5} />
                {linked && <span className="font-label text-[10px] uppercase tracking-widest ml-0.5">medley</span>}
              </button>
            </div>
          )}

          {/* Static medley indicator when approved (read-only) */}
          {idx < songs.length - 1 && isApproved && linked && (
            <div className="-my-0.5 flex items-center justify-center relative z-10">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/30 bg-surface-base text-accent/70">
                <ChainLinkIcon strokeWidth={2.5} />
                <span className="font-label text-[10px] uppercase tracking-widest ml-0.5">medley</span>
              </span>
            </div>
          )}
          </Fragment>
          );
        })}
        </div>
        )}

        {/* Song search */}
        {!isApproved && (
          <div ref={searchRef} className="relative">
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-accent/25 hover:border-accent/50 transition-colors cursor-pointer"
              onClick={() => { setShowSearch(true); setKeyPickerIdx(null); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="font-label text-xs uppercase tracking-widest text-mono-500">Agregar canción</span>
            </div>

            {showSearch && (
              <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded-xl border border-accent/20 bg-surface-overlay-deepest shadow-2xl overflow-hidden">
                <div className="p-2 border-b border-accent/10">
                  <input
                    autoFocus
                    className={inputCls}
                    placeholder="Buscar canción…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {searching && (
                    <p className="font-body text-sm text-mono-500 text-center py-4">Buscando…</p>
                  )}
                  {!searching && searchResults.length === 0 && (
                    <p className="font-body text-sm text-mono-500 text-center py-4">Sin resultados</p>
                  )}
                  {!searching && searchResults.map(song => {
                    const already = songs.some(s => s.songId === song._id);
                    return (
                      <button
                        key={song._id}
                        onClick={() => !already && addSong(song)}
                        disabled={already}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          already ? "opacity-40 cursor-not-allowed" : "hover:bg-accent/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                          <p className="font-body text-xs text-mono-400 truncate">{song.author}</p>
                          <p className="font-body text-xs text-mono-500 mt-0.5">
                            {song.previous_keys.length > 0
                              ? <>Tonos anteriores: <span className="text-accent/80">{song.previous_keys.join(" · ")}</span></>
                              : "Sin historial previo"}
                          </p>
                        </div>
                        <span className="font-label text-xs text-mono-500 shrink-0">{song.key}</span>
                        {already && <span className="font-label text-[11px] text-mono-500">En lista</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Team message */}
      {!isApproved && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">
            Mensaje para el equipo <span className="normal-case tracking-normal text-mono-600">(opcional)</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Comparte un versículo, una reflexión o algo que quieras decirle al equipo…"
            value={teamNotes}
            onChange={e => setTeamNotes(e.target.value)}
          />
          <p className="font-body text-xs text-mono-600">Se mostrará al equipo cuando se apruebe la propuesta.</p>
        </div>
      )}

      {/* Private review notes */}
      {!isApproved && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">
            Notas privadas para revisión <span className="normal-case tracking-normal text-mono-600">(opcional)</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Contexto o peticiones especiales solo para los admins…"
            value={leadNotes}
            onChange={e => setLeadNotes(e.target.value)}
          />
          <p className="font-body text-xs text-mono-600">Solo las verán los admins que revisan la propuesta.</p>
        </div>
      )}

      {isApproved && teamNotes && (
        <div className="space-y-1">
          <p className="font-label text-xs uppercase tracking-widest text-accent">Mensaje para el equipo</p>
          <p className="font-body text-sm text-mono-300 whitespace-pre-wrap">{teamNotes}</p>
        </div>
      )}

      {isApproved && leadNotes && (
        <div className="space-y-1">
          <p className="font-label text-xs uppercase tracking-widest text-mono-500">Tus notas privadas para revisión</p>
          <p className="font-body text-sm text-mono-300 whitespace-pre-wrap">{leadNotes}</p>
        </div>
      )}

      {/* Approved banner */}
      {isApproved && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-positive-deep/20 bg-positive-deep/5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-positive-strong shrink-0">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="font-label text-xs uppercase tracking-widest text-positive-strong">
            Propuesta aprobada — el setlist ha sido publicado
          </p>
        </div>
      )}

      {/* Sticky action bar */}
      {!isApproved && (
        <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-surface-base/95 backdrop-blur-sm border-t border-surface-accent-faint z-10">
          <div className="flex gap-3">
            <button
              onClick={() => save("draft")}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar borrador"}
            </button>
            <button
              onClick={() => setConfirmSubmit(true)}
              disabled={saving || songs.length === 0}
              className="flex-1 py-2.5 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              {saving ? "Enviando…" : "Enviar propuesta"}
            </button>
          </div>
        </div>
      )}

      {/* Submit confirmation modal */}
      {confirmSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-scrim/60 backdrop-blur-sm" onClick={() => setConfirmSubmit(false)} />
          <div className="relative z-10 w-full max-w-sm bg-surface-raised-alt border border-accent/20 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="space-y-1">
              <h3 className="font-display text-lg uppercase tracking-wide">Enviar propuesta</h3>
              <p className="font-body text-sm text-mono-400">
                Vas a enviar {songs.length} canción{songs.length !== 1 ? "es" : ""} para {serviceLabel}. El admin recibirá tu propuesta para revisión.
              </p>
            </div>
            <ul className="space-y-1 border border-accent/10 rounded-xl p-3 bg-accent-deep/10">
              {songs.map((s, i) => (
                <li key={s.songId} className="flex items-center gap-2">
                  <span className="font-label text-[11px] text-mono-600 w-4 text-right tabular-nums">{i + 1}</span>
                  <span className="font-body text-sm truncate flex-1">{s.title}</span>
                  <span className="font-label text-xs text-accent shrink-0">{s.play_key}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmSubmit(false)}
                className="flex-1 py-2.5 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setConfirmSubmit(false); save("pending"); }}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl border font-label text-xs uppercase tracking-widest shadow-xl ${
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

// ─── Icons ────────────────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mono-700">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
