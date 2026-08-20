import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveSession, requireMinistryMember } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import { KIDS_SEATS, KIDS_SEAT_LABELS, type KidsSeat } from "@/app/utils/kidsTypes";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";

export const metadata: Metadata = {
  title: "Oasis Kids — Backstage",
  description: "Los próximos domingos de Oasis Kids y las parejas asignadas.",
};

const TZ = "America/Mexico_City";

/**
 * Published Sundays only, and the FILTER is `published == true` — stricter than
 * the `published != false` the worship types need. `kidsSchedule` is a new type
 * whose every document carries the field from birth, so the absent-field leniency
 * does not apply; and for a field-less document `null == true` is false, which
 * excludes it — the safe direction.
 *
 * The PROJECTION is `coalesce(published, false)`, never a bare `published`: a
 * missing field projects as `null`, not `false`, and that third state reads as
 * neither published nor draft.
 */
const KIDS_SCHEDULE_QUERY = `*[_type == "kidsSchedule" && published == true && date >= $today] | order(date asc) [0...8] {
    date,
    "published": coalesce(published, false),
    "ensenanza": ensenanza->{ _id, name, "memberIds": members[]._ref },
    "chiquitos": chiquitos->{ _id, name, "memberIds": members[]._ref },
    "medianos":  medianos->{ _id, name, "memberIds": members[]._ref },
    "grandes":   grandes->{ _id, name, "memberIds": members[]._ref }
  }`;

interface SeatPair {
  _id: string;
  name?: string;
  memberIds?: string[] | null;
}

type KidsScheduleRow = {
  date?: string;
  published?: boolean;
} & Partial<Record<KidsSeat, SeatPair | null>>;

/** Pinned to local noon — a bare `new Date(iso)` flips the day at UTC-6. */
function sundayLabel(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** The seats this member is standing in on a given Sunday (usually zero or one). */
function seatsFor(row: KidsScheduleRow, memberId: string): KidsSeat[] {
  return KIDS_SEATS.filter((seat) => {
    const pair = row[seat];
    return Array.isArray(pair?.memberIds) && pair.memberIds.includes(memberId);
  });
}

export default async function KidsPage() {
  // THE TWO FAILURE CASES ARE SPLIT, and they must stay split. A visitor with no
  // ACTIVE session (no token, or a disabled/deleted member still holding a live
  // cookie — `proxy.ts:26` only proves a token EXISTS) goes to sign-in. Sending
  // them to `/` instead would bounce off `requireWorshipPage`, which sends a
  // kids member straight back here: an infinite `/` ⇄ `/kids` loop.
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/kids");
  // Active, but not a kids member: `/` is the worship landing and its own gate
  // routes them onward (worship page, or `/me` for a member of neither), so this
  // hop always terminates.
  const kids = await requireMinistryMember("kids");
  if (!kids) redirect("/");

  const { sanityId } = session.user;
  // Free: the same 30s-TTL cache entry `requireMinistryMember` just filled.
  const access = await getMemberAccess(sanityId);
  const managesKids = access.role === "super-admin" || access.managesMinistries.includes("kids");

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });

  // Member-facing read, so it goes through the published-perspective client: a
  // `drafts.kidsSchedule-…` overlay authored in Studio is never a member's Sunday.
  const rows = await operationalClient.fetch<KidsScheduleRow[]>(KIDS_SCHEDULE_QUERY, { today });

  // A malformed/missing date can neither be sorted nor rendered, so the record is
  // dropped instead of reaching `new Date(...)`.
  const sundays = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const day = serviceDayKey(row?.date);
      return day ? { day, row, mine: seatsFor(row, sanityId) } : null;
    })
    .filter((s): s is { day: string; row: KidsScheduleRow; mine: KidsSeat[] } => s !== null);

  return (
    <div>
      <Navbar title="Oasis Kids" />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl md:text-3xl font-bold">Próximos domingos</h2>
          {managesKids && (
            <Link
              href="/kids/admin"
              className="flex items-center gap-1.5 rounded-lg border border-surface-accent-30 px-3 py-2 font-label text-xs uppercase tracking-widest text-mono-500 hover:border-accent hover:text-accent transition-colors"
            >
              Planear Kids
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {sundays.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-mono-600">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="font-label text-sm uppercase tracking-widest">Aún no hay domingos publicados</p>
          </div>
        ) : (
          <div className="space-y-5">
            {sundays.map(({ day, row, mine }) => (
              <article
                key={day}
                className={`rounded-2xl border p-5 ${
                  mine.length > 0
                    ? "border-accent bg-surface-accent-faint"
                    : "border-edge-accent-subtle bg-surface-raised"
                }`}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-lg md:text-xl font-bold capitalize text-ink">
                    {sundayLabel(day)}
                  </h3>
                  {mine.length > 0 && (
                    <span className="rounded-full border border-accent px-3 py-1 font-label text-[11px] uppercase tracking-widest text-accent">
                      Te toca — {mine.map((seat) => KIDS_SEAT_LABELS[seat]).join(" · ")}
                    </span>
                  )}
                </header>

                <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                  {KIDS_SEATS.map((seat) => {
                    const pair = row[seat];
                    const isMine = mine.includes(seat);
                    return (
                      <div
                        key={seat}
                        className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2"
                      >
                        <dt className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                          {KIDS_SEAT_LABELS[seat]}
                        </dt>
                        <dd
                          className={`min-w-0 truncate font-body text-sm ${
                            isMine ? "text-accent" : pair?.name ? "text-ink-muted" : "text-mono-600 italic"
                          }`}
                        >
                          {pair?.name ?? "Sin asignar"}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
