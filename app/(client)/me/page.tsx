import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { client } from "@/sanity/lib/client";
import { serverClient } from "@/sanity/lib/serverClient";
import Navbar from "@/app/components/Navbar";
import { DayCard } from "@/app/components/DayCard";
import ProfilePanel from "@/app/components/ProfilePanel";
import AvailabilityCalendar from "@/app/components/AvailabilityCalendar";
import { Setlist, SetlistSong } from "@/app/utils/interface";

export const revalidate = 60;

const TZ = "America/Mexico_City";

export default async function MePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin?callbackUrl=/me");

  const { sanityId, name } = session.user;

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, member_name, alias, email, role, memberType,
      unavailableDates,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`,
    { id: sanityId }
  );

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  const limit = new Date(Date.now() + 95 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: TZ });

  const memberFilter = `(
    $id in Lead[]._ref ||
    $id in BGVs[]._ref ||
    $id in Chorus[]._ref ||
    $id in instruments[].person._ref ||
    $id in foh_team[].person._ref
  )`;

  const data = await client.fetch(
    `{
      "sundays": *[_type == "sunday_role" && week >= $today && week <= $limit && ${memberFilter}] | order(week asc) {
        _id, week,
        Lead[]-> { member_name, alias },
        instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
        foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
        BGVs[]-> { member_name, alias },
        Chorus[]-> { member_name, alias },
        "setlist": *[_type == "featuredSongs" && week == ^.week][0] {
          songs[] {
            play_key,
            "title": song->title, "slug": song->slug, "_id": song->_id,
            "author": song->author, "key": song->key,
          },
          week,
        }
      },
      "saturdays": *[_type == "saturday_role" && week >= $today && week <= $limit && ${memberFilter}] | order(week asc) {
        _id, week,
        Lead[]-> { member_name, alias },
        instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
        foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
        BGVs[]-> { member_name, alias },
        Chorus[]-> { member_name, alias },
        "setlist": *[_type == "saturdarSongs" && week == ^.week][0] {
          songs[] {
            play_key,
            "title": song->title, "slug": song->slug, "_id": song->_id,
            "author": song->author, "key": song->key,
          },
          week,
        }
      },
      "specials": *[_type == "special_role" && date >= $today && date <= $limit && ${memberFilter}] | order(date asc) {
        _id, date, service_name,
        Lead[]-> { member_name, alias },
        instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
        foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
        BGVs[]-> { member_name, alias },
        Chorus[]-> { member_name, alias },
        songs[] {
          play_key,
          "title": song->title, "slug": song->slug, "_id": song->_id,
          "author": song->author, "key": song->key,
        }
      }
    }`,
    { today, limit, id: sanityId }
  );

  type RoleDoc = {
    _id: string;
    week?: string;
    date?: string;
    service_name?: string;
    Lead?: Array<{ member_name: string; alias?: string }>;
    instruments?: Array<{ instrument: string; person: string }>;
    foh_team?: Array<{ role: string; person: string }>;
    BGVs?: Array<{ member_name: string; alias?: string }>;
    Chorus?: Array<{ member_name: string; alias?: string }>;
    setlist?: Setlist;
    songs?: SetlistSong[];
  };

  const allAssignments: Array<{ dateKey: string; day: string; doc: RoleDoc }> = [
    ...data.sundays.map((d: RoleDoc) => ({ dateKey: d.week!, day: "Domingo", doc: d })),
    ...data.saturdays.map((d: RoleDoc) => ({ dateKey: d.week!, day: "Sábado", doc: d })),
    ...data.specials.map((d: RoleDoc) => ({ dateKey: d.date!, day: d.service_name || "Servicio Especial", doc: d })),
  ].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const firstName = name?.split(" ")[0] ?? "Miembro";

  return (
    <div>
      <Navbar title={firstName} schedule tags />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-12">

        {/* Profile settings */}
        {member && <ProfilePanel initialMember={member} />}

        {/* Availability */}
        {member && (
          <AvailabilityCalendar initialDates={member.unavailableDates ?? []} />
        )}

        {/* Upcoming services */}
        <div>
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-2">
          Mis próximos servicios
        </h2>
        <p className="font-label text-xs uppercase tracking-widest text-gray-500 text-center mb-10">
          Próximos 3 meses
        </p>

        {allAssignments.length === 0 ? (
          <p className="text-center font-label text-sm text-gray-400 py-20">
            No tienes servicios asignados en los próximos tres meses.
          </p>
        ) : (
          <div className="space-y-6">
            {allAssignments.map(({ day, doc }) => {
              const setlist = doc.setlist ?? (
                doc.songs?.length
                  ? { songs: doc.songs, week: doc.date ?? "" }
                  : undefined
              );
              return (
                <DayCard
                  key={doc._id}
                  day={day}
                  date={doc.week ?? doc.date}
                  setlist={setlist}
                  leads={doc.Lead?.map((m) => m.alias || m.member_name)}
                  instruments={doc.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
                  fohTeam={doc.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
                  bgvs={doc.BGVs}
                  chorus={doc.Chorus}
                />
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
