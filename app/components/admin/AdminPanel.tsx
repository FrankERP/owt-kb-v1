"use client";

import { useState, useEffect, useCallback } from "react";
import ServicesPanel from "./ServicesPanel";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

interface Member {
  _id: string;
  member_name: string;
  alias?: string;
  email: string;
  role: OWTRole;
  memberType?: string[];
  hasPassword: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  voz: "Voz", instrumento: "Instr.", foh: "FOH",
};

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
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

const selectCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#010b17] dark:bg-[#010b17] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

// ─── Initials avatar ──────────────────────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-[#003572] dark:bg-[#00bfff]/10 flex items-center justify-center shrink-0">
      <span className="font-label text-[11px] text-[#00bfff]">{initials}</span>
    </div>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────
function MemberForm({
  initial,
  onSubmit,
  onClose,
  loading,
}: {
  initial?: Partial<Member>;
  onSubmit: (data: { member_name: string; email: string; role: OWTRole }) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName]   = useState(initial?.member_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [role, setRole]   = useState<OWTRole>(initial?.role ?? "member");

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ member_name: name, email, role }); }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Nombre</label>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Nombre completo" />
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
type Tab = "members" | "services";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tab = (id: Tab, label: string) => (
    <button
      onClick={() => onChange(id)}
      className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
        active === id
          ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB] dark:text-[#00bfff]"
          : "text-gray-500 hover:text-[#00bfff]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-1 p-1 rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 w-fit">
      {tab("members", "Miembros")}
      {tab("services", "Servicios")}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab]           = useState<Tab>("members");
  const [members, setMembers]   = useState<Member[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [modal, setModal]       = useState<ModalState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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

  const handleAdd = async (data: { member_name: string; email: string; role: OWTRole }) => {
    setSubmitting(true);
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchMembers(); showToast("Miembro agregado."); }
    else showToast("Error al agregar miembro.");
  };

  const handleEdit = async (data: { member_name: string; email: string; role: OWTRole }) => {
    if (modal?.type !== "edit") return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/members/${modal.member._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchMembers(); showToast("Miembro actualizado."); }
    else showToast("Error al actualizar.");
  };

  const handlePassword = async (password: string) => {
    if (modal?.type !== "password") return;
    setSubmitting(true);
    const res = await fetch("/api/admin/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sanityMemberId: modal.member._id, password }),
    });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchMembers(); showToast("Contraseña establecida."); }
    else showToast("Error al establecer contraseña.");
  };

  const handleDelete = async () => {
    if (modal?.type !== "delete") return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/members/${modal.member._id}`, { method: "DELETE" });
    setSubmitting(false);
    if (res.ok) { setModal(null); fetchMembers(); showToast("Miembro eliminado."); }
    else showToast("Error al eliminar.");
  };

  if (tab === "services") return (
    <div className="space-y-6">
      <TabBar active={tab} onChange={setTab} />
      <ServicesPanel />
    </div>
  );

  return (
    <div className="space-y-6">
      <TabBar active={tab} onChange={setTab} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Miembros</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-gray-500 mt-0.5">
              {members.length} {members.length === 1 ? "miembro" : "miembros"}
            </p>
          )}
        </div>
        <button
          onClick={() => setModal({ type: "add" })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Agregar
        </button>
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
          {members.map((m) => (
            <div
              key={m._id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 hover:border-[#003572]/30 dark:hover:border-[#00bfff]/20 transition-colors group"
            >
              <Avatar name={m.member_name} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="font-body text-sm font-semibold truncate">{m.member_name}</p>
                  {m.alias?.trim() && (
                    <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70 truncate">"{m.alias.trim()}"</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="font-body text-xs text-gray-500 truncate">{m.email}</p>
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
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionBtn title="Editar" onClick={() => setModal({ type: "edit", member: m })}>
                  <PencilIcon />
                </ActionBtn>
                <ActionBtn title="Contraseña" onClick={() => setModal({ type: "password", member: m })}>
                  <KeyIcon />
                </ActionBtn>
                <ActionBtn title="Eliminar" onClick={() => setModal({ type: "delete", member: m })} danger>
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#003572] dark:bg-[#0a1929] border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === "add" && (
        <Modal title="Agregar miembro" onClose={() => setModal(null)}>
          <MemberForm onSubmit={handleAdd} onClose={() => setModal(null)} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "edit" && (
        <Modal title="Editar miembro" onClose={() => setModal(null)}>
          <MemberForm initial={modal.member} onSubmit={handleEdit} onClose={() => setModal(null)} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "password" && (
        <Modal title="Establecer contraseña" onClose={() => setModal(null)}>
          <PasswordForm member={modal.member} onSubmit={handlePassword} onClose={() => setModal(null)} loading={submitting} />
        </Modal>
      )}

      {modal?.type === "delete" && (
        <Modal title="Eliminar miembro" onClose={() => setModal(null)}>
          <p className="font-body text-sm text-gray-400">
            ¿Eliminar a <span className="text-red-400 font-semibold">{modal.member.member_name}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
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
