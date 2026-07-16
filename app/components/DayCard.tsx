"use client";

import { useState } from "react";
import { Setlist } from "../utils/interface";
import { buildRuns } from "../utils/medley";
import { ChainLinkIcon } from "./ChainLinkIcon";
import PracticePlaylistButton from "./PracticePlaylistButton";
import { usePlayer } from "@/app/context/PlayerContext";
import { useSession } from "next-auth/react";
import { SetlistEditor } from "./admin/SetlistEditor";

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
  border:       "border-brand-beam/45",
  shadow:       "shadow-brand-beam/10",
  headerBg:     "bg-brand-deck/80",
  headerBorder: "border-brand-beam/25",
  accent:       "text-brand-beam",
  accentMuted:  "text-brand-beam/70",
  accentHex:    "#12c8f4",
};

const SATURDAY_THEME = {
  border:       "border-[#78350f] dark:border-[#f59e0b]",
  shadow:       "shadow-[#f59e0b]/20",
  headerBg:     "bg-[#78350f] dark:bg-[#1c0800]",
  headerBorder: "border-[#92400e] dark:border-[#f59e0b]",
  accent:       "text-[#f59e0b]",
  accentMuted:  "text-[#f59e0b]/70",
  accentHex:    "#f59e0b",
};

const SPECIAL_THEME = {
  border:       "border-[#4c1d95] dark:border-[#a78bfa]",
  shadow:       "shadow-[#a78bfa]/20",
  headerBg:     "bg-[#4c1d95] dark:bg-[#1e0a3c]",
  headerBorder: "border-[#5b21b6] dark:border-[#a78bfa]",
  accent:       "text-[#a78bfa]",
  accentMuted:  "text-[#a78bfa]/70",
  accentHex:    "#a78bfa",
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

  const t = day === "Sábado" ? SATURDAY_THEME : day === "Domingo" ? SUNDAY_THEME : SPECIAL_THEME;
  const canEdit = ["super-admin", "admin"].includes(session?.user?.role as string);
  const setlistType: "sunday" | "saturday" | "special" =
    day === "Sábado" ? "saturday" : day === "Domingo" ? "sunday" : "special";

  const shortDate = date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";

  // Group songs into medley runs
  const runs = hasSetlist ? buildRuns(setlist!.songs) : [];

  return (
    <>
      <div className={`brand-facet-panel border ${t.border} rounded-[var(--brand-radius-panel)] overflow-hidden bg-brand-console/55 shadow-lg ${t.shadow}`}>
        {/* Header */}
        <div className={`${t.headerBg} px-5 py-4 border-b ${t.headerBorder}`}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-xl md:text-2xl lg:text-3xl font-bold uppercase text-[#C8D8EB]">
              {day}
            </h3>
            {isNext && (
              <span className="font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/15 text-[#C8D8EB] border border-white/20 shrink-0 mt-1">
                Próximo
              </span>
            )}
          </div>
          {date && (
            <p className="text-xs md:text-sm lg:text-base text-[#C8D8EB]/60 capitalize mt-0.5">
              {new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          )}
        </div>

        <div className="p-4 md:p-5 space-y-4">
          {setlist?.team_notes && (
            <section className="rounded-lg border px-4 py-3" style={{ borderColor: `${t.accentHex}35`, background: `${t.accentHex}0d` }}>
              <p className={`font-label text-[10px] uppercase tracking-widest ${t.accentMuted} mb-1`}>Mensaje para el equipo</p>
              <p className="font-body text-sm text-[#C8D8EB]/90 whitespace-pre-wrap">{setlist.team_notes}</p>
            </section>
          )}

          {/* Setlist */}
          {hasSetlist && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50">
                  Setlist
                </h4>
                <div className="flex items-center gap-3">
                  <PracticePlaylistButton songIds={setlist!.songs.map(s => s._id)} accent={t.accentHex} />
                  {canEdit && date && (
                    <button
                      onClick={() => setEditSetlist(true)}
                      className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors"
                    >
                      <PencilIcon />
                      Editar
                    </button>
                  )}
                </div>
              </div>
              <ol>
                {runs.map((run) => {
                  // Single-song medley groups render as plain singles
                  if (run.kind === "single" || (run.kind === "medley" && run.songs.length === 1)) {
                    const { song, n } = run.kind === "single" ? run : run.songs[0];
                    return (
                      <li key={song._id}>
                        <button
                          onClick={() => openSheet(song._id, song.play_key || undefined)}
                          className="w-full flex items-center gap-3 px-2 py-2 -mx-2 rounded-lg text-left hover:bg-white/5 group transition-colors cursor-pointer"
                        >
                          <span className="font-label text-xs text-gray-400 w-4 shrink-0 text-right tabular-nums">{n}</span>
                          <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                            <span className="font-body text-sm md:text-base font-semibold truncate group-hover:text-[#00bfff] transition-colors">{song.title}</span>
                            {song.author && <span className="text-gray-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {song.play_key && song.key && song.play_key !== song.key && (
                              <span className="font-label text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800/50 text-gray-500 leading-tight">orig. {song.key}</span>
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
                        style={{ background: `linear-gradient(to bottom, ${t.accentHex}00, ${t.accentHex}55 12%, ${t.accentHex}55 88%, ${t.accentHex}00)` }}
                      />
                      {/* MEDLEY label */}
                      <div className="flex items-center gap-1 pl-2 -ml-2 mb-0.5">
                        <ChainLinkIcon color={t.accentHex} opacity={0.65} />
                        <span className="font-label text-[9px] uppercase tracking-[0.18em]" style={{ color: `${t.accentHex}99` }}>Medley</span>
                      </div>
                      {run.songs.map(({ song, n }, si) => (
                        <div key={song._id}>
                          {si > 0 && (
                            <span className="block w-4 text-center font-label text-[10px] leading-none -my-0.5" style={{ color: `${t.accentHex}70` }}>+</span>
                          )}
                          <button
                            onClick={() => openSheet(song._id, song.play_key || undefined)}
                            className="w-full flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg text-left hover:bg-white/5 group transition-colors cursor-pointer"
                          >
                            <span className="font-label text-xs text-gray-400 w-4 shrink-0 text-right tabular-nums">{n}</span>
                            <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                              <span className="font-body text-sm md:text-base font-semibold truncate group-hover:text-[#00bfff] transition-colors">{song.title}</span>
                              {song.author && <span className="text-gray-500 text-xs truncate hidden sm:inline">· {song.author}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {song.play_key && song.key && song.play_key !== song.key && (
                                <span className="font-label text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800/50 text-gray-500 leading-tight">orig. {song.key}</span>
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
            <section className={hasSetlist ? "border-t border-gray-200 dark:border-gray-800 pt-5" : ""}>
              <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50 mb-3">
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
                    {instruments.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} accentHex={t.accentHex} highlightName={myName} isDuplicate={instrDups.has(s.person.toLowerCase().trim())} />)}
                  </div>
                </div>
              )}

              {fohTeam && fohTeam.filter(s => s.person).length > 0 && (
                <div>
                  <SectionDivider label="Front of House" accent={t.accentMuted} />
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {fohTeam.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} accentHex={t.accentHex} highlightName={myName} isDuplicate={fohDups.has(s.person.toLowerCase().trim())} />)}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Setlist editor modal */}
      {editSetlist && date && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 px-4 pb-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditSetlist(false)} />
          <div className="relative z-10 w-full max-w-xl bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl flex flex-col max-h-[calc(100vh-2rem)]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#003572]/15 dark:border-[#00bfff]/10 shrink-0">
              <h2 className="font-display text-lg uppercase tracking-wide">
                Setlist — {day} {shortDate}
              </h2>
              <button onClick={() => setEditSetlist(false)} className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto overflow-x-hidden p-6 flex-1">
              <SetlistEditor
                week={date.slice(0, 10)}
                type={setlistType}
                roleId={roleId}
                onClose={() => setEditSetlist(false)}
              />
            </div>
          </div>
        </div>
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
      <p className="font-label text-xs uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
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
                  className="font-semibold text-amber-400 whitespace-nowrap"
                  style={{ textShadow: "0 0 10px rgba(251,191,36,0.65)" }}
                >⚠&nbsp;{name}</span>
              ) : isMe ? (
                <span
                  className="font-semibold text-[#3dff7c] whitespace-nowrap"
                  style={{ textShadow: "0 0 10px rgba(61,255,124,0.8)" }}
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

function Row({ label, value, accentHex, highlightName, isDuplicate }: { label: string; value: string; accentHex: string; highlightName?: string; isDuplicate?: boolean }) {
  const isMe = !isDuplicate && !!highlightName && value.toLowerCase().trim() === highlightName;
  return (
    <div
      className="inline-flex items-stretch rounded-lg"
      style={{
        border: isDuplicate
          ? "1px solid rgba(251,191,36,0.6)"
          : isMe ? "1px solid rgba(61,255,124,0.5)" : `1px solid ${accentHex}40`,
        boxShadow: isDuplicate
          ? "0 0 10px rgba(251,191,36,0.35)"
          : isMe ? "0 0 10px rgba(61,255,124,0.3)" : undefined,
      }}
    >
      <span
        className="font-label text-xs uppercase tracking-wide px-2.5 flex items-center shrink-0 rounded-l-[7px]"
        style={{
          background: `${accentHex}18`,
          color: accentHex,
          borderRight: `1px solid ${accentHex}30`,
        }}
      >
        {label}
      </span>
      <span
        className={`font-body text-sm md:text-base px-3 py-1.5 flex flex-1 items-center justify-center gap-1 leading-tight ${
          isDuplicate ? "font-semibold text-amber-400" : isMe ? "font-semibold text-[#3dff7c]" : ""
        }`}
        style={isDuplicate ? { background: "rgba(251,191,36,0.10)" } : isMe ? { background: "rgba(61,255,124,0.10)" } : undefined}
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
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
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
