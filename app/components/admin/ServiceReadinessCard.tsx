"use client";

// One service card, in the plan's hierarchy (Plan B items 7-9):
//
//   1 identity + publication state + the action cluster + the ONE primary action
//   2 blocking issue summary
//   3 assigned-team | setlist preview
//
// Three of the plan's sections are gone (see `CARD_SECTIONS` in `serviceCardModel`):
// the four-module readiness strip, the full-width `Más acciones` bar, and the
// full-width primary action at the foot. The secondary actions live top-right in
// the header — `Editar equipo` and `Editar setlist` as icon buttons, everything
// else behind the kebab beside them — and the primary action sits in the same
// row as a normal-width button (2026-10-22, the compact card). Every action and
// every gate survived the moves; only their placement changed.
//
// The compact card (2026-10-22) is one line of identity — `Dom 25 oct · en 3 días`
// and the state chip — over a two-column body, «Equipo» beside «Setlist», when the
// card is wide enough for both (a container query in `brand.css`, not a viewport
// breakpoint: the same card is ~656 px beside the Participaciones column and
// ~340 px on a phone). Its day colour is a 3 px rail down the left edge and
// nothing else (ADR-0059, `CARD_RAIL`): the header ground, the borders, the
// section labels, the keys and the chips are all neutral, so Saturday no longer
// wears the alerts' amber and twelve cards fit in ~a third of the height.
//
// The card renders by MAPPING over `CARD_SECTIONS`, so that exported constant is
// the real rendered order and the ordering test cannot drift from the DOM.
//
// It decides nothing: the issue copy, preview and primary action all come
// from `serviceCardModel` (which in turn reads the shipped readiness contracts).
// The 15-rule ladder is rendered, never re-derived.
//
// Existing tools it must keep working: whole-team and per-seat `Intercambiar`
// selection, copy-instruments source/target picking, the setlist editor, publish /
// hide, edit and delete.

import { ChainLinkIcon } from "../ChainLinkIcon";
import { buildRuns } from "../../utils/medley";
import Button from "../ui/Button";
import Menu, { MenuItem, MenuSeparator } from "../ui/Menu";
import NumberRoll from "../ui/NumberRoll";
import ServiceIssueList from "./ServiceIssueList";
import ServicePrimaryAction, { ServiceReviewFlag, isReviewKind } from "./ServicePrimaryAction";
import {
  CARD_RAIL,
  CARD_SECTIONS,
  CARD_STYLE,
  cardIdentity,
  cardPreview,
  dn,
  serviceIssueLines,
  servicePrimaryActionProps,
  type CardSection,
  type MemberOption,
  type ServiceCardModel,
  type SetlistSong,
  type SwapSource,
} from "./serviceCardModel";
import type { ServiceSourceStates } from "./serviceReadiness";
import type { RevealProps } from "@/app/utils/reveal";
import { themeColour } from "@/app/utils/themeColour";
import { plural } from "@/app/utils/plural";

/** The medley spine's token: neutral, as on the member-facing `DayCard` (ADR-0059). */
const NEUTRAL = "--ink-dim-rgb";

/**
 * One control's current availability, derived from the five individual source
 * states (never from aggregate `dataConfidence`). `reason` is the Spanish copy
 * naming the missing source and its retry.
 */
export interface CardGate {
  enabled: boolean;
  reason: string | null;
}

export interface CardGates {
  editTeam: CardGate;
  editSetlist: CardGate;
  copyInstruments: CardGate;
  deleteService: CardGate;
  publish: CardGate;
  unpublish: CardGate;
  swap: CardGate;
  proposalHandoff: CardGate;
}

