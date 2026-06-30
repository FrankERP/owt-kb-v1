# Participation sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only left sidebar in the admin Servicios panel showing per-member participation (voz appearances per service; instruments/FOH per week) over the currently month-filtered services, updating live.

**Architecture:** A pure, unit-tested helper `computeParticipation(roles)` produces per-member metrics; a presentational `ParticipationSidebar` component renders them; `ServicesPanel` wraps its content in a two-column grid and passes its already-filtered `visible` roles + a month label.

**Tech Stack:** React, TypeScript, Vitest, Tailwind.

## Global Constraints

- **Voz appearances are per-service:** `sunLead`/`satLead` (Lead on Sunday/Saturday), `sunBGV`/`satBGV`, `coro` (chorus on ANY Sunday or Saturday service). `total = sunLead+satLead+sunBGV+satBGV+coro`.
- **Instruments/FOH are per-week:** distinct `weekKey`. **`weekKey(role) = role._type === "saturday_role" ? plusOneDay(role.date) : role.date`** (Saturday is stored one day BEFORE its Sunday — verified — so normalize to the Sunday). `plusOneDay` parses `YYYY-MM-DD` at `T12:00:00` to avoid DST drift.
- **`special_role` is excluded entirely** (voz, chorus, instruments, FOH).
- **Null guard:** `instruments[].person` / `foh[].person` can be `null` — skip without throwing.
- Names: `alias?.trim() || member_name`, read from the role-embedded member objects (no separate `members` param).
- Only members with any participation are returned, sorted by `total` desc then name.
- **Drafts ARE counted** (the filtered list includes unpublished services — intended for planning).
- Read-only: no mutations, no API calls.
- Tests = Vitest (`npx vitest run <file>`); `npx tsc --noEmit` stays at 0 errors. Spanish UI copy. Match the panel's cyan/blue theme; role colors Líder=blue `#378ADD`, BGV=teal `#1D9E75`, Coro=purple `#7F77DD`, Instr=amber `#BA7517`, FOH=gray `#888780`.

---

### Task 1: `computeParticipation` pure helper

**Files:**
- Create: `app/utils/computeParticipation.ts`
- Test: `app/utils/__tests__/computeParticipation.test.ts`

**Interfaces:**
- Produces: `computeParticipation(roles: ParticipantRole[]): MemberParticipation[]` and the exported types below.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/computeParticipation.test.ts
import { describe, it, expect } from "vitest";
import { computeParticipation } from "../computeParticipation";

const M = (id: string, alias?: string) => ({ _id: id, member_name: id, alias });
const sun = (over: Record<string, unknown> = {}) =>
  ({ _type: "sunday_role" as const, date: "2026-07-26", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });
const sat = (over: Record<string, unknown> = {}) =>
  ({ _type: "saturday_role" as const, date: "2026-07-25", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });

