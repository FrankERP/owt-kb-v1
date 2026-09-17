"use client";

// The Miembros tab — the member list, its filters, its modals and every member
// write. Extracted from `AdminPanel` in R5 Task 3: the body used to be a VALUE
// built on every render of every tab (wrapping it in a function turned
// `react-hooks/refs` into an error at `handlePhotoClick`), and a component is
// the shape that actually pays — it renders only on this tab, and Task 6 mounts
// it behind `next/dynamic`.
//
// Row actions are ONE `Menu` (R5 ruling 6): the hover-only icon strip is gone,
// touch gets the same affordance, and the kill switch asks before it fires
// (decision O).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";
import Button from "../ui/Button";
import Menu, { MenuItem, MenuSeparator } from "../ui/Menu";
import Skeleton, { SkeletonGroup } from "../ui/Skeleton";
import Select from "@/app/components/ui/Select";
import EmailPrefToggles, { resolveEmailPrefs, type EmailPrefValues } from "../ui/EmailPrefToggles";
import { useToast } from "../ui/Toast";
import SegmentedControl from "../ui/SegmentedControl";
import {
  ALL_MINISTRY_IDS,
  MANAGEABLE_MINISTRY_IDS,
  MINISTRIES,
  normalizeMinistries,
  type MinistryId,
} from "@/app/ministries";
import { interpretMemberDeleteResponse } from "@/app/utils/memberDelete";
import { DEFAULT_INSTRUMENT_SEATS } from "./seatModel";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

interface Member {
  _id: string;
  member_name: string;
  alias?: string;
  email: string;
  role: OWTRole;
  memberType?: string[];
  /** Declared instrument seats; absent or empty = declares nothing (spec D6). */
  instruments?: string[];
  hasPassword: boolean;
  photoUrl?: string;
  notifPrefs?: Record<string, unknown>;
  /** Absent on every member predating Oasis Kids — read it through
   *  `normalizeMinistries`, never raw (see `MemberForm`). */
  ministries?: string[];
  managesMinistries?: string[];
  /** Stored as-is — absent means enabled (same contract as `isMemberActive`). */
  disabled?: boolean;
}

interface MemberFormData {
  member_name: string;
  alias: string;
  email: string;
  role: OWTRole;
  memberType: string[];
  /**
   * Present on EDIT only when the admin touched the Instrumentos grid, and on
   * CREATE only when touched and non-empty — the same touched-field discipline
   * as `ministries`, so editing an email never writes `[]` over an untouched
   * field and a new member is not frozen at `[]` for the backfill (spec §4.4).
   */
  instruments?: string[];
  /**
   * Only the per-type email toggles the admin actually touched this editing
   * session, sent flat to PATCH. Absent (or empty) when adding, or when
   * editing without touching a switch — an untouched form must write NOTHING
   * here, or it silently restores whatever the member has since opted out of
   * (the admin's member list can be stale relative to the member's own edits).
   */
  emailPrefs?: Partial<EmailPrefValues>;
  /**
   * Present when CREATING (there is no stored value to clobber), and when
   * editing only if the admin actually touched that row — same rule, and same
   * reason, as `emailPrefs` above.
   */
  ministries?: string[];
  managesMinistries?: string[];
}

// The table's own abbreviations — deliberately not `MEMBER_TYPE_LABEL`'s full
// words (`app/utils/memberTypes.ts`): this is a dense list, not the member's
// own profile, where there is room to spell "Líder Domingo" out.
const TYPE_ABBR: Record<string, string> = {
  voz: "Voz", instrumento: "Instr.", foh: "FOH",
  sunday_lead: "Líder Dom", saturday_lead: "Líder Sáb", support: "Soporte",
};

type FilterKey = "type" | "role";
type SortDir  = "asc" | "desc";

/** Which ministry's people the Miembros list is showing. */
export type MinistryScope = MinistryId | "all";

const MINISTRY_SCOPES: MinistryScope[] = [...ALL_MINISTRY_IDS, "all"];

const MINISTRY_SCOPE_LABEL = (s: MinistryScope) => (s === "all" ? "Todos" : MINISTRIES[s].name);

/** The name the list shows for a member: the alias when there is one. */
const displayName = (m: Member) => m.alias?.trim() || m.member_name;

/**
 * Per-ministry counts, whether the control is worth showing, and the scoped
 * list — ONE derivation, read by both the control and the list, so the panel
 * can never filter by a control the admin cannot see.
 *
 * `super-admin` is the only role whose `GET /api/admin/members` is unfiltered
 * (they alone can edit `ministries`, so hiding a Kids-only member would leave
 * them uneditable — see `WORSHIP_MEMBER_GROQ_FILTER`). Everyone else receives
 * worship members only, where a ministry chooser is pure noise; `visible`
 * therefore comes from the DATA, not the role.
 *
 * Membership goes through `normalizeMinistries`: an absent `ministries` means
 * worship, which is every member predating Oasis Kids. Testing the raw array
 * would empty the default view.
 *
 * When the control is hidden the scope is NOT applied — a single-ministry list
 * would otherwise be filtered to nothing by a default the admin cannot change.
 */
