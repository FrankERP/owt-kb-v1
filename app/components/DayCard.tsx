"use client";

import { useCallback, useState } from "react";
import { Setlist, SetlistSong } from "../utils/interface";
import { buildRuns } from "../utils/medley";
import { ChainLinkIcon } from "./ChainLinkIcon";
import PracticePlaylistButton from "./PracticePlaylistButton";
import { usePlayer } from "@/app/context/PlayerContext";
import { useSession } from "next-auth/react";
import { SetlistEditor } from "./admin/SetlistEditor";
import ServiceMessagesDialog from "./admin/ServiceMessagesDialog";
import { isThreadOpen } from "@/app/utils/proposalThread";
import CueDialog from "./ui/CueDialog";
import { themeColour } from "@/app/utils/themeColour";
import { paintsDayCard } from "@/app/utils/paintsDayCard";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import { findDuplicates, myNameFromSession, serviceTone, TONE_RAIL } from "@/app/utils/agenda";
import { formatLeadNames } from "@/app/utils/songLeads";
import NumberRoll from "./ui/NumberRoll";
import QuickActions, { type QuickAction } from "./ui/QuickActions";
import useLongPress from "./ui/useLongPress";
import { useToast } from "./ui/Toast";

export interface DayCardProps {
  day: string;
  date?: string;
  /** "HH:mm" for a same-day set; rendered after the date. Display only. */
  time?: string | null;
  setlist?: Setlist | null;
  leads?: string[];
  /** Titles of the songs the viewing member leads (worship nights). */
  myLeadSongs?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
  roleId?: string;
  /**
   * The service document's own `_id` (role doc for a special, or the
   * `sunday_role`/`saturday_role` doc for a weekend card). `DayCardDisclosure`
   * uses it for the `.ics` UID so a weekend service gets one UID rather than
   * a `${date}-${day}` string it shares with nothing else on record.
   */
  serviceId?: string;
  isNext?: boolean;
  /**
   * `card` is the stacked card every surface has always rendered. `wide` is the
   * run sheet on home (spec §12.1): setlist and team side by side from `lg`, so
   * the next service fits one screen instead of scrolling past the seats.
   */
  layout?: "card" | "wide";
  /**
   * The card is the page's hero: it carries ONE primary action, `Ensayar`, in
   * the header — and therefore drops the inline practice pill on the Setlist
   * rail, so the same affordance never appears twice on one card.
   */
  hero?: boolean;
  /** Rendered inside `DayCardDisclosure`, which already draws the card's ground,
   *  hairline and rail: drop this card's own so there is one card, not two. */
  nested?: boolean;
}

/* The day's identity is ONE device: the 3 px rail down the card's left edge, in the
   agenda's own tone vocabulary (`TONE_RAIL`). Until 2026-10-20 each day also tinted
   the border, the shadow, the header ground, the date, every section label, the
   song keys, the medley spine and the instrument chips — Saturday in the `warning`
   family, so the most-seen card in the app read as an alert, and one card carried
   amber, green and cyan at once. Everything else on the card is neutral now; cyan
   is for what can be pressed, green for «tú» (the «premium» audit, approved by Frank
   as "superficies y color"; ADR-0059). */

/** The neutral the card's quiet chrome (medley spine, instrument chips) is drawn in. */
const NEUTRAL = "--ink-dim-rgb";

