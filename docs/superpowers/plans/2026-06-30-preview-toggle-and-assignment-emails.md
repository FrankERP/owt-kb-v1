# Preview View Toggle + Gated Assignment Emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only DayCard view toggle to the month-generation preview, and send Spanish assignment emails (gated to Frank only) when members are assigned to a service.

**Architecture:** Feature A is a pure transform helper + a segmented toggle in `MonthGenerator`. Feature B is three isolated modules — a Resend wrapper (`email.ts`), a content+gating layer (`assignmentEmail.ts`), and two one-line hooks beside the existing `sendPush` calls in the role API routes. Push notifications are untouched.

**Tech Stack:** Next.js (App Router), React, TypeScript, Sanity, Resend, Vitest.

## Global Constraints

- All user-facing copy is **Spanish** (matches the app).
- **Gating safety:** assignment emails send ONLY to allowlisted addresses. Default allowlist = `chikipuas@gmail.com` (env `EMAIL_ALLOWLIST`, comma-separated, lowercased). This is enforced in code regardless of Resend config.
- **Never break role creation:** all email work runs after the Sanity write, wrapped in try/catch, fire-and-forget (`void`). Failures only `console.error`.
- **Push untouched:** do not modify any `sendPush` call or `app/utils/push.ts`.
- **No real emails in tests:** the `resend` SDK and `email.ts` are mocked. Tests assert behavior, never send.
- Tests use **Vitest** (`npx vitest run <file>`); pure-logic tests live in `app/utils/__tests__/`.
- Follow existing patterns: member lookups via the `members` prop / `serverClient`; toggle styled like `app/components/CalendarView.tsx:79`.
- Free-tier only: no paid services; Resend free tier.

---

## Feature A — Preview view toggle

### Task 1: `draftToDayCardProps` pure helper

**Files:**
- Create: `app/utils/draftToDayCardProps.ts`
- Test: `app/utils/__tests__/draftToDayCardProps.test.ts`

**Interfaces:**
- Consumes: `DraftCard` and `MemberOption` shapes (mirrored locally to avoid importing the client component).
- Produces: `draftToDayCardProps(draft: DraftCardLike, members: MemberLike[]): DayCardData` where
  - `DayCardData = { day: "Domingo" | "Sábado"; date: string; leads: string[]; bgvs: {member_name:string; alias?:string}[]; chorus: {member_name:string; alias?:string}[]; instruments: {label:string; person:string}[]; fohTeam: {label:string; person:string}[] }`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/draftToDayCardProps.test.ts
import { describe, it, expect } from "vitest";
import { draftToDayCardProps } from "../draftToDayCardProps";

const members = [
  { _id: "m1", member_name: "Frank", alias: "Frankie" },
  { _id: "m2", member_name: "Gaby" },
  { _id: "m3", member_name: "Jakey" },
];

const baseDraft = {
  _type: "sunday_role" as const,
  date: "2026-07-05",
  leads: ["m1"],
  bgvs: ["m2", "m3"],
  chorus: ["m2"],
  instruments: [{ instrument: "Guitarra", personId: "m3" }],
  foh: [{ role: "Sonido", personId: "m1" }],
};

