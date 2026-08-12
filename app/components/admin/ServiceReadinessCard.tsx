"use client";

// One service card, in the plan's hierarchy (Plan B items 7-9):
//
//   1 identity + publication state + the action cluster
//   2 blocking issue summary
//   3 assigned-team / setlist preview
//   4 ONE primary action
//
// Two of the plan's sections are gone (see `CARD_SECTIONS` in `serviceCardModel`):
// the four-module readiness strip, and the full-width `Más acciones` bar. The
// card's secondary actions now live top-right in the header — `Editar equipo` and
// `Editar setlist` as icon buttons, everything else behind the kebab beside them.
// Every action and every gate survived the move; only their placement changed.
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

import { useEffect, useRef, useState } from "react";

import { ChainLinkIcon } from "../ChainLinkIcon";
import { buildRuns } from "../../utils/medley";
import ReadinessBadge from "./ReadinessBadge";
import ServiceIssueList from "./ServiceIssueList";
import ServicePrimaryAction from "./ServicePrimaryAction";
import {
  CARD_ACCENT,
  CARD_ACCENT_VAR,
  CARD_ACCENT_MUTED,
  CARD_BORDER,
  CARD_DIVIDER,
  CARD_HEADER,
  CARD_SECTIONS,
  CARD_STYLE,
  SERVICE_BADGE,
  cardIdentity,
  cardPreview,
  dn,
  pillWidth,
  serviceIssueLines,
  servicePrimaryActionProps,
  type CardSection,
  type MemberOption,
  type ServiceCardModel,
  type SetlistSong,
  type SwapSource,
} from "./serviceCardModel";
import type { ServiceSourceStates } from "./serviceReadiness";
import { themeColour } from "@/app/utils/themeColour";

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
}

