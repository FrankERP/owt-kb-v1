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
  day: "Domingo" | "Sábado";
  date: string;
  leads: string[];
  bgvs: { member_name: string; alias?: string }[];
  chorus: { member_name: string; alias?: string }[];
  instruments: { label: string; person: string }[];
  fohTeam: { label: string; person: string }[];
}

export function draftToDayCardProps(draft: DraftCardLike, members: MemberLike[]): DayCardData {
  const byId = new Map(members.map((m) => [m._id, m]));
  const name = (id: string) => byId.get(id)?.member_name;
  const obj = (id: string) => {
    const m = byId.get(id);
    return m ? { member_name: m.member_name ?? "", alias: m.alias } : undefined;
  };
  const present = <T,>(x: T | undefined): x is T => x !== undefined;

  return {
    day: draft._type === "saturday_role" ? "Sábado" : "Domingo",
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