describe("draftToDayCardProps", () => {
  it("maps a Sunday draft's ids to DayCard names/objects", () => {
    const r = draftToDayCardProps(baseDraft, members);
    expect(r.day).toBe("Domingo");
    expect(r.date).toBe("2026-07-05");
    expect(r.leads).toEqual(["Frank"]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }, { member_name: "Jakey", alias: undefined }]);
    expect(r.chorus).toEqual([{ member_name: "Gaby", alias: undefined }]);
    expect(r.instruments).toEqual([{ label: "Guitarra", person: "Jakey" }]);
    expect(r.fohTeam).toEqual([{ label: "Sonido", person: "Frank" }]);
  });

  it("labels saturday_role as Sábado", () => {
    expect(draftToDayCardProps({ ...baseDraft, _type: "saturday_role" }, members).day).toBe("Sábado");
  });

  it("drops ids with no matching member without crashing", () => {
    const r = draftToDayCardProps({ ...baseDraft, leads: ["ghost"], bgvs: ["ghost", "m2"] }, members);
    expect(r.leads).toEqual([]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/utils/__tests__/draftToDayCardProps.test.ts`
Expected: FAIL — `Cannot find module '../draftToDayCardProps'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/draftToDayCardProps.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/utils/__tests__/draftToDayCardProps.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/draftToDayCardProps.ts app/utils/__tests__/draftToDayCardProps.test.ts
git commit -m "feat(month-gen): pure draft->DayCard transform helper"
```

---

### Task 2: Wire the view toggle into MonthGenerator

**Files:**
- Modify: `app/components/admin/MonthGenerator.tsx` (preview step ~lines 1408–1493)

**Interfaces:**
- Consumes: `draftToDayCardProps` (Task 1); existing `DayCard` (`app/components/DayCard.tsx`), `drafts`, `members`.
- Produces: nothing for other tasks (UI only).

> No unit test: this is UI wiring. The transform logic is covered by Task 1. Verify with TypeScript + visual check.

- [ ] **Step 1: Add imports near the top of `MonthGenerator.tsx`**

```ts
import { DayCard } from "@/app/components/DayCard";
import { draftToDayCardProps } from "@/app/utils/draftToDayCardProps";
```
`DayCard` is a **named** export (`app/components/DayCard.tsx:55`: `export function DayCard(...)`), matching the import style in `app/(client)/page.tsx:5`. Its props (all optional): `day, date, setlist, leads, instruments, fohTeam, bgvs, chorus, roleId, isNext` — the subset we pass (`day, date, leads, bgvs, chorus, instruments, fohTeam`) matches `DayCardProps` exactly (`DayCard.tsx:12-23`).

- [ ] **Step 2: Add view-mode state** beside the other preview state (near `const [swapSel, setSwapSel] = ...`)

```ts
const [viewMode, setViewMode] = useState<"edit" | "view">("edit");
```

- [ ] **Step 3: Add the segmented toggle** in the preview header (after the month-info/back-button row, before the notices). Use the CalendarView style:

```tsx
<div className="flex justify-center">
  <div className="flex rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 overflow-hidden">
    <button type="button" onClick={() => setViewMode("edit")}
      className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
        viewMode === "edit" ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]" : "text-gray-500 hover:text-[#C8D8EB]"}`}>
      Editar
    </button>
    <button type="button" onClick={() => setViewMode("view")}
      className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors border-l border-[#003572]/30 dark:border-[#00bfff]/20 ${
        viewMode === "view" ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]" : "text-gray-500 hover:text-[#C8D8EB]"}`}>
      Vista
    </button>
  </div>
</div>
```

- [ ] **Step 4: Conditionally render** the existing `DraftCardEditor` list vs the DayCard list. Wrap the current `<div className="space-y-2 ...">{drafts.map(d => <DraftCardEditor .../>)}</div>` so it shows only when `viewMode === "edit"`, and add the view branch:

```tsx
{viewMode === "edit" ? (
  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-0.5">
    {drafts.map(d => (
      <DraftCardEditor /* ...existing props unchanged... */ />
    ))}
  </div>
) : (
  <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-0.5">
    {drafts.filter(d => !d.skipped).map(d => {
      const p = draftToDayCardProps(d, members);
      return <DayCard key={d.localId} day={p.day} date={p.date} leads={p.leads}
                bgvs={p.bgvs} chorus={p.chorus} instruments={p.instruments} fohTeam={p.fohTeam} />;
    })}
  </div>
)}
```
(Match `DayCard`'s exact prop names from `app/components/DayCard.tsx:12-23`; adjust if any differ.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Visual verification**

Run the app (`/run` or `npm run dev`), open Generar Mes → Previsualizar, toggle Editar/Vista. Confirm: edit view unchanged; Vista shows DayCards with correct names; empty/short roles (from solver degradation) render fewer chips without error.

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/MonthGenerator.tsx
git commit -m "feat(month-gen): add Editar/Vista toggle (DayCard preview)"
```

---

## Feature B — Gated assignment emails

### Task 3: Resend wrapper `email.ts`

**Files:**
- Modify: `package.json` (add `resend`)
- Create: `app/utils/email.ts`
- Test: `app/utils/__tests__/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }>`. No-ops (`{ ok: false, error: "email disabled" }`) when `RESEND_API_KEY` or `EMAIL_FROM` is unset.

- [ ] **Step 1: Install Resend**

```bash
npm install resend
```

- [ ] **Step 2: Write the failing test**

```ts
// app/utils/__tests__/email.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

describe("sendEmail", () => {
  beforeEach(() => { sendMock.mockReset(); vi.resetModules(); });
  afterEach(() => { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; });

  it("no-ops when env is unset", async () => {
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends via Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Oasis <onboarding@resend.dev>";
    sendMock.mockResolvedValue({ data: { id: "1" }, error: null });
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledWith({ from: "Oasis <onboarding@resend.dev>", to: "a@b.com", subject: "s", html: "<p>h</p>" });
  });

  it("returns ok:false when Resend reports an error", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Oasis <onboarding@resend.dev>";
    sendMock.mockResolvedValue({ data: null, error: { message: "bad" } });
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/utils/__tests__/email.test.ts`
Expected: FAIL — `Cannot find module '../email'`.

- [ ] **Step 4: Write the implementation**

```ts
// app/utils/email.ts
import { Resend } from "resend";

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, error: "email disabled" };
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html });
    if (error) return { ok: false, error: String((error as { message?: string }).message ?? error) };
    return { ok: true };
  } catch (err) {
    console.error("[email] sendEmail failed:", err);
    return { ok: false, error: String(err) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/utils/__tests__/email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/utils/email.ts app/utils/__tests__/email.test.ts
git commit -m "feat(email): add Resend wrapper (no-op until configured)"
```

---

### Task 4: `assignmentEmail.ts` — content, role resolution, allowlist gating

**Files:**
- Create: `app/utils/assignmentEmail.ts`
- Test: `app/utils/__tests__/assignmentEmail.test.ts`

**Interfaces:**
- Consumes: `sendEmail` (Task 3); `serverClient` (`@/sanity/lib/serverClient`).
- Produces:
  - `rolesForMember(id: string, body: ServiceBody): string[]`
  - `buildAssignmentEmail(o: { name: string; roles: string[]; type: ServiceType; date: string }): { subject: string; html: string }`
  - `getAllowlist(): string[]` (reads env at call time)
  - `sendAssignmentEmails(memberIds: string[], service: { type: ServiceType; date: string; body: ServiceBody }): Promise<void>`
  - types `ServiceType = "sunday_role" | "saturday_role" | "special_role"`, `ServiceBody = { leads?: string[]; bgvs?: string[]; chorus?: string[]; instruments?: { instrument: string; personId: string }[]; foh?: { role: string; personId: string }[] }`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/assignmentEmail.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) } }));