export function resolveMinistryScope<T extends { ministries?: string[] }>(
  members: T[],
  scope: MinistryScope,
): { counts: Record<MinistryId, number>; visible: boolean; scoped: T[] } {
  const counts = Object.fromEntries(ALL_MINISTRY_IDS.map((id) => [id, 0])) as Record<MinistryId, number>;
  for (const m of members) {
    for (const id of normalizeMinistries(m.ministries)) counts[id] += 1;
  }
  const visible = ALL_MINISTRY_IDS.filter((id) => counts[id] > 0).length > 1;
  const scoped = visible && scope !== "all"
    ? members.filter((m) => normalizeMinistries(m.ministries).includes(scope))
    : members;
  return { counts, visible, scoped };
}

export function MinistryScopeBar({
  counts,
  total,
  visible,
  value,
  onChange,
}: {
  counts: Record<MinistryId, number>;
  total: number;
  visible: boolean;
  value: MinistryScope;
  onChange: (next: MinistryScope) => void;
}) {
  if (!visible) return null;
  return (
    <SegmentedControl
      label="Ministerio"
      tone="filled"
      // brand-search-console deliberately wins over the primitive's filled chrome
      // so the control matches the search input beside it.
      className="brand-search-console self-start"
      value={value}
      onChange={onChange}
      options={MINISTRY_SCOPES.map((s) => ({
        value: s,
        label: (
          <>
            {MINISTRY_SCOPE_LABEL(s)}
            <span className="ml-1.5 opacity-60">{s === "all" ? total : counts[s]}</span>
          </>
        ),
      }))}
    />
  );
}

/**
 * Which member dialog the panel is showing. The KIND and its member are held
 * apart from the open flag on purpose: `CueDialog` stays mounted for the whole
 * exit animation, so a body read out of a state that closing sets to `null`
 * blanks itself on the way out — the admin watches the member's name vanish
 * before the sheet does. Closing flips `modalOpen` only; the next open
 * overwrites the payload.
 */
type ModalKind = "add" | "edit" | "password" | "delete";

const ROLES: { value: OWTRole; label: string }[] = [
  { value: "super-admin", label: "Super Admin" },
  { value: "admin",       label: "Admin" },
  { value: "content-editor", label: "Content Editor" },
  { value: "member",      label: "Miembro" },
];

const ROLE_BADGE: Record<OWTRole, string> = {
  "super-admin":    "bg-accent/15 text-accent border border-accent/30",
  "admin":          "bg-badge-azure-deep/15 text-badge-azure-fg border border-badge-azure-deep/30",
  "content-editor": "bg-badge-violet-deep/15 text-badge-violet-fg border border-badge-violet-deep/30",
  "member":         "bg-mono-500/15 text-mono-400 border border-mono-500/30",
};

const ROLE_LABEL: Record<OWTRole, string> = {
  "super-admin":    "Super Admin",
  "admin":          "Admin",
  "content-editor": "Editor",
  "member":         "Miembro",
};