export interface ServiceReadinessCardProps {
  card: ServiceCardModel;
  sources: ServiceSourceStates;
  todayIso: string;
  gates: CardGates;
  /** Runs the ONE primary action; the panel maps its route to an existing flow. */
  onPrimaryAction: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetlist: () => void;
  /** «Mensajes del servicio»: the conversation with this service's leads (ADR-0065). */
  onMessages?: () => void;
  /** Draft -> publish (guarded / override). Never used to hide a service. */
  onPublish: () => void;
  /** Published -> hide, through the separate narrow unpublish flow. */
  onUnpublish: () => void;
  swapMode: boolean;
  swapSource: SwapSource | null;
  onCardSwapSelect: () => void;
  onMemberChipClick: (src: Exclude<SwapSource, { kind: "card" }>) => void;
  copyMode: boolean;
  isCopySource: boolean;
  onCopyStart: () => void;
  onCopyPick: () => void;
  /**
   * Additive layout utilities for the card ROOT, supplied by whoever lays the
   * cards out. The Servicios board passes none since it went vertical
   * (ADR-0044): its grid sizes each card, where the old snap track needed a
   * fixed width and a snap stop on every one. Never colour: the root's
   * border/ring/shadow are decided here, from the card's own state.
   */
  className?: string;
  /** Route-reveal attributes (`{...revealProps(i)}`), spread on the root. */
  revealAttrs?: RevealProps;
}

