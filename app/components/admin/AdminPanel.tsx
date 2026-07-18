"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import ServicesPanel from "./ServicesPanel";
import ActivityPanel from "./ActivityPanel";
import ContentPanel from "./ContentPanel";
import AvailabilityPanel from "./AvailabilityPanel";
import ProposalsPanel from "./ProposalsPanel";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

interface Member {
  _id: string;
  member_name: string;
  alias?: string;
  email: string;
  role: OWTRole;
  memberType?: string[];
  hasPassword: boolean;
  photoUrl?: string;
  notifPrefs?: { email?: boolean };
}

const TYPE_LABEL: Record<string, string> = {
  voz: "Voz", instrumento: "Instr.", foh: "FOH",
  sunday_lead: "Líder Dom", saturday_lead: "Líder Sáb", support: "Soporte",
};

type FilterKey = "type" | "role";
type SortDir  = "asc" | "desc";

type ModalState =
  | { type: "add" }
  | { type: "edit"; member: Member }
  | { type: "password"; member: Member }
  | { type: "delete"; member: Member }
  | null;

const ROLES: { value: OWTRole; label: string }[] = [
  { value: "super-admin", label: "Super Admin" },
  { value: "admin",       label: "Admin" },
  { value: "content-editor", label: "Content Editor" },
  { value: "member",      label: "Miembro" },
];

const ROLE_BADGE: Record<OWTRole, string> = {
  "super-admin":    "bg-[#00bfff]/15 text-[#00bfff] border border-[#00bfff]/30",
  "admin":          "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  "content-editor": "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  "member":         "bg-gray-500/15 text-gray-400 border border-gray-500/30",
};

const ROLE_LABEL: Record<OWTRole, string> = {
  "super-admin":    "Super Admin",
  "admin":          "Admin",
  "content-editor": "Editor",
  "member":         "Miembro",
};

// ─── Shared input style ────────────────────────────────────────────────────────
const inputCls =
  "brand-search-console w-full px-3 py-2.5 bg-transparent font-body text-sm focus:outline-none transition-colors";