// ─── Shared input style ────────────────────────────────────────────────────────
// 16px on the phone: anything smaller makes iOS Safari zoom the page on focus.
// `inputFontSize.test.ts` excludes `admin/` by path, so this is the convention
// holding rather than the guard.
const inputCls =
  "brand-search-console w-full px-3 py-2.5 bg-transparent font-body text-[16px] sm:text-sm focus:outline-none transition-colors";

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({
  name,
  photoUrl,
  onClick,
  uploading,
}: {
  name: string;
  photoUrl?: string;
  onClick?: () => void;
  uploading?: boolean;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const inner = (
    <>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-surface-accent-l100-d10 text-on-fill flex items-center justify-center">
          <span className="font-label text-xs text-accent">{initials}</span>
        </div>
      )}
      {onClick && (
        <div className="absolute inset-0 bg-scrim/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity rounded-full">
          {uploading ? (
            <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Cambiar foto"
        className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 group/avatar cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0">
      {inner}
    </div>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────
// ALWAYS MOUNTED, visibility driven by the `open` prop — never a BARE `open`
// attribute behind a conditional, which gets no enter/exit and which
// `cueDialogMount.test.ts` counts (in source, so that guard reads comments too:
// do not spell the anti-pattern out here). Each of the four member dialogs
// passes its own `modalOpen && modalKind === …`; the BODY is drawn from state
// that OUTLIVES the close, so nothing blanks during the exit, and it is keyed on
// `modalSeq` so a reopen still starts from a fresh form.
function Modal({
  open,
  title,
  onClose,
  status,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <CueDialog open={open} title={title} label={title} mode="sheet" size="sm" onDismiss={onClose}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        {status && <CueDialogStatus tone="error">{status}</CueDialogStatus>}
        {children}
      </div>
    </CueDialog>
  );
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────
const MEMBER_TYPES: { value: string; label: string }[] = [
  { value: "voz",           label: "Voz" },
  { value: "instrumento",   label: "Instrumento" },
  { value: "foh",           label: "FOH" },
  { value: "sunday_lead",   label: "Líder Dom" },
  { value: "saturday_lead", label: "Líder Sáb" },
  { value: "support",       label: "Soporte" },
];

export function MemberForm({
  initial,
  onSubmit,
  onClose,
  loading,
}: {
  initial?: Partial<Member>;
  onSubmit: (data: MemberFormData) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName]             = useState(initial?.member_name ?? "");
  const [alias, setAlias]           = useState(initial?.alias ?? "");
  const [email, setEmail]           = useState(initial?.email ?? "");
  const [role, setRole]             = useState<OWTRole>(initial?.role ?? "member");
  const [memberType, setMemberType] = useState<string[]>(initial?.memberType ?? []);
  // Kept even while `instrumento` is unticked, so re-ticking restores it.
  const [instruments, setInstruments] = useState<string[]>(initial?.instruments ?? []);
  const [touchedInstruments, setTouchedInstruments] = useState(false);
  const toggleInstrument = (value: string) => {
    setInstruments(prev => prev.includes(value) ? prev.filter(i => i !== value) : [...prev, value]);
    setTouchedInstruments(true);
  };
  // RESOLVED per-type values, not the raw fields: a member who opted out of the
  // legacy `notifPrefs.email` has all five unset, and unset renders as its `true`
  // default — five switches ON for someone receiving nothing. This is what
  // renders the switches; it is NOT what gets submitted (see `touchedPrefFields`
  // below) — an admin's stale snapshot of this must never overwrite a
  // preference the member changed after the admin's member list was fetched.
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefValues>(() => resolveEmailPrefs(initial?.notifPrefs));
  // Only the switches the admin actually clicked THIS session. A save that
  // never touches this section must PATCH none of the five fields, so the
  // route leaves whatever the member has since set alone.
  const [touchedPrefFields, setTouchedPrefFields] = useState<ReadonlySet<keyof EmailPrefValues>>(() => new Set());
  // SEEDED THROUGH THE SHARED NORMALIZER, never `initial?.ministries ?? []`.
  // The field is absent on every member predating Oasis Kids, so a raw seed
  // would draw both boxes unticked for a full worship member — and the intended
  // workflow (open a singer, tick "Oasis Kids", save) would then submit
  // `["kids"]` and silently revoke their access to the whole worship app. The
  // same call supplies the CREATE default, `["worship"]`.
  const [ministries, setMinistries] = useState<string[]>(() => normalizeMinistries(initial?.ministries));
  // Raw, because absent genuinely means "manages nothing" — no legacy value to infer.
  const [managesMinistries, setManagesMinistries] = useState<string[]>(initial?.managesMinistries ?? []);
  // Same discipline as `touchedPrefFields`: an edit that never touches a
  // ministry row must PATCH neither key.
  const [touchedMinistryFields, setTouchedMinistryFields] =
    useState<ReadonlySet<"ministries" | "managesMinistries">>(() => new Set());
  const [ministryError, setMinistryError] = useState<string | null>(null);

  const toggleType = (value: string) => {
    setMemberType(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    );
  };

  const toggleMinistry = (value: string) => {
    setMinistries(prev =>
      prev.includes(value) ? prev.filter(m => m !== value) : [...prev, value]
    );
    setTouchedMinistryFields(prev => new Set(prev).add("ministries"));
    setMinistryError(null);
  };

  const toggleManagedMinistry = (value: string) => {
    setManagesMinistries(prev =>
      prev.includes(value) ? prev.filter(m => m !== value) : [...prev, value]
    );
    setTouchedMinistryFields(prev => new Set(prev).add("managesMinistries"));
  };

  const handleTogglePref = (field: string, next: boolean) => {
    const key = field as keyof EmailPrefValues;
    setEmailPrefs((p) => ({ ...p, [key]: next }));
    setTouchedPrefFields((prev) => new Set(prev).add(key));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Belonging to NOTHING is not a state a member may be saved in, on
        // either mode. Creating with no ministry would mint a Kids manager who
        // is also a full worship member; unticking the last box on an edit
        // would submit `[]`, which reads back as `["worship"]`. The route
        // rejects both too — this is the friendly half, not the enforcement.
        if (ministries.length === 0) { setMinistryError("Elige al menos un ministerio."); return; }
        setMinistryError(null);
        // Only an edit carries preferences, and only the fields actually touched
        // this session — never the full resolved snapshot. That snapshot can be
        // stale (fetched before the member last changed their own preference),
        // so submitting all five every time would silently revert an opt-out
        // the moment an admin fixes an unrelated typo in the name.
        const touchedEmailPrefs: Partial<EmailPrefValues> = {};
        for (const field of touchedPrefFields) touchedEmailPrefs[field] = emailPrefs[field];
        // On CREATE both arrays go unconditionally — there is no stored value to
        // clobber, and a Kids volunteer must be created kids-only rather than
        // existing as a worship member until someone remembers a second edit.
        const touchedMinistries: Partial<Pick<MemberFormData, "ministries" | "managesMinistries">> = {};
        if (!initial || touchedMinistryFields.has("ministries")) touchedMinistries.ministries = ministries;
        if (!initial || touchedMinistryFields.has("managesMinistries")) touchedMinistries.managesMinistries = managesMinistries;
        onSubmit({
          member_name: name, alias, email, role, memberType,
          ...(initial && touchedPrefFields.size > 0 ? { emailPrefs: touchedEmailPrefs } : {}),
          ...touchedMinistries,
          ...(touchedInstruments && (initial || instruments.length > 0) ? { instruments } : {}),
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Nombre</label>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Nombre completo" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Alias</label>
        <input className={inputCls} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Nombre corto o apodo (opcional)" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Email</label>
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="correo@ejemplo.com" />
      </div>
      <div className="space-y-1">
        <Select id="member-role" label="Rol" value={role} onChange={(e) => setRole(e.target.value as OWTRole)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Tipo</label>
        <div className="flex gap-2">
          {MEMBER_TYPES.map(({ value, label }) => {
            const active = memberType.includes(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleType(value)}
                className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-accent/20 text-mono-500 hover:border-accent/50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {memberType.includes("instrumento") && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Instrumentos</label>
          <div className="flex gap-2">
            {DEFAULT_INSTRUMENT_SEATS.map((value) => {
              const active = instruments.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleInstrument(value)}
                  className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                    active
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-accent/20 text-mono-500 hover:border-accent/50"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
          <p className="font-body text-[11px] text-mono-500">
            Vacío = no se asigna en automático; el planner lo sigue listando como «sin declarar».
          </p>
        </div>
      )}
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Ministerios</label>
        <div className="flex gap-2">
          {ALL_MINISTRY_IDS.map((id) => {
            const active = ministries.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleMinistry(id)}
                className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-accent/20 text-mono-500 hover:border-accent/50"
                }`}
              >
                {MINISTRIES[id].name}
              </button>
            );
          })}
        </div>
        {ministryError && (
          <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-lg px-3 py-2">{ministryError}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Administra ministerios</label>
        <div className="flex gap-2">
          {MANAGEABLE_MINISTRY_IDS.map((id) => {
            const active = managesMinistries.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleManagedMinistry(id)}
                className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-accent/20 text-mono-500 hover:border-accent/50"
                }`}
              >
                {MINISTRIES[id].name}
              </button>
            );
          })}
        </div>
        <p className="font-body text-xs text-mono-500">
          Otorga administración del ministerio. No implica membresía.
        </p>
      </div>
      {initial && (
        <div className="space-y-3 pt-1">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Correos</label>
          <EmailPrefToggles
            values={emailPrefs}
            onToggle={handleTogglePref}
            // The role selected in THIS form, not `initial.role`: promoting
            // someone to admin reveals the admin-only row straight away.
            memberRole={role}
            showHints={false}
            disabled={loading}
          />
        </div>
      )}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {loading ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

// ─── Password form ────────────────────────────────────────────────────────────
function PasswordForm({
  member,
  onSubmit,
  onClose,
  loading,
}: {
  member: Member;
  onSubmit: (password: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [pw, setPw]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr]     = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { setErr("Mínimo 8 caracteres."); return; }
    if (pw !== confirm) { setErr("Las contraseñas no coinciden."); return; }
    setErr(null);
    onSubmit(pw);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="font-body text-sm text-mono-400">
        Establecer contraseña para <span className="text-accent">{member.member_name}</span>
      </p>
      {err && <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-lg px-3 py-2">{err}</p>}
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Nueva contraseña</label>
        <input className={inputCls} type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} placeholder="Mínimo 8 caracteres" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Confirmar contraseña</label>
        <input className={inputCls} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Repetir contraseña" />
      </div>
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {loading ? "Guardando..." : "Establecer"}
        </button>
      </div>
    </form>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────
export default function MembersPanel({ role }: { role: OWTRole }) {
  const { update } = useSession();
  const router = useRouter();
  const [members, setMembers]   = useState<Member[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [modalKind, setModalKind]     = useState<ModalKind | null>(null);
  const [modalMember, setModalMember] = useState<Member | null>(null);
  const [modalOpen, setModalOpen]     = useState(false);
  // Bumped on every open, and part of each body's `key`: the payload survives
  // the exit (so nothing blanks mid-animation) but a REOPEN still gets a fresh
  // form rather than the text — or the password — left in the last one.
  const [modalSeq, setModalSeq]       = useState(0);
  const [modalError, setModalError]   = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  // Decision O: the kill switch asks first. One dialog for the panel, driven by
  // the member it was opened for — never one dialog per row. Same split as the
  // modals above: the member outlives the close so the exit keeps its body.
  const [confirmMember, setConfirmMember] = useState<Member | null>(null);
  const [confirmOpen, setConfirmOpen]     = useState(false);
  const [confirmError, setConfirmError]   = useState<string | null>(null);
  const { toast } = useToast();
  const showToast = useCallback((msg: string) => toast({ message: msg }), [toast]);
  const [query, setQuery]           = useState("");
  const [filterKey, setFilterKey]   = useState<FilterKey>("type");
  const [filterValue, setFilterValue] = useState("");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  // Frank sees the whole church here; "Alabanza" is the view he actually works in.
  const [ministryScope, setMinistryScope] = useState<MinistryScope>("worship");
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [photoTarget, setPhotoTarget]       = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Same contract as leaving one (see ImpersonationBanner): `update()` was
  // awaited and never checked, so a refused impersonation still navigated to
  // /me — showing the admin their OWN profile, indistinguishable from a
  // successful switch until they wondered why the banner was missing.
  const handleImpersonate = async (memberId: string) => {
    try {
      const next = await update({ impersonating: memberId });
      if (!next?.user?.isImpersonating) {
        showToast("No se pudo suplantar a este miembro.");
        return;
      }
      router.push("/me");
      router.refresh();
    } catch {
      showToast("No se pudo suplantar a este miembro.");
    }
  };

  // Ministry scope first, so the type/role filter and the Fuse index below both
  // work on the visible ministry only — searching inside "Oasis Kids" searches
  // Kids members, not the whole church.
  const ministry = useMemo(
    () => resolveMinistryScope(members, ministryScope),
    [members, ministryScope],
  );

  // Category filter — independent of the search query.
  const categoryFiltered = useMemo(() => {
    const base = ministry.scoped;
    if (!filterValue) return base;
    return filterKey === "type"
      ? base.filter((m) => m.memberType?.includes(filterValue))
      : base.filter((m) => m.role === filterValue);
  }, [ministry, filterKey, filterValue]);

  // Build the Fuse index only when the filtered set changes — NOT on every
  // keystroke. Typing then just re-runs .search() against the existing index.
  const fuse = useMemo(
    () => new Fuse(categoryFiltered, {
      keys: [
        { name: "alias",       weight: 0.5 },
        { name: "member_name", weight: 0.4 },
        { name: "email",       weight: 0.1 },
      ],
      threshold: 0.4,
    }),
    [categoryFiltered],
  );

  const filteredMembers = useMemo(() => {
    const list = query.trim() ? fuse.search(query).map((r) => r.item) : categoryFiltered;
    // Sort A→Z / Z→A by display name (alias preferred)
    return [...list].sort((a, b) => {
      const na = (a.alias?.trim() || a.member_name).toLocaleLowerCase("es");
      const nb = (b.alias?.trim() || b.member_name).toLocaleLowerCase("es");
      return sortDir === "asc" ? na.localeCompare(nb, "es") : nb.localeCompare(na, "es");
    });
  }, [categoryFiltered, fuse, query, sortDir]);

  const openModal = (kind: ModalKind, member?: Member) => {
    setModalError(null);
    setModalKind(kind);
    setModalMember(member ?? null);
    setModalSeq((n) => n + 1);
    setModalOpen(true);
  };

  // The kind and the member stay put — `open` is what closes the dialog, and the
  // body must still have something to draw while it animates out.
  const closeModal = () => {
    setModalError(null);
    setModalOpen(false);
  };

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members");
      if (!res.ok) throw new Error("Error al cargar miembros");
      setMembers(await res.json());
    } catch {
      setError("No se pudo cargar la lista de miembros.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleAdd = async (data: MemberFormData) => {
    setSubmitting(true);
    try {
      // A new member starts on the preference defaults; POST takes identity plus
      // ministry membership. The ministries MUST be carried here: created
      // without them, a Kids volunteer normalizes to `["worship"]` and holds the
      // whole song catalog, schedule, tags and authors until someone remembers a
      // second edit — with no signal to the admin that it happened.
      const { member_name, alias, email, role: memberRole, memberType, ministries, managesMinistries, instruments } = data;
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_name, alias, email, role: memberRole, memberType, ministries, managesMinistries,
          ...(instruments !== undefined ? { instruments } : {}),
        }),
      });
      if (res.ok) { setModalOpen(false); setModalError(null); fetchMembers(); showToast("Miembro agregado."); }
      else setModalError("Error al agregar miembro.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (data: MemberFormData) => {
    if (modalKind !== "edit" || !modalMember) return;
    setSubmitting(true);
    try {
      // Only the touched toggles go flat: `emailAssigned`, `emailRemoved`, …
      // `emailPrefs` is already filtered to the fields the admin changed this
      // session (see MemberForm) — an untouched form sends none of them.
      const { emailPrefs, ...rest } = data;
      const res = await fetch(`/api/admin/members/${modalMember._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, ...(emailPrefs ?? {}) }),
      });
      if (res.ok) { setModalOpen(false); setModalError(null); fetchMembers(); showToast("Miembro actualizado."); }
      else setModalError("Error al actualizar.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePassword = async (password: string) => {
    if (modalKind !== "password" || !modalMember) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sanityMemberId: modalMember._id, password }),
      });
      if (res.ok) { setModalOpen(false); setModalError(null); fetchMembers(); showToast("Contraseña establecida."); }
      else setModalError("Error al establecer contraseña.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Returns whether the write LANDED. The caller needs that: the confirm dialog
   * must stay open on a failure, and it used to close on every outcome because
   * this swallowed the error into a toast and returned `undefined` — the admin
   * saw the sheet close and the row unchanged, which reads as "it worked, the
   * list is stale". The toast still carries the server's own reason; the dialog
   * says why it is still on screen.
   */
  const handleDisableAccess = async (memberId: string, disabled: boolean): Promise<boolean> => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/members/${memberId}/disable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (res.ok) {
        fetchMembers();
        showToast(disabled ? "Acceso deshabilitado." : "Acceso restaurado.");
        return true;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      showToast(body.error ?? "Error al cambiar acceso.");
      return false;
    } catch {
      showToast("Error de conexión.");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // Taking access away is the one row action that asks first (decision O);
  // GIVING it back does not — it restores what the member already had, and a
  // confirm on a reversible, non-destructive action only teaches admins to
  // click through confirms.
  const openConfirm = (member: Member) => {
    setConfirmError(null);
    setConfirmMember(member);
    setConfirmOpen(true);
  };

  // The member stays: `CueDialog` is still on screen for its exit.
  const closeConfirm = () => {
    setConfirmError(null);
    setConfirmOpen(false);
  };

  const confirmDisableAccess = async () => {
    if (!confirmMember) return;
    const ok = await handleDisableAccess(confirmMember._id, true);
    if (ok) closeConfirm();
    else setConfirmError("No se pudo deshabilitar el acceso. El miembro sigue teniéndolo.");
  };

  const handlePhotoClick = (memberId: string) => {
    setPhotoTarget(memberId);
    photoInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !photoTarget) return;
    e.target.value = "";
    setUploadingPhoto(photoTarget);
    const formData = new FormData();
    formData.append("photo", file);
    try {
      const res = await fetch(`/api/admin/members/${photoTarget}/photo`, { method: "POST", body: formData });
      if (res.ok) {
        const { photoUrl } = await res.json();
        setMembers(prev => prev.map(m => m._id === photoTarget ? { ...m, photoUrl } : m));
        showToast("Foto actualizada.");
      } else {
        showToast("Error al subir foto.");
      }
    } catch {
      showToast("Error al subir foto.");
    }
    setUploadingPhoto(null);
    setPhotoTarget(null);
  };

  const handleDelete = async () => {
    if (modalKind !== "delete" || !modalMember) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/members/${modalMember._id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        deleted?: boolean;
      };
      const outcome = interpretMemberDeleteResponse(res.ok, body);
      if (outcome.kind === "success") {
        setModalOpen(false);
        setModalError(null);
        fetchMembers();
        showToast("Miembro eliminado.");
      } else if (outcome.kind === "partial") {
        fetchMembers();
        setModalError(outcome.message);
      } else if (outcome.kind === "references") {
        setModalError(outcome.message);
      } else {
        setModalError("Error al eliminar.");
      }
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Miembros</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
              {/* `filterValue` is in here deliberately: with scope "Todos", no query
                  and a type/role filter active, the heading used to read "57 miembros"
                  above a list of 5 — a silently shortened list is how someone concludes
                  a member was deleted. Any narrowing input must make the count honest. */}
              {(query.trim() || filterValue || ministryScope !== "all") && filteredMembers.length !== members.length
                ? `${filteredMembers.length} de ${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
                : `${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
              }
            </p>
          )}
        </div>
        <button
          onClick={() => openModal("add")}
          className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/15 px-4 py-2.5 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent/25"
        >
          <span className="text-base leading-none">+</span>
          Agregar
        </button>
      </div>

      {/* Filter + sort controls */}
      <div className="space-y-2">
        {/* Row 0: ministry scope — hidden unless the list spans more than one */}
        <MinistryScopeBar
          counts={ministry.counts}
          total={members.length}
          visible={ministry.visible}
          value={ministryScope}
          onChange={setMinistryScope}
        />

        {/* Row 1: filter key + filter value + sort direction */}
        <div className="flex gap-2 flex-wrap">
          <SegmentedControl
            label="Filtrar por"
            tone="filled"
            // brand-search-console deliberately wins over the primitive's filled chrome
            // so the control matches the search input beside it.
            className="brand-search-console shrink-0"
            value={filterKey}
            onChange={(k) => { setFilterKey(k); setFilterValue(""); }}
            options={[
              { value: "type", label: "Tipo" },
              { value: "role", label: "Rol" },
            ]}
          />

          {/* Filter value dropdown */}
          <Select
            aria-label={filterKey === "type" ? "Tipo" : "Rol"}
            className="min-w-[120px] flex-1"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
          >
            <option value="">{filterKey === "type" ? "Todos los tipos" : "Todos los roles"}</option>
            {filterKey === "type"
              ? [
                  { value: "voz",           label: "Voz"         },
                  { value: "instrumento",   label: "Instrumento" },
                  { value: "foh",           label: "FOH"         },
                  { value: "sunday_lead",   label: "Líder Dom"   },
                  { value: "saturday_lead", label: "Líder Sáb"   },
                  { value: "support",       label: "Soporte"     },
                ].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
              : ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)
            }
          </Select>

          <SegmentedControl
            label="Orden"
            tone="filled"
            // brand-search-console deliberately wins over the primitive's filled chrome
            // so the control matches the search input beside it.
            className="brand-search-console shrink-0"
            value={sortDir}
            onChange={setSortDir}
            options={[
              { value: "asc", label: "A→Z" },
              { value: "desc", label: "Z→A" },
            ]}
          />
        </div>

        {/* Row 2: search */}
        <div className="brand-search-console relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-mono-500 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {/* 16px on the phone: anything smaller makes iOS Safari zoom the page
              on focus. `inputFontSize.test.ts` excludes `admin/` by path, so this
              is the convention holding rather than the guard. */}
          <input
            className="w-full bg-transparent py-2.5 pl-9 pr-8 font-body text-[16px] sm:text-sm placeholder:text-placeholder focus:outline-none"
            placeholder="Buscar por nombre, alias o email…"
            aria-label="Buscar miembros"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <Button
              variant="icon"
              size="sm"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-lg leading-none"
            >
              ×
            </Button>
          )}
        </div>
      </div>

      {/* States */}
      {loading && (
        <SkeletonGroup label="Cargando miembros" className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" rounded="lg" />
          ))}
        </SkeletonGroup>
      )}

      {error && (
        <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Members list */}
      {!loading && !error && (
        <div className="space-y-2">
          {members.length === 0 && (
            <p className="font-body text-sm text-mono-500 text-center py-12">No hay miembros todavía.</p>
          )}
          {members.length > 0 && filteredMembers.length === 0 && (
            <p className="font-body text-sm text-mono-500 text-center py-12">
              {query.trim() ? <>Sin resultados para &ldquo;{query}&rdquo;</> : "Sin resultados"}
            </p>
          )}
          {filteredMembers.map((m) => (
            <div
              key={m._id}
              // `:hover` moves the border colour and the shadow; its `background` is a
              // GRADIENT (background-image), which does not interpolate, so listing
              // background-color would animate nothing and say otherwise.
              className="brand-member-row group flex items-center gap-4 rounded-xl px-4 py-3 transition-[box-shadow,border-color] duration-base ease-out-brand"
            >
              <Avatar
                name={displayName(m)}
                photoUrl={m.photoUrl}
                uploading={uploadingPhoto === m._id}
                onClick={() => handlePhotoClick(m._id)}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {m.alias?.trim()
                    ? <p className="font-display text-base leading-tight truncate">{m.alias.trim()}</p>
                    : <p className="font-body text-sm font-semibold truncate">{m.member_name}</p>
                  }
                  {m.alias?.trim() && (
                    <span className="font-body text-sm text-accent/70 truncate">{m.member_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="font-body text-sm text-surface-ink-l50-d35 truncate">{m.email}</p>
                  {(m.memberType ?? []).map(t => (
                    <span key={t} className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent/10 text-mono-400 border border-accent/15">
                      {TYPE_ABBR[t] ?? t}
                    </span>
                  ))}
                  {(m.instruments ?? []).map(i => (
                    <span key={`instr-${i}`} className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-mono-500/10 text-mono-400 border border-mono-500/20">
                      {i}
                    </span>
                  ))}
                  {/* The chip is the row's only statement about access now that the
                      kill switch lives in the menu — it stays. */}
                  {m.disabled === true && (
                    <span className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-negative-strong/15 text-negative-fg border border-negative-strong/30">
                      Sin acceso
                    </span>
                  )}
                </div>
              </div>

              {/* Role badge */}
              <span className={`hidden sm:inline-flex font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role ?? "member"]}`}>
                {ROLE_LABEL[m.role ?? "member"]}
              </span>

              {/* Password indicator */}
              <span
                title={m.hasPassword ? "Tiene contraseña" : "Sin contraseña"}
                className={`w-2 h-2 rounded-full shrink-0 ${m.hasPassword ? "bg-positive-deep" : "bg-mono-600"}`}
              />

              {/* Actions — ONE menu per row (R5 ruling 6). The four hover-only icon
                  buttons are gone: nothing on this row depends on hover, so a phone
                  reaches every action the desktop does. */}
              <Menu
                label={`Acciones de ${displayName(m)}`}
                align="end"
                trigger={
                  <Button variant="icon" size="lg" aria-label={`Acciones de ${displayName(m)}`}>
                    <span aria-hidden="true" className="text-base leading-none">⋯</span>
                  </Button>
                }
              >
                <MenuItem icon={<PencilIcon />} onSelect={() => openModal("edit", m)}>
                  Editar
                </MenuItem>
                <MenuItem icon={<KeyIcon />} onSelect={() => openModal("password", m)}>
                  Contraseña
                </MenuItem>
                {role === "super-admin" && (
                  <>
                    <MenuItem icon={<MaskIcon />} onSelect={() => handleImpersonate(m._id)}>
                      Ver como este miembro
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      icon={<BanIcon />}
                      danger={m.disabled !== true}
                      // `submitting` covers a second pick while the previous
                      // access write is still in flight — the confirm's own
                      // button is `busy`, and this is the path that has none.
                      disabled={submitting}
                      onSelect={() =>
                        m.disabled === true ? handleDisableAccess(m._id, false) : openConfirm(m)
                      }
                    >
                      {m.disabled === true ? "Habilitar acceso" : "Deshabilitar acceso"}
                    </MenuItem>
                    <MenuItem icon={<TrashIcon />} danger disabled={submitting} onSelect={() => openModal("delete", m)}>
                      Eliminar
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {!loading && members.length > 0 && (
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-600 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-positive-deep inline-block" /> Con contraseña
          <span className="w-2 h-2 rounded-full bg-mono-600 inline-block ml-2" /> Solo SSO
        </p>
      )}

      {/* Hidden photo input */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handlePhotoChange}
      />

      {/* ── Modals: mounted always, opened by the prop, and their bodies keyed on
             the OPEN rather than on the member — so a close keeps drawing what it
             is animating away, and a reopen still starts clean. ── */}
      <Modal open={modalOpen && modalKind === "add"} title="Agregar miembro" onClose={closeModal} status={modalError}>
        {modalKind === "add" && (
          <MemberForm key={`add-${modalSeq}`} onSubmit={handleAdd} onClose={closeModal} loading={submitting} />
        )}
      </Modal>

      <Modal open={modalOpen && modalKind === "edit"} title="Editar miembro" onClose={closeModal} status={modalError}>
        {modalKind === "edit" && modalMember && (
          <MemberForm key={`edit-${modalSeq}`} initial={modalMember} onSubmit={handleEdit} onClose={closeModal} loading={submitting} />
        )}
      </Modal>

      <Modal open={modalOpen && modalKind === "password"} title="Establecer contraseña" onClose={closeModal} status={modalError}>
        {modalKind === "password" && modalMember && (
          <PasswordForm key={`password-${modalSeq}`} member={modalMember} onSubmit={handlePassword} onClose={closeModal} loading={submitting} />
        )}
      </Modal>

      <Modal open={modalOpen && modalKind === "delete"} title="Eliminar miembro" onClose={closeModal} status={modalError}>
        {modalKind === "delete" && modalMember && (
          <>
            <p className="font-body text-sm text-mono-400">
              ¿Eliminar a <span className="text-negative-fg font-semibold">{modalMember.member_name}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="ghost" className="flex-1" onClick={closeModal}>Cancelar</Button>
              <Button variant="danger" className="flex-1" busy={submitting} busyLabel="Eliminando..." onClick={handleDelete}>
                Eliminar
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── The kill switch asks first (decision O) ── */}
      <CueDialog
        open={confirmOpen}
        title="Deshabilitar acceso"
        label="Deshabilitar acceso"
        mode="modal"
        size="sm"
        onDismiss={closeConfirm}
      >
        <div className="space-y-4 p-6">
          {confirmError && <CueDialogStatus tone="error">{confirmError}</CueDialogStatus>}
          <p className="font-body text-sm text-mono-400">
            ¿Deshabilitar el acceso de{" "}
            <span className="text-negative-fg font-semibold">{confirmMember ? displayName(confirmMember) : ""}</span>?
          </p>
          <p className="font-body text-sm text-mono-500">
            No podrá iniciar sesión. No cambia su Tipo, sus asignaciones ni su historial.
          </p>
          <div className="flex gap-3 pt-1">
            <Button variant="ghost" className="flex-1" onClick={closeConfirm}>Cancelar</Button>
            <Button variant="danger" className="flex-1" busy={submitting} busyLabel="Deshabilitando..." onClick={confirmDisableAccess}>
              Deshabilitar
            </Button>
          </div>
        </div>
      </CueDialog>
    </div>
  );
}

// ─── Menu glyphs ───────────────────────────────────────────────────────────────
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function MaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" strokeLinecap="round" />
      <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function BanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
    </svg>
  );
}
