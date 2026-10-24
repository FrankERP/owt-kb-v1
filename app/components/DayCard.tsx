"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { Setlist, SetlistSong } from "../utils/interface";
import { buildRuns } from "../utils/medley";
import { ChainLinkIcon } from "./ChainLinkIcon";
import PracticePlaylistButton from "./PracticePlaylistButton";
import Button from "./ui/Button";
import { usePlayer } from "@/app/context/PlayerContext";
import { useSession } from "next-auth/react";
import { SetlistEditor } from "./admin/SetlistEditor";
import ServiceMessagesDialog from "./admin/ServiceMessagesDialog";
import { isThreadOpen } from "@/app/utils/proposalThread";
import CueDialog from "./ui/CueDialog";
import { themeColour } from "@/app/utils/themeColour";
import { paintsDayCard } from "@/app/utils/paintsDayCard";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import { serviceStartTime } from "@/app/utils/calendarFeed";
import { myNameFromSession, mySeats, serviceTone, TONE_RAIL } from "@/app/utils/agenda";
import { normalizeSeatName } from "./admin/seatModel";
import { SEAT_TO_FAMILY } from "@/app/utils/rehearsalMixes";
import { formatLeadNames } from "@/app/utils/songLeads";
import NumberRoll from "./ui/NumberRoll";
import QuickActions, { type QuickAction } from "./ui/QuickActions";
import useLongPress from "./ui/useLongPress";
import { useToast } from "./ui/Toast";
import TeamSections from "./TeamSections";
import { formatKey } from "@/app/utils/formatKey";
// The sheet's one small-caps title lives in a NEUTRAL module (ADR-0028): the home
// page is a Server Component and reads it as a string, which an export from this
// "use client" file would not be there.
import { SHEET_TITLE } from "@/app/utils/homeHero";

export interface DayCardProps {
  day: string;
  date?: string;
  /** "HH:mm" for a same-day set; rendered after the date. Display only. */
  time?: string | null;
  setlist?: Setlist | null;
  /**
   * The service's «Mensaje del pastor» (ADR-0065, 2026-10-24): one text per
   * service, set by an admin, shown to the whole team above the team note.
   */
  pastorMessage?: string | null;
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
  /**
   * The run-sheet rendering WITHOUT the hero's own head (ADR-0070): hairline
   * rows, the sheet's titles and body-type labels, no card header — what a
   * «Después» row on home opens onto, since the row already names the service.
   * `hero` implies it.
   */
  sheet?: boolean;
  /** Rendered inside `DayCardDisclosure`, which already draws the card's ground,
   *  hairline and rail: drop this card's own so there is one card, not two. */
  nested?: boolean;
  /** Display-name key → photo URL for the team's faces (`seatPhotos`). Absent:
   *  initials for everyone and no «+ foto» (see `TeamSections`). */
  photos?: Record<string, string>;
  /** The viewer's Tipo, so a member with no seat here still opens their section. */
  viewerTypes?: string[] | null;
  /** The viewer's display name as the SERVER read it. A server page passes it so
   *  the member's own section is open in the first paint; the bare client
   *  `SessionProvider` only has the session after hydration, and the card would
   *  otherwise jump open under the reader. */
  viewerName?: string;
  /** Whether the viewer is an admin (super-admin or admin), as the SERVER read
   *  it — same first-paint reason as `viewerName`. Admins see every team section
   *  open (Frank, 2026-10-21): they read the whole team, not their own seat. */
  viewerIsAdmin?: boolean;
}

/* The day's identity is ONE device: the 3 px rail down the card's left edge, in the
   agenda's own tone vocabulary (`TONE_RAIL`). Until 2026-10-20 each day also tinted
   the border, the shadow, the header ground, the date, every section label, the
   song keys, the medley spine and the instrument chips — Saturday in the `warning`
   family, so the most-seen card in the app read as an alert, and one card carried
   amber, green and cyan at once. Everything else on the card is neutral now; cyan
   is for what can be pressed, green for «tú» (the «premium» audit, approved by Frank
   as "superficies y color"; ADR-0059). */

/** The neutral the card's quiet chrome (the medley spine) is drawn in. */
const NEUTRAL = "--ink-dim-rgb";

