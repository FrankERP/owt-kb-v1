import Link from "next/link";
import { Setlist } from "../utils/interface";

export interface DayCardProps {
  day: string;
  date?: string;
  setlist?: Setlist | null;
  leads?: string[];
  leadSupport?: string;
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
}

export function DayCard({ day, date, setlist, leads, leadSupport, instruments, fohTeam, bgvs, chorus }: DayCardProps) {
  const hasRole = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist = !!(setlist?.songs?.length);

  if (!hasSetlist && !hasRole) return null;

  return (
    <div className="border border-[#003572] dark:border-[#00bfff] rounded-xl overflow-hidden shadow-md shadow-[#00bfff]/20">
      <div className="bg-[#003572] dark:bg-[#001f3f] px-5 py-4 border-b border-[#002249] dark:border-[#00bfff]">
        <h3 className="font-display text-lg md:text-xl font-bold uppercase text-[#C8D8EB]">
          {day}
        </h3>
        {date && (
          <p className="text-xs md:text-sm text-[#C8D8EB]/60 capitalize mt-0.5">
            {new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </div>

      <div className="p-5 md:p-7 space-y-5">
        {hasSetlist && (
          <section>
            <h4 className="font-label text-xs md:text-sm uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50 mb-3">
              Setlist
            </h4>
            <ol className="space-y-3">
              {setlist!.songs.map((song, i) => (
                <li key={song._id} className="flex items-start gap-2">
                  <span className="text-gray-400 text-sm md:text-base w-4 shrink-0 mt-0.5">{i + 1}.</span>
                  <div>
                    <Link href={`/posts/${song.slug.current}`} className="hover:text-[#00bfff] transition-colors">
                      <span className="font-body text-sm md:text-base font-semibold">{song.title}</span>
                      <span className="text-gray-500 text-sm md:text-base"> — {song.author}</span>
                    </Link>
                    <div className="font-label text-xs md:text-sm mt-0.5">
                      <span className="text-[#00bfff]">{song.play_key || song.key}</span>
                      {song.play_key && song.key && song.play_key !== song.key && (
                        <span className="text-gray-400 ml-1.5">orig. {song.key}</span>
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
            <h4 className="font-label text-xs md:text-sm uppercase tracking-widest text-[#C8D8EB]/70 dark:text-[#C8D8EB]/50 mb-3">
              Equipo
            </h4>

            {leads && leads.length > 0 && (
              <div>
                <SectionDivider label={leads.length > 1 ? "Líderes" : "Lead"} />
                <p className="font-body text-sm md:text-base">{leads.join(", ")}</p>
              </div>
            )}
            {leadSupport && (
              <div className="mt-3">
                <SectionDivider label="Support" />
                <p className="font-body text-sm md:text-base">{leadSupport}</p>
              </div>
            )}

            {instruments && instruments.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Instrumentos" />
                {instruments.map((s, i) => <Row key={i} label={s.label} value={s.person} />)}
              </div>
            )}

            {fohTeam && fohTeam.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Front of House" />
                {fohTeam.map((s, i) => <Row key={i} label={s.label} value={s.person} />)}
              </div>
            )}

            {bgvs && bgvs.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="BGVs" />
                <p className="font-body text-sm md:text-base">{bgvs.map(m => m.alias || m.member_name).join(", ")}</p>
              </div>
            )}

            {chorus && chorus.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Coro" />
                <p className="font-body text-sm md:text-base">{chorus.map(m => m.alias || m.member_name).join(", ")}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-0.5">
      <span className="font-label text-[10px] md:text-xs text-gray-500 uppercase tracking-wide shrink-0">
        {label}
      </span>
      <span className="font-body text-sm md:text-base text-right">{value}</span>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-label text-[10px] md:text-xs text-[#00bfff]/70 uppercase tracking-wide shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}
