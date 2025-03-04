import { client } from "@/sanity/lib/client";

export async function getSetlistAndRoles() {
  const currentWeek = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format

  const query = `
    {
      "setlist": *[_type == "featuredSongs" && week >= "${currentWeek}"] | order(week desc)[0] {
        songs[]{
          song->{
            _id,
            title,
            slug,
            author,
            timeSig,
            bpm,
            key
          },
          play_key
        },
        week
      },
      "roles": *[_type == "sunday_role" && week >= "${currentWeek}"] | order(week desc)[0] {
        week,
        Lead[]->{ _id, member_name, alias, slug },
        EG->{ _id, member_name, alias, slug },
        Bass->{ _id, member_name, alias, slug },
        Drums[]->{ _id, member_name, alias, slug },
        Keys[]->{ _id, member_name, alias, slug },
        BGVs[]->{ _id, member_name, alias, slug },
        Chorus[]->{ _id, member_name, alias, slug }
      }
    }
  `;

  return await client.fetch(query);
}