export function DayCard({ day, date, time, setlist, pastorMessage, leads, myLeadSongs, instruments, fohTeam, bgvs, chorus, roleId, serviceId, isNext, layout = "card", hero = false, sheet: sheetProp = false, nested = false, photos, viewerTypes, viewerName, viewerIsAdmin }: DayCardProps) {
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

  const sheet = hero || sheetProp;
  const hasRole     = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist  = !!(setlist?.songs?.length);

  // The display name used in role cards is alias || member_name — the same helper
  // the agenda reads (`myNameFromSession`), so the two surfaces can never disagree.
  // The client session wins once it exists; until then, the server's reading.
  const myName = myNameFromSession(session?.user) || viewerName || "";

  // The instrument the viewer plays in THIS service, for «Ensayar»'s «al frente» mix:
  // their first seat that HAS a mix family (a Lead who also plays Keys gets Keys).
  const mySeat = mySeats({ leads, bgvs, chorus, instruments, fohTeam }, myName.toLowerCase().trim())
    .map(normalizeSeatName)
    .find((seat) => SEAT_TO_FAMILY[seat]) ?? null;

  if (!paintsDayCard({ setlist, leads, instruments, fohTeam, bgvs, chorus })) return null;

  const tone = serviceTone({ day, roleId });
  const canEdit = ["super-admin", "admin"].includes(session?.user?.role as string);
  // The client session wins once it exists (an impersonating admin reads as the
  // member they view); until then, the server's reading.
  const openAllSections = session?.user ? canEdit : !!viewerIsAdmin;
  // «Mensajes» (ADR-0065): admins write to this service's leads — what the pastor
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
  // The next service's pill carries the clock too — «En 3 días · 11:00» (design
  // pass D, 2026-10-22). WEEKENDS ONLY, at the team's standing hour by the feed's
  // rule (`serviceStartTime`): a special's own `time` already sits after its date
  // in the heading (or it is all-day and has no clock), so the pill never repeats
  // it. `roleId` is only ever set for a special — the `DayCardDisclosure` rule.
  const startTime = roleId || time ? null : serviceStartTime("weekend", day, null);
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

  // The message and the songs, rendered ONCE: the run sheet wraps them as its
  // left column, a stacked card lays them straight into its flow.
  const runSheetMain = (
    <>
      {/* Keyed by the text: `CalendarView` keys its cards by index, so the
          same instance can be handed another day's note — which must arrive
          folded, not inheriting the «Leer todo» the reader opened before. */}
      {pastorMessage && <TeamNote key={pastorMessage} title="Mensaje del pastor" pastor text={pastorMessage} />}
      {setlist?.team_notes && <TeamNote key={setlist.team_notes} text={setlist.team_notes} />}

      {/* Setlist */}
      {hasSetlist && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className={sheet ? SHEET_TITLE : "font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-surface-ink-l70-d50"}>
              Setlist
            </h4>
            <div className="flex items-center gap-3">
              {!hero && <PracticePlaylistButton songs={setlist!.songs} mySeat={mySeat} accentVar="--accent-rgb" />}
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
          <ol className={sheet ? "divide-y divide-ink/[0.10] border-y border-ink/[0.10]" : "divide-y divide-ink-dim/[0.06]"}>
            {runs.map((run) => {
              // Single-song medley groups render as plain singles
              if (run.kind === "single" || (run.kind === "medley" && run.songs.length === 1)) {
                const { song, n } = run.kind === "single" ? run : run.songs[0];
                return (
                  <li key={song._id}>
                    <SongRow song={song} n={n} onOpen={openSheet} onQuickActions={onQuickActions} sheet={sheet} />
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
                        <span className={`block ${sheet ? "w-7 text-right" : "w-4 text-center"} font-label text-[11px] leading-none -my-0.5`} style={{ color: `${themeColour(NEUTRAL, 0.6)}` }}>+</span>
                      )}
                      <SongRow song={song} n={n} onOpen={openSheet} onQuickActions={onQuickActions} dense sheet={sheet} />
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );

  return (
    <>
      {/* A SHEET is not a card (ADR-0070): no panel, no rail, no card header — the
          page's gutter is its padding. The hero keeps a one-line identity («Domingo
          · 25 oct · 11:00»): the greeting band above it names the member's OWN next
          service, which is not always this one (a Sunday Lead opens the page on a
          week whose next service is Saturday), so the sheet says which service it
          is. A «Después» row already does, so a plain sheet draws none. Only the
          one action, «Ensayar», leads. */}
      <div className={sheet ? "relative" : nested ? "relative overflow-hidden rounded-[var(--brand-radius-panel)]" : "brand-facet-panel brand-surface overflow-hidden rounded-[var(--brand-radius-panel)]"}>
        {!nested && !sheet && <span aria-hidden className={`absolute inset-y-0 left-0 z-[1] w-[3px] ${TONE_RAIL[tone]}`} />}
        {sheet ? (
          <div className="flex flex-col gap-4 empty:hidden">
            {hero && (
              <p className="font-body text-sm text-ink-muted">
                {day}{shortDate && ` · ${shortDate}`}{(time || startTime) && <span className="tabular-nums"> · {time || startTime}</span>}
              </p>
            )}
            {/* Capped from `md`: full width on a phone is the thumb's target, but the
                same button across a 56rem desktop page read as a banner (D). */}
            {hero && hasSetlist && (
              <div className="md:max-w-md">
                <PracticePlaylistButton variant="hero" songs={setlist!.songs} mySeat={mySeat} accentVar="--accent-rgb" />
              </div>
            )}
            {((myLeadSongs && myLeadSongs.length > 0) || canMessage) && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {myLeadSongs && myLeadSongs.length > 0 ? (
                  <p className="font-body text-sm text-accent">Diriges: {myLeadSongs.join(", ")}</p>
                ) : <span />}
                {canMessage && (
                  <Button variant="ghost" size="sm" onClick={() => setMessagesOpen(true)}>
                    <ChatIcon />
                    Mensajes
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
        // Header — day · date with the countdown on the right (next service
        // only). §18 keeps one eyebrow per surface, so the `Servicio` label and
        // the long date are gone; the date the header already shows is the date.
        <div className="border-b border-ink/[0.08] px-5 py-4">
          {/* THE ROW WRAPS. It was written for title + countdown + «Ensayar» side by
              side, verified in the iOS Simulator at every preset: with no wrap, a
              long title collapsed to one letter per line at «Máximo» or painted
              over the controls. «Ensayar» moved below the row on 2026-10-21, but an
              editor-authored service name beside the countdown pill can still run
              out of room, and a second line is the only thing that gives without
              losing content. `ml-auto` keeps the pill right-aligned, because a lone
              item on a wrapped `justify-between` line falls back to flex-start. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3 className="font-display text-2xl font-bold uppercase leading-none text-ink md:text-3xl break-words">
                {day}{shortDate && <span className="text-ink-dim font-normal"> · {shortDate}</span>}{time && <span className="text-ink-dim font-normal tabular-nums"> · {time}</span>}
              </h3>
              {myLeadSongs && myLeadSongs.length > 0 && <p className="mt-1 font-label text-xs text-accent">Diriges: {myLeadSongs.join(", ")}</p>}
            </div>
            {/* NO `shrink-0` here, and it wraps too: a pinned block hung out past
                a 314px card at «Máximo», where `overflow-hidden` cut it in half. */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {isNext && days !== null && (
                <span className="rounded-full border border-ink-dim/30 px-2.5 py-1 font-label text-[10px] uppercase tracking-widest text-ink-muted">
                  <NumberRoll value={formatCountdown(days)} />
                  {startTime && <span className="tabular-nums"> · {startTime}</span>}
                </span>
              )}
              {canMessage && (
                <Button variant="ghost" size="sm" onClick={() => setMessagesOpen(true)}>
                  <ChatIcon />
                  Mensajes
                </Button>
              )}
            </div>
          </div>
        </div>
        )}

        <div className={hero ? "mt-8 space-y-6" : sheet ? "mt-2 space-y-6 pb-2" : "space-y-5 p-5 md:p-6"}>
          {/* The run sheet reads left-to-right from `lg`: the message and the
              songs in the wide column, the seats in a fixed rail (22rem, 24rem
              from `xl`: two faces with their names to a row). The message sits
              INSIDE the left column (Frank, 2026-10-22) — spanning both columns
              it pushed the whole sheet down by its own height on a big screen.
              `space-y-5` is the stacked gap and has to go once the two are
              columns, or the rail starts a row lower than the setlist. */}
          <div className={wide ? "space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8 lg:space-y-0 xl:grid-cols-[minmax(0,1fr)_24rem]" : "space-y-5"}>
            {/* The left column exists only on the run sheet: a stacked card has
                no column to fill, and `space-y-5` inside `space-y-5` would be
                a wrapper for nothing. */}
            {wide ? <div className="space-y-5" data-run-sheet-main="">{runSheetMain}</div> : runSheetMain}

            {/* Team — Voces, Banda, Cabina as folding sections of faces; on the
                run sheet every section starts open from `lg`, where the rail
                has the room and the page is one screen anyway. */}
            {hasRole && (
              <section className={sheet ? "pt-2" : hasSetlist ? `border-t border-ink-dim/[0.12] pt-2${wide ? " lg:border-t-0 lg:pt-0" : ""}` : ""}>
                {sheet && <h4 className={`${SHEET_TITLE} mb-3`}>Equipo</h4>}
                <TeamSections
                  team={{ leads, bgvs, chorus, instruments, fohTeam }}
                  myName={myName}
                  photos={photos}
                  viewerTypes={viewerTypes}
                  openAll={openAllSections}
                  openAllFrom={wide ? "lg" : undefined}
                  sheet={sheet}
                />
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
 * «Mensaje para el equipo», folded to three lines (design pass D, 2026-10-22).
 * The pastor's note on the hero ran eight lines on a phone and pushed the
 * setlist — what the card is for — below the fold. The fold is REAL, not a
 * guess from the text's length: the paragraph is measured clamped
 * (`scrollHeight > clientHeight`) and re-measured whenever its box changes (a
 * text-size change, a rotated phone) and once the web fonts land (a swap
 * re-wraps the lines without changing the clamped box, so the observer alone
 * would miss it), so a two-line note never grows a «Leer todo» that does
 * nothing. Measured only while clamped: once open the paragraph no longer
 * overflows, and the toggle must stay so the reader can fold it back.
 */
function TeamNote({
  text,
  title = "Mensaje para el equipo",
  pastor = false,
}: {
  text: string;
  title?: string;
  /** The pastor's message: the same fold, an accent edge so it reads as the pastor's. */
  pastor?: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    // A 1px tolerance: a clamped box and its content can differ by a subpixel
    // of line-height rounding without a fourth line existing.
    let live = true;
    const measure = () => {
      if (live) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // Optional chaining on `fonts`: jsdom has no Font Loading API.
    document.fonts?.ready.then(measure, () => {});
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [expanded, text]);
  return (
    <section
      className={
        pastor
          ? "rounded-lg border border-surface-accent-30 bg-accent/5 px-4 py-3"
          : "rounded-lg border border-ink/[0.08] bg-surface-lift/[0.03] px-4 py-3"
      }
    >
      <p className={`font-label text-[11px] uppercase tracking-widest mb-1 ${pastor ? "text-accent" : "text-mono-400"}`}>{title}</p>
      <p ref={ref} id={id} className={`font-body text-sm text-ink-muted/90 whitespace-pre-wrap${expanded ? "" : " line-clamp-3"}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 mt-1"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Leer menos" : "Leer todo"}
        </Button>
      )}
    </section>
  );
}

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
function SongRow({ song, n, onOpen, onQuickActions, dense = false, sheet = false }: {
  song: SetlistSong;
  n: number;
  onOpen: (songId: string, playKey?: string) => void;
  // Stable (the card's `useCallback`) — a new identity per render would re-arm
  // the hook's timer mid-press.
  onQuickActions?: (song: SetlistSong) => void;
  dense?: boolean;
  /** The hero's run sheet (ADR-0070): a display-face number, a 17 px title with the
   *  artist on its own line, the key as a hairline pill — one row per 68 px. */
  sheet?: boolean;
}) {
  const longPress = useLongPress(() => onQuickActions?.(song));
  const leadNames = formatLeadNames(song.leads);
  return (
    <button
      {...longPress}
      onClick={() => onOpen(song._id, song.play_key || undefined)}
      className={`group -mx-2 flex w-full cursor-pointer select-none items-center ${sheet ? "gap-4" : "gap-3"} rounded-lg px-2 ${sheet ? (dense ? "py-2.5" : "py-3.5") : dense ? "py-2" : "py-2.5"} text-left transition-colors hover:bg-accent/[0.055]`}
    >
      {/* `w-7`, right-aligned: two digits of 20 px display type need the room, and a
          medley's «+» sits in the same column. */}
      <span className={sheet ? "w-7 shrink-0 text-right font-display text-xl font-semibold leading-none text-ink-dim tabular-nums" : "font-label text-xs text-mono-400 w-4 shrink-0 text-right tabular-nums"}>{n}</span>
      <div className="flex-1 min-w-0">
        {sheet ? (
          <>
            <span className="block truncate font-body text-[17px] font-semibold leading-snug transition-colors group-hover:text-accent">{song.title}</span>
            {song.author && <span className="block truncate font-body text-sm text-ink-muted">{song.author}</span>}
          </>
        ) : (
          <div className="min-w-0 flex items-baseline gap-1.5">
            <span className="truncate font-body text-base font-semibold transition-colors group-hover:text-accent md:text-lg">{song.title}</span>
            {song.author && <span className="text-mono-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
          </div>
        )}
        {leadNames && <span className={`block truncate ${sheet ? "font-body text-sm text-ink-muted" : "font-label text-[11px] text-mono-500"}`}>Dirige: {leadNames}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {song.play_key && song.key && song.play_key !== song.key && (
          <span className="font-label text-[11px] px-1.5 py-0.5 rounded border border-mono-700 bg-mono-800/50 text-mono-500 leading-tight">orig. {formatKey(song.key)}</span>
        )}
        <span className={sheet ? "rounded-full border border-ink/[0.18] px-2.5 py-1 font-label text-sm font-semibold text-ink" : "font-label text-xs font-semibold text-ink"}>{formatKey(song.play_key || song.key)}</span>
        {song.bpm && <span className="hidden w-10 text-right font-label text-[11px] text-mono-500 tabular-nums sm:inline">{song.bpm}</span>}
      </div>
    </button>
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
