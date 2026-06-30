interface PMember { _id: string; member_name?: string; alias?: string }
export interface ParticipantRole {
  _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  leads: PMember[];
  bgvs: PMember[];
  chorus: PMember[];
  instruments: { person: PMember | null }[];
  foh: { person: PMember | null }[];
}
export interface MemberParticipation {
  id: string; name: string;
  sunLead: number; satLead: number; sunBGV: number; satBGV: number; coro: number;
  total: number; instrWeeks: number; fohWeeks: number;
}

function plusOneDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const weekKey = (r: ParticipantRole) => (r._type === "saturday_role" ? plusOneDay(r.date) : r.date);
const dn = (m: PMember) => (m.alias?.trim() || m.member_name || "");

export function computeParticipation(roles: ParticipantRole[]): MemberParticipation[] {
  type Acc = MemberParticipation & { _instr: Set<string>; _foh: Set<string> };
  const map = new Map<string, Acc>();
  const get = (m: PMember): Acc => {
    let e = map.get(m._id);
    if (!e) {
      e = { id: m._id, name: dn(m), sunLead: 0, satLead: 0, sunBGV: 0, satBGV: 0, coro: 0,
            total: 0, instrWeeks: 0, fohWeeks: 0, _instr: new Set(), _foh: new Set() };
      map.set(m._id, e);
    }
    return e;
  };

  for (const r of roles) {
    if (r._type === "special_role") continue;
    const isSun = r._type === "sunday_role";
    for (const m of r.leads ?? []) { const e = get(m); isSun ? e.sunLead++ : e.satLead++; }
    for (const m of r.bgvs ?? [])  { const e = get(m); isSun ? e.sunBGV++  : e.satBGV++; }
    for (const m of r.chorus ?? []) { get(m).coro++; }
    const wk = weekKey(r);
    for (const s of r.instruments ?? []) { if (s.person) get(s.person)._instr.add(wk); }
    for (const s of r.foh ?? [])         { if (s.person) get(s.person)._foh.add(wk); }
  }

  const out: MemberParticipation[] = [];
  for (const e of map.values()) {
    e.total = e.sunLead + e.satLead + e.sunBGV + e.satBGV + e.coro;
    e.instrWeeks = e._instr.size;
    e.fohWeeks = e._foh.size;
    if (e.total > 0 || e.instrWeeks > 0 || e.fohWeeks > 0) {
      const { _instr, _foh, ...rest } = e;
      out.push(rest);
    }
  }
  return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
