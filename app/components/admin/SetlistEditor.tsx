"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { SongForm, SongTag, FormState, buildPayload } from "./SongFormModal";
import { normalizeMedleyTags } from "../../utils/medley";
import { ChainLinkIcon } from "../ChainLinkIcon";
import Button from "../ui/Button";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";
import Select, { useAnyCoarsePointer, useFinePointer } from "../ui/Select";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon } from "../ui/icons";
import { canEditSetlistResponse, SETLIST_READ_ISSUE_COPY } from "../../utils/setlistReadContract";
import { serviceDayOffset, serviceTodayIso } from "./serviceReadiness";
import { MUTATION_TIMEOUT_MS } from "./serviceMutationErrors";
import { writeErrorMessage } from "@/app/utils/writeError";
import { WORSHIP_NIGHT_FORMAT } from "@/app/utils/serviceFormat";
import { unassignedLeads } from "@/app/utils/songLeads";

// The row's icon buttons: a 44 px target on a phone, the 36 px icon default from `sm`
// (no `size` is responsive, so the desktop half is an additive utility), dimmed and
// inert while `aria-disabled` (see the row for why not `disabled`).
const ROW_ICON = "sm:min-h-9 sm:min-w-9 aria-disabled:opacity-50 aria-disabled:pointer-events-none";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SongResult   { _id: string; title: string; author: string; key: string; slug: string; }
export interface SetlistEntry { localId: string; play_key: string; medley_tag?: string; song: SongResult; leadIds: string[]; }

/** A1's observed state, carried UNCHANGED from the GET into the PUT (A2 §5). */
type ObservedTarget = { state: "none" } | { state: "single"; id: string; rev: string };

const SAVE_CONFLICT_COPY =
  "Alguien más cambió este setlist mientras lo editabas. Recarga para ver el estado actual antes de guardar.";

const LEAD_CHANGED_COPY = "Cambió quién está en Lead mientras editabas. Recarga el setlist.";

/**
 * A 400 naming `songs[i].leadIds`: the PUT refused a leader who is not in the
 * special's Lead as the server loaded it. On a set with saved songs a Lead change
 * moves the role's `_rev` and arrives as the 409 instead; a worship night with no
 * saved songs yet has no revision to go stale, so it arrives here. Either way the
 * fix is the same fresh read. [post-approval, un-reviewed]
 */
