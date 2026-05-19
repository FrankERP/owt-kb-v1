"use client";

import { useState } from "react";
import { Setlist } from "../utils/interface";
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
  border:       "border-[#003572] dark:border-[#00bfff]",
  shadow:       "shadow-[#00bfff]/20",
  headerBg:     "bg-[#003572] dark:bg-[#001f3f]",
  headerBorder: "border-[#002249] dark:border-[#00bfff]",
  accent:       "text-[#00bfff]",
  accentMuted:  "text-[#00bfff]/70",
};

const SATURDAY_THEME = {
  border:       "border-[#78350f] dark:border-[#f59e0b]",
  shadow:       "shadow-[#f59e0b]/20",
  headerBg:     "bg-[#78350f] dark:bg-[#1c0800]",
  headerBorder: "border-[#92400e] dark:border-[#f59e0b]",
  accent:       "text-[#f59e0b]",
  accentMuted:  "text-[#f59e0b]/70",
};

const SPECIAL_THEME = {
  border:       "border-[#4c1d95] dark:border-[#a78bfa]",
  shadow:       "shadow-[#a78bfa]/20",
  headerBg:     "bg-[#4c1d95] dark:bg-[#1e0a3c]",
  headerBorder: "border-[#5b21b6] dark:border-[#a78bfa]",
  accent:       "text-[#a78bfa]",
  accentMuted:  "text-[#a78bfa]/70",
};

export function DayCard({ day, date, setlist, leads, instruments, fohTeam, bgvs, chorus, roleId, isNext }: DayCardProps) {
  const { openSheet } = usePlayer();
  const { data: session } = useSession();
  const [editSetlist, setEditSetlist] = useState(false);

  const hasRole     = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist  = !!(setlist?.songs?.length);

  if (!hasSetlist && !hasRole) return null;

  const t = day === "Sábado" ? SATURDAY_THEME : day === "Domingo" ? SUNDAY_THEME : SPECIAL_THEME;
  const canEdit = ["super-admin", "admin"].includes(session?.user?.role as string);
  const setlistType: "sunday" | "saturday" | "special" =
    day === "Sábado" ? "saturday" : day === "Domingo" ? "sunday" : "special";

  const shortDate = date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";

  return (
    <>
      <div className={`border ${t.border} rounded-xl overflow-hidden shadow-md ${t.shadow}`}>
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
          {/* Setlist */}
          {hasSetlist && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50">
                  Setlist
                </h4>
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
              <ol>
                {setlist!.songs.map((song, i) => (
                  <li key={song._id}>
                    <button
                      onClick={() => openSheet(song._id, song.play_key || undefined)}
                      className="w-full flex items-center gap-3 px-2 py-2 -mx-2 rounded-lg text-left hover:bg-white/5 group transition-colors cursor-pointer"
                    >
                      <span className="font-label text-xs text-gray-600 w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                        <span className="font-body text-sm md:text-base font-semibold truncate group-hover:text-[#00bfff] transition-colors">{song.title}</span>
                        {song.author && (
                          <span className="text-gray-500 text-xs truncate hidden sm:inline">· {song.author}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {song.play_key && song.key && song.play_key !== song.key && (
                          <span className="font-label text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800/50 text-gray-500 leading-tight">
                            orig. {song.key}
                          </span>
                        )}
                        <span className={`font-label text-xs font-semibold ${t.accent}`}>{song.play_key || song.key}</span>
                      </div>
                    </button>
                  </li>
                ))}
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
                  <SectionDivider label="Líderes" accent={t.accentMuted} />
                  <div className="grid grid-cols-3 gap-x-3">
                    <VocalCol label="Lead" names={leads ?? []} />
                    <VocalCol label="BGVs" names={(bgvs ?? []).map(m => m.alias || m.member_name)} />
                    <VocalCol label="Coro" names={(chorus ?? []).map(m => m.alias || m.member_name)} />
                  </div>
                </div>
              ) : null}

              {instruments && instruments.filter(s => s.person).length > 0 && (
                <div>
                  <SectionDivider label="Instrumentos" accent={t.accentMuted} />
                  {instruments.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} />)}
                </div>
              )}

              {fohTeam && fohTeam.filter(s => s.person).length > 0 && (
                <div>
                  <SectionDivider label="Front of House" accent={t.accentMuted} />
                  {fohTeam.filter(s => s.person).map((s, i) => <Row key={i} label={s.label} value={s.person} />)}
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

function VocalCol({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return <div />;
  return (
    <div>
      <p className="font-label text-xs uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      <p className="font-body text-sm md:text-base lg:text-lg leading-snug">{names.join(", ")}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="font-label text-xs md:text-sm uppercase tracking-wide px-2 py-0.5 rounded border border-gray-700 bg-gray-800/60 text-gray-400 shrink-0 leading-tight">
        {label}:
      </span>
      <span className="font-body text-sm md:text-base lg:text-lg">{value}</span>
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
