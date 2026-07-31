import { SERVICE_LABEL } from "@/app/components/admin/serviceCardModel";

export interface MemberLike { _id: string; member_name?: string; alias?: string }
export interface DraftCardLike {
  _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: { instrument: string; personId: string }[];
  foh: { role: string; personId: string }[];
}
export interface DayCardData {
  /**
   * The service-type label, from the shared `SERVICE_LABEL` record — so
   * "Especial" is now a possible value and the union has widened to `string`.
   *
   * **Safe, deliberately, not dodged.** `DayCard`'s own prop is already
   * `day: string` (`app/components/DayCard.tsx:14`), and both selectors that
   * read it fall back for an unrecognised label: the theme to `SPECIAL_THEME`
   * and the setlist type to `"special"` (`:79`, `:81-82`). Narrowing this back
   * to a two-member union, or adding a third hardcoded ternary below to keep it
   * narrow, would re-introduce exactly the label duplication `SERVICE_LABEL`
   * exists to remove.
   */
  day: string;
  date: string;
  leads: string[];
  bgvs: { member_name: string; alias?: string }[];
  chorus: { member_name: string; alias?: string }[];
  instruments: { label: string; person: string }[];
  fohTeam: { label: string; person: string }[];
}

export function draftToDayCardProps(draft: DraftCardLike, members: MemberLike[]): DayCardData {
  const byId = new Map(members.map((m) => [m._id, m]));
  /**
   * The app-wide display name: alias first, full name only as the fallback (the
   * same rule as `dn` in `serviceCardModel` / `MonthGenerator`).
   *
   * `leads`, `instruments` and `fohTeam` are pre-resolved STRINGS in `DayCardData`,
   * so the alias has to be applied here — `DayCard` cannot do it later the way it
   * does for `bgvs`/`chorus`, which it receives as objects. Resolving with
   * `member_name` alone is what showed solver-generated leads under their full
   * legal names in the month preview's `Vista`.
   *
   * `undefined` still means "no such member", so unknown ids are filtered out
   * exactly as before.
   */
  const name = (id: string) => {
    const m = byId.get(id);
    return m ? (m.alias?.trim() || m.member_name) : undefined;
  };
  const obj = (id: string) => {
    const m = byId.get(id);
    return m ? { member_name: m.member_name ?? "", alias: m.alias } : undefined;
  };
  const present = <T,>(x: T | undefined): x is T => x !== undefined;

  return {
    day: SERVICE_LABEL[draft._type],
    date: draft.date,
    leads: draft.leads.map(name).filter(present),
    bgvs: draft.bgvs.map(obj).filter(present),
    chorus: draft.chorus.map(obj).filter(present),
    instruments: draft.instruments
      .map((s) => ({ label: s.instrument, person: name(s.personId) }))
      .filter((s): s is { label: string; person: string } => present(s.person)),
    fohTeam: draft.foh
      .map((s) => ({ label: s.role, person: name(s.personId) }))
      .filter((s): s is { label: string; person: string } => present(s.person)),
  };
}