async function refusesLeaders(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { details?: { issues?: unknown } } | null;
    const issues = body?.details?.issues;
    return Array.isArray(issues) && issues.some((i) => typeof i === "string" && /^songs\[\d+\]\.leadIds$/.test(i));
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid2 = () => Math.random().toString(36).slice(2, 9);

/**
 * What the badge should say about a song's most recent appearance.
 *
 * Two things were wrong. The GROQ behind `recentSongs` is `week >= $cutoff`
 * with no upper bound, and the route keeps the LATEST week per song — so a song
 * already booked three months out arrived here as a NEGATIVE age, which passed
 * the `> 4` filter, landed in the `<= 2` red class and rendered "esta sem.".
 * A lead building a setlist saw a red "played this week" warning on songs that
 * had not been played at all, which buries the real recency signal.
 *
 * Suppressing negatives would be the wrong fix: a song on tomorrow's Sunday
 * while you edit Saturday is a genuine same-weekend repeat, and the most
 * actionable warning of the lot. It gets its own label instead.
 *
 * The age is also a CALENDAR-day diff at local noon now, not elapsed hours,
 * which is the repo's rule for anything that becomes a day/week LABEL: the old
 * arithmetic flipped "esta sem." to "hace 1 sem." depending on the time of day.
 */
export function repeatBadgeFor(
  lastUsed: string,
  todayIso: string = serviceTodayIso(),
): { label: string; tone: "upcoming" | "recent" | "older" } | null {
  const offset = serviceDayOffset(lastUsed, todayIso);
  if (offset === null) return null;
  if (offset > 0) return { label: "ya programada", tone: "upcoming" };
  const days = -offset;
  const weeks = Math.floor(days / 7);
  if (weeks > 4) return null;
  return {
    label: weeks <= 0 ? "esta sem." : `hace ${weeks} sem.`,
    tone: weeks <= 2 ? "recent" : "older",
  };
}

const REPEAT_TONE_CLASS: Record<"upcoming" | "recent" | "older", string> = {
  // A booking still ahead is at least as loud as one two weeks past.
  upcoming: "bg-negative-strong/20 text-negative-fg border-negative-strong/30",
  recent: "bg-negative-strong/20 text-negative-fg border-negative-strong/30",
  older: "bg-recency-fg/20 text-recency-strong border-recency-fg/30",
};

function RepeatBadge({ lastUsed }: { lastUsed: string }) {
  const badge = repeatBadgeFor(lastUsed);
  if (!badge) return null;
  return (
    <span className={`font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${REPEAT_TONE_CLASS[badge.tone]}`}>
      {badge.label}
    </span>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="4" cy="2.5" r="1" /><circle cx="8" cy="2.5" r="1" />
      <circle cx="4" cy="6"   r="1" /><circle cx="8" cy="6"   r="1" />
      <circle cx="4" cy="9.5" r="1" /><circle cx="8" cy="9.5" r="1" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SetlistEditor({ week, type, roleId, onClose, onSaved, onBusyChange }: {
  week: string;
  type: "sunday" | "saturday" | "special";
  roleId?: string;
  onClose: () => void;
  onSaved?: () => void;
  /**
   * Reports the in-flight save upward so the surrounding dialog can refuse to
   * be dismissed. `save()` deliberately keeps this editor open on failure and
   * writes into `saveError` — and a dismissal mid-request destroys exactly that
   * surface, so a lead's whole setlist disappears with no error shown.
   */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [entries, setEntries]           = useState<SetlistEntry[]>([]);
  const [recentSongs, setRecentSongs]   = useState<Record<string, string>>({});
  const [searchQ, setSearchQ]           = useState("");
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  // The cleanup is load-bearing: on a SUCCESSFUL save `onSaved()` unmounts this
  // editor in the same batch that sets `saving` false, so the effect never
  // re-runs and the parent's flag would stay true — locking the next dialog.
  useEffect(() => {
    onBusyChange?.(saving);
    return () => onBusyChange?.(false);
  }, [saving, onBusyChange]);
  const [saveError, setSaveError]       = useState<string | null>(null);
  // The observed target state is retained until a successful save or a reload —
  // never re-derived from a fresh server read, which would silently re-authorize
  // an overwrite of someone else's change.
  const [observed, setObserved]         = useState<ObservedTarget | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [reloadToken, setReloadToken]   = useState(0);
  const [addKey, setAddKey]             = useState("");
  const [draggingIdx, setDraggingIdx]   = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx]   = useState<number | null>(null);
  const [allTags, setAllTags]           = useState<SongTag[]>([]);
  const [allAuthors, setAllAuthors]     = useState<SongTag[]>([]);
  const [createOpen, setCreateOpen]     = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError]   = useState<string | null>(null);
  // A worship night's songs name their leaders from the block's Lead (spec §6).
  const [worshipNight, setWorshipNight] = useState(false);
  const [roster, setRoster]             = useState<{ id: string; name: string }[]>([]);
  const dragSrc     = useRef<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // HTML5 drag is a mouse/trackpad affordance: a touch screen never starts it,
  // and on iOS a long press on a `draggable` row hijacks the scroll instead. So a
  // row is draggable only on a fine pointer with NO touch screen attached (an iPad
  // with a trackpad is fine-pointer AND any-pointer coarse); elsewhere the grip is
  // not drawn and the 44 px «Subir / Bajar / Quitar» buttons are the only reorder
  // (bloque 6).
  const finePointer = useFinePointer();
  const anyCoarse = useAnyCoarsePointer();
  const dragPointer = finePointer && !anyCoarse;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSaveConflict(false);
      setSaveError(null);
      setObserved(null);
      const params = new URLSearchParams({ type, week });
      if (roleId) params.set("roleId", roleId);
      try {
        const [setlistRes, tagsRes, authorsRes] = await Promise.all([
          fetch(`/api/admin/setlists?${params}`),
          fetch("/api/content/tags"),
          fetch("/api/content/authors"),
        ]);
        if (!alive) return;
        if (!setlistRes.ok) {
          setLoadError(SETLIST_READ_ISSUE_COPY.http);
          return;
        }
        // Fail closed: only a canonical `none` target or a singleton with
        // empty/incomplete/ready content opens editable state. A duplicate,
        // draft conflict, invalid target/content or malformed payload must never
        // render as an ordinary empty setlist the admin could overwrite.
        const decision = canEditSetlistResponse(await setlistRes.json());
        if (!alive) return;
        if (!decision.editable) {
          setLoadError(SETLIST_READ_ISSUE_COPY[decision.issue]);
          return;
        }
        const data = decision.read as unknown as {
          songs: Array<{ play_key: string; medley_tag?: string; song: SongResult; leadIds?: unknown }>;
          recentSongs: Record<string, string>;
          observed: ObservedTarget;
          format?: unknown;
          leadRoster?: unknown;
        };
        setWorshipNight(data.format === WORSHIP_NIGHT_FORMAT);
        setRoster(Array.isArray(data.leadRoster) ? data.leadRoster : []);
        setEntries(data.songs.map(s => ({
          localId: uid2(),
          play_key: s.play_key,
          medley_tag: s.medley_tag,
          song: s.song,
          leadIds: Array.isArray(s.leadIds) ? s.leadIds.filter((id): id is string => typeof id === "string") : [],
        })));
        setRecentSongs(data.recentSongs);
        setObserved(data.observed);
        if (tagsRes.ok) setAllTags(await tagsRes.json());
        if (authorsRes.ok) setAllAuthors(await authorsRes.json());
      } catch {
        if (alive) setLoadError(SETLIST_READ_ISSUE_COPY.http);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [week, type, roleId, reloadToken]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/songs?q=${encodeURIComponent(searchQ)}`);
      if (res.ok) setSearchResults(await res.json());
    }, 250);
  }, [searchQ]);

  function addSong(song: SongResult) {
    setEntries(prev => [...prev, { localId: uid2(), play_key: addKey, song, leadIds: [] }]);
    setSearchQ(""); setSearchResults([]); setAddKey("");
  }

  // «Dirige» (slot 0) and «y» (slot 1). Clearing the first clears both; a first
  // pick drops the same person from the second, so a row never names one twice.
  function setLead(localId: string, slot: 0 | 1, id: string) {
    setEntries(prev => prev.map(x => {
      if (x.localId !== localId) return x;
      if (slot === 0) return { ...x, leadIds: id ? [id, ...x.leadIds.slice(1).filter(other => other !== id)] : [] };
      return { ...x, leadIds: id ? [x.leadIds[0], id] : x.leadIds.slice(0, 1) };
    }));
  }

  function remove(localId: string) {
    // Removing a song can orphan its medley partner — re-normalize tags.
    setEntries(prev => normalizeMedleyTags(prev.filter(e => e.localId !== localId), uid2));
  }

  function handleDrop(toIdx: number) {
    const from = dragSrc.current;
    if (from === null || from === toIdx) return;
    setEntries(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(toIdx, 0, item);
      // Reordering can break a medley apart or interleave two — re-derive tags
      // from the new adjacency so stored tags always match what's shown.
      return normalizeMedleyTags(next, uid2);
    });
  }

  // The reorder every pointer can use (drag is mouse-only). Moves the row at
  // idx by one position; re-derives medley tags like handleDrop.
  function move(idx: number, dir: -1 | 1) {
    setEntries(prev => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item);
      return normalizeMedleyTags(next, uid2);
    });
  }

  // Precondition: idxA and idxB are adjacent (idxB === idxA + 1). The only caller
  // is the toggle button rendered between consecutive rows, which guarantees this.
  function toggleMedleyLink(idxA: number, idxB: number) {
    setEntries(prev => {
      const next = prev.map(e => ({ ...e }));
      const a = next[idxA];
      const b = next[idxB];

      if (a.medley_tag && b.medley_tag && a.medley_tag === b.medley_tag) {
        // Already linked — split at this boundary
        const tag = a.medley_tag;
        const groupIndices = next.reduce<number[]>((acc, e, i) => e.medley_tag === tag ? [...acc, i] : acc, []);
        const splitPos = groupIndices.indexOf(idxB);
        const leftGroup  = groupIndices.slice(0, splitPos);
        const rightGroup = groupIndices.slice(splitPos);
        if (leftGroup.length < 2)  leftGroup.forEach(i  => { next[i].medley_tag = undefined; });
        if (rightGroup.length >= 2) {
          const newTag = uid2();
          rightGroup.forEach(i => { next[i].medley_tag = newTag; });
        } else {
          rightGroup.forEach(i => { next[i].medley_tag = undefined; });
        }
      } else {
        // Link them — merge groups or create new tag
        const aTag = a.medley_tag;
        const bTag = b.medley_tag;
        if (aTag && bTag) {
          next.forEach(e => { if (e.medley_tag === bTag) e.medley_tag = aTag; });
        } else if (aTag) {
          b.medley_tag = aTag;
        } else if (bTag) {
          a.medley_tag = bTag;
        } else {
          const newTag = uid2();
          a.medley_tag = newTag;
          b.medley_tag = newTag;
        }
      }
      return next;
    });
  }

  async function handleCreateSong(form: FormState) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    setCreateSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/content/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload(form)),
      });
      if (!res.ok) {
        setCreateError(await writeErrorMessage(res) ?? "No se pudo crear la canción.");
        return;
      }
      const doc = await res.json();
      addSong({
        _id:    doc._id,
        title:  doc.title,
        author: doc.author ?? "",
        key:    doc.key ?? "",
        slug:   doc.slug?.current ?? "",
      });
      setCreateOpen(false);
    } catch {
      setCreateError("No se pudo crear la canción.");
    } finally {
      clearTimeout(timer);
      setCreateSaving(false);
    }
  }

  async function handleCreateTag(name: string): Promise<SongTag | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    try {
      const res = await fetch("/api/content/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const tag = await res.json();
      setAllTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateError(null);
      return tag;
    } catch {
      setCreateError("No se pudo crear el tag.");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleCreateAuthor(name: string): Promise<SongTag | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    try {
      const res = await fetch("/api/content/authors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const author = await res.json();
      setAllAuthors(prev => [...prev, author].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateError(null);
      return author;
    } catch {
      setCreateError("No se pudo crear el artista.");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function save() {
    // Without an observed state there is nothing to guard the write with; refuse
    // rather than send a blind overwrite.
    if (!observed) { setSaveError(SETLIST_READ_ISSUE_COPY.http); return; }
    // The dialogs that host this editor block Escape, the backdrop and the ✕
    // while it saves, so an un-abortable request would leave a modal that
    // cannot be closed at all. Same budget and same reason as the panel's own
    // mutations.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/setlists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          week, type, roleId,
          // A1's observed state, unchanged: the server rejects the save unless the
          // target is still exactly what this editor loaded.
          observed,
          songs: entries.map(e => ({
            songId: e.song._id,
            play_key: e.play_key,
            medley_tag: e.medley_tag,
            ...(worshipNight ? { leadIds: e.leadIds } : {}),
          })),
        }),
      });
      // Only close on success — otherwise keep the editor open so the admin's
      // edits aren't silently discarded on a failed/rejected save.
      if (res.status === 409) {
        setSaveConflict(true);
        setSaveError(SAVE_CONFLICT_COPY);
        return;
      }
      if (res.status === 400 && await refusesLeaders(res)) {
        setSaveConflict(true);
        setSaveError(LEAD_CHANGED_COPY);
        return;
      }
      if (!res.ok) { setSaveError("No se pudo guardar el setlist. Intenta de nuevo."); return; }
      if (onSaved) onSaved();
      else onClose();
    } catch {
      setSaveError("Error de conexión. Intenta de nuevo.");
    } finally {
      clearTimeout(timer);
      setSaving(false);
    }
  }

  const rosterIds = new Set(roster.map(m => m.id));
  const staleRows = worshipNight ? entries.filter(e => e.leadIds.some(id => !rosterIds.has(id))) : [];
  // A stale leader keeps an option of its own. Without one React selects «—» for
  // a value no option matches, so the picker would show nobody and choosing «—»
  // would change nothing — the admin could not clear the mark.
  const goneFromLead = (id: string | undefined): id is string => !!id && !rosterIds.has(id);
  const waiting = worshipNight ? unassignedLeads(roster, entries) : [];

  if (loading) {
    return <div className="flex justify-center py-8"><span className="font-label text-xs uppercase tracking-widest text-mono-500 animate-pulse">Cargando...</span></div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <CueDialogStatus tone="error">{loadError}</CueDialogStatus>
        <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current setlist */}
      <div>
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 mb-2">
          Setlist ({entries.length})
        </p>
        {entries.length === 0 && (
          <p className="font-body text-xs text-mono-600 italic">Sin canciones todavía</p>
        )}
        <div>
          {entries.map((e, idx) => {
            const lastUsed = recentSongs[e.song._id];
            const isDragging = draggingIdx === idx;
            const nextEntry = entries[idx + 1];
            const linked = !!e.medley_tag && !!nextEntry?.medley_tag && e.medley_tag === nextEntry.medley_tag;
            return (
              <Fragment key={e.localId}>
                <div
                  draggable={dragPointer}
                  onDragStart={ev => { ev.dataTransfer.effectAllowed = "move"; dragSrc.current = idx; setDraggingIdx(idx); }}
                  onDragOver={ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={ev => { ev.preventDefault(); handleDrop(idx); setDragOverIdx(null); }}
                  onDragEnd={() => { dragSrc.current = null; setDraggingIdx(null); setDragOverIdx(null); }}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 select-none transition-all ${idx > 0 ? "mt-1.5" : ""} ${
                    isDragging
                      ? "opacity-30 border-accent/10 bg-surface-sunken/30"
                      : dragOverIdx === idx
                      ? "border-accent/50 bg-accent/5"
                      : e.medley_tag
                      ? "border-accent/25 bg-surface-sunken/50"
                      : "border-accent/10 bg-surface-sunken/30"
                  }`}
                >
                  {dragPointer && (
                    <div className="cursor-grab active:cursor-grabbing text-mono-600 hover:text-mono-400 shrink-0 transition-colors" aria-hidden="true">
                      <GripIcon />
                    </div>
                  )}
                  <span className="font-label text-[11px] text-mono-600 shrink-0 w-4 text-center tabular-nums">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm truncate">{e.song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-xs text-mono-600">{e.song.author}</span>
                      {e.song.key && <span className="font-label text-xs text-mono-600">· {e.song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                    {worshipNight && (
                      <div className="mt-1.5 flex items-end gap-2">
                        <Select
                          id={`dirige-${e.localId}`}
                          label="Dirige"
                          aria-label={`Dirige ${e.song.title}`}
                          size="md"
                          className="min-w-0 flex-1"
                          value={e.leadIds[0] ?? ""}
                          onChange={ev => setLead(e.localId, 0, ev.target.value)}
                        >
                          <option value="">—</option>
                          {goneFromLead(e.leadIds[0]) && <option value={e.leadIds[0]} disabled>Ya no está en Lead</option>}
                          {roster.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                        <Select
                          id={`dirige-y-${e.localId}`}
                          label="y"
                          aria-label={`Y también dirige ${e.song.title}`}
                          size="md"
                          className="min-w-0 flex-1"
                          disabled={!e.leadIds[0]}
                          value={e.leadIds[1] ?? ""}
                          onChange={ev => setLead(e.localId, 1, ev.target.value)}
                        >
                          <option value="">—</option>
                          {goneFromLead(e.leadIds[1]) && <option value={e.leadIds[1]} disabled>Ya no está en Lead</option>}
                          {roster.filter(m => m.id !== e.leadIds[0]).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                      </div>
                    )}
                    {worshipNight && staleRows.includes(e) && (
                      <p className="font-body text-xs text-warning-strong">Dirige alguien que ya no está en Lead</p>
                    )}
                  </div>
                  {/* On a phone the controls take a line of their own under the
                      title (basis-full); from `sm` they sit inline at the right.
                      Three 44 px targets: a thumb cannot hit an 11 px glyph. */}
                  <div className="flex basis-full items-center gap-1 sm:basis-auto">
                    <input
                      className="w-16 min-h-[44px] select-text rounded-lg border border-edge-control bg-transparent px-1.5 text-center font-body text-[16px] focus:outline-none focus:border-accent sm:min-h-9 sm:text-xs"
                      placeholder="Tono"
                      aria-label={`Tono de ${e.song.title}`}
                      value={e.play_key}
                      onChange={ev => setEntries(prev => prev.map(x => x.localId === e.localId ? { ...x, play_key: ev.target.value } : x))}
                    />
                    {/* 44 px on a phone, the 36 px icon default from `sm` so a desktop row keeps
                        its height (the key field matches with `sm:min-h-9`). The end buttons are
                        `aria-disabled`, not `disabled`: a `disabled` button drops focus to <body>
                        the moment the row it just moved reaches the end, and `move()` already
                        refuses a step past either end. */}
                    <div className="ml-auto flex items-center">
                      <Button variant="icon" size="lg" className={ROW_ICON} onClick={() => move(idx, -1)} aria-disabled={idx === 0 || undefined} aria-label={`Subir ${e.song.title}`}>
                        <ChevronUpIcon size={16} />
                      </Button>
                      <Button variant="icon" size="lg" className={ROW_ICON} onClick={() => move(idx, 1)} aria-disabled={idx === entries.length - 1 || undefined} aria-label={`Bajar ${e.song.title}`}>
                        <ChevronDownIcon size={16} />
                      </Button>
                      <Button variant="icon" size="lg" className={ROW_ICON} tone="danger" onClick={() => remove(e.localId)} aria-label={`Quitar ${e.song.title}`}>
                        <CloseIcon size={16} />
                      </Button>
                    </div>
                  </div>
                </div>
                {idx < entries.length - 1 && (
                  <div className="-my-0.5 flex items-center justify-center relative z-10">
                    {/* The wrapper paints the page surface so the pill masks the gap between rows
                        (`inline-flex`, so its box is the pill's, not a line box with a descender).
                        On a phone an invisible `before:` pseudo-element stretches the pill's hit
                        area to ~44 px without moving the rows apart; from `sm` the pointer is a
                        mouse and the pill's own box is the target. */}
                    <span className="inline-flex rounded-full bg-surface-base">
                      <Button
                        variant="pill"
                        size="sm"
                        className="relative before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] sm:before:content-none"
                        active={linked}
                        onClick={() => toggleMedleyLink(idx, idx + 1)}
                        title={linked ? "Desagrupar medley" : "Agrupar en medley"}
                        aria-label={linked ? `Desagrupar medley: ${e.song.title} y ${nextEntry.song.title}` : `Agrupar en medley: ${e.song.title} y ${nextEntry.song.title}`}
                      >
                        <ChainLinkIcon strokeWidth={linked ? 2.5 : 1.5} />
                        {linked && <span className="text-[10px]">medley</span>}
                      </Button>
                    </span>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        {worshipNight && roster.length === 0 && (
          <p className="mt-2 font-body text-xs text-mono-400">
            Nadie está en Lead todavía. Agrégalos en el planner y guarda para elegir quién dirige.
          </p>
        )}
        {worshipNight && roster.length > 0 && waiting.length > 0 && (
          <p className="mt-2 font-body text-xs text-mono-400">Aún no dirigen: {waiting.map(m => m.name).join(", ")}.</p>
        )}
      </div>

      {/* Search & add */}
      <div className="border-t border-accent/10 pt-3 space-y-2">
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">Agregar canción</p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-1.5 rounded-lg border border-edge-control bg-transparent font-body text-[16px] sm:text-sm focus:outline-none focus:border-accent transition-colors placeholder-mono-600"
            placeholder="Buscar por título..."
            aria-label="Buscar canción por título"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          <input
            className="w-16 px-2 py-1.5 rounded-lg border border-edge-control bg-transparent font-body text-[16px] sm:text-sm text-center focus:outline-none focus:border-accent transition-colors placeholder-mono-600"
            placeholder="Tono"
            aria-label="Tono de la canción que agregas"
            value={addKey}
            onChange={e => setAddKey(e.target.value)}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="rounded-lg border border-accent/20 divide-y divide-accent/10 max-h-48 overflow-y-auto">
            {searchResults.map(song => {
              const lastUsed = recentSongs[song._id];
              const alreadyAdded = entries.some(e => e.song._id === song._id);
              return (
                <div key={song._id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/5 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm truncate">{song.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="font-label text-xs text-mono-600">{song.author}</span>
                      {song.key && <span className="font-label text-xs text-mono-600">· {song.key}</span>}
                      {lastUsed && <RepeatBadge lastUsed={lastUsed} />}
                    </div>
                  </div>
                  <Button variant="pill" size="sm" className="shrink-0" disabled={alreadyAdded} onClick={() => addSong(song)} aria-label={alreadyAdded ? `${song.title} ya está en el setlist` : `Añadir ${song.title}`}>
                    {alreadyAdded ? "Ya está" : <><PlusIcon size={12} /> Añadir</>}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <Button variant="secondary" size="lg" className="w-full justify-start" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={14} /> Crear{" "}
          {searchQ.trim()
            ? <span className="min-w-0 truncate font-body text-xs normal-case tracking-normal text-mono-400">&quot;{searchQ}&quot;</span>
            : <span className="font-body text-xs normal-case tracking-normal text-mono-400">nueva canción</span>}
        </Button>
      </div>

      {/* Footer */}
      {staleRows.length > 0 && (
        <p className="font-body text-xs text-warning-strong">Corrige quién dirige las canciones marcadas.</p>
      )}
      {saveError && (
        <p className="text-negative-fg font-label text-xs uppercase tracking-widest text-center -mb-1">{saveError}</p>
      )}
      {/* A 409 keeps the editor (and the admin's edits) open and requires a
          reload: the observed state is only replaced by a fresh read. */}
      {saveConflict && (
        <Button variant="secondary" size="lg" className="w-full" onClick={() => setReloadToken(t => t + 1)}>
          Recargar setlist
        </Button>
      )}
      <div className="flex gap-3 sticky bottom-0 bg-surface-raised-alt py-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={save}
          busy={saving}
          busyLabel="Guardando..."
          disabled={saveConflict || !observed || staleRows.length > 0}
        >
          Guardar setlist
        </Button>
      </div>

      {/* Create song modal (nested above the ServicesPanel modal) */}
      {createOpen && (
        <CueDialog
          open
          title="Nueva canción"
          label="Nueva canción"
          mode="sheet"
          size="lg"
          onDismiss={() => { setCreateError(null); setCreateOpen(false); }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {createError && <CueDialogStatus tone="error">{createError}</CueDialogStatus>}
          <SongForm
            initial={{ title: searchQ }}
            allTags={allTags}
            allAuthors={allAuthors}
            onSubmit={handleCreateSong}
            onClose={() => { setCreateError(null); setCreateOpen(false); }}
            loading={createSaving}
            canCreateTag={handleCreateTag}
            canCreateAuthor={handleCreateAuthor}
          />
          </div>
        </CueDialog>
      )}
    </div>
  );
}
