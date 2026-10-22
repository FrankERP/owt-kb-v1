"use client";

import { useState, useEffect, useRef, useCallback, useId, Fragment } from "react";
import { useRouter } from "next/navigation";
import { ProposalStatus } from "@/app/utils/interface";
import { normalizeMedleyTags } from "@/app/utils/medley";
import { ChainLinkIcon } from "@/app/components/ChainLinkIcon";
import { useToast } from "@/app/components/ui/Toast";
import ProposalThread, { type ThreadMessage } from "@/app/components/ProposalThread";
import CueDialog from "@/app/components/ui/CueDialog";
import Button from "@/app/components/ui/Button";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, MusicNoteIcon, PlusIcon } from "@/app/components/ui/icons";
import { formatKey } from "@/app/utils/formatKey";

// Design pass (2026-10-22, item 12 of «Diseño para miembros»): the oldest screen
// in the app, and every one of its controls was drawn by hand — «Volver»,
// «Recargar», the dashed «Agregar canción», the key picker, the «X», the save
// bar. They are the house `Button` now, doing exactly what they did. Keys are
// SHOWN through `formatKey` («B♭», never «Bb») and stored untouched. The song
// search, which was a 256 px box floating over the list with its results
// clipped inside, is a `CueDialog` sheet: the results get the screen, and the
// sheet stays open after an add so a lead can pick the whole set in one go —
// the row the lead just added reads «En lista».

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
  messages?: ThreadMessage[] | null;
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
  /**
   * What admins wrote to this service's leads from its card (ADR-0065) —
   * typically what the pastor shared. Read-only here; merged into the thread by `at`.
   */
  earlierMessages?: ThreadMessage[] | null;
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

/** The editor's songs as they come off a stored proposal. */
function songsFromProposal(proposal: SharedProposal | null | undefined): ProposalSong[] {
  if (!proposal?.songs?.length) return [];
  return proposal.songs.map(s => ({
    songId: s.song_id,
    title: s.title,
    author: s.author,
    key: s.key,
    play_key: s.play_key || s.key,
    medley_tag: s.medley_tag,
  }));
}

/**
 * Stable fingerprint of the state a save actually persists, for detecting
 * unsaved work. Order is part of it — a setlist IS its order.
 *
 * `proposalId` is an input rather than a nicety: `leadNotes` is sent ONLY while
 * no proposal document exists (see the payload in `save`), and the field stops
 * being rendered at the same moment. So it has to leave the fingerprint exactly
 * when it leaves the payload — otherwise the first save, which mints the id,
 * would leave the editor reading as permanently dirty the instant it succeeded.
 *
 * Notes are trimmed on both sides, so a stray trailing space is not "work".
 */
