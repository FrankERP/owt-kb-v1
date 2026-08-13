"use client";

import { useState } from "react";
import { Setlist } from "../utils/interface";
import { buildRuns } from "../utils/medley";
import { ChainLinkIcon } from "./ChainLinkIcon";
import PracticePlaylistButton from "./PracticePlaylistButton";
import { usePlayer } from "@/app/context/PlayerContext";
import { useSession } from "next-auth/react";
import { SetlistEditor } from "./admin/SetlistEditor";
import CueDialog from "./ui/CueDialog";
import { themeColour } from "@/app/utils/themeColour";

export interface DayCardProps {
  day: string;
  date?: string;
  setlist?: Setlist | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
  roleId?: string;
  isNext?: boolean;
}

const SUNDAY_THEME = {
  border:       "border-accent/45",
  shadow:       "shadow-accent/10",
  headerBg:     "bg-surface-raised/80",
  headerBorder: "border-accent/25",
  accent:       "text-accent",
  accentMuted:  "text-accent/70",
  accentVar:    "--accent-rgb",
};

const SATURDAY_THEME = {
  border:       "border-warning-fg",
  shadow:       "shadow-warning-fg/20",
  headerBg:     "bg-warning-surface-deep",
  headerBorder: "border-warning-fg",
  accent:       "text-warning-fg",
  accentMuted:  "text-warning-fg/80",
  accentVar:    "--warning-fg-rgb",
};

const SPECIAL_THEME = {
  border:       "border-info-fg",
  shadow:       "shadow-info-fg/20",
  headerBg:     "bg-info-surface-deep",
  headerBorder: "border-info-fg",
  accent:       "text-info-fg",
  accentMuted:  "text-info-fg/80",
  accentVar:    "--info-fg-rgb",
};

