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

import { PAGE_LEDE, PAGE_TITLE, SHEET_TITLE } from "@/app/utils/homeHero";
import { normalizeText } from "@/app/utils/normalizeText";
import { plural } from "@/app/utils/plural";
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
import { PlusIcon } from "../ui/icons";
import {
  ALL_MINISTRY_IDS,
  MANAGEABLE_MINISTRY_IDS,
  MINISTRIES,
  normalizeMinistries,
  type MinistryId,
} from "@/app/ministries";
import { interpretMemberDeleteResponse } from "@/app/utils/memberDelete";
import { MEMBER_TYPES as MEMBER_TYPE_IDS, type MemberType } from "@/app/utils/memberTypes";
import FiltersPill from "../ui/FiltersPill";
import SearchLine from "../ui/SearchLine";
import { DEFAULT_INSTRUMENT_SEATS } from "./seatModel";

import { ROLE_LABEL, type OWTRole } from "@/app/utils/roleLabel";

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
/**
 * The row's words for a Tipo: full words since the Admin pass turned the chips
 * into a line of text, with the two leader types kept short («Líder Dom») so
 * «Voz · Líder Dom · Guitarra» fits a phone row. Keyed on `MemberType`, so a
 * Tipo added to `memberTypes.ts` fails to compile here instead of going
 * silently unlabelled; the Filtros sheet lists `MEMBER_TYPES` with these words.
 */
const TYPE_ABBR: Record<MemberType, string> = {
  voz: "Voz", instrumento: "Instrumento", foh: "FOH",
  sunday_lead: "Líder Dom", saturday_lead: "Líder Sáb", support: "Soporte",
};
const typeWord = (t: string) => (t in TYPE_ABBR ? TYPE_ABBR[t as MemberType] : t);

const TYPE_OPTIONS = MEMBER_TYPE_IDS.map((value) => ({ value, label: TYPE_ABBR[value] }));

type SortDir  = "asc" | "desc";

/**
 * The list by letter of the shown name, like Biblioteca (ADR-0070): the letter
 * follows `sortDir`, the rows keep the order the caller sorted them in. A query
 * orders by relevance, so the caller passes one unlettered group then.
 */
