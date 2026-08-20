import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import KidsPlanner from "@/app/components/kids/KidsPlanner";
import PairRoster from "@/app/components/kids/PairRoster";
import KidsAvailabilityPanel from "@/app/components/kids/KidsAvailabilityPanel";
import { HISTORY_MONTHS } from "@/app/components/kids/kidsPlannerLabels";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { KIDS_SEATS, type KidsRoom, type KidsSeat } from "@/app/utils/kidsTypes";

export const metadata = { title: "Oasis Kids — Planeación" };

// The three reads the planner opens with, in one round trip. They mirror the
// projections of `/api/kids/pairs`, `/api/kids/schedules` and `/api/kids/members`
// (which the client components then use for every refresh), so the first paint
// carries real data instead of three loading skeletons.
const PAGE_QUERY = `{
  "pairs": *[_type == "kidsPair"] | order(name asc) {
    "id": _id, name, room,
    "active": coalesce(active, true),
    "memberIds": coalesce(members[]._ref, [])
  },
  "schedules": *[_type == "kidsSchedule" && date >= $from && date <= $to] | order(date asc) {
    date,
    "published": coalesce(published, false),
    "ensenanza": ensenanza._ref,
    "chiquitos": chiquitos._ref,
    "medianos": medianos._ref,
    "grandes": grandes._ref
  },
  "history": *[_type == "kidsSchedule" && date >= $historyFrom && date < $from] | order(date asc) {
    date,
    "published": coalesce(published, false),
    "ensenanza": ensenanza._ref,
    "chiquitos": chiquitos._ref,
    "medianos": medianos._ref,
    "grandes": grandes._ref
  },
  "members": *[_type == "teamMembers" && "kids" in ministries] | order(member_name asc) {
    _id, _rev, member_name, alias,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }
}`;

interface ScheduleRow {
  date: string;
  published: boolean;
  ensenanza?: string | null;
  chiquitos?: string | null;
  medianos?: string | null;
  grandes?: string | null;
}

interface PageData {
  pairs: { id: string; name: string; room: KidsRoom; active: boolean; memberIds: string[] }[];
  schedules: ScheduleRow[];
  history: ScheduleRow[];
  members: {
    _id: string;
    // The availability panel sends this back as an `ifRevisionId` precondition —
    // see `app/api/kids/members/[id]/availability/route.ts`.
    _rev: string;
    member_name: string;
    alias?: string;
    unavailableDates: string[];
    unavailabilityNotes: { date: string; note: string }[];
  }[];
}

export default async function KidsAdminPage() {
  // Management, not membership, and NOT a worship `admin` role: two-way ministry
  // isolation (P1). Redirecting to `/` is safe here because this page is reached
  // by a manager who already has a session — the disabled/tokenless case belongs
  // to the member-facing `/kids`.
  const session = await requireMinistryManager("kids");
  if (!session) redirect("/");

  // Server "today" is Mexico City's, per the repo's timezone invariant, and the
  // month bounds are string comparisons: `YYYY-MM-31` covers every real day of a
  // month and excludes the next one's first, with no `Date` arithmetic to drift.
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const month = today.slice(0, 7);

  // The planner's "hace 3 semanas" / "le toca" clocks are measured from prior
  // Sundays, so the first paint carries HISTORY_MONTHS of them. The bound is built
  // on a noon-UTC anchor — the same trick `sundaysOfMonth` uses — because
  // `Date.UTC` normalises a negative month index without any local-midnight edge
  // for the timezone to fall off.
  const historyFrom = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - HISTORY_MONTHS, 1, 12),
  )
    .toISOString()
    .slice(0, 10);

  const data = await serverClient.fetch<PageData>(PAGE_QUERY, {
    from: `${month}-01`,
    to: `${month}-31`,
    historyFrom,
  });

  const pairs = data?.pairs ?? [];
  const members = data?.members ?? [];
  const toSchedule = (row: ScheduleRow) => {
    const seats: Partial<Record<KidsSeat, string>> = {};
    for (const seat of KIDS_SEATS) {
      const pairId = row[seat];
      if (pairId) seats[seat] = pairId;
    }
    return { date: row.date, seats, published: row.published };
  };
  const schedules = (data?.schedules ?? []).map(toSchedule);
  const history = (data?.history ?? []).map(toSchedule);

  return (
    <>
      <Navbar title="Oasis Kids" />
      <div className="mx-auto max-w-5xl px-6 pb-20 pt-10">
        <header className="mb-8 border-b border-ink-dim/10 pb-7">
          <p className="font-label text-[10px] uppercase tracking-[0.26em] text-accent">
            Oasis Kids
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-none text-ink sm:text-5xl">
            Planeación
          </h1>
          <p className="mt-3 max-w-xl font-body text-sm text-ink-dim">
            Rotación de los domingos, parejas por sala y disponibilidad del equipo.
          </p>
        </header>

        <div className="space-y-12">
          <section aria-labelledby="kids-planner-heading">
            <h2
              id="kids-planner-heading"
              className="mb-4 font-display text-2xl uppercase tracking-wide text-ink"
            >
              Domingos
            </h2>
            <KidsPlanner
              initialMonth={month}
              initialPairs={pairs}
              initialMembers={members}
              initialSchedules={schedules}
              initialHistory={history}
            />
          </section>

          <section aria-labelledby="kids-roster-heading">
            <h2
              id="kids-roster-heading"
              className="mb-4 font-display text-2xl uppercase tracking-wide text-ink"
            >
              Parejas
            </h2>
            <PairRoster initialPairs={pairs} initialMembers={members} />
          </section>

          <section aria-labelledby="kids-availability-heading">
            <h2
              id="kids-availability-heading"
              className="mb-4 font-display text-2xl uppercase tracking-wide text-ink"
            >
              Disponibilidad
            </h2>
            <KidsAvailabilityPanel initialMembers={members} />
          </section>
        </div>
      </div>
    </>
  );
}