const selectCls =
  "brand-search-console w-full px-3 py-2.5 bg-[#010b17] font-body text-sm focus:outline-none transition-colors";

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
        <div className="w-full h-full bg-[#003572] dark:bg-[#00bfff]/10 flex items-center justify-center">
          <span className="font-label text-[11px] text-[#00bfff]">{initials}</span>
        </div>
      )}
      {onClick && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity rounded-full">
          {uploading ? (
            <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
function Modal({
  title,
  onClose,
  status,
  children,
}: {
  title: string;
  onClose: () => void;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <CueDialog open title={title} label={title} mode="sheet" size="sm" onDismiss={onClose}>
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

function MemberForm({
  initial,
  onSubmit,
  onClose,
  loading,
}: {
  initial?: Partial<Member>;
  onSubmit: (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName]             = useState(initial?.member_name ?? "");
  const [alias, setAlias]           = useState(initial?.alias ?? "");
  const [email, setEmail]           = useState(initial?.email ?? "");
  const [role, setRole]             = useState<OWTRole>(initial?.role ?? "member");
  const [memberType, setMemberType] = useState<string[]>(initial?.memberType ?? []);
  const [notifEmail, setNotifEmail] = useState<boolean>(initial?.notifPrefs?.email !== false);

  const toggleType = (value: string) => {
    setMemberType(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    );
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ member_name: name, alias, email, role, memberType, notifEmail }); }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Nombre</label>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Nombre completo" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Alias</label>
        <input className={inputCls} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Nombre corto o apodo (opcional)" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Email</label>
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="correo@ejemplo.com" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Rol</label>
        <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value as OWTRole)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tipo</label>
        <div className="flex gap-2">
          {MEMBER_TYPES.map(({ value, label }) => {
            const active = memberType.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleType(value)}
                className={`flex-1 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                    : "border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {initial && (
        <div className="flex items-center justify-between gap-4 pt-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Correo de asignaciones</label>
          <button
            type="button"
            role="switch"
            aria-checked={notifEmail}
            aria-label="Correo de asignaciones"
            onClick={() => setNotifEmail((v) => !v)}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${notifEmail ? "bg-[#00bfff]" : "bg-gray-500/40"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notifEmail ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      )}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
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
      <p className="font-body text-sm text-gray-400">
        Establecer contraseña para <span className="text-[#00bfff]">{member.member_name}</span>
      </p>
      {err && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{err}</p>}
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Nueva contraseña</label>
        <input className={inputCls} type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} placeholder="Mínimo 8 caracteres" />
      </div>
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Confirmar contraseña</label>
        <input className={inputCls} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Repetir contraseña" />
      </div>
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {loading ? "Guardando..." : "Establecer"}
        </button>
      </div>
    </form>
  );
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────
type Tab = "members" | "services" | "proposals" | "availability" | "activity" | "content";

const ALL_TABS: { id: Tab; label: string; roles: OWTRole[] }[] = [
  { id: "members",      label: "Miembros",       roles: ["super-admin"] },
  { id: "services",     label: "Servicios",      roles: ["super-admin", "admin"] },
  { id: "proposals",    label: "Propuestas",     roles: ["super-admin", "admin"] },
  { id: "availability", label: "Disponibilidad", roles: ["super-admin", "admin"] },
  { id: "activity",     label: "Actividad",      roles: ["super-admin", "admin"] },
  { id: "content",      label: "Contenido",      roles: ["super-admin", "admin", "content-editor"] },
];

function TabBar({ active, onChange, role }: { active: Tab; onChange: (t: Tab) => void; role: OWTRole }) {
  const visible = ALL_TABS.filter((t) => t.roles.includes(role));
  return (
    <div className="relative">
      <div className="overflow-x-auto -mx-2 px-2 pb-1">
        <div className="brand-admin-tabs flex min-w-full w-max gap-1 rounded-xl p-1.5">
          {visible.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                active === id
                  ? "bg-brand-beam/15 text-brand-beam shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]"
                  : "text-brand-steel/60 hover:bg-brand-beam/[0.04] hover:text-brand-frost"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Scroll-fade hint (mobile, where tabs overflow) */}
      <div className="md:hidden pointer-events-none absolute top-0 right-0 bottom-1 w-8 bg-gradient-to-l from-[#C8D8EB] dark:from-[#010b17] to-transparent" />
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export default function AdminPanel({ role = "super-admin" }: { role?: OWTRole }) {
  const { update } = useSession();
  const router = useRouter();
  const firstTab = ALL_TABS.filter((t) => t.roles.includes(role))[0]?.id ?? "content";
  const [tab, setTab]           = useState<Tab>(firstTab);
  const [members, setMembers]   = useState<Member[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [modal, setModal]       = useState<ModalState>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);
  const [query, setQuery]           = useState("");
  const [filterKey, setFilterKey]   = useState<FilterKey>("type");
  const [filterValue, setFilterValue] = useState("");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [photoTarget, setPhotoTarget]       = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleImpersonate = async (memberId: string) => {
    await update({ impersonating: memberId });
    router.push("/me");
    router.refresh();
  };

  // Category filter — independent of the search query.
  const categoryFiltered = useMemo(() => {
    if (!filterValue) return members;
    return filterKey === "type"
      ? members.filter((m) => m.memberType?.includes(filterValue))
      : members.filter((m) => m.role === filterValue);
  }, [members, filterKey, filterValue]);

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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const openModal = (next: Exclude<ModalState, null>) => {
    setModalError(null);
    setModal(next);
  };

  const closeModal = () => {
    setModalError(null);
    setModal(null);
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

  const handleAdd = async (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) { setModal(null); setModalError(null); fetchMembers(); showToast("Miembro agregado."); }
      else setModalError("Error al agregar miembro.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (data: { member_name: string; alias: string; email: string; role: OWTRole; memberType: string[]; notifEmail?: boolean }) => {
    if (modal?.type !== "edit") return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/members/${modal.member._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) { setModal(null); setModalError(null); fetchMembers(); showToast("Miembro actualizado."); }
      else setModalError("Error al actualizar.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePassword = async (password: string) => {
    if (modal?.type !== "password") return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sanityMemberId: modal.member._id, password }),
      });
      if (res.ok) { setModal(null); setModalError(null); fetchMembers(); showToast("Contraseña establecida."); }
      else setModalError("Error al establecer contraseña.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
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
    if (modal?.type !== "delete") return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/members/${modal.member._id}`, { method: "DELETE" });
      if (res.ok) { setModal(null); setModalError(null); fetchMembers(); showToast("Miembro eliminado."); }
      else setModalError("Error al eliminar.");
    } catch {
      setModalError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  if (tab === "services") return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />
      <div className="brand-surface rounded-2xl p-4 sm:p-6"><ServicesPanel /></div>
    </div>
  );

  if (tab === "proposals") return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />
      <div className="brand-surface rounded-2xl p-4 sm:p-6"><ProposalsPanel /></div>
    </div>
  );

  if (tab === "availability") return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />
      <div className="brand-surface rounded-2xl p-4 sm:p-6"><AvailabilityPanel /></div>
    </div>
  );

  if (tab === "activity") return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />
      <div className="brand-surface rounded-2xl p-4 sm:p-6"><ActivityPanel /></div>
    </div>
  );

  if (tab === "content") return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />
      <div className="brand-surface rounded-2xl p-4 sm:p-6">
        <ContentPanel canDelete={role === "super-admin" || role === "admin"} />
      </div>
    </div>
  );

  return (
    <div className="brand-admin-workspace space-y-6">
      <TabBar active={tab} onChange={setTab} role={role} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Miembros</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-gray-500 mt-0.5">
              {query.trim() && filteredMembers.length !== members.length
                ? `${filteredMembers.length} de ${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
                : `${members.length} ${members.length === 1 ? "miembro" : "miembros"}`
              }
            </p>
          )}
        </div>
        <button
          onClick={() => openModal({ type: "add" })}
          className="flex items-center gap-2 rounded-lg border border-brand-beam/30 bg-brand-beam/15 px-4 py-2.5 font-label text-xs uppercase tracking-widest text-brand-beam transition-colors hover:bg-brand-beam/25"
        >
          <span className="text-base leading-none">+</span>
          Agregar
        </button>
      </div>

      {/* Filter + sort controls */}
      <div className="space-y-2">
        {/* Row 1: filter key + filter value + sort direction */}
        <div className="flex gap-2 flex-wrap">
          {/* Filter by: type | role */}
          <div className="brand-search-console flex shrink-0 overflow-hidden">
            {(["type", "role"] as FilterKey[]).map((k) => (
              <button
                key={k}
                onClick={() => { setFilterKey(k); setFilterValue(""); }}
                className={`px-3 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
                  filterKey === k
                    ? "bg-brand-beam/15 text-brand-beam"
                    : "text-brand-steel/60 hover:text-brand-beam"
                }`}
              >
                {k === "type" ? "Tipo" : "Rol"}
              </button>
            ))}
          </div>

          {/* Filter value dropdown */}
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            className="brand-search-console min-w-[120px] flex-1 bg-[#010b17] px-3 py-2 font-body text-sm text-brand-frost/80 focus:outline-none"
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
          </select>

          {/* Sort direction */}
          <div className="brand-search-console flex shrink-0 overflow-hidden">
            {(["asc", "desc"] as SortDir[]).map((d) => (
              <button
                key={d}
                onClick={() => setSortDir(d)}
                className={`px-3 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
                  sortDir === d
                    ? "bg-brand-beam/15 text-brand-beam"
                    : "text-brand-steel/60 hover:text-brand-beam"
                }`}
              >
                {d === "asc" ? "A→Z" : "Z→A"}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: search */}
        <div className="brand-search-console relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="w-full bg-transparent py-2.5 pl-9 pr-8 font-body text-sm placeholder:text-brand-steel/40 focus:outline-none"
            placeholder="Buscar por nombre, alias o email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#00bfff] transition-colors text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#003572]/10 dark:bg-[#00bfff]/5 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Members list */}
      {!loading && !error && (
        <div className="space-y-2">
          {members.length === 0 && (
            <p className="font-body text-sm text-gray-500 text-center py-12">No hay miembros todavía.</p>
          )}
          {members.length > 0 && filteredMembers.length === 0 && (
            <p className="font-body text-sm text-gray-500 text-center py-12">
              Sin resultados para &ldquo;{query}&rdquo;
            </p>
          )}
          {filteredMembers.map((m) => (
            <div
              key={m._id}
              className="brand-member-row group flex items-center gap-4 rounded-xl px-4 py-3 transition-all"
            >
              <Avatar
                name={m.alias?.trim() || m.member_name}
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
                    <span className="font-body text-sm text-[#00bfff]/60 truncate">{m.member_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="font-body text-sm text-[#C8D8EB]/50 dark:text-[#C8D8EB]/35 truncate">{m.email}</p>
                  {(m.memberType ?? []).map(t => (
                    <span key={t} className="font-label text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-400 border border-[#003572]/15 dark:border-[#00bfff]/15">
                      {TYPE_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Role badge */}
              <span className={`hidden sm:inline-flex font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role ?? "member"]}`}>
                {ROLE_LABEL[m.role ?? "member"]}
              </span>

              {/* Password indicator */}
              <span
                title={m.hasPassword ? "Tiene contraseña" : "Sin contraseña"}
                className={`w-2 h-2 rounded-full shrink-0 ${m.hasPassword ? "bg-green-500" : "bg-gray-600"}`}
              />

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {role === "super-admin" && (
                  <ActionBtn title="Ver como este miembro" onClick={() => handleImpersonate(m._id)}>
                    <MaskIcon />
                  </ActionBtn>
                )}
                <ActionBtn title="Editar" onClick={() => openModal({ type: "edit", member: m })}>
                  <PencilIcon />
                </ActionBtn>
                <ActionBtn title="Contraseña" onClick={() => openModal({ type: "password", member: m })}>
                  <KeyIcon />
                </ActionBtn>
                <ActionBtn title="Eliminar" onClick={() => openModal({ type: "delete", member: m })} danger>
                  <TrashIcon />
                </ActionBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {!loading && members.length > 0 && (
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-600 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Con contraseña
          <span className="w-2 h-2 rounded-full bg-gray-600 inline-block ml-2" /> Solo SSO
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#003572] dark:bg-[#0a1929] border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === "add" && (
        <Modal title="Agregar miembro" onClose={closeModal} status={modalError}>
          <MemberForm onSubmit={handleAdd} onClose={closeModal} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "edit" && (
        <Modal title="Editar miembro" onClose={closeModal} status={modalError}>
          <MemberForm initial={modal.member} onSubmit={handleEdit} onClose={closeModal} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "password" && (
        <Modal title="Establecer contraseña" onClose={closeModal} status={modalError}>
          <PasswordForm member={modal.member} onSubmit={handlePassword} onClose={closeModal} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "delete" && (
        <Modal title="Eliminar miembro" onClose={closeModal} status={modalError}>
          <p className="font-body text-sm text-gray-400">
            ¿Eliminar a <span className="text-red-400 font-semibold">{modal.member.member_name}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={closeModal} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={submitting} className="flex-1 py-2 rounded-lg bg-red-800/60 hover:bg-red-700/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
              {submitting ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────
function ActionBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${danger ? "hover:bg-red-500/20 hover:text-red-400 text-gray-500" : "hover:bg-[#00bfff]/10 hover:text-[#00bfff] text-gray-500"}`}
    >
      {children}
    </button>
  );
}

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
