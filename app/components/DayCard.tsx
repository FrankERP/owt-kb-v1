import Link from "next/link";
import { Setlist } from "../utils/interface";

export interface DayCardProps {
  day: string;
  date?: string;
  setlist?: Setlist | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
}

const SUNDAY_THEME = {
  border:       "border-[#003572] dark:border-[#00bfff]",
  shadow:       "shadow-[#00bfff]/20",
  headerBg:     "bg-[#003572] dark:bg-[#001f3f]",
  headerBorder: "border-[#002249] dark:border-[#00bfff]",
  accent:       "text-[#00bfff]",
  accentMuted:  "text-[#00bfff]/70",
  songHover:    "hover:text-[#00bfff]",
};

const SATURDAY_THEME = {
  border:       "border-[#78350f] dark:border-[#f59e0b]",
  shadow:       "shadow-[#f59e0b]/20",
  headerBg:     "bg-[#78350f] dark:bg-[#1c0800]",
  headerBorder: "border-[#92400e] dark:border-[#f59e0b]",
  accent:       "text-[#f59e0b]",
  accentMuted:  "text-[#f59e0b]/70",
  songHover:    "hover:text-[#f59e0b]",
};

const SPECIAL_THEME = {
  border:       "border-[#4c1d95] dark:border-[#a78bfa]",
  shadow:       "shadow-[#a78bfa]/20",
  headerBg:     "bg-[#4c1d95] dark:bg-[#1e0a3c]",
  headerBorder: "border-[#5b21b6] dark:border-[#a78bfa]",
  accent:       "text-[#a78bfa]",
  accentMuted:  "text-[#a78bfa]/70",
  songHover:    "hover:text-[#a78bfa]",
};

export function DayCard({ day, date, setlist, leads, instruments, fohTeam, bgvs, chorus }: DayCardProps) {
  const hasRole = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist = !!(setlist?.songs?.length);

  if (!hasSetlist && !hasRole) return null;

  const t = day === "Sábado" ? SATURDAY_THEME : day === "Domingo" ? SUNDAY_THEME : SPECIAL_THEME;

  return (
    <div className={`border ${t.border} rounded-xl overflow-hidden shadow-md ${t.shadow}`}>
      <div className={`${t.headerBg} px-5 py-4 border-b ${t.headerBorder}`}>
        <h3 className="font-display text-xl md:text-2xl lg:text-3xl font-bold uppercase text-[#C8D8EB]">
          {day}
        </h3>
        {date && (
          <p className="text-xs md:text-sm lg:text-base text-[#C8D8EB]/60 capitalize mt-0.5">
            {new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </div>

      <div className="p-4 md:p-5 space-y-4">
        {hasSetlist && (
          <section>
            <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50 mb-3">
              Setlist
            </h4>
            <ol className="space-y-3">
              {setlist!.songs.map((song, i) => (
                <li key={song._id} className="flex items-start gap-2">
                  <span className="text-gray-400 text-sm md:text-base lg:text-lg w-5 shrink-0 mt-0.5">{i + 1}.</span>
                  <div>
                    <Link href={`/posts/${song.slug.current}`} className={`${t.songHover} transition-colors`}>
                      <span className="font-body text-sm md:text-base lg:text-lg font-semibold">{song.title}</span>
                      <span className="text-gray-500 text-sm md:text-base lg:text-lg"> — {song.author}</span>
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`font-label text-xs md:text-sm lg:text-base font-semibold ${t.accent}`}>{song.play_key || song.key}</span>
                      {song.play_key && song.key && song.play_key !== song.key && (
                        <span className="font-label text-xs md:text-sm px-2 py-0.5 rounded border border-gray-700 bg-gray-800/60 text-gray-400 leading-tight">
                          orig. {song.key}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {hasRole && (
          <section className={hasSetlist ? "border-t border-gray-200 dark:border-gray-800 pt-5" : ""}>
            <h4 className="font-label text-xs md:text-sm lg:text-base uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50 mb-3">
              Equipo
            </h4>

            {/* Vocals — Lead / BGVs / Chorus as a single 3-column row */}
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
  );
}

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
