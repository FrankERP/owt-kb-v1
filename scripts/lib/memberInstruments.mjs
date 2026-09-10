// Pure half of scripts/backfill-member-instruments.mjs (spec 2026-09-09 §5).
// A .mjs script cannot import the TS seat model, so the vocabulary and the
// normalizer are MIRRORED here; scripts/lib/__tests__/memberInstruments.test.mjs
// pins them to app/components/admin/seatModel.ts.

export const INSTRUMENT_SEATS = ["Bass", "Keys", "Drums", "EG", "AG"];

const CANONICAL = new Map([
  ["bass", "Bass"], ["keys", "Keys"], ["drums", "Drums"], ["eg", "EG"], ["ag", "AG"], ["console", "Console"],
]);

export function normalizeSeatName(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return CANONICAL.get(trimmed.toLowerCase()) ?? trimmed;
}

/**
 * members: [{ _id, member_name, memberType?, instruments? }]
 * roles:   [{ instruments?: [{ instrument, person?: { _ref } | null }] }]
 */
export function proposeInstruments(members, roles) {
  const evidenceById = new Map(); // id -> Map(label -> count)
  const unknownCounts = new Map();
  for (const r of roles) {
    for (const slot of r.instruments ?? []) {
      const ref = slot?.person?._ref;
      if (!ref) continue;
      const label = normalizeSeatName(slot.instrument);
      if (!label) continue;
      if (!INSTRUMENT_SEATS.includes(label)) {
        unknownCounts.set(label, (unknownCounts.get(label) ?? 0) + 1);
        continue;
      }
      let m = evidenceById.get(ref);
      if (!m) evidenceById.set(ref, (m = new Map()));
      m.set(label, (m.get(label) ?? 0) + 1);
    }
  }

  const proposals = [];
  const noTipo = [];
  for (const member of members) {
    const evidence = evidenceById.get(member._id);
    const seen = evidence ? INSTRUMENT_SEATS.filter((s) => evidence.has(s)) : [];
    const hasTipo = (member.memberType ?? []).includes("instrumento");
    if (!hasTipo) {
      if (seen.length) noTipo.push({ id: member._id, name: member.member_name, seen });
      continue;
    }
    const stored = Array.isArray(member.instruments) ? member.instruments : undefined;
    const action = stored !== undefined ? "skip-stored" : seen.length === 0 ? "skip-no-history" : "write";
    proposals.push({
      id: member._id,
      name: member.member_name,
      proposed: seen,
      evidence: Object.fromEntries(seen.map((s) => [s, evidence.get(s)])),
      stored,
      action,
    });
  }
  const unrecognised = [...unknownCounts].map(([label, count]) => ({ label, count }));
  return { proposals, noTipo, unrecognised };
}