export default function ServiceReadinessCard(props: ServiceReadinessCardProps) {
  const { card, gates, swapMode, copyMode, isCopySource, swapSource } = props;
  const role = card.role;
  const readiness = card.readiness;

  const identity = cardIdentity(card, props.todayIso);
  // The state line's colour comes from the model's tone, not a second reading of
  // `publishState`: `cardIdentity` is where «Borrador»/«Publicado» is decided.
  const stateWarn = identity.publication.tone === "warn";
  const preview = cardPreview(role);
  const issueLines = serviceIssueLines({ readiness, sources: props.sources });
  const action = servicePrimaryActionProps(readiness, routeGate(props));

  const isDraft = readiness.publishState === "draft";
  const conflictIds = new Set(readiness.conflicts.map((c) => c.memberId));
  const conflictNotes = new Map(
    readiness.conflicts.filter((c) => c.note).map((c) => [c.memberId, c.note as string]),
  );
  // A past service is dimmed and never highlighted as a live conflict, but its
  // readiness is untouched — the issue list still tells the truth.
  const highlightConflict = !card.isPast && readiness.availabilityStatus === "conflict";
  const isCardSelected = swapSource?.kind === "card" && swapSource.roleId === role._id;
  const modeActive = swapMode || copyMode;

  // The two promoted icons and the primary action share a row now, so an icon
  // whose flow IS the primary action's flow would be the same control twice
  // («Editar setlist» as a button and as a note icon beside it). The button
  // carries the label; the icon steps aside. Nothing is lost: the primary action
  // opens exactly the editor the icon would have.
  const showTeamIcon = action.route !== "service_modal";
  const showSetlistIcon = action.route !== "setlist_editor";
  // A blocker is a small flag in the corner, not a button across the card
  // (phase 5 of the «millones» pass; see `ServiceReviewFlag`).
  const reviewFlag = isReviewKind(action.kind);

  const isChipSource = (section: string, itemKey?: string) =>
    !!itemKey &&
    !!swapSource &&
    swapSource.kind !== "card" &&
    swapSource.roleId === role._id &&
    swapSource.section === section &&
    swapSource.itemKey === itemKey;

  // Instruments and FOH in their stored order: they read as one running line now
  // («Bajo Mkz · Batería Samo»), so there is no chip width to pack by.
  const instrPills = (role.instruments ?? [])
    .filter((s) => s.person)
    .map((s) => ({ label: s.instrument, person: s.person! }));
  const fohPills = (role.foh ?? [])
    .filter((s) => s.person)
    .map((s) => ({ label: s.role, person: s.person! }));
  const hasVoices =
    (role.leads ?? []).length + (role.bgvs ?? []).length + (role.chorus ?? []).length > 0;
  const hasTeam = hasVoices || instrPills.length > 0 || fohPills.length > 0;
  const songs: SetlistSong[] = role.songs ?? [];

  const bodyPad = "px-4 sm:px-5";
  const vocalConflicts = highlightConflict ? conflictIds : EMPTY_SET;

  function renderSection(section: CardSection) {
    switch (section) {
      // ── 1. Identity + publication state + actions ────────────────────────
      case "identity":
        return (
          <div
            data-card-header=""
            className={`${bodyPad} flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pt-4`}
          >
            {/*
              ONE wrapping row. On a wide card it reads
                Dom 25 oct · en 3 días · [Publicado]        [Completar setlist] [👥] [⋮]
              On a phone (below `sm`) the same items re-order into three lines —
                Dom 25 oct                                   [👥] [🎵] [⋮]
                en 3 días · [Publicado]
                [Completar setlist                                        ]
              — the icons stay up beside the date (`max-sm:order-1`), the
              countdown and the state take a line of their own (`max-sm:order-2
              max-sm:basis-full`), and the primary action wraps last
              (`basis-full order-last` in `ServicePrimaryAction`). Three 44px icons
              therefore never squeeze the date into a four-line wrap, and nothing
              is rendered twice for the two layouts.
            */}
            <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 ${CARD_STYLE.longText}`}>
              <h3
                title={identity.dateText}
                className={`font-display text-2xl font-semibold uppercase leading-none tracking-[0.02em] text-ink md:text-[26px] ${CARD_STYLE.longText}`}
              >
                {identity.headline}
              </h3>
              {identity.subline && (
                <span className="font-label text-xs tabular-nums text-ink-dim">{identity.subline}</span>
              )}
            </div>
            <div
              data-card-meta=""
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:order-2 max-sm:basis-full"
            >
              {/* «En 6 días · ● Publicado»: the state is a dot and a word in 14 px
                  body (phase 5 of the «millones» pass), no longer a chip. The dot
                  is filled green for published, an amber ring for a draft — the
                  word carries the meaning, the colour only reinforces it. */}
              {identity.relative && (
                <span className="font-body text-sm text-ink-dim">
                  <NumberRoll value={identity.relative} />
                  <span aria-hidden="true"> ·</span>
                </span>
              )}
              <span
                data-card-state={isDraft ? "draft" : "published"}
                className={`inline-flex items-center gap-1.5 font-body text-sm ${stateWarn ? "text-warning-strong" : "text-positive-strong"}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${stateWarn ? "border border-warning-fg" : "bg-positive-fg"}`}
                />
                {identity.publication.text}
              </span>
            </div>

            {/* Mode affordances replace the action cluster while a mode is active. */}
            {/*
              Both mode controls are house Buttons: the swap pick is a `pill`, whose
              pressed state (`active`) is the selection, and the paste target a
              `secondary`. A closed gate's reason rides on `title`; the toolbar's
              line explains the mode's gate as a whole.
            */}
            {swapMode ? (
              <Button
                variant="pill"
                size="lg"
                active={isCardSelected}
                onClick={props.onCardSwapSelect}
                disabled={!gates.swap.enabled}
                title={gates.swap.reason ?? "Intercambiar equipo completo"}
                className="ml-auto shrink-0 max-sm:order-1"
              >
                ⇄ Equipo
              </Button>
            ) : copyMode ? (
              isCopySource ? (
                <span className="ml-auto shrink-0 rounded-lg border border-surface-lift/40 bg-surface-lift/20 px-2.5 py-1.5 font-label text-[11px] uppercase tracking-widest text-ink max-sm:order-1">
                  Origen
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={props.onCopyPick}
                  disabled={!gates.copyInstruments.enabled}
                  title={gates.copyInstruments.reason ?? "Copiar los instrumentos del origen a este día"}
                  className="ml-auto shrink-0 max-sm:order-1"
                >
                  Pegar aquí
                </Button>
              )
            ) : (
              // `contents` below `sm`: the primary action and the icon cluster are
              // the header row's own flex items there (the action wraps to a full
              // line, the icons stay up beside the date). From `sm` the two become
              // ONE right-aligned cluster, so a long special name can push the pair
              // down together but never leave the icons orphaned on a line of their own.
              <div className="contents sm:ml-auto sm:flex sm:shrink-0 sm:items-center sm:gap-3">
                {!reviewFlag && <ServicePrimaryAction action={action} onAction={props.onPrimaryAction} />}
                <div className="ml-auto flex shrink-0 items-center gap-0.5 max-sm:order-1 sm:ml-0">
                  {reviewFlag && <ServiceReviewFlag action={action} onAction={props.onPrimaryAction} />}
                  {showTeamIcon && (
                    <IconAction
                      label="Editar equipo"
                      gate={gates.editTeam}
                      onClick={props.onEdit}
                      icon={<UsersIcon />}
                    />
                  )}
                  {showSetlistIcon && (
                    <IconAction
                      label="Editar setlist"
                      gate={gates.editSetlist}
                      onClick={props.onSetlist}
                      icon={<MusicIcon />}
                    />
                  )}
                  <Menu
                    label="Más acciones"
                    align="end"
                    trigger={
                      <button
                        type="button"
                        aria-label="Más acciones"
                        title="Más acciones"
                        className={`${CARD_STYLE.menuTrigger} flex items-center justify-center rounded-lg text-ink-muted/70 transition-colors hover:bg-surface-lift/15 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                      >
                        <KebabIcon />
                      </button>
                    }
                  >
                    {props.onMessages && !card.isPast && (
                      <MenuItem icon={<ChatIcon />} onSelect={props.onMessages}>
                        Mensajes a los líderes
                      </MenuItem>
                    )}
                    {instrPills.length > 0 && (
                      <MenuItem
                        icon={<CopyIcon />}
                        disabled={!gates.copyInstruments.enabled}
                        onSelect={props.onCopyStart}
                      >
                        Copiar instrumentos a otro día
                        {!gates.copyInstruments.enabled && gates.copyInstruments.reason && (
                          <span className="block text-[11px] normal-case tracking-normal text-warning-fg">
                            {gates.copyInstruments.reason}
                          </span>
                        )}
                      </MenuItem>
                    )}
                    {/* Publishing needs all five sources; safe unpublish needs only
                        roles + role-target integrity (plan §"Unpublish is separate"). */}
                    <MenuItem
                      icon={<EyeIcon />}
                      disabled={!(isDraft ? gates.publish.enabled : gates.unpublish.enabled)}
                      onSelect={() => { if (isDraft) props.onPublish(); else props.onUnpublish(); }}
                    >
                      {isDraft ? "Publicar" : "Ocultar"}
                      {!(isDraft ? gates.publish.enabled : gates.unpublish.enabled) &&
                        (isDraft ? gates.publish.reason : gates.unpublish.reason) && (
                          <span className="block text-[11px] normal-case tracking-normal text-warning-fg">
                            {isDraft ? gates.publish.reason : gates.unpublish.reason}
                          </span>
                        )}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<TrashIcon />} danger disabled={!gates.deleteService.enabled} onSelect={props.onDelete}>
                      Eliminar servicio
                      {!gates.deleteService.enabled && gates.deleteService.reason && (
                        <span className="block text-[11px] normal-case tracking-normal text-warning-fg">
                          {gates.deleteService.reason}
                        </span>
                      )}
                    </MenuItem>
                  </Menu>
                </div>
              </div>
            )}
          </div>
        );

      // ── 2. Blocking issue summary ────────────────────────────────────────
      case "issues":
        if (issueLines.length === 0) return null;
        return (
          <div className={`${bodyPad} min-w-0`}>
            <ServiceIssueList lines={issueLines} />
          </div>
        );

      // ── 3. Team | setlist preview ────────────────────────────────────────
      case "preview":
        return (
          <div className={`${bodyPad} brand-service-card-body min-w-0`}>
            <section className="min-w-0" data-card-team="">
              <SectionHead label="Equipo" />
              {swapMode ? (
                // Swap mode: seat chips, addressed by their stored `_key`.
                <div className="mt-2 space-y-2">
                  {(
                    [
                      ["leads", role.leads ?? [], "Líderes"],
                      ["bgvs", role.bgvs ?? [], "BGVs"],
                      ["chorus", role.chorus ?? [], "Coro"],
                    ] as const
                  ).map(
                    ([section, arr, lbl]) =>
                      arr.length > 0 && (
                        <div key={section} className="flex min-w-0 flex-wrap items-start gap-2">
                          <span className="w-12 shrink-0 pt-0.5 font-label text-[10px] uppercase tracking-widest text-mono-600">
                            {lbl}
                          </span>
                          <div className="flex min-w-0 flex-wrap gap-1">
                            {arr.map((m) => (
                              <MemberChip
                                key={m._key ?? m._id}
                                name={dn(m)}
                                isSource={isChipSource(section, m._key)}
                                onClick={
                                  swapSource?.kind === "card" || !m._key || !gates.swap.enabled
                                    ? undefined
                                    : () =>
                                        props.onMemberChipClick({
                                          kind: "member",
                                          roleId: role._id,
                                          section,
                                          itemKey: m._key!,
                                          member: m,
                                        })
                                }
                              />
                            ))}
                          </div>
                        </div>
                      ),
                  )}
                  {(
                    [
                      ["instruments", role.instruments ?? [], "Instr."],
                      ["foh", role.foh ?? [], "FOH"],
                    ] as const
                  ).map(
                    ([section, arr, lbl]) =>
                      arr.length > 0 && (
                        <div key={section} className="flex min-w-0 flex-wrap items-start gap-2">
                          <span className="w-12 shrink-0 pt-0.5 font-label text-[10px] uppercase tracking-widest text-mono-600">
                            {lbl}
                          </span>
                          <div className="flex min-w-0 flex-wrap gap-1">
                            {arr.map(
                              (s, i) =>
                                s.person && (
                                  <MemberChip
                                    key={s._key ?? i}
                                    name={`${dn(s.person)} · ${
                                      section === "instruments"
                                        ? (s as { instrument: string }).instrument
                                        : (s as { role: string }).role
                                    }`}
                                    isSource={isChipSource(section, s._key)}
                                    onClick={
                                      swapSource?.kind === "card" || !s._key || !gates.swap.enabled
                                        ? undefined
                                        : () =>
                                            props.onMemberChipClick({
                                              kind: "slot",
                                              roleId: role._id,
                                              section,
                                              itemKey: s._key!,
                                              member: s.person,
                                              slotLabel:
                                                section === "instruments"
                                                  ? (s as { instrument: string }).instrument
                                                  : (s as { role: string }).role,
                                            })
                                    }
                                  />
                                ),
                            )}
                          </div>
                        </div>
                      ),
                  )}
                  {!hasTeam && (
                    <p className="font-body text-xs italic text-mono-600">Sin miembros asignados</p>
                  )}
                </div>
              ) : hasTeam ? (
                <div className="mt-2 space-y-2.5">
                  {hasVoices && (
                    // All three columns, always — an empty one shows «—» so Lead,
                    // BGVs and Coro sit in the same place on every card.
                    <div className="grid grid-cols-3 gap-x-3">
                      <VocalCol label="Lead" members={role.leads ?? []} conflictIds={vocalConflicts} notes={conflictNotes} />
                      <VocalCol label="BGVs" members={role.bgvs ?? []} conflictIds={vocalConflicts} notes={conflictNotes} />
                      <VocalCol label="Coro" members={role.chorus ?? []} conflictIds={vocalConflicts} notes={conflictNotes} />
                    </div>
                  )}
                  {(instrPills.length > 0 || fohPills.length > 0) && (
                    // Instruments and FOH share one running line («Bajo Mkz ·
                    // Batería Samo · Consola Vega»): the seat's label already says
                    // which is which, and a line of text costs a third of the
                    // height a band of chips did (phase 5 of the «millones» pass).
                    <p className={`font-body text-sm leading-relaxed text-ink-dim ${CARD_STYLE.longText}`} data-card-band="">
                      {[...instrPills, ...fohPills].map((p, i) => (
                        <span key={i}>
                          {i > 0 && <span aria-hidden="true"> · </span>}
                          <TeamRow
                            label={p.label}
                            value={dn(p.person)}
                            isConflict={highlightConflict && conflictIds.has(p.person._id)}
                            conflictNote={conflictNotes.get(p.person._id)}
                          />
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 font-body text-xs italic text-mono-600">Sin miembros asignados</p>
              )}
            </section>

            <section className="min-w-0" data-card-setlist="">
              <SectionHead
                label={
                  songs.length > 0
                    ? `Setlist · ${plural(preview.songCount, "canción", "canciones")}`
                    : "Setlist"
                }
              />
              {songs.length > 0 ? (
                <ol className="mt-2 space-y-1">
                  {buildRuns(songs).map((run) => {
                    if (run.kind === "single" || run.songs.length === 1) {
                      const { song, n } = run.kind === "single" ? run : run.songs[0];
                      return (
                        <li key={song.song._id}>
                          <SongRow entry={song} n={n} />
                        </li>
                      );
                    }
                    return (
                      <li key={run.songs[0].song.song._id + "_m"} className="relative pl-3.5">
                        <span
                          aria-hidden
                          className="absolute bottom-1 left-0.5 top-5 w-[2px] rounded-full"
                          style={{
                            background: `linear-gradient(to bottom, ${themeColour(NEUTRAL, 0)}, ${themeColour(NEUTRAL, 0.3333)} 12%, ${themeColour(NEUTRAL, 0.3333)} 88%, ${themeColour(NEUTRAL, 0)})`,
                          }}
                        />
                        {/* `color` on the wrapper — see DayCard: a token in `stroke=` is dropped. */}
                        <div className="mb-0.5 flex items-center gap-1" style={{ color: themeColour(NEUTRAL) }}>
                          <ChainLinkIcon opacity={0.7} />
                          <span
                            className="font-label text-[10px] uppercase tracking-[0.18em]"
                            style={{ color: `${themeColour(NEUTRAL, 0.8)}` }}
                          >
                            Medley
                          </span>
                        </div>
                        <div className="space-y-1">
                          {run.songs.map(({ song, n }, si) => (
                            <div key={song.song._id}>
                              {si > 0 && (
                                <span
                                  className="-my-0.5 block w-5 text-center font-label text-[11px] leading-none"
                                  style={{ color: `${themeColour(NEUTRAL, 0.6)}` }}
                                >
                                  +
                                </span>
                              )}
                              <SongRow entry={song} n={n} />
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-2 font-body text-xs italic text-mono-600">Sin canciones todavía.</p>
              )}
            </section>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div
      data-card-id={card.cardId}
      {...props.revealAttrs}
      className={`${CARD_STYLE.container} brand-service-card relative isolate flex flex-col gap-3 overflow-hidden bg-surface-card pb-4 ${props.className ?? ""} ${
        card.isPast && !modeActive
          ? "border-ink/[0.08] opacity-50 shadow-md"
          : isCardSelected || (copyMode && isCopySource)
            ? "border-ink/[0.08] ring-2 ring-accent/40 shadow-md"
            : highlightConflict
              ? "border-2 border-negative-strong shadow-lg shadow-negative-strong/30 ring-2 ring-negative-strong/40"
              : "border-ink/[0.08] shadow-md"
      }`}
    >
      {/* The day's ONE colour (ADR-0059): a 3 px rail, as on the member-facing DayCard. */}
      <span aria-hidden data-card-rail="" className={`absolute inset-y-0 left-0 z-[1] w-[3px] ${CARD_RAIL[role._type]}`} />
      {CARD_SECTIONS.map((section) => {
        const content = renderSection(section);
        return content ? <div key={section} className="min-w-0">{content}</div> : null;
      })}
    </div>
  );
}

/** The capability row the primary action's own route must be checked against. */
function routeGate(props: ServiceReadinessCardProps): CardGate | null {
  const kind = props.card.readiness.primaryAction.kind;
  switch (kind) {
    case "resolve_conflict":
    case "edit_team":
    case "edit_service":
      return props.gates.editTeam;
    case "complete_setlist":
    case "edit_setlist":
      return props.gates.editSetlist;
    case "publish":
      return props.gates.publish;
    case "review_proposal":
    case "review_proposals":
      return props.gates.proposalHandoff;
    default:
      // `Revisar datos`, `Reintentar carga` and `Cargando datos` are read-only or
      // are themselves the recovery, so no capability row gates them.
      return null;
  }
}

const EMPTY_SET: Set<string> = new Set();

/** A neutral section label with a hairline — no day tint (ADR-0059). */
function SectionHead({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-label text-[11px] uppercase tracking-widest text-mono-400">
        {label}
      </span>
      <div className="h-px flex-1 bg-ink-dim/15" />
    </div>
  );
}

/**
 * One setlist line: number, title, author, and the key at the end of the line.
 * One row per song (not the «Nadie D · Lavado B» string of the phone mock) because a
 * medley needs its spine and a transposed song its «orig.» badge, and neither
 * fits inside a run-on sentence.
 */
function SongRow({ entry, n }: { entry: SetlistSong; n: number }) {
  const key = entry.play_key || entry.song.key;
  const transposed = !!entry.play_key && !!entry.song.key && entry.play_key !== entry.song.key;
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-4 shrink-0 text-right font-label text-[11px] tabular-nums text-ink-dim">{n}</span>
      <span className={`min-w-0 flex-1 font-body text-[13px] leading-snug ${CARD_STYLE.longText}`}>
        <span className="font-semibold text-ink">{entry.song.title}</span>
        {entry.song.author && <span className="text-ink-dim"> — {entry.song.author}</span>}
      </span>
      {key && (
        <span className="flex shrink-0 items-center gap-1 font-label text-xs font-semibold text-ink">
          {key}
          {transposed && (
            <span className="rounded border border-mono-700 bg-mono-800/60 px-1.5 py-0.5 font-label text-[10px] font-normal leading-tight text-mono-500">
              orig. {entry.song.key}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function VocalCol({
  label,
  members,
  conflictIds,
  notes,
}: {
  label: string;
  members: MemberOption[];
  conflictIds: Set<string>;
  notes: Map<string, string>;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 font-label text-[10px] uppercase tracking-widest text-ink-dim">
        {label}
      </p>
      <p className={`font-body text-[15px] leading-snug ${CARD_STYLE.longText}`}>
        {members.length === 0 ? (
          <span className="text-ink-dim">—</span>
        ) : (
          members.map((m, i) => (
            <span key={m._key ?? m._id}>
              {i > 0 && ", "}
              {conflictIds.has(m._id) ? (
                <span title={notes.get(m._id)} className="font-semibold text-negative-fg">
                  ⚠&nbsp;{dn(m)}
                </span>
              ) : (
                <span>{dn(m)}</span>
              )}
            </span>
          ))
        )}
      </p>
    </div>
  );
}

/**
 * One instrument/FOH seat in the running line: the seat muted, the name in ink
 * («Bajo **Mkz**»). Neutral (ADR-0059); only a live availability conflict
 * colours it, and then with the ⚠ and the note on `title` too.
 */
function TeamRow({
  label,
  value,
  isConflict,
  conflictNote,
}: {
  label: string;
  value: string;
  isConflict?: boolean;
  conflictNote?: string;
}) {
  return (
    // No `whitespace-nowrap`: the band is running text under `CARD_STYLE.longText`,
    // and a long seat («Guitarra eléctrica» + a long alias) must break rather than
    // push the card past a 320 px viewport (ADR-0035: /admin never scrolls sideways).
    <span title={isConflict && conflictNote ? conflictNote : undefined}>
      <span className={isConflict ? "text-negative-fg" : undefined}>{label}</span>{" "}
      <span className={`font-semibold ${isConflict ? "text-negative-fg" : "text-ink"}`}>
        {isConflict && <span aria-hidden="true">⚠ </span>}
        {value}
      </span>
    </span>
  );
}

function MemberChip({
  name,
  isSource,
  onClick,
}: {
  name: string;
  isSource: boolean;
  onClick?: () => void;
}) {
  return (
    // The transition names the properties the source state actually changes:
    // border-colour, background, text colour, the `scale-105` transform and the
    // ring (box-shadow). Nothing else on this chip animates.
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 font-label text-[11px] uppercase tracking-widest transition-[color,background-color,border-color,transform,box-shadow] duration-base ease-out-brand ${
        isSource
          ? "scale-105 border-accent bg-accent/30 text-accent ring-1 ring-accent/50"
          : onClick
            ? "cursor-pointer border-accent/20 bg-accent/10 text-mono-400 hover:border-accent/40 hover:bg-accent/20 hover:text-accent"
            : "border-accent/20 bg-accent/10 text-mono-400"
      }`}
    >
      {name}
    </button>
  );
}

/**
 * One promoted header action: icon only, but never icon ALONE — the label is the
 * accessible name and the tooltip, and a closed gate replaces the tooltip with its
 * own Spanish reason (the header has no room for the explanatory line `MenuItem`
 * renders, so the reason has to live on the control itself).
 */
function IconAction({
  label,
  icon,
  gate,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  gate: CardGate;
  onClick: () => void;
}) {
  const disabled = !gate.enabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? (gate.reason ?? label) : label}
      className={`${CARD_STYLE.menuTrigger} flex items-center justify-center rounded-lg text-ink-muted/70 transition-colors hover:bg-surface-lift/15 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {icon}
    </button>
  );
}

function UsersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