export function DayCard({ day, date, time, setlist, leads, myLeadSongs, instruments, fohTeam, bgvs, chorus, roleId, serviceId, isNext, layout = "card", hero = false, nested = false }: DayCardProps) {
  const { openSheet } = usePlayer();
  const { data: session } = useSession();
  const { toast } = useToast();
  const [editSetlist, setEditSetlist] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [setlistSaving, setSetlistSaving] = useState(false);

  // ONE quick-actions sheet for the whole card, never one per row — the same rule
  // `LibraryIndex` follows (R7): a mounted `QuickActions` subscribes to the
  // CueDialog layer context, so a sheet per setlist row would re-render every row
  // each time any dialog anywhere opened or closed. The rows only report the press.
  //
  // Song and OPEN flag are separate state on purpose: `CueDialog` keeps its
  // children mounted through the exit animation, so clearing the song on close
  // would blank the sheet's title while it slides away.
  const [actionsFor, setActionsFor] = useState<SetlistSong | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const onQuickActions = useCallback((song: SetlistSong) => {
    setActionsFor(song);
    setActionsOpen(true);
  }, []);

  const hasRole     = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist  = !!(setlist?.songs?.length);

  // The display name used in role cards is alias || member_name — the same helper
  // the agenda reads (`myNameFromSession`), so the two surfaces can never disagree.
  const myName = myNameFromSession(session?.user);

  // Detect the same person assigned twice within one section (voces / instrumentos / foh).
  // A person may appear once in voces AND once in instrumentos — that's fine.
  const vocesDups = findDuplicates([
    ...(leads ?? []),
    ...(bgvs ?? []).map(m => m.alias || m.member_name),
    ...(chorus ?? []).map(m => m.alias || m.member_name),
  ]);
  const instrDups = findDuplicates((instruments ?? []).filter(s => s.person).map(s => s.person));
  const fohDups   = findDuplicates((fohTeam ?? []).filter(s => s.person).map(s => s.person));

  if (!paintsDayCard({ setlist, leads, instruments, fohTeam, bgvs, chorus })) return null;

  const tone = serviceTone({ day, roleId });
  const canEdit = ["super-admin", "admin"].includes(session?.user?.role as string);
  // «Mensajes» (ADR-0064): admins write to this service's leads — what the pastor
  // shared, say — from the card itself. Needs the service document's id (absent
  // on the planner's preview cards) and a service that has not happened yet.
  const messageRoleId = serviceId || roleId || null;
  const canMessage = canEdit && !!messageRoleId && !!date && isThreadOpen({ serviceDate: date });
  const setlistType: "sunday" | "saturday" | "special" =
    roleId ? "special" : day === "Sábado" ? "saturday" : day === "Domingo" ? "sunday" : "special";

  const shortDate = date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";
  const days = date ? daysUntil(date) : null;
  // The two-column rail only earns its keep when both columns have content —
  // a setlist with no team to show beside it should stack like `card`, not
  // reserve a 20rem rail for nothing.
  const wide = layout === "wide" && hasSetlist && hasRole;

  // Group songs into medley runs
  const runs = hasSetlist ? buildRuns(setlist!.songs) : [];

  // «Abrir» is the row's own tap, named; «Practicar» is deliberately absent because
  // the player exposes ONE song entry point and «Abrir» already calls it. The link
  // action only appears when the row carries a slug — the home page's setlist
  // projection does, but `DayCard` is also handed rows from elsewhere.
  const actionSlug = actionsFor?.slug?.current;
  const quickActions: QuickAction[] = actionsFor
    ? [
        { label: "Abrir", onSelect: () => openSheet(actionsFor._id, actionsFor.play_key || undefined) },
        ...(actionSlug
          ? [
              {
                label: "Copiar enlace",
                onSelect: async () => {
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}/posts/${actionSlug}`);
                    toast({ message: "Enlace copiado", tone: "ok", duration: 2000 });
                  } catch {
                    // Denied permission, an insecure origin, or no clipboard at all —
                    // never close as success (the client-handler invariant).
                    toast({ message: "No se pudo copiar", tone: "error" });
                  }
                },
              } satisfies QuickAction,
            ]
          : []),
      ]
    : [];

  return (
    <>
      <div className={nested ? "relative overflow-hidden rounded-[var(--brand-radius-panel)]" : "brand-facet-panel brand-surface overflow-hidden rounded-[var(--brand-radius-panel)]"}>
        {!nested && <span aria-hidden className={`absolute inset-y-0 left-0 z-[1] w-[3px] ${TONE_RAIL[tone]}`} />}
        {/* Header — day · date, and at most two things on the right: the
            countdown (next service only) and the hero's one action. §18 keeps
            one eyebrow per surface, so the `Servicio` label and the long date
            are gone; the date the header already shows is the date. */}
        <div className="border-b border-ink/[0.08] px-5 py-4">
          {/* THE ROW WRAPS, and that is a deliberate visual change on the app's most
              looked-at surface — verified in the iOS Simulator at every preset,
              because both cheaper options are worse at one end or the other:

                • `min-w-0` + `break-words` on the title and NO wrap: correct at
                  Normal (the title takes two lines beside the controls, exactly as
                  it shipped), but at «Máximo» the right-hand block is ~220px of
                  unshrinkable pill + «Ensayar», so the title's box collapses to a
                  couple of characters and paints ONE LETTER PER LINE down the card,
                  with «Ensayar» clipped by `overflow-hidden` anyway.
                • no wrap and no break rule — what shipped: the title's text simply
                  painted over the controls and was cut off.

              At «Máximo» the title and «Ensayar» genuinely do not fit one line on a
              phone; something has to give, and a second line is the only thing that
              gives without losing content. `ml-auto` keeps the controls where the
              design puts them, because a lone item on a wrapped `justify-between`
              line otherwise falls back to flex-start. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3 className="font-display text-2xl font-bold uppercase leading-none text-ink md:text-3xl break-words">
                {day}{shortDate && <span className="text-ink-dim font-normal"> · {shortDate}</span>}{time && <span className="text-ink-dim font-normal tabular-nums"> · {time}</span>}
              </h3>
              {myLeadSongs && myLeadSongs.length > 0 && <p className="mt-1 font-label text-xs text-accent">Diriges: {myLeadSongs.join(", ")}</p>}
            </div>
            {/* NO `shrink-0` here, and it wraps too. With `shrink-0` this block sat
                at its max-content width — pill + «Ensayar» ≈ 350px at «Máximo» —
                and hung out past a 314px card, where the panel's `overflow-hidden`
                simply cut «ENSAYAR» in half (seen in the simulator). Letting it
                shrink lets its own two children stack, right-aligned. */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {isNext && days !== null && (
                <span className="rounded-full border border-ink-dim/30 px-2.5 py-1 font-label text-[10px] uppercase tracking-widest text-ink-muted">
                  <NumberRoll value={formatCountdown(days)} />
                </span>
              )}
              {canMessage && (
                <button
                  type="button"
                  onClick={() => setMessagesOpen(true)}
                  className="flex items-center gap-1 font-label text-[11px] uppercase tracking-widest text-mono-500 hover:text-accent transition-colors"
                >
                  <ChatIcon />
                  Mensajes
                </button>
              )}
              {hero && hasSetlist && (
                <PracticePlaylistButton variant="hero" songIds={setlist!.songs.map((s) => s._id)} accentVar="--accent-rgb" />
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 md:p-6">
          {setlist?.team_notes && (
            <section className="rounded-lg border border-ink/[0.08] bg-surface-lift/[0.03] px-4 py-3">
              <p className="font-label text-[11px] uppercase tracking-widest text-mono-400 mb-1">Mensaje para el equipo</p>
              <p className="font-body text-sm text-ink-muted/90 whitespace-pre-wrap">{setlist.team_notes}</p>
            </section>
          )}

          {/* The run sheet reads left-to-right from `lg`: songs in the wide
              column, seats in a fixed 20rem rail. `space-y-5` is the stacked
              gap and has to go once the two are columns, or the rail starts a
              row lower than the setlist. */}
          <div className={wide ? "space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:space-y-0" : "space-y-5"}>
            {/* Setlist */}
            {hasSetlist && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-surface-ink-l70-d50">
                    Setlist
                  </h4>
                  <div className="flex items-center gap-3">
                    {!hero && <PracticePlaylistButton songIds={setlist!.songs.map(s => s._id)} accentVar="--accent-rgb" />}
                    {canEdit && date && (
                      <button
                        onClick={() => setEditSetlist(true)}
                        className="flex items-center gap-1 font-label text-[11px] uppercase tracking-widest text-mono-500 hover:text-accent transition-colors"
                      >
                        <PencilIcon />
                        Editar
                      </button>
                    )}
                  </div>
                </div>
                <ol className="divide-y divide-ink-dim/[0.06]">
                  {runs.map((run) => {
                    // Single-song medley groups render as plain singles
                    if (run.kind === "single" || (run.kind === "medley" && run.songs.length === 1)) {
                      const { song, n } = run.kind === "single" ? run : run.songs[0];
                      return (
                        <li key={song._id}>
                          <SongRow song={song} n={n} onOpen={openSheet} onQuickActions={onQuickActions} />
                        </li>
                      );
                    }
                    // Multi-song medley group — left-spine bracket, no box
                    return (
                      <li key={run.songs[0].song._id + "_m"} className="relative pl-4 my-0.5">
                        {/* vertical accent spine */}
                        <span
                          aria-hidden
                          className="absolute left-1 top-6 bottom-2 w-[2px] rounded-full"
                          style={{ background: `linear-gradient(to bottom, ${themeColour(NEUTRAL, 0)}, ${themeColour(NEUTRAL, 0.3333)} 12%, ${themeColour(NEUTRAL, 0.3333)} 88%, ${themeColour(NEUTRAL, 0)})` }}
                        />
                        {/* MEDLEY label */}
                        {/* `color` on the wrapper, not on the icon: ChainLinkIcon strokes with
                            `currentColor` by default, and `var()` is NOT substituted inside an SVG
                            presentation attribute — a token passed as `color` would be dropped
                            silently. The sibling span sets its own colour, so it is unaffected. */}
                        <div className="flex items-center gap-1 pl-2 -ml-2 mb-0.5" style={{ color: themeColour(NEUTRAL) }}>
                          <ChainLinkIcon opacity={0.65} />
                          <span className="font-label text-[10px] uppercase tracking-[0.18em]" style={{ color: `${themeColour(NEUTRAL, 0.8)}` }}>Medley</span>
                        </div>
                        {run.songs.map(({ song, n }, si) => (
                          <div key={song._id}>
                            {si > 0 && (
                              <span className="block w-4 text-center font-label text-[11px] leading-none -my-0.5" style={{ color: `${themeColour(NEUTRAL, 0.6)}` }}>+</span>
                            )}
                            <SongRow song={song} n={n} onOpen={openSheet} onQuickActions={onQuickActions} dense />
                          </div>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Team */}
            {hasRole && (
              <section className={`space-y-5${hasSetlist ? ` border-t border-ink-dim/[0.12] pt-5${wide ? " lg:border-t-0 lg:pt-0" : ""}` : ""}`}>
                {(leads?.length || bgvs?.length || chorus?.length) ? (
                  <div>
                    <SectionDivider label="Voces" />
                    {/* auto-fit + an em-based floor, not `grid-cols-3`: the track
                        minimum grows with the TEXT, so a member on «Máximo» text size
                        gets two columns and then one instead of three columns whose
                        names overlap each other. `minmax(0,…)`'s upper half keeps a
                        long name from pushing the card wider than the phone. */}
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5em),1fr))] gap-x-3 gap-y-3">
                      <VocalCol label="Lead" names={leads ?? []} highlightName={myName} duplicateNames={vocesDups} />
                      <VocalCol label="BGVs" names={(bgvs ?? []).map(m => m.alias || m.member_name)} highlightName={myName} duplicateNames={vocesDups} />
                      <VocalCol label="Coro" names={(chorus ?? []).map(m => m.alias || m.member_name)} highlightName={myName} duplicateNames={vocesDups} />
                    </div>
                  </div>
                ) : null}

                {instruments && instruments.filter(s => s.person).length > 0 && (
                  <div>
                    <SectionDivider label="Instrumentos" />
                    <div className="flex flex-wrap gap-x-3 gap-y-2">
                      {instruments.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} highlightName={myName} isDuplicate={instrDups.has(s.person.toLowerCase().trim())} />)}
                    </div>
                  </div>
                )}

                {fohTeam && fohTeam.filter(s => s.person).length > 0 && (
                  <div>
                    <SectionDivider label="Front of House" />
                    <div className="flex flex-wrap gap-x-3 gap-y-2">
                      {fohTeam.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} highlightName={myName} isDuplicate={fohDups.has(s.person.toLowerCase().trim())} />)}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      <QuickActions
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={actionsFor?.title ?? ""}
        subtitle={actionsFor?.author || undefined}
        actions={quickActions}
      />

      {canMessage && (
        <ServiceMessagesDialog
          open={messagesOpen}
          roleId={messageRoleId}
          title={`Mensajes · ${day} ${shortDate}`}
          viewerId={session?.user?.sanityId ?? null}
          onClose={() => setMessagesOpen(false)}
        />
      )}

      {/* Setlist editor modal */}
      {editSetlist && date && (
        <CueDialog
          open
          title={`Setlist - ${day} ${shortDate}`}
          label={`Setlist - ${day} ${shortDate}`}
          mode="sheet"
          size="lg"
          // A save in flight keeps the editor mounted on failure so it can
          // show the error; dismissing here would destroy that surface and the
          // lead's whole setlist with it. Same guard as the Servicios dialog.
          onDismiss={() => { if (!setlistSaving) setEditSetlist(false); }}
        >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
              <SetlistEditor
                week={date.slice(0, 10)}
                type={setlistType}
                roleId={roleId}
                onBusyChange={setSetlistSaving}
                onClose={() => setEditSetlist(false)}
                onSaved={() => setEditSetlist(false)}
              />
            </div>
        </CueDialog>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * One run-sheet row: order · title · artist · key · BPM (spec §12.1). The single
 * and medley branches carried a byte-identical copy of this markup each, which is
 * exactly how a new column lands in one of them and not the other. `dense` is the
 * only real difference: a medley's members sit tighter because the `+` between
 * them already spaces the run.
 *
 * The row is a `<button>` rather than the house `Button`: the ROW is the
 * affordance, edge to edge, the same exemption `LibraryRow` takes.
 *
 * A long press (F3) REPORTS the row through `onQuickActions` and opens nothing
 * itself — the card owns the one sheet. Before this a hold on a phone selected the
 * row's text instead of doing anything, which is what `select-none` (and the
 * hook's own `user-select` style) now prevents.
 */
function SongRow({ song, n, onOpen, onQuickActions, dense = false }: {
  song: SetlistSong;
  n: number;
  onOpen: (songId: string, playKey?: string) => void;
  // Stable (the card's `useCallback`) — a new identity per render would re-arm
  // the hook's timer mid-press.
  onQuickActions?: (song: SetlistSong) => void;
  dense?: boolean;
}) {
  const longPress = useLongPress(() => onQuickActions?.(song));
  const leadNames = formatLeadNames(song.leads);
  return (
    <button
      {...longPress}
      onClick={() => onOpen(song._id, song.play_key || undefined)}
      className={`group -mx-2 flex w-full cursor-pointer select-none items-center gap-3 rounded-lg px-2 ${dense ? "py-2" : "py-2.5"} text-left transition-colors hover:bg-accent/[0.055]`}
    >
      <span className="font-label text-xs text-mono-400 w-4 shrink-0 text-right tabular-nums">{n}</span>
      <div className="flex-1 min-w-0">
        <div className="min-w-0 flex items-baseline gap-1.5">
          <span className="truncate font-body text-base font-semibold transition-colors group-hover:text-accent md:text-lg">{song.title}</span>
          {song.author && <span className="text-mono-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
        </div>
        {leadNames && <span className="block truncate font-label text-[11px] text-mono-500">Dirige: {leadNames}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {song.play_key && song.key && song.play_key !== song.key && (
          <span className="font-label text-[11px] px-1.5 py-0.5 rounded border border-mono-700 bg-mono-800/50 text-mono-500 leading-tight">orig. {song.key}</span>
        )}
        <span className="font-label text-xs font-semibold text-ink">{song.play_key || song.key}</span>
        {song.bpm && <span className="hidden w-10 text-right font-label text-[11px] text-mono-500 tabular-nums sm:inline">{song.bpm}</span>}
      </div>
    </button>
  );
}

function VocalCol({ label, names, highlightName, duplicateNames }: { label: string; names: string[]; highlightName?: string; duplicateNames?: Set<string> }) {
  if (!names.length) return <div />;
  return (
    <div className="min-w-0">
      <p className="font-label text-xs uppercase tracking-widest text-mono-400 mb-0.5">{label}</p>
      {/* `break-words`, not `anywhere`: a name breaks only when that one name is
          wider than its column — at «Máximo» text size it is — and the paragraph's
          min-content stays the longest name rather than a single letter, which is
          what `anywhere` would do to a flex or grid child. Before this the names
          could not break at all and simply painted over the next column, where the
          card's `overflow-hidden` cut them off. */}
      <p className="font-body text-sm md:text-base lg:text-lg leading-snug break-words">
        {names.map((name, i) => {
          const key  = name.toLowerCase().trim();
          const isDup = !!duplicateNames?.has(key);
          const isMe  = !isDup && !!highlightName && key === highlightName;
          return (
            <span key={i}>
              {i > 0 && ", "}
              {isDup ? (
                <span
                  className="font-semibold text-warning-strong"
                  style={{ textShadow: "0 0 10px rgb(var(--warning-strong-rgb) / 0.65)" }}
                >⚠&nbsp;{name}</span>
              ) : isMe ? (
                <span className="font-semibold text-positive-fg">{name}</span>
              ) : (
                <span>{name}</span>
              )}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function Row({ label, value, highlightName, isDuplicate }: { label: string; value: string; highlightName?: string; isDuplicate?: boolean }) {
  const isMe = !isDuplicate && !!highlightName && value.toLowerCase().trim() === highlightName;
  return (
    <div
      className="inline-flex items-stretch rounded-lg"
      style={{
        border: isDuplicate
          ? "1px solid rgb(var(--warning-strong-rgb) / 0.6)"
          : isMe ? "1px solid rgb(var(--positive-fg-rgb) / 0.5)" : `1px solid ${themeColour(NEUTRAL, 0.2)}`,
        boxShadow: isDuplicate ? "0 0 10px rgb(var(--warning-strong-rgb) / 0.35)" : undefined,
      }}
    >
      <span
        className="font-label text-xs uppercase tracking-wide px-2.5 flex items-center shrink-0 rounded-l-[7px] text-mono-400"
        style={{
          background: `${themeColour(NEUTRAL, 0.08)}`,
          borderRight: `1px solid ${themeColour(NEUTRAL, 0.16)}`,
        }}
      >
        {label}
      </span>
      <span
        className={`font-body text-sm md:text-base px-3 py-1.5 flex flex-1 items-center justify-center gap-1 leading-tight ${
          isDuplicate ? "font-semibold text-warning-strong" : isMe ? "font-semibold text-positive-fg" : ""
        }`}
        style={isDuplicate ? { background: "rgb(var(--warning-strong-rgb) / 0.10)" } : isMe ? { background: "rgb(var(--positive-fg-rgb) / 0.10)" } : undefined}
      >
        {isDuplicate && <span>⚠</span>}
        {value}
      </span>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-label text-xs md:text-sm lg:text-base text-mono-400 uppercase tracking-wide shrink-0">
        {label}
      </span>
      {/* `ink/8`, not the `mono-200`/`dark:mono-800` pair it replaced: the mono scale
          INVERTS in light, so `mono-200` drew a near-black rule there (2026-10-20). */}
      <div className="flex-1 h-px bg-ink/[0.08]" />
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
