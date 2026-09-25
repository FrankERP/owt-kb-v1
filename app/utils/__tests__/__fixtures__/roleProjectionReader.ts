// A literal reading of a GROQ projection text such as `ROLE_PROJECTION`, for
// tests that must see the row the READ returns — the read's real nulls
// (`date: null` on a weekend role, `service_name: null`) rather than the
// writer's absent keys.
//
// It supports exactly the terms `ROLE_PROJECTION` uses — `field`, `field{…}` and
// `field[]{…}` — and throws on anything else, so a projection change this reader
// cannot follow fails loudly instead of projecting the wrong shape.
//
// Shared by `solverHistoryEquivalence.test.ts` (R12) and
// `solverHistoryEvidence.test.ts` (R11's positive control). Not a `*.test.ts`,
// so vitest does not collect it; `tsc` still types it.

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Project `value` through `projection`, as the Content Lake would. */
export function projectRow(value: unknown, projection: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inner = projection.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, unknown> = {};
  for (const term of splitTopLevel(inner)) {
    const m = /^(\w+)(\[\])?\s*(\{[\s\S]*\})?$/.exec(term);
    if (!m) throw new Error(`unsupported projection term: ${term}`);
    const [, field, isArray, sub] = m;
    const v = (value as Record<string, unknown>)[field];
    if (!sub) out[field] = v ?? null;
    else if (isArray) out[field] = Array.isArray(v) ? v.map((item) => projectRow(item, sub)) : null;
    else out[field] = projectRow(v, sub);
  }
  return out;
}