export default function ServiceReadinessCard(props: ServiceReadinessCardProps) {
  const { card, gates, swapMode, copyMode, isCopySource, swapSource } = props;
  const role = card.role;
  const readiness = card.readiness;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes the kebab and hands focus back to its trigger. The backdrop
  // click is a pointer-only escape hatch, so without this a keyboard user who
  // opened the menu has no way out of it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const identity = cardIdentity(card, props.todayIso);
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

  const isChipSource = (section: string, itemKey?: string) =>
    !!itemKey &&
    !!swapSource &&
    swapSource.kind !== "card" &&
    swapSource.roleId === role._id &&
    swapSource.section === section &&
    swapSource.itemKey === itemKey;

  const instrPills = (role.instruments ?? [])
    .filter((s) => s.person)
    .map((s) => ({ label: s.instrument, person: s.person! }))
    .sort((a, b) => pillWidth(a.label, dn(a.person)) - pillWidth(b.label, dn(b.person)));
  const fohPills = (role.foh ?? [])
    .filter((s) => s.person)
    .map((s) => ({ label: s.role, person: s.person! }))
    .sort((a, b) => pillWidth(a.label, dn(a.person)) - pillWidth(b.label, dn(b.person)));
  const hasTeam =
    (role.leads ?? []).length > 0 ||
    (role.bgvs ?? []).length > 0 ||
    (role.chorus ?? []).length > 0 ||
    instrPills.length > 0 ||
    fohPills.length > 0;
  const songs: SetlistSong[] = role.songs ?? [];

  const bodyPad = "px-4 sm:px-5";

  function renderSection(section: CardSection) {
    switch (section) {
      // ── 1. Identity + publication state ──────────────────────────────────
      case "identity":
        return (
          <div
            className={`${CARD_HEADER[role._type]} min-w-0 rounded-t-xl border-b px-4 py-3`}
          >
            {/*
              Only the TITLE shares a row with the action cluster. The date and the
              badges span the full header width below it, so three 44px targets in a
              260px-wide month column cannot squeeze the date into a four-line wrap.
            */}
            <div className="flex min-w-0 items-start justify-between gap-2">
              <h3
                className={`font-display text-xl font-bold uppercase text-ink-muted md:text-2xl ${CARD_STYLE.longText}`}
              >
                {identity.title}
              </h3>

              {/* Mode affordances replace the action cluster while a mode is active. */}
              {swapMode ? (
                <button
                  type="button"
                  onClick={props.onCardSwapSelect}
                  disabled={!gates.swap.enabled}
                  title={gates.swap.reason ?? "Intercambiar equipo completo"}
                  className={`${CARD_STYLE.menuTrigger} shrink-0 rounded-lg px-2.5 font-label text-xs transition-colors disabled:opacity-40 ${
                    isCardSelected
                      ? "border border-surface-lift/40 bg-surface-lift/20 text-ink"
                      : "border border-transparent text-ink-muted/70 hover:bg-surface-lift/15 hover:text-ink"
                  }`}
                >
                  ⇄ Equipo
                </button>
              ) : copyMode ? (
                isCopySource ? (
                  <span className="shrink-0 rounded-lg border border-surface-lift/40 bg-surface-lift/20 px-2.5 py-1.5 font-label text-[11px] uppercase tracking-widest text-ink">
                    Origen
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={props.onCopyPick}
                    disabled={!gates.copyInstruments.enabled}
                    title={gates.copyInstruments.reason ?? "Copiar los instrumentos del origen a este día"}
                    className={`${CARD_STYLE.menuTrigger} shrink-0 rounded-lg border border-accent/40 px-2.5 font-label text-xs text-ink-muted/70 transition-colors hover:bg-accent/25 hover:text-ink disabled:opacity-40`}
                  >
                    Pegar aquí
                  </button>
                )
              ) : (
                <div className="relative flex shrink-0 items-center gap-0.5">
                  <IconAction
                    label="Editar equipo"
                    gate={gates.editTeam}
                    onClick={props.onEdit}
                    icon={<UsersIcon />}
                  />
                  <IconAction
                    label="Editar setlist"
                    gate={gates.editSetlist}
                    onClick={props.onSetlist}
                    icon={<MusicIcon />}
                  />
                  <button
                    type="button"
                    ref={menuTriggerRef}
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Más acciones"
                    title="Más acciones"
                    className={`${CARD_STYLE.menuTrigger} flex items-center justify-center rounded-lg text-ink-muted/70 transition-colors hover:bg-surface-lift/15 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                  >
                    <KebabIcon />
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      <div
                        role="menu"
                        className={`absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-accent/25 bg-surface-overlay-deep py-1 shadow-xl shadow-elevation/50 ${CARD_STYLE.menu}`}
                      >
                        {instrPills.length > 0 && (
                          <MenuItem
                            icon={<CopyIcon />}
                            label="Copiar instrumentos a otro día"
                            gate={gates.copyInstruments}
                            onClick={() => {
                              setMenuOpen(false);
                              props.onCopyStart();
                            }}
                          />
                        )}
                        <MenuItem
                          icon={<EyeIcon />}
                          label={isDraft ? "Publicar" : "Ocultar"}
                          // Publishing needs all five sources; safe unpublish needs only
                          // roles + role-target integrity (plan §"Unpublish is separate").
                          gate={isDraft ? gates.publish : gates.unpublish}
                          onClick={() => {
                            setMenuOpen(false);
                            if (isDraft) props.onPublish();
                            else props.onUnpublish();
                          }}
                        />
                        <div className="my-1 border-t border-accent/15" />
                        <MenuItem
                          icon={<TrashIcon />}
                          label="Eliminar servicio"
                          danger
                          gate={gates.deleteService}
                          onClick={() => {
                            setMenuOpen(false);
                            props.onDelete();
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <p className="font-label text-xs capitalize text-ink-muted/70">{identity.dateText}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${SERVICE_BADGE[role._type]}`}
              >
                {identity.typeLabel}
              </span>
              <ReadinessBadge
                text={identity.publication.text}
                icon={isDraft ? "◌" : "◉"}
                tone={identity.publication.tone}
                className="!py-0.5"
              />
              {identity.relative && (
                <span className="font-label text-[11px] uppercase tracking-widest text-ink-muted/70">
                  {identity.relative}
                </span>
              )}
            </div>
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

      // ── 3. Assigned-team / setlist preview ───────────────────────────────
      case "preview":
        return (
          <div className={`${bodyPad} min-w-0 space-y-4`}>
            {songs.length > 0 && (
              <section>
                <SectionHead
                  label={`Setlist · ${preview.songCount} canción${preview.songCount === 1 ? "" : "es"}`}
                  accent={CARD_ACCENT_MUTED[role._type]}
                  divider={CARD_DIVIDER[role._type]}
                />
                <ol className="mt-3 space-y-2.5">
                  {buildRuns(songs).map((run) => {
                    const renderRow = (entry: SetlistSong, n: number) => (
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-0.5 w-5 shrink-0 text-sm text-mono-500">{n}.</span>
                        <div className="min-w-0">
                          <span
                            className={`font-body text-sm font-semibold ${CARD_STYLE.longText}`}
                          >
                            {entry.song.title}
                          </span>
                          <span className="text-sm text-mono-500"> — {entry.song.author}</span>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span
                              className={`font-label text-xs font-semibold ${CARD_ACCENT[role._type]}`}
                            >
                              {entry.play_key || entry.song.key}
                            </span>
                            {entry.play_key &&
                              entry.song.key &&
                              entry.play_key !== entry.song.key && (
                                <span className="rounded border border-mono-700 bg-mono-800/60 px-1.5 py-0.5 font-label text-[11px] leading-tight text-mono-500">
                                  orig. {entry.song.key}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>
                    );

                    if (run.kind === "single" || run.songs.length === 1) {
                      const { song, n } = run.kind === "single" ? run : run.songs[0];
                      return <li key={song.song._id}>{renderRow(song, n)}</li>;
                    }

                    const accentVar = CARD_ACCENT_VAR[role._type];
                    return (
                      <li key={run.songs[0].song.song._id + "_m"} className="relative pl-3.5">
                        <span
                          aria-hidden
                          className="absolute bottom-1 left-0.5 top-5 w-[2px] rounded-full"
                          style={{
                            background: `linear-gradient(to bottom, ${themeColour(accentVar, 0)}, ${themeColour(accentVar, 0.3333)} 12%, ${themeColour(accentVar, 0.3333)} 88%, ${themeColour(accentVar, 0)})`,
                          }}
                        />
                        {/* `color` on the wrapper — see DayCard: a token in `stroke=` is dropped. */}
                        <div className="mb-1 flex items-center gap-1" style={{ color: themeColour(accentVar) }}>
                          <ChainLinkIcon opacity={0.7} />
                          <span
                            className="font-label text-[10px] uppercase tracking-[0.18em]"
                            style={{ color: `${themeColour(accentVar, 0.6)}` }}
                          >
                            Medley
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {run.songs.map(({ song, n }, si) => (
                            <div key={song.song._id}>
                              {si > 0 && (
                                <span
                                  className="-my-0.5 block w-5 text-center font-label text-[11px] leading-none"
                                  style={{ color: `${themeColour(accentVar, 0.4392)}` }}
                                >
                                  +
                                </span>
                              )}
                              {renderRow(song, n)}
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Swap mode: seat chips, addressed by their stored `_key`. */}
            {swapMode ? (
              <div className="space-y-2">
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
              <section className={songs.length > 0 ? "border-t border-mono-200 pt-4 dark:border-mono-800" : ""}>
                <div className="space-y-3">
                  {(role.leads ?? []).length + (role.bgvs ?? []).length + (role.chorus ?? []).length >
                    0 && (
                    <div>
                      <SectionHead
                        label="Voces"
                        accent={CARD_ACCENT_MUTED[role._type]}
                        divider={CARD_DIVIDER[role._type]}
                      />
                      <div className="mt-2 grid grid-cols-3 gap-x-3">
                        <VocalCol
                          label="Lead"
                          members={role.leads ?? []}
                          conflictIds={highlightConflict ? conflictIds : EMPTY_SET}
                          notes={conflictNotes}
                        />
                        <VocalCol
                          label="BGVs"
                          members={role.bgvs ?? []}
                          conflictIds={highlightConflict ? conflictIds : EMPTY_SET}
                          notes={conflictNotes}
                        />
                        <VocalCol
                          label="Coro"
                          members={role.chorus ?? []}
                          conflictIds={highlightConflict ? conflictIds : EMPTY_SET}
                          notes={conflictNotes}
                        />
                      </div>
                    </div>
                  )}
                  {instrPills.length > 0 && (
                    <div>
                      <SectionHead
                        label="Instrumentos"
                        accent={CARD_ACCENT_MUTED[role._type]}
                        divider={CARD_DIVIDER[role._type]}
                      />
                      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                        {instrPills.map((p, i) => (
                          <TeamRow
                            key={i}
                            label={p.label}
                            value={dn(p.person)}
                            accentVar={CARD_ACCENT_VAR[role._type]}
                            isConflict={highlightConflict && conflictIds.has(p.person._id)}
                            conflictNote={conflictNotes.get(p.person._id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {fohPills.length > 0 && (
                    <div>
                      <SectionHead
                        label="Front of House"
                        accent={CARD_ACCENT_MUTED[role._type]}
                        divider={CARD_DIVIDER[role._type]}
                      />
                      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                        {fohPills.map((p, i) => (
                          <TeamRow
                            key={i}
                            label={p.label}
                            value={dn(p.person)}
                            accentVar={CARD_ACCENT_VAR[role._type]}
                            isConflict={highlightConflict && conflictIds.has(p.person._id)}
                            conflictNote={conflictNotes.get(p.person._id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              songs.length === 0 && (
                <p className="font-body text-xs italic text-mono-600">Sin información todavía.</p>
              )
            )}
          </div>
        );

      // ── 4. ONE primary action ────────────────────────────────────────────
      case "primary_action":
        if (modeActive) return null;
        return (
          <div className={`${bodyPad} min-w-0`}>
            <ServicePrimaryAction action={action} onAction={props.onPrimaryAction} />
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div
      data-card-id={card.cardId}
      className={`${CARD_STYLE.container} flex flex-col gap-3.5 pb-4 ${
        card.isPast && !modeActive
          ? `${CARD_BORDER[role._type]} opacity-50 shadow-md`
          : isCardSelected || (copyMode && isCopySource)
            ? `${CARD_BORDER[role._type]} ring-2 ring-accent/40 shadow-md`
            : highlightConflict
              ? "border-2 border-negative-strong shadow-lg shadow-negative-strong/30 ring-2 ring-negative-strong/40"
              : `${CARD_BORDER[role._type]} shadow-md`
      }`}
    >
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

function SectionHead({
  label,
  accent,
  divider,
}: {
  label: string;
  accent: string;
  divider: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={`shrink-0 font-label text-xs uppercase tracking-wide ${accent}`}>
        {label}
      </span>
      <div className={`h-px flex-1 ${divider}`} />
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
  if (members.length === 0) return <div />;
  return (
    <div className="min-w-0">
      <p className="mb-0.5 font-label text-[11px] uppercase tracking-widest text-mono-400">
        {label}
      </p>
      <p className={`font-body text-sm leading-snug ${CARD_STYLE.longText}`}>
        {members.map((m, i) => (
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
        ))}
      </p>
    </div>
  );
}

function TeamRow({
  label,
  value,
  accentVar,
  isConflict,
  conflictNote,
}: {
  label: string;
  value: string;
  accentVar: string;
  isConflict?: boolean;
  conflictNote?: string;
}) {
  return (
    <div
      className="flex min-w-0 items-stretch overflow-hidden rounded-lg"
      style={{
        border: isConflict ? "1px solid rgb(var(--negative-strong-rgb) / 0.7)" : `1px solid ${themeColour(accentVar, 0.251)}`,
      }}
    >
      <span
        className="flex min-w-[3.5rem] shrink-0 items-center justify-center rounded-l-[7px] px-2.5 font-label text-xs uppercase tracking-wide"
        style={{
          background: isConflict ? "rgb(var(--negative-strong-rgb) / 0.18)" : `${themeColour(accentVar, 0.0941)}`,
          color: isConflict ? themeColour("--negative-fg-rgb") : themeColour(accentVar),
          borderRight: isConflict
            ? "1px solid rgb(var(--negative-strong-rgb) / 0.45)"
            : `1px solid ${themeColour(accentVar, 0.1882)}`,
        }}
      >
        {label}
      </span>
      <span
        title={isConflict && conflictNote ? conflictNote : undefined}
        className={`flex min-w-[3.5rem] items-center justify-center gap-1 px-3 py-1.5 font-body text-sm leading-tight ${CARD_STYLE.longText} ${
          isConflict ? "font-semibold text-negative-fg" : ""
        }`}
        style={isConflict ? { background: "rgb(var(--negative-strong-rgb) / 0.10)" } : undefined}
      >
        {isConflict && <span aria-hidden="true">⚠</span>}
        {value}
      </span>
    </div>
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
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 font-label text-[11px] uppercase tracking-widest transition-all ${
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

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  gate,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  gate?: CardGate;
}) {
  const disabled = !!gate && !gate.enabled;
  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? (gate?.reason ?? undefined) : undefined}
        className={`flex min-h-[44px] w-full min-w-0 items-center gap-2.5 px-3 text-left text-sm transition-colors disabled:opacity-40 ${
          danger ? "text-negative-muted hover:bg-negative-strong/15" : "text-ink-muted hover:bg-surface-lift/10"
        }`}
      >
        <span className="shrink-0 opacity-80">{icon}</span>
        <span className={CARD_STYLE.longText}>{label}</span>
      </button>
      {disabled && gate?.reason && (
        // `role="none"` so this explanatory line is not read as a menu item.
        <p role="none" className={`px-3 pb-1.5 font-body text-[11px] text-warning-strong ${CARD_STYLE.longText}`}>
          {gate.reason}
        </p>
      )}
    </>
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