export function groupMembersByLetter<T extends { member_name: string; alias?: string }>(
  rows: T[],
  sortDir: SortDir,
): { letter: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const m of rows) {
    const c = normalizeText(m.alias?.trim() || m.member_name).trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(c) ? c : "#";
    (map.get(letter) ?? map.set(letter, []).get(letter)!).push(m);
  }
  const letters = [...map.keys()].filter((l) => l !== "#").sort();
  if (sortDir === "desc") letters.reverse();
  if (map.has("#")) letters.push("#");
  return letters.map((letter) => ({ letter, rows: map.get(letter)! }));
}

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
          <span className="font-label text-sm text-accent">{initials}</span>
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
        className="relative w-11 h-11 rounded-full overflow-hidden shrink-0 group/avatar cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="relative w-11 h-11 rounded-full overflow-hidden shrink-0">
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
        <div className="flex flex-wrap gap-2">
          {MEMBER_TYPES.map(({ value, label }) => {
            const active = memberType.includes(value);
            return (
              <Button key={value} variant="pill" active={active} onClick={() => toggleType(value)}>
                {label}
              </Button>
            );
          })}
        </div>
      </div>
      {memberType.includes("instrumento") && (
        <div className="space-y-2">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Instrumentos</label>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_INSTRUMENT_SEATS.map((value) => {
              const active = instruments.includes(value);
              return (
                <Button key={value} variant="pill" active={active} onClick={() => toggleInstrument(value)}>
                  {value}
                </Button>
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
        <div className="flex flex-wrap gap-2">
          {ALL_MINISTRY_IDS.map((id) => {
            const active = ministries.includes(id);
            return (
              <Button key={id} variant="pill" active={active} onClick={() => toggleMinistry(id)}>
                {MINISTRIES[id].name}
              </Button>
            );
          })}
        </div>
        {ministryError && (
          <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-lg px-3 py-2">{ministryError}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-mono-500">Administra ministerios</label>
        <div className="flex flex-wrap gap-2">
          {MANAGEABLE_MINISTRY_IDS.map((id) => {
            const active = managesMinistries.includes(id);
            return (
              <Button key={id} variant="pill" active={active} onClick={() => toggleManagedMinistry(id)}>
                {MINISTRIES[id].name}
              </Button>
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
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" className="flex-1" busy={loading} busyLabel="Guardando...">
          Guardar
        </Button>
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
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" className="flex-1" busy={loading} busyLabel="Guardando...">
          Establecer
        </Button>
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
  // Tipo and Rol filter together now (the Admin pass): both live in the
  // «Filtros» sheet, so a key picker choosing ONE of them is gone.
  const [typeFilter, setTypeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    let base = ministry.scoped;
    if (typeFilter) base = base.filter((m) => m.memberType?.includes(typeFilter));
    if (roleFilter) base = base.filter((m) => m.role === roleFilter);
    return base;
  }, [ministry, typeFilter, roleFilter]);

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

  // A query orders by relevance, so the letters only exist while idle.
  const groups = useMemo(
    () => (query.trim() ? [{ letter: "", rows: filteredMembers }] : groupMembersByLetter(filteredMembers, sortDir)),
    [filteredMembers, query, sortDir],
  );
  const activeFilters = (typeFilter ? 1 : 0) + (roleFilter ? 1 : 0) + (sortDir === "desc" ? 1 : 0);

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
          <h1 className={PAGE_TITLE}>Miembros</h1>
          {!loading && (
            <p className={`mt-2 ${PAGE_LEDE}`}>
              {/* `filterValue` is in here deliberately: with scope "Todos", no query
                  and a type/role filter active, the heading used to read "57 miembros"
                  above a list of 5 — a silently shortened list is how someone concludes
                  a member was deleted. Any narrowing input must make the count honest. */}
              {(query.trim() || typeFilter || roleFilter || ministryScope !== "all") && filteredMembers.length !== members.length
                ? `${filteredMembers.length} de ${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
                : `${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
              }
            </p>
          )}
        </div>
        <Button variant="primary" size="lg" onClick={() => openModal("add")}>
          <PlusIcon size={14} />
          Agregar
        </Button>
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

        {/* Row 1: the search as a hairline beside the «Filtros» pill (ADR-0070's
            Biblioteca pattern): Tipo, Rol and Orden live in the sheet. */}
        <div className="flex items-center gap-3">
          <SearchLine
            label="Buscar miembros"
            placeholder="Buscar por nombre, alias o email…"
            value={query}
            onChange={setQuery}
            className="flex-1"
          />
          <FiltersPill count={activeFilters} open={filtersOpen} onClick={() => setFiltersOpen(true)} />
        </div>
      </div>

      {/* The filter sheet: Tipo and Rol as pills with a «Todos» each (a pill does
          fire on re-press, but «Todos» reads clearer than "tap it again"), Orden
          as the house segmented control. The primary says what it will show. */}
      <CueDialog open={filtersOpen} mode="sheet" size="md" title="Filtros" label="Filtros" onDismiss={() => setFiltersOpen(false)}>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-5">
          <section>
            <p className={`mb-3 ${SHEET_TITLE}`}>Tipo</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
              <Button variant="pill" size="sm" active={typeFilter === ""} onClick={() => setTypeFilter("")} className="text-sm px-3 py-1.5">Todos</Button>
              {TYPE_OPTIONS.map((o) => (
                <Button key={o.value} variant="pill" size="sm" active={typeFilter === o.value} onClick={() => setTypeFilter(o.value)} className="text-sm px-3 py-1.5">{o.label}</Button>
              ))}
            </div>
          </section>
          <section>
            <p className={`mb-3 ${SHEET_TITLE}`}>Rol</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rol">
              <Button variant="pill" size="sm" active={roleFilter === ""} onClick={() => setRoleFilter("")} className="text-sm px-3 py-1.5">Todos</Button>
              {ROLES.map((r) => (
                <Button key={r.value} variant="pill" size="sm" active={roleFilter === r.value} onClick={() => setRoleFilter(r.value)} className="text-sm px-3 py-1.5">{r.label}</Button>
              ))}
            </div>
          </section>
          <section>
            <p className={`mb-3 ${SHEET_TITLE}`}>Orden</p>
            <SegmentedControl
              label="Orden"
              tone="filled"
              size="sm"
              className="w-fit"
              value={sortDir}
              onChange={setSortDir}
              options={[
                { value: "asc", label: "A→Z" },
                { value: "desc", label: "Z→A" },
              ]}
            />
          </section>
          <div className="flex items-center justify-between gap-3 border-t border-ink/[0.10] pt-5">
            <Button variant="ghost" onClick={() => { setTypeFilter(""); setRoleFilter(""); setSortDir("asc"); }}>Limpiar filtros</Button>
            <Button variant="cta" onClick={() => setFiltersOpen(false)}>
              {/* What the FILTERS show — without the search box's own narrowing, which
                  the sheet does not touch. */}
              {`Ver ${plural(categoryFiltered.length, "miembro", "miembros")}`}
            </Button>
          </div>
        </div>
      </CueDialog>

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

      {/* Members list: letter sections over hairline rows (ADR-0070, the Admin
          pass PR B). The letter is the display face, muted — an index, not a
          label; the row is photo, alias at 17 px, «Voz · Líder Dom» at 14 px, the
          role as a muted word («Sin acceso» in red) and ONE menu. */}
      {!loading && !error && (
        <div>
          {members.length === 0 && (
            <p className="font-body text-[15px] text-ink-dim py-12">No hay miembros todavía.</p>
          )}
          {members.length > 0 && filteredMembers.length === 0 && (
            <p className="font-body text-[15px] text-ink-dim py-12">
              {query.trim() ? <>Sin resultados para &ldquo;{query}&rdquo;</> : "Sin resultados"}
            </p>
          )}
          {groups.map((g) => (
            <section key={g.letter || "resultados"} aria-label={g.letter ? `Letra ${g.letter}` : "Resultados"}>
              {g.letter && (
                <h2 className="pb-1.5 pt-7 font-display text-[28px] font-semibold leading-none text-ink-dim md:text-[34px]">
                  {g.letter}
                </h2>
              )}
              <div className="border-t border-ink/[0.10]">
                {g.rows.map((m) => {
                  const facts = [
                    ...(m.memberType ?? []).map(typeWord),
                    ...(m.instruments ?? []),
                  ];
                  return (
                    <div
                      key={m._id}
                      data-member-row=""
                      className="flex min-h-[68px] items-center gap-3.5 border-b border-ink/[0.10] py-2.5"
                    >
                      <Avatar
                        name={displayName(m)}
                        photoUrl={m.photoUrl}
                        uploading={uploadingPhoto === m._id}
                        onClick={() => handlePhotoClick(m._id)}
                      />

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <p className="truncate font-body text-[17px] font-semibold leading-tight text-ink">{displayName(m)}</p>
                          {m.alias?.trim() && (
                            <span className="hidden truncate font-body text-sm text-ink-muted sm:inline">{m.member_name}</span>
                          )}
                        </div>
                        {/* No Tipo and no instrument: the line exists only from `md`, where the
                            email fills it — a phone row must not carry an empty 14 px line. */}
                        <p className={`mt-1 truncate font-body text-sm leading-tight text-ink-muted ${facts.length > 0 ? "" : "hidden md:block"}`}>
                          {facts.join(" · ")}
                          <span className="hidden md:inline">
                            {facts.length > 0 && <span className="text-ink-dim"> · </span>}
                            {m.email}
                          </span>
                        </p>
                      </div>

                      {/* Access or role, as a word. «Sin acceso» is the row's only statement
                          about access now that the kill switch lives in the menu — it stays. */}
                      {m.disabled === true ? (
                        <span className="shrink-0 font-body text-sm text-negative-fg">Sin acceso</span>
                      ) : (m.role ?? "member") !== "member" ? (
                        <span className="hidden shrink-0 font-body text-sm text-ink-muted sm:inline">{ROLE_LABEL[m.role ?? "member"]}</span>
                      ) : null}

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
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Legend */}
      {!loading && members.length > 0 && (
        <p className="flex items-center gap-2 font-body text-xs text-ink-dim">
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