export function DayCard({ day, date, setlist, leads, instruments, fohTeam, bgvs, chorus, roleId, isNext }: DayCardProps) {
  const { openSheet } = usePlayer();
  const { data: session } = useSession();
  const [editSetlist, setEditSetlist] = useState(false);

  const hasRole     = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist  = !!(setlist?.songs?.length);

  // The display name used in role cards is alias || member_name — match both
  const myName = (session?.user?.alias?.trim() || session?.user?.name || "").toLowerCase();

  // Detect the same person assigned twice within one section (voces / instrumentos / foh).
  // A person may appear once in voces AND once in instrumentos — that's fine.
  const vocesDups = findDuplicates([
    ...(leads ?? []),
    ...(bgvs ?? []).map(m => m.alias || m.member_name),
    ...(chorus ?? []).map(m => m.alias || m.member_name),
  ]);
  const instrDups = findDuplicates((instruments ?? []).filter(s => s.person).map(s => s.person));
  const fohDups   = findDuplicates((fohTeam ?? []).filter(s => s.person).map(s => s.person));

  if (!hasSetlist && !hasRole) return null;

  const t = roleId ? SPECIAL_THEME : day === "Sábado" ? SATURDAY_THEME : day === "Domingo" ? SUNDAY_THEME : SPECIAL_THEME;
  const canEdit = ["super-admin", "admin"].includes(session?.user?.role as string);
  const setlistType: "sunday" | "saturday" | "special" =
    roleId ? "special" : day === "Sábado" ? "saturday" : day === "Domingo" ? "sunday" : "special";

  const shortDate = date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";

  // Group songs into medley runs
  const runs = hasSetlist ? buildRuns(setlist!.songs) : [];

  return (
    <>
      <div className={`brand-facet-panel brand-surface overflow-hidden rounded-[var(--brand-radius-panel)] border ${t.border} shadow-xl ${t.shadow}`}>
        {/* Header */}
        <div className={`${t.headerBg} border-b px-5 py-5 ${t.headerBorder}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={`mb-1 font-label text-[10px] uppercase tracking-[0.24em] ${t.accentMuted}`}>Servicio</p>
              <h3 className="font-display text-2xl font-bold uppercase leading-none text-ink md:text-3xl lg:text-4xl">
                {day}
              </h3>
              {date && (
                <p className="mt-2 truncate font-body text-xs capitalize text-ink/60 md:text-sm">
                  {new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
                    weekday: "long", year: "numeric", month: "long", day: "numeric",
                  })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {date && (
                <span className="rounded-lg border border-ink/10 bg-surface-base/35 px-3 py-2 text-center font-label text-[11px] uppercase tracking-[0.15em] text-ink/70 shadow-inner">
                  {shortDate}
                </span>
              )}
              {isNext && (
                <span className="rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-1 font-label text-[10px] uppercase tracking-widest text-positive-fg">
                  Próximo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 md:p-6">
          {setlist?.team_notes && (
            <section className="rounded-lg border px-4 py-3" style={{ borderColor: `${themeColour(t.accentVar, 0.2078)}`, background: `${themeColour(t.accentVar, 0.051)}` }}>
              <p className={`font-label text-[11px] uppercase tracking-widest ${t.accentMuted} mb-1`}>Mensaje para el equipo</p>
              <p className="font-body text-sm text-ink-muted/90 whitespace-pre-wrap">{setlist.team_notes}</p>
            </section>
          )}

          {/* Setlist */}
          {hasSetlist && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-surface-ink-l70-d50">
                  Setlist
                </h4>
                <div className="flex items-center gap-3">
                  <PracticePlaylistButton songIds={setlist!.songs.map(s => s._id)} accentVar={t.accentVar} />
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
                        <button
                          onClick={() => openSheet(song._id, song.play_key || undefined)}
                          className="group -mx-2 flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/[0.055]"
                        >
                          <span className="font-label text-xs text-mono-400 w-4 shrink-0 text-right tabular-nums">{n}</span>
                          <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                            <span className="truncate font-body text-base font-semibold transition-colors group-hover:text-accent md:text-lg">{song.title}</span>
                            {song.author && <span className="text-mono-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {song.play_key && song.key && song.play_key !== song.key && (
                              <span className="font-label text-[11px] px-1.5 py-0.5 rounded border border-mono-700 bg-mono-800/50 text-mono-500 leading-tight">orig. {song.key}</span>
                            )}
                            <span className={`font-label text-xs font-semibold ${t.accent}`}>{song.play_key || song.key}</span>
                          </div>
                        </button>
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
                        style={{ background: `linear-gradient(to bottom, ${themeColour(t.accentVar, 0)}, ${themeColour(t.accentVar, 0.3333)} 12%, ${themeColour(t.accentVar, 0.3333)} 88%, ${themeColour(t.accentVar, 0)})` }}
                      />
                      {/* MEDLEY label */}
                      {/* `color` on the wrapper, not on the icon: ChainLinkIcon strokes with
                          `currentColor` by default, and `var()` is NOT substituted inside an SVG
                          presentation attribute — a token passed as `color` would be dropped
                          silently. The sibling span sets its own colour, so it is unaffected. */}
                      <div className="flex items-center gap-1 pl-2 -ml-2 mb-0.5" style={{ color: themeColour(t.accentVar) }}>
                        <ChainLinkIcon opacity={0.65} />
                        <span className="font-label text-[10px] uppercase tracking-[0.18em]" style={{ color: `${themeColour(t.accentVar, 0.6)}` }}>Medley</span>
                      </div>
                      {run.songs.map(({ song, n }, si) => (
                        <div key={song._id}>
                          {si > 0 && (
                            <span className="block w-4 text-center font-label text-[11px] leading-none -my-0.5" style={{ color: `${themeColour(t.accentVar, 0.4392)}` }}>+</span>
                          )}
                          <button
                            onClick={() => openSheet(song._id, song.play_key || undefined)}
                            className="group -mx-2 flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/[0.055]"
                          >
                            <span className="font-label text-xs text-mono-400 w-4 shrink-0 text-right tabular-nums">{n}</span>
                            <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                              <span className="truncate font-body text-base font-semibold transition-colors group-hover:text-accent md:text-lg">{song.title}</span>
                              {song.author && <span className="text-mono-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {song.play_key && song.key && song.play_key !== song.key && (
                                <span className="font-label text-[11px] px-1.5 py-0.5 rounded border border-mono-700 bg-mono-800/50 text-mono-500 leading-tight">orig. {song.key}</span>
                              )}
                              <span className={`font-label text-xs font-semibold ${t.accent}`}>{song.play_key || song.key}</span>
                            </div>
                          </button>
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
            <section className={hasSetlist ? "border-t border-ink-dim/[0.12] pt-5" : ""}>
              <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-surface-ink-l70-d50 mb-3">
                Equipo
              </h4>

              {(leads?.length || bgvs?.length || chorus?.length) ? (
                <div>
                  <SectionDivider label="Voces" accent={t.accentMuted} />
                  <div className="grid grid-cols-3 gap-x-3">
                    <VocalCol label="Lead" names={leads ?? []} highlightName={myName} duplicateNames={vocesDups} />
                    <VocalCol label="BGVs" names={(bgvs ?? []).map(m => m.alias || m.member_name)} highlightName={myName} duplicateNames={vocesDups} />
                    <VocalCol label="Coro" names={(chorus ?? []).map(m => m.alias || m.member_name)} highlightName={myName} duplicateNames={vocesDups} />
                  </div>
                </div>
              ) : null}

              {instruments && instruments.filter(s => s.person).length > 0 && (
                <div>
                  <SectionDivider label="Instrumentos" accent={t.accentMuted} />
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {instruments.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} accentVar={t.accentVar} highlightName={myName} isDuplicate={instrDups.has(s.person.toLowerCase().trim())} />)}
                  </div>
                </div>
              )}

              {fohTeam && fohTeam.filter(s => s.person).length > 0 && (
                <div>
                  <SectionDivider label="Front of House" accent={t.accentMuted} />
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {fohTeam.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} accentVar={t.accentVar} highlightName={myName} isDuplicate={fohDups.has(s.person.toLowerCase().trim())} />)}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Setlist editor modal */}
      {editSetlist && date && (
        <CueDialog
          open
          title={`Setlist - ${day} ${shortDate}`}
          label={`Setlist - ${day} ${shortDate}`}
          mode="sheet"
          size="lg"
          onDismiss={() => setEditSetlist(false)}
        >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
              <SetlistEditor
                week={date.slice(0, 10)}
                type={setlistType}
                roleId={roleId}
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

// Lowercased names that appear more than once within a single section
function findDuplicates(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = n.toLowerCase().trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [k, c] of counts) if (c > 1) dups.add(k);
  return dups;
}

function VocalCol({ label, names, highlightName, duplicateNames }: { label: string; names: string[]; highlightName?: string; duplicateNames?: Set<string> }) {
  if (!names.length) return <div />;
  return (
    <div>
      <p className="font-label text-xs uppercase tracking-widest text-mono-400 mb-0.5">{label}</p>
      <p className="font-body text-sm md:text-base lg:text-lg leading-snug">
        {names.map((name, i) => {
          const key  = name.toLowerCase().trim();
          const isDup = !!duplicateNames?.has(key);
          const isMe  = !isDup && !!highlightName && key === highlightName;
          return (
            <span key={i}>
              {i > 0 && ", "}
              {isDup ? (
                <span
                  className="font-semibold text-warning-strong whitespace-nowrap"
                  style={{ textShadow: "0 0 10px rgb(var(--warning-strong-rgb) / 0.65)" }}
                >⚠&nbsp;{name}</span>
              ) : isMe ? (
                <span
                  className="font-semibold text-positive-fg whitespace-nowrap"
                  style={{ textShadow: "0 0 10px rgb(var(--positive-fg-rgb) / 0.8)" }}
                >{name}</span>
              ) : (
                <span className="whitespace-nowrap">{name}</span>
              )}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function Row({ label, value, accentVar, highlightName, isDuplicate }: { label: string; value: string; accentVar: string; highlightName?: string; isDuplicate?: boolean }) {
  const isMe = !isDuplicate && !!highlightName && value.toLowerCase().trim() === highlightName;
  return (
    <div
      className="inline-flex items-stretch rounded-lg"
      style={{
        border: isDuplicate
          ? "1px solid rgb(var(--warning-strong-rgb) / 0.6)"
          : isMe ? "1px solid rgb(var(--positive-fg-rgb) / 0.5)" : `1px solid ${themeColour(accentVar, 0.251)}`,
        boxShadow: isDuplicate
          ? "0 0 10px rgb(var(--warning-strong-rgb) / 0.35)"
          : isMe ? "0 0 10px rgb(var(--positive-fg-rgb) / 0.3)" : undefined,
      }}
    >
      <span
        className="font-label text-xs uppercase tracking-wide px-2.5 flex items-center shrink-0 rounded-l-[7px]"
        style={{
          background: `${themeColour(accentVar, 0.0941)}`,
          color: themeColour(accentVar),
          borderRight: `1px solid ${themeColour(accentVar, 0.1882)}`,
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

function SectionDivider({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className={`font-label text-xs md:text-sm lg:text-base ${accent} uppercase tracking-wide shrink-0`}>
        {label}
      </span>
      <div className="flex-1 h-px bg-mono-200 dark:bg-mono-800" />
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