export function proposalSnapshot(
  songs: Array<Pick<ProposalSong, "songId" | "play_key" | "medley_tag">>,
  teamNotes: string,
  leadNotes: string,
  proposalId: string | null,
): string {
  return JSON.stringify({
    songs: songs.map(s => [s.songId, s.play_key ?? "", s.medley_tag ?? ""]),
    teamNotes: teamNotes.trim(),
    leadNotes: proposalId ? "" : leadNotes.trim(),
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProposalEditor({ roleDoc, proposal, currentUserId, earlierMessages }: Props) {
  const router = useRouter();

  const [songs, setSongs] = useState<ProposalSong[]>(() => songsFromProposal(proposal));

  const [messages, setMessages] = useState<ThreadMessage[]>(proposal?.messages ?? []);
  const [leadNotes, setLeadNotes] = useState(proposal?.lead_notes ?? "");
  const [teamNotes, setTeamNotes] = useState(proposal?.team_notes ?? "");
  const [status, setStatus]       = useState<ProposalStatus>(proposal?.status ?? "draft");
  // Which save is in flight — the bar's two buttons each swap their own label.
  const [savingAs, setSavingAs]   = useState<"draft" | "pending" | null>(null);
  const saving = savingAs !== null;
  const { toast } = useToast();
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [staleReload, setStaleReload] = useState(false);

  // Saved-state snapshot `dirty` compares against; re-seeded after each
  // successful save. Same shape as `useAvailability`'s, and for the same
  // reason: this editor holds a whole setlist and had no guard at all, so
  // "Volver" discarded a reordered, retuned, medley-linked list in silence.
  const [initialSnap, setInitialSnap] = useState(() =>
    proposalSnapshot(
      songsFromProposal(proposal),
      proposal?.team_notes ?? "",
      proposal?.lead_notes ?? "",
      proposal?._id ?? null,
    ),
  );

  // The submit-confirmation dialog is a `CueDialog` (traps focus, restores it
  // to the opener on close, and closes on Escape/backdrop) — see Step 3 of
  // the M0b-1 overlays task for why the hand-rolled version it replaced
  // needed a trap in the first place.
  const teamNotesId = useId();
  const leadNotesId = useId();

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
  const [sheetOpen, setSheetOpen]       = useState(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, ok = true) => toast({ message: msg, tone: ok ? "ok" : "error" });

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

  // A pending search must not outlive the editor: it would set state on an
  // unmounted component, and in tests fire after jsdom teardown and fail the run.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // The catalogue is fetched while the sheet is CLOSED (on mount, and again after
  // a close that left nothing), so opening it shows songs at once, not «Buscando…».
  useEffect(() => {
    if (!sheetOpen && searchResults.length === 0) search("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  const openSheet = () => { setKeyPickerIdx(null); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setSearchQuery(""); };

  // The sheet opens on its search box, not on the dialog's own close button
  // (`CueDialog` lands entry focus on its first focusable, which is that
  // button). A focus-moving effect depends on the presence edge only
  // (ADR-0034); it runs after the dialog's, so the box is where focus ends.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sheetOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [sheetOpen]);

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
  };

  // Removing a song can orphan its medley partner — re-normalize tags.
  const removeSong = (idx: number) => setSongs(prev => normalizeMedleyTags(prev.filter((_, i) => i !== idx), uid));

  const setPlayKey = (idx: number, play_key: string) => {
    setSongs(prev => prev.map((s, i) => i === idx ? { ...s, play_key } : s));
    setKeyPickerIdx(null);
  };

  const save = async (submitStatus: "draft" | "pending") => {
    setSavingAs(submitStatus);
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
          // Sent ONLY on a first submission, when no proposal document exists yet
          // (Child A §2). Once one does, the private note is a thread message and
          // the composer below is where it is written.
          //
          // The PAYLOAD is conditioned, not just the rendering: `leadNotes` is a
          // one-time initializer re-sent verbatim on every save, so after the lead
          // posts a message the mirror moves the stored value and this stale copy
          // would read as a deliberate edit — resurrecting the pre-post note as a
          // new bubble and mailing it. Conditioning the render alone leaves that
          // payload in place and makes the server rule unsound.
          leadNotes: proposalId ? "" : leadNotes,
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
      const data: {
        _id?: string;
        status: ProposalStatus;
        _rev?: string | null;
        messages?: ThreadMessage[] | null;
      } = await res.json();
      setStatus(data.status);
      if (data._id) setProposalId(data._id);
      // The save landed, so what is on screen IS the saved state. Seeded with
      // the id the server just minted, not the one this closure captured: on a
      // FIRST save those differ, and the old `null` would keep `leadNotes` in
      // the fingerprint that the next render no longer puts there.
      setInitialSnap(proposalSnapshot(songs, teamNotes, leadNotes, data._id ?? proposalId));
      // No fresh revision means the next save cannot be guarded: force a reload
      // rather than let it fall back to an unguarded observation.
      if (data._rev) setRev(data._rev);
      else setStaleReload(true);
      // A first submission that carried a note mints the first message. Adopt it
      // so the thread the editor is about to reveal shows what was just written,
      // instead of "Aún no hay mensajes." — `null` means the read-back failed,
      // so keep what is on screen.
      if (data.messages) setMessages(data.messages);
      showToast(submitStatus === "pending" ? "Propuesta enviada" : "Borrador guardado");
      router.refresh();
    } catch {
      showToast("Error al guardar", false);
    } finally {
      setSavingAs(null);
    }
  };

  /**
   * Post one message into the thread.
   *
   * Rethrows on failure so `<ProposalThread>` keeps the composer's text — its
   * own catch is what shows the error. Clearing on failure would lose what the
   * lead wrote, which is the one thing this channel promises not to do.
   *
   * **Adopts the fresh revision only when `observedRev` matches the pin.** The
   * lead's OWN post moves `_rev`, so a blanket pin guarantees a 409 on their
   * next save and a reload that discards the in-progress setlist — on the
   * feature's primary action. And a content comparison is not a substitute:
   * `POST /api/me/proposals` writes `songs`, `status` AND `team_notes` in one
   * patch — `lead_notes` was in this list until Child B froze it, and the
   * argument rests on the others — so "identical songs" proves only that songs did
   * not move; adopting on that would let this editor's stale `teamNotes`
   * initializer destroy a co-lead's message with no 409 and no banner.
   *
   * Residual, named not closed: the append carries no revision precondition, so
   * a co-lead commit inside the route's read→commit window still lets this
   * editor adopt a revision whose parent it never saw. Milliseconds, and
   * conditioning the append would reintroduce the 409 it exists to avoid.
   */
  const postMessage = useCallback(async (body: string) => {
    if (!proposalId) throw new Error("no proposal");
    const res = await fetch(`/api/me/proposals/${encodeURIComponent(proposalId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error("post failed");
    // `messages: null` means the post landed but the read-back did not — not an
    // empty thread. Typed so the distinction survives the next edit.
    const data: {
      messages?: ThreadMessage[] | null;
      rev?: string | null;
      observedRev?: string | null;
    } = await res.json();
    // `null` = the post landed but the read-back did not. Keep the thread on
    // screen rather than blanking it; the message is stored either way.
    if (data.messages) setMessages(data.messages);
    if (data.rev && data.observedRev && data.observedRev === rev) setRev(data.rev);
  }, [proposalId, rev]);

  const isApproved  = status === "approved";

  // Unsaved work. Not tracked once approved: the editor is read-only there, so a
  // warning the member cannot act on is noise, and the action bar that would
  // show it is not rendered.
  const dirty =
    !isApproved &&
    proposalSnapshot(songs, teamNotes, leadNotes, proposalId) !== initialSnap;

  // Tab close / refresh / navigation out of the app. Client-side navigation
  // inside the app does not fire this — "Volver" is guarded below, and the
  // navbar links are a known gap the App Router gives no clean hook for.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const leaveEditor = () => {
    if (dirty && !window.confirm("Tienes cambios sin guardar en esta propuesta. ¿Salir y descartarlos?")) return;
    router.push("/me");
  };

  const serviceLabel =
    roleDoc.service_type === "sunday"   ? "Domingo" :
    roleDoc.service_type === "saturday" ? "Sábado"  :
    (roleDoc.service_name ?? "Servicio Especial");

  // 16 px on a phone, the design's size from `sm` up (F3): WebKit auto-zooms any
  // focused control under 16 px and never zooms back, which pushed the tab bar off
  // screen on the simulator. `inputFontSize.test.ts` is the guard.
  const inputCls = "w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-[16px] sm:text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-placeholder";

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={leaveEditor} className="-ml-3 mb-4">
          <ArrowLeftIcon />
          Volver
        </Button>

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
          <Button variant="secondary" size="sm" className="mt-1" onClick={() => { setStaleReload(false); router.refresh(); }}>
            Recargar
          </Button>
        </div>
      )}

      {/* The private lead ↔ admin conversation, replacing the old "Comentarios
          del admin" banner. Rendered whenever a document exists and NOT gated on
          status or on a field being non-empty: the block it replaces was gated on
          `changes_requested && admin_notes`, and inheriting that would hide the
          thread on a `pending` proposal, which is where the conversation happens.

          Before the document exists there is no composer — the "Notas privadas"
          textarea below stands in, and nothing is buffered client-side. */}
      {proposalId && (
        <ProposalThread
          // The admins' pre-proposal messages first (ADR-0065); the thread orders
          // the whole list by `at`. Kept out of `messages` state on purpose: every
          // post's read-back replaces that state with the PROPOSAL's thread only.
          messages={[...(earlierMessages ?? []), ...messages]}
          viewerId={currentUserId}
          viewerRole="lead"
          serviceDate={roleDoc.service_date}
          onPost={postMessage}
        />
      )}

      {/* Before the proposal exists there is no document to post into, but the
          admins may already have written here — what the pastor shared, say.
          The lead reads it now, while choosing songs, and answers through the
          "Notas privadas" field below, which opens the proposal's thread. */}
      {!proposalId && (earlierMessages?.length ?? 0) > 0 && (
        <ProposalThread
          messages={earlierMessages}
          viewerId={currentUserId}
          viewerRole="lead"
          title="Mensajes de los admins"
          serviceDate={roleDoc.service_date}
          readOnlyHint="Para responder, escribe en «Notas privadas para revisión» al guardar tu propuesta."
        />
      )}

      {/* Song list */}
      <div className="space-y-3">
        <h2 className="font-label text-xs uppercase tracking-widest text-mono-500">Lista de canciones</h2>

        {songs.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-3 text-mono-600">
            <MusicNoteIcon size={32} strokeWidth={1.5} />
            <p className="font-body text-sm text-center">
              Aún no hay canciones. Agrégalas con «Agregar canción».
            </p>
          </div>
        )}

        {songs.length > 0 && (
        <div>
        {songs.map((song, idx) => {
          const nextSong = songs[idx + 1];
          const linked = !!song.medley_tag && !!nextSong?.medley_tag && song.medley_tag === nextSong.medley_tag;
          const inMedley = !!song.medley_tag;
          const shownKey = formatKey(song.play_key);
          return (
          <Fragment key={song.songId}>
          <div
            draggable={!isApproved}
            onDragStart={() => onDragStart(idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDrop={() => onDrop(idx)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-2 pl-3 pr-2 py-2.5 md:gap-3 md:px-4 md:py-3 rounded-xl border transition-all ${idx > 0 ? "mt-1.5" : ""} ${
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

            {/* Up / down (the phone's reorder — drag needs a pointer). Icon
                buttons keep a 36 px target each; the pair overlaps the row's
                padding so the row stays as tall as its three lines of text. */}
            {!isApproved && (
              <div className="flex flex-col -my-2 shrink-0 md:hidden">
                <Button
                  variant="icon"
                  onClick={(e) => { e.stopPropagation(); moveSong(idx, idx - 1); }}
                  disabled={idx === 0}
                  aria-label={`Mover arriba: ${song.title}`}
                >
                  <ChevronUpIcon />
                </Button>
                <Button
                  variant="icon"
                  onClick={(e) => { e.stopPropagation(); moveSong(idx, idx + 1); }}
                  disabled={idx === songs.length - 1}
                  aria-label={`Mover abajo: ${song.title}`}
                >
                  <ChevronDownIcon />
                </Button>
              </div>
            )}

            {/* Position */}
            <span className="font-label text-xs text-mono-500 w-5 text-center shrink-0 tabular-nums">{idx + 1}</span>

            {/* Song info */}
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold truncate">{song.title}</p>
              <p className="font-body text-xs text-mono-400 truncate">{song.author}</p>
              {!!song.previous_keys?.length && (
                <p className="font-body text-xs text-mono-500 mt-0.5">
                  Tonos anteriores: <span className="text-accent/80">{song.previous_keys.map(formatKey).join(" · ")}</span>
                </p>
              )}
            </div>

            {/* Key picker: the row's key as a small button, a popover of pills under it */}
            {!isApproved && (
              <div
                className="relative shrink-0"
                ref={keyPickerIdx === idx ? keyPickerRef : undefined}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  aria-haspopup="true"
                  aria-expanded={keyPickerIdx === idx}
                  aria-label={`Tono de ${song.title}: ${shownKey}`}
                  onClick={(e) => { e.stopPropagation(); setKeyPickerIdx(keyPickerIdx === idx ? null : idx); }}
                  onMouseDown={e => e.stopPropagation()}
                  className="min-w-[2.75rem] normal-case tracking-normal"
                >
                  {shownKey}
                </Button>
                {keyPickerIdx === idx && (
                  <div className="absolute right-0 top-full mt-1.5 z-30 bg-surface-overlay-deepest border border-accent/20 rounded-xl shadow-2xl p-2.5 w-[13.5rem]">
                    <div className="grid grid-cols-4 gap-1" role="group" aria-label={`Elegir tono de ${song.title}`}>
                      {KEY_OPTIONS.map(k => (
                        <Button
                          key={k}
                          variant="pill"
                          size="sm"
                          active={k === song.play_key}
                          onClick={() => setPlayKey(idx, k)}
                          className="normal-case tracking-normal px-1"
                        >
                          {formatKey(k)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isApproved && (
              <span className="font-label text-xs px-2 py-0.5 rounded-full border border-accent/20 text-accent shrink-0">
                {shownKey}
              </span>
            )}

            {/* Remove */}
            {!isApproved && (
              <Button
                variant="icon"
                tone="danger"
                onClick={() => removeSong(idx)}
                aria-label={`Quitar ${song.title}`}
                title="Quitar"
                className="-mr-1"
              >
                <CloseIcon />
              </Button>
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

        {/* Add a song: opens the search sheet */}
        {!isApproved && (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={openSheet}
          >
            <PlusIcon />
            Agregar canción
          </Button>
        )}
      </div>

      {/* Team message */}
      {!isApproved && (
        <div className="space-y-2">
          <label htmlFor={teamNotesId} className="font-label text-xs uppercase tracking-widest text-mono-500">
            Mensaje para el equipo <span className="normal-case tracking-normal text-mono-600">(opcional)</span>
          </label>
          <textarea
            id={teamNotesId}
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Comparte un versículo, una reflexión o algo que quieras decirle al equipo…"
            value={teamNotes}
            onChange={e => setTeamNotes(e.target.value)}
          />
          <p className="font-body text-xs text-mono-600">Se mostrará al equipo cuando se apruebe la propuesta.</p>
        </div>
      )}

      {/* Private review notes — the FIRST-submission stand-in for the thread
          composer, which needs a document that does not exist yet. Retained on
          purpose: deleting it would also empty the "Nueva propuesta" admin email,
          whose body is this value. Once the proposal exists, the conversation
          moves to <ProposalThread> below. */}
      {!proposalId && (
        <div className="space-y-2">
          <label htmlFor={leadNotesId} className="font-label text-xs uppercase tracking-widest text-mono-500">
            Notas privadas para revisión <span className="normal-case tracking-normal text-mono-600">(opcional)</span>
          </label>
          <textarea
            id={leadNotesId}
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

      {/* Approved banner */}
      {isApproved && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-positive-deep/20 bg-positive-deep/5 text-positive-strong">
          <CheckIcon size={16} className="shrink-0" />
          <p className="font-label text-xs uppercase tracking-widest">
            Propuesta aprobada — el setlist ha sido publicado
          </p>
        </div>
      )}

      {/* Sticky action bar */}
      {!isApproved && (
        <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-surface-base/95 backdrop-blur-sm border-t border-surface-accent-faint z-10">
          {dirty && !saving && (
            <p className="mb-2 font-label text-[11px] uppercase tracking-widest text-warning-strong">
              Cambios sin guardar
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              disabled={saving}
              busy={savingAs === "draft"}
              busyLabel="Guardando…"
              onClick={() => save("draft")}
            >
              Guardar borrador
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={saving || songs.length === 0}
              busy={savingAs === "pending"}
              busyLabel="Enviando…"
              onClick={() => setConfirmSubmit(true)}
            >
              Enviar propuesta
            </Button>
          </div>
        </div>
      )}

      {/* Song search sheet. A sheet on a phone and a modal from `sm` up, so the
          results get the whole screen instead of a 256 px box over the list. It
          stays open after an add: picking four songs is one trip, and the row
          just added reads «En lista». */}
      <CueDialog open={sheetOpen} mode="sheet" size="md" title="Agregar canción" label="Agregar canción" onDismiss={closeSheet}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-5 pt-5 pb-3">
            <div className="brand-search-console">
              <input
                ref={searchInputRef}
                type="search"
                aria-label="Buscar canción"
                placeholder="Buscar por título o artista…"
                autoComplete="off"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-transparent px-3 py-2.5 font-body text-[16px] sm:text-sm text-ink placeholder:text-placeholder focus:outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {searching && (
              <p className="font-body text-sm text-mono-500 text-center py-6">Buscando…</p>
            )}
            {!searching && searchResults.length === 0 && (
              <p className="font-body text-sm text-mono-500 text-center py-6">Sin resultados</p>
            )}
            {!searching && searchResults.length > 0 && (
              <ul className="divide-y divide-ink-dim/10" aria-label="Resultados">
                {searchResults.map(song => {
                  const already = songs.some(s => s.songId === song._id);
                  return (
                    <li key={song._id}>
                      <button
                        type="button"
                        onClick={() => !already && addSong(song)}
                        disabled={already}
                        aria-label={already ? `${song.title} — en lista` : `Agregar ${song.title}`}
                        className={`w-full flex items-center gap-3 px-2 py-3 text-left rounded-lg transition-colors duration-fast ease-out-brand ${
                          already ? "opacity-40 cursor-not-allowed" : "hover:bg-accent/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm font-semibold truncate">{song.title}</p>
                          <p className="font-body text-xs text-mono-400 truncate">{song.author}</p>
                          <p className="font-body text-xs text-mono-500 mt-0.5">
                            {song.previous_keys.length > 0
                              ? <>Tonos anteriores: <span className="text-accent/80">{song.previous_keys.map(formatKey).join(" · ")}</span></>
                              : "Sin historial previo"}
                          </p>
                        </div>
                        <span className="font-label text-xs text-mono-500 shrink-0">{formatKey(song.key)}</span>
                        {already
                          ? <span className="font-label text-[11px] uppercase tracking-widest text-mono-500 shrink-0">En lista</span>
                          : <span className="text-accent shrink-0" aria-hidden="true"><PlusIcon /></span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-surface-accent-faint px-5 py-3">
            <p className="font-label text-xs text-mono-500 tabular-nums">
              {songs.length} en la lista
            </p>
            <Button variant="primary" onClick={closeSheet}>Listo</Button>
          </div>
        </div>
      </CueDialog>

      {/* Submit confirmation dialog */}
      <CueDialog open={confirmSubmit} title="Enviar propuesta" size="sm" onDismiss={() => setConfirmSubmit(false)}>
        <div className="space-y-5 p-6">
          <p className="font-body text-sm text-mono-400">
            Vas a enviar {songs.length} canción{songs.length !== 1 ? "es" : ""} para {serviceLabel}. El admin recibirá tu propuesta para revisión.
          </p>
          <ul className="space-y-1 rounded-xl border border-accent/10 bg-accent-deep/10 p-3">
            {songs.map((s, i) => (
              <li key={s.songId} className="flex items-center gap-2">
                <span className="w-4 text-right font-label text-[11px] tabular-nums text-mono-600">{i + 1}</span>
                <span className="flex-1 truncate font-body text-sm">{s.title}</span>
                <span className="shrink-0 font-label text-xs text-accent">{formatKey(s.play_key)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setConfirmSubmit(false)}>Cancelar</Button>
            <Button className="flex-1" variant="primary" disabled={saving} onClick={() => { setConfirmSubmit(false); save("pending"); }}>
              Confirmar
            </Button>
          </div>
        </div>
      </CueDialog>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
