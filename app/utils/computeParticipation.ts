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
  sunLead: number; satLead: number; sunBGV: number; satBGV: number; coro: number; especial: number;
  total: number; instrWeeks: number; fohWeeks: number;
}

function plusOneDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** The next Sunday on or after the given date (unchanged if already a Sunday). */
function nextSundayOnOrAfter(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  const day = d.getDay(); // 0 = Sunday
  if (day !== 0) d.setDate(d.getDate() + (7 - day));
  return ymd(d);
}
/**
 * The week a service belongs to: a Saturday counts toward the FOLLOWING Sunday,
 * so a weekend is one week. A special (weekday) service counts toward the next
 * Sunday ON OR AFTER its date, so a Wednesday special shares that week's cell
 * with the coming Sunday, and a special dated on a Sunday keys to itself rather
 * than being pushed a week forward. Exported because the seat board's load
 * strip must group by the same rule — a second implementation would drift.
 */
export const serviceWeekKey = (r: ParticipantRole) =>
  r._type === "saturday_role" ? plusOneDay(r.date)
  : r._type === "special_role" ? nextSundayOnOrAfter(r.date)
  : r.date;

const weekKey = serviceWeekKey;
const dn = (m: PMember) => (m.alias?.trim() || m.member_name || "");

export function computeParticipation(roles: ParticipantRole[]): MemberParticipation[] {
  type Acc = MemberParticipation & { _instr: Set<string>; _foh: Set<string> };
  const map = new Map<string, Acc>();
  const get = (m: PMember): Acc => {
    let e = map.get(m._id);
    if (!e) {
      e = { id: m._id, name: dn(m), sunLead: 0, satLead: 0, sunBGV: 0, satBGV: 0, coro: 0, especial: 0,
            total: 0, instrWeeks: 0, fohWeeks: 0, _instr: new Set(), _foh: new Set() };
      map.set(m._id, e);
    }
    return e;
  };

  for (const r of roles) {
    // A special's leads, bgvs AND chorus all land in ONE `especial` bucket —
    // never split into sun/sat/coro, which would make those three segments
    // mean different things depending on service type (round-4 decision).
    if (r._type === "special_role") {
      for (const m of r.leads ?? [])   { get(m).especial++; }
      for (const m of r.bgvs ?? [])    { get(m).especial++; }
      for (const m of r.chorus ?? [])  { get(m).especial++; }
    } else {
      const isSun = r._type === "sunday_role";
      for (const m of r.leads ?? []) { const e = get(m); if (isSun) e.sunLead++; else e.satLead++; }
      for (const m of r.bgvs ?? [])  { const e = get(m); if (isSun) e.sunBGV++;  else e.satBGV++; }
      for (const m of r.chorus ?? []) { get(m).coro++; }
    }
    const wk = weekKey(r);
    for (const s of r.instruments ?? []) { if (s.person) get(s.person)._instr.add(wk); }
    for (const s of r.foh ?? [])         { if (s.person) get(s.person)._foh.add(wk); }
  }

  const out: MemberParticipation[] = [];
  for (const e of map.values()) {
    e.total = e.sunLead + e.satLead + e.sunBGV + e.satBGV + e.coro + e.especial;
    e.instrWeeks = e._instr.size;
    e.fohWeeks = e._foh.size;
    if (e.total > 0 || e.instrWeeks > 0 || e.fohWeeks > 0) {
      const { _instr, _foh, ...rest } = e;
      out.push(rest);
    }
  }
  return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