describe("computeParticipation", () => {
  it("routes voz appearances to Sun/Sat columns and totals them", () => {
    const r = computeParticipation([
      sun({ leads: [M("a")], bgvs: [M("b")], chorus: [M("c")] }),
      sat({ leads: [M("a")], bgvs: [M("b")] }),
    ]);
    const a = r.find(x => x.id === "a")!;
    expect(a).toMatchObject({ sunLead: 1, satLead: 1, sunBGV: 0, satBGV: 0, coro: 0, total: 2 });
    expect(r.find(x => x.id === "b")).toMatchObject({ sunBGV: 1, satBGV: 1, total: 2 });
    expect(r.find(x => x.id === "c")).toMatchObject({ coro: 1, total: 1 });
  });

  it("counts an instrument on the Sat AND Sun of one weekend as instrWeeks: 1", () => {
    const r = computeParticipation([
      sat({ instruments: [{ person: M("a") }] }),   // 2026-07-25 -> normalizes to 07-26
      sun({ instruments: [{ person: M("a") }] }),   // 2026-07-26
    ]);
    expect(r.find(x => x.id === "a")).toMatchObject({ instrWeeks: 1, total: 0 });
  });

  it("counts instruments on two different weekends as instrWeeks: 2", () => {
    const r = computeParticipation([
      sun({ date: "2026-07-26", instruments: [{ person: M("a") }] }),
      sun({ date: "2026-07-19", instruments: [{ person: M("a") }] }),
    ]);
    expect(r.find(x => x.id === "a")!.instrWeeks).toBe(2);
  });

  it("skips a null instrument/FOH person without throwing", () => {
    const r = computeParticipation([sun({ instruments: [{ person: null }], foh: [{ person: null }] })]);
    expect(r).toEqual([]);
  });

  it("counts chorus on a saturday_role and ignores special_role entirely", () => {
    const r = computeParticipation([
      sat({ chorus: [M("a")] }),
      { _type: "special_role", date: "2026-07-20", leads: [M("a")], bgvs: [], chorus: [M("a")], instruments: [], foh: [] },
    ]);
    expect(r.find(x => x.id === "a")).toMatchObject({ coro: 1, total: 1 }); // special contributes nothing
  });

  it("omits zero-participation members and sorts by total desc", () => {
    const r = computeParticipation([sun({ leads: [M("a"), M("b")], bgvs: [M("b")] })]);
    expect(r.map(x => x.id)).toEqual(["b", "a"]); // b total 2, a total 1
  });

  it("resolves name from alias when present", () => {
    const r = computeParticipation([sun({ leads: [M("a", "Frankie")] })]);
    expect(r[0].name).toBe("Frankie");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/utils/__tests__/computeParticipation.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// app/utils/computeParticipation.ts
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
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run app/utils/__tests__/computeParticipation.test.ts` → PASS (7).

- [ ] **Step 5: Commit**

```bash
git add app/utils/computeParticipation.ts app/utils/__tests__/computeParticipation.test.ts
git commit -m "feat(participation): pure per-member participation aggregator"
```

---

### Task 2: `ParticipationSidebar` component

**Files:**
- Create: `app/components/admin/ParticipationSidebar.tsx`

**Interfaces:**
- Consumes: `computeParticipation` + `ParticipantRole` (Task 1).
- Produces: `export function ParticipationSidebar({ roles, monthLabel }: { roles: ParticipantRole[]; monthLabel: string })`.

> UI task. Gate: `npx tsc --noEmit` = 0 errors (logic tested in Task 1).

- [ ] **Step 1: Implement the component**

```tsx
// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useMemo, useState } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";

const COLORS = { lead: "#378ADD", bgv: "#1D9E75", coro: "#7F77DD", instr: "#BA7517", foh: "#888780" };
type SortKey = "total" | "sunLead" | "satLead" | "sunBGV" | "satBGV" | "coro";

export function ParticipationSidebar({ roles, monthLabel }: { roles: ParticipantRole[]; monthLabel: string }) {
  const [sort, setSort] = useState<SortKey>("total");
  const rows = useMemo(() => {
    const data = computeParticipation(roles);
    return [...data].sort((a, b) => (b[sort] as number) - (a[sort] as number) || a.name.localeCompare(b.name));
  }, [roles, sort]);
  const maxTotal = Math.max(1, ...rows.map(r => r.total));

  return (
    <aside className="rounded-xl border border-[#00bfff]/20 bg-[#C8D8EB]/40 dark:bg-[#010b17] p-3 lg:sticky lg:top-4 self-start">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="font-label text-xs uppercase tracking-widest text-[#003572] dark:text-[#00bfff]">Participaciones</p>
          <p className="text-[11px] text-gray-500">{monthLabel}</p>
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
          className="text-xs bg-transparent border border-[#00bfff]/20 rounded-lg px-2 py-1">
          <option value="total">Total</option>
          <option value="sunLead">Líder dom</option>
          <option value="satLead">Líder sáb</option>
          <option value="sunBGV">BGV dom</option>
          <option value="satBGV">BGV sáb</option>
          <option value="coro">Coro</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-[#00bfff]/15 mb-1">
        {([["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro], ["Instr", COLORS.instr], ["FOH", COLORS.foh]] as const).map(([l, c]) => (
          <span key={l} className="text-[11px] text-gray-500 inline-flex items-center gap-1">
            <i style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
      </div>

      {rows.length === 0 && <p className="text-xs text-gray-500 py-3 text-center">Sin participaciones en este filtro.</p>}

      <div className="space-y-0 max-h-[60vh] overflow-y-auto pr-0.5">
        {rows.map(r => <Row key={r.id} r={r} maxTotal={maxTotal} />)}
      </div>
    </aside>
  );
}

function Row({ r, maxTotal }: { r: MemberParticipation; maxTotal: number }) {
  const barW = Math.round((r.total / maxTotal) * 150);
  const u = r.total > 0 ? barW / r.total : 0;
  const seg = (n: number, c: string) => n > 0
    ? <span style={{ display: "inline-block", height: 8, width: Math.round(n * u), background: c }} /> : null;
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-[#00bfff]/10">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#003572] dark:text-[#C8D8EB] truncate">{r.name}</div>
        <div className="text-[11px] text-gray-500">
          L {r.sunLead}·{r.satLead}  B {r.sunBGV}·{r.satBGV}  C {r.coro}
          {(r.instrWeeks > 0 || r.fohWeeks > 0) && <>  ·  Instr {r.instrWeeks} · FOH {r.fohWeeks}</>}
        </div>
        <div className="mt-1 rounded overflow-hidden flex" style={{ width: 150, background: "rgba(0,191,255,0.08)" }}>
          {seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}
        </div>
      </div>
      <div className="text-xl font-medium text-[#003572] dark:text-[#C8D8EB] min-w-[24px] text-right">{r.total}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/ParticipationSidebar.tsx
git commit -m "feat(participation): ParticipationSidebar component (sortable, segmented bar)"
```

---

### Task 3: Wire the sidebar into ServicesPanel

**Files:**
- Modify: `app/components/admin/ServicesPanel.tsx`

> UI/integration. Gate: `npx tsc --noEmit` = 0 + visual check. The `ServiceRole` type in this file is structurally compatible with `ParticipantRole` (it has `_type`, `date`, `leads`/`bgvs`/`chorus` as member objects, `instruments`/`foh` with nullable `person`); pass `visible` directly.

- [ ] **Step 1: Import**

```ts
import { ParticipationSidebar } from "@/app/components/admin/ParticipationSidebar";
```

- [ ] **Step 2: Derive `monthLabel`** near where `visible` is computed (~line 1064). `selectedMonths` is a `Set<string>` of `YYYY-MM`; reuse the existing month formatter (`fmtYM`):

```ts
const monthLabel =
  selectedMonths.size === 0 ? "Próximos"
  : selectedMonths.size === 1 ? fmtYM([...selectedMonths][0])
  : `${selectedMonths.size} meses`;
```
(If a helper named `fmtYM` doesn't exist, format the single `YYYY-MM` with `new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" })`.)

- [ ] **Step 3: Two-column layout.** Wrap the existing cards grid (`<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 …">…</div>`, ~line 1226) and the sidebar in an outer grid, sidebar first (left). Cap the inner card columns for readability:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
  <ParticipationSidebar roles={visible} monthLabel={monthLabel} />
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
    {/* existing card .map(...) unchanged */}
  </div>
</div>
```
Keep the card `.map(...)` body exactly as-is; only the wrapping grid and the inner grid's column classes change. On screens below `lg`, the outer grid is single-column so the sidebar stacks above the cards.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → 0 errors. If the panel's `ServiceRole` isn't assignable to `ParticipantRole`, pass `roles={visible as ParticipantRole[]}` (structurally compatible) or align the field optionality — do NOT change `computeParticipation`'s types.

- [ ] **Step 5: Visual check.** Run the app → Servicios: sidebar shows on the left (lg+), totals match the visible services, changing the month filter updates it, creating/publishing/swapping a service updates it live, an instrumentalist on Sat+Sun of one week shows `Instr 1`, sort options reorder rows. Below lg, sidebar stacks on top; the card grid still looks right.

- [ ] **Step 6: Commit**

```bash
git add app/components/admin/ServicesPanel.tsx
git commit -m "feat(participation): wire sidebar into ServicesPanel (two-column, month label)"
```

---

## Final verification
- [ ] `npx vitest run` — whole suite green (existing + computeParticipation).
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] Manual: the checks in Task 3 Step 5.

## Out of scope
- Editing from the sidebar (read-only). Historical/all-time totals. `special_role`. Fairness scoring. Mobile redesign beyond column-stacking.
