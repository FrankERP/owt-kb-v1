// app/utils/fairnessFormat.ts
//
// THE fairness-figure formatter (solver v3 C2 IF2-13, LG-13, UI-4; parent A17). One
// decimal, written from a TENTHS figure that the ledger computed once from the exact
// value — never from hundredths, which would round twice (exact 0.249 → 0.25 → «0.3»,
// where the exact value says «0.2»). Neutral and client-callable; the panel, C4's table
// and C6's U5 columns all format through these two functions.
// `fairnessFormat.test.ts` sweeps app/** for code that derives tenths from hundredths.

/** 8 → "0.8", -13 → "-1.3", 0 → "0.0" — es-MX writes the decimal point. */
export function formatFairnessTenths(tenths: number): string {
  const whole = Math.trunc(tenths);
  const abs = Math.abs(whole);
  return `${whole < 0 ? "-" : ""}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** The saldo in words (§8): «le deben 0.8» · «0.3 de más» · «al día» when its tenths are 0. */
export function saldoWords(balanceTenths: number): string {
  if (balanceTenths === 0) return "al día";
  return balanceTenths > 0
    ? `le deben ${formatFairnessTenths(balanceTenths)}`
    : `${formatFairnessTenths(-balanceTenths)} de más`;
}