import { rolesForMember, buildAssignmentEmail, sendAssignmentEmails } from "../assignmentEmail";

const body = {
  leads: ["m1"], bgvs: ["m2"], chorus: [],
  instruments: [{ instrument: "Guitarra", personId: "m1" }], foh: [],
};

describe("rolesForMember", () => {
  it("lists every role a member holds in the service", () => {
    expect(rolesForMember("m1", body)).toEqual(["Líder", "Guitarra"]);
    expect(rolesForMember("m2", body)).toEqual(["BGV"]);
    expect(rolesForMember("zzz", body)).toEqual([]);
  });
});

describe("buildAssignmentEmail", () => {
  it("builds a Spanish subject and body", () => {
    const e = buildAssignmentEmail({ name: "Frank", roles: ["Líder"], type: "sunday_role", date: "2026-07-05" });
    expect(e.subject).toContain("Domingo");
    expect(e.html).toContain("Frank");
    expect(e.html).toContain("Líder");
  });
});

describe("sendAssignmentEmails gating", () => {
  beforeEach(() => { sendEmailMock.mockReset(); fetchMock.mockReset(); process.env.EMAIL_ALLOWLIST = "frank@x.com"; });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  it("emails an allowlisted recipient", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "frank@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("frank@x.com");
  });

  it("does NOT email a non-allowlisted recipient", async () => {
    fetchMock.mockResolvedValue([{ _id: "m2", member_name: "Gaby", email: "gaby@x.com" }]);
    await sendAssignmentEmails(["m2"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips members with no email", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank" }]);
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/utils/__tests__/assignmentEmail.test.ts`
Expected: FAIL — `Cannot find module '../assignmentEmail'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/assignmentEmail.ts
import { serverClient } from "@/sanity/lib/serverClient";
import { sendEmail } from "./email";

export type ServiceType = "sunday_role" | "saturday_role" | "special_role";
export interface ServiceBody {
  leads?: string[]; bgvs?: string[]; chorus?: string[];
  instruments?: { instrument: string; personId: string }[];
  foh?: { role: string; personId: string }[];
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  sunday_role: "Domingo", saturday_role: "Sábado", special_role: "Servicio especial",
};

export function getAllowlist(): string[] {
  return (process.env.EMAIL_ALLOWLIST ?? "chikipuas@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function rolesForMember(id: string, b: ServiceBody): string[] {
  const roles: string[] = [];
  if ((b.leads ?? []).includes(id)) roles.push("Líder");
  if ((b.bgvs ?? []).includes(id)) roles.push("BGV");
  if ((b.chorus ?? []).includes(id)) roles.push("Coro");
  for (const i of b.instruments ?? []) if (i.personId === id) roles.push(i.instrument);
  for (const f of b.foh ?? []) if (f.personId === id) roles.push(f.role);
  return roles;
}

export function buildAssignmentEmail(o: { name: string; roles: string[]; type: ServiceType; date: string }): { subject: string; html: string } {
  const svc = SERVICE_LABEL[o.type];
  const dateFmt = new Date(o.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const rolesText = o.roles.length ? o.roles.join(", ") : "el equipo";
  const link = `${process.env.NEXTAUTH_URL ?? ""}/me`;
  const subject = `Asignación — ${svc} ${dateFmt}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0b1f33">
      <h2 style="color:#003572">Nueva asignación</h2>
      <p>Hola ${o.name || "equipo"},</p>
      <p>Estás asignado como <strong>${rolesText}</strong> el <strong>${svc} ${dateFmt}</strong>.</p>
      <p><a href="${link}" style="display:inline-block;background:#003572;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Ver servicio →</a></p>
      <p style="color:#6b7280;font-size:12px">Oasis Worship Team</p>
    </div>`.trim();
  return { subject, html };
}

export async function sendAssignmentEmails(
  memberIds: string[],
  service: { type: ServiceType; date: string; body: ServiceBody },
): Promise<void> {
  try {
    const ids = [...new Set(memberIds)].filter(Boolean);
    if (!ids.length) return;
    const allow = getAllowlist();
    const members = await serverClient.fetch<{ _id: string; member_name?: string; alias?: string; email?: string }[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, member_name, alias, email }`,
      { ids },
    );
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (!email || !allow.includes(email)) continue;
      const roles = rolesForMember(m._id, service.body);
      const { subject, html } = buildAssignmentEmail({ name: m.alias || m.member_name || "", roles, type: service.type, date: service.date });
      const res = await sendEmail({ to: email, subject, html });
      if (!res.ok) console.error(`[assignmentEmail] send failed for ${m._id}:`, res.error);
    }
  } catch (err) {
    console.error("[assignmentEmail] sendAssignmentEmails failed:", err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/utils/__tests__/assignmentEmail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/assignmentEmail.ts app/utils/__tests__/assignmentEmail.test.ts
git commit -m "feat(email): assignment email content + allowlist gating"
```

---

### Task 5: Hook emails into the role API routes

**Files:**
- Modify: `app/api/admin/roles/route.ts` (POST, after the `sendPush` block ~line 116-120)
- Modify: `app/api/admin/roles/[id]/route.ts` (PATCH, after the `sendPush` block ~line 88-92)

**Interfaces:**
- Consumes: `sendAssignmentEmails` (Task 4); existing `allAssignees(body)`, `added`, `body`.

> No new unit test: the logic is tested in Task 4; this wires it in. Verified by typecheck. (The routes have no existing route-level tests.)
>
> **Fire-and-forget note:** `void sendAssignmentEmails(...)` intentionally mirrors the existing `void sendPush(...)` in the same routes — same serverless caveat (work after the response relies on the runtime not freezing the function mid-flight). We match the established pattern for consistency; if push proves unreliable in production, switch BOTH to `next/server`'s `after()` in one change. Do not block the HTTP response on email.

- [ ] **Step 1: POST route — add the import**

```ts
import { sendAssignmentEmails } from "@/app/utils/assignmentEmail";
```

- [ ] **Step 2: POST route — add the call** immediately after the existing `void sendPush(added, "assignments", { ... });`

```ts
void sendAssignmentEmails(added, { type: body._type, date: body.date, body });
```

- [ ] **Step 3: PATCH route — add the same import**

```ts
import { sendAssignmentEmails } from "@/app/utils/assignmentEmail";
```

- [ ] **Step 4: PATCH route — add the call** immediately after the existing `void sendPush(added, "assignments", { ... });`

```ts
void sendAssignmentEmails(added, { type: body._type, date: body.date, body });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/roles/route.ts app/api/admin/roles/[id]/route.ts
git commit -m "feat(email): send assignment emails on role create/update (gated)"
```

---

### Task 6: Add `notifPrefs.email` schema field (forward-looking, no UI)

**Files:**
- Modify: `sanity/schemas/worshipTeam.ts` (the `notifPrefs` object's `fields` array)

> No automated test (Sanity schema). Validated by `tsc` + Studio deploy.

- [ ] **Step 1: Add the field** to the `notifPrefs` object's `fields`, after the `assignments` field:

```ts
{
  name: "email",
  title: "Asignaciones por correo",
  type: "boolean",
  initialValue: false,
  description: "Recibir asignaciones por correo electrónico (próximamente).",
},
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemas/worshipTeam.ts
git commit -m "feat(schema): add notifPrefs.email field (reserved, no UI)"
```

- [ ] **Step 4: Deploy the Studio schema** (manual, per the project's deploy-schema skill) — note for the operator; not part of the code build.

---

### Task 7: Document required environment variables

**Files:**
- Modify: `.env.local` (local) and Vercel project env (manual)
- Modify/Create: `.env.example` if present, else add a note block to the plan's handoff

- [ ] **Step 1: Add to `.env.local`** (and Vercel → Production):

```
RESEND_API_KEY=re_xxx                     # from resend.com (free account)
EMAIL_FROM=Oasis Worship <onboarding@resend.dev>   # later: equipo@send.oasis.mx
# EMAIL_ALLOWLIST=chikipuas@gmail.com      # optional; default is this value
```

- [ ] **Step 2: Verify** the app boots with these unset (email no-ops) and with them set (sends to Frank). No commit needed for `.env.local` (gitignored); record the values in the team's secret store.

---

## Final verification (run once all tasks complete)

- [ ] `npx vitest run` — entire suite green (existing + new).
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] Manual: generate a month with yourself assigned → confirm exactly one email arrives at `chikipuas@gmail.com`; assign a non-allowlisted member → confirm no email to them.
- [ ] Manual: Editar/Vista toggle works and DayCards render.

## Out of scope (do not build)
- Notification-preferences UI (email/push/both) — future spec.
- Emailing anyone but Frank this phase.
- Reminder/digest/setlist emails.
- Any change to push behavior.
