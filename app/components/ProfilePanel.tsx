"use client";

import { useState, useRef, useEffect } from "react";

interface MemberProfile {
  _id: string;
  member_name: string;
  alias?: string;
  email: string;
  role: string;
  photoUrl?: string;
  hasPassword: boolean;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

function Avatar({
  name, photoUrl, size = "md", onClick, uploading,
}: {
  name: string; photoUrl?: string; size?: "sm" | "md" | "lg";
  onClick?: () => void; uploading?: boolean;
}) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const dim = size === "sm" ? "w-10 h-10" : size === "lg" ? "w-20 h-20" : "w-12 h-12";
  const textSize = size === "lg" ? "text-2xl" : "text-sm";

  const inner = (
    <>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-[#003572] dark:bg-[#00bfff]/10 flex items-center justify-center">
          <span className={`font-display ${textSize} text-[#00bfff]`}>{initials}</span>
        </div>
      )}
      {onClick && (
        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1 opacity-0 group-hover/av:opacity-100 transition-opacity">
          {uploading ? (
            <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <button type="button" onClick={onClick} title="Cambiar foto"
        className={`relative ${dim} rounded-full overflow-hidden shrink-0 group/av cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#010b17]`}>
        {inner}
      </button>
    );
  }
  return (
    <div className={`relative ${dim} rounded-full overflow-hidden shrink-0`}>{inner}</div>
  );
}

export default function ProfilePanel({ initialMember }: { initialMember: MemberProfile }) {
  const [member, setMember]   = useState(initialMember);
  const [open, setOpen]       = useState(false);
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  // Identity form
  const [alias, setAlias]     = useState(initialMember.alias ?? "");
  const [email, setEmail]     = useState(initialMember.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Photo
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw]         = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw]   = useState(false);
  const [pwError, setPwError]     = useState<string | null>(null);

  // Sync form state when initialMember prop changes
  useEffect(() => {
    setMember(initialMember);
    setAlias(initialMember.alias ?? "");
    setEmail(initialMember.email ?? "");
  }, [initialMember]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, email }),
    });
    setSavingProfile(false);
    if (res.ok) {
      setMember((m) => ({ ...m, alias: alias.trim() || undefined, email }));
      showToast("Perfil actualizado.");
    } else {
      const { error } = await res.json().catch(() => ({ error: "Error al guardar." }));
      showToast(error, false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingPhoto(true);
    const fd = new FormData();
    fd.append("photo", file);
    const res = await fetch("/api/me/photo", { method: "POST", body: fd });
    setUploadingPhoto(false);
    if (res.ok) {
      const { photoUrl } = await res.json();
      setMember((m) => ({ ...m, photoUrl }));
      showToast("Foto actualizada.");
    } else {
      const { error } = await res.json().catch(() => ({ error: "Error al subir la foto." }));
      showToast(error, false);
    }
  };

  const handleSavePassword = async () => {
    setPwError(null);
    if (newPw.length < 8) { setPwError("Mínimo 8 caracteres."); return; }
    if (newPw !== confirmPw) { setPwError("Las contraseñas no coinciden."); return; }
    setSavingPw(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw || undefined, newPassword: newPw }),
    });
    setSavingPw(false);
    if (res.ok) {
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setMember((m) => ({ ...m, hasPassword: true }));
      showToast("Contraseña actualizada.");
    } else {
      const { error } = await res.json().catch(() => ({ error: "Error al actualizar contraseña." }));
      setPwError(error);
    }
  };

  const displayName = member.alias?.trim() || member.member_name;

  return (
    <>
      {/* ── Compact profile card ─────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5">
        <Avatar name={displayName} photoUrl={member.photoUrl} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-display text-base leading-tight truncate">{displayName}</p>
          {member.alias?.trim() && (
            <p className="font-body text-xs text-[#00bfff]/60 truncate">{member.member_name}</p>
          )}
          <p className="font-label text-[9px] uppercase tracking-widest text-gray-500 mt-0.5">{member.role}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#00bfff]/20 font-label text-[10px] uppercase tracking-widest text-gray-400 hover:border-[#00bfff] hover:text-[#00bfff] transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Editar perfil
        </button>
      </div>

      {/* ── Drawer ───────────────────────────────────────────────────────── */}
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* Panel */}
      <div className={`fixed top-0 right-0 z-50 h-full w-full max-w-md flex flex-col bg-[#C8D8EB] dark:bg-[#0a1929] border-l border-[#003572]/20 dark:border-[#00bfff]/20 shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>

        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#003572]/15 dark:border-[#00bfff]/10 shrink-0">
          <div className="flex items-center gap-4">
            <Avatar
              name={displayName}
              photoUrl={member.photoUrl}
              size="lg"
              onClick={() => photoInputRef.current?.click()}
              uploading={uploadingPhoto}
            />
            <div className="min-w-0">
              <h2 className="font-display text-lg uppercase tracking-wide">Editar perfil</h2>
              <p className="font-body text-xs text-[#00bfff]/60 truncate">{displayName}</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-[#00bfff] transition-colors text-2xl leading-none ml-4 shrink-0"
          >
            ×
          </button>
        </div>
        <input ref={photoInputRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">

          {/* Identity */}
          <section className="space-y-4">
            <h3 className="font-label text-[10px] uppercase tracking-widest text-gray-500">Identidad</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="font-label text-xs uppercase tracking-widest text-gray-500">Alias</label>
                <input
                  className={inputCls}
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Nombre corto o apodo (opcional)"
                />
              </div>
              <div className="space-y-1">
                <label className="font-label text-xs uppercase tracking-widest text-gray-500">Email</label>
                <input
                  className={inputCls}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                />
              </div>
            </div>
            <button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="w-full py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              {savingProfile ? "Guardando…" : "Guardar cambios"}
            </button>
          </section>

          {/* Password */}
          <section className="space-y-4 border-t border-[#003572]/10 dark:border-[#00bfff]/10 pt-6">
            <div>
              <h3 className="font-label text-[10px] uppercase tracking-widest text-gray-500">Contraseña</h3>
              <p className="font-body text-xs text-gray-500 mt-1">
                {member.hasPassword
                  ? "Actualiza tu contraseña de acceso por email."
                  : "Establece una contraseña para iniciar sesión con email además de Google."}
              </p>
            </div>
            {pwError && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{pwError}</p>
            )}
            <div className="space-y-3">
              {member.hasPassword && (
                <div className="space-y-1">
                  <label className="font-label text-xs uppercase tracking-widest text-gray-500">Contraseña actual</label>
                  <input className={inputCls} type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
                </div>
              )}
              <div className="space-y-1">
                <label className="font-label text-xs uppercase tracking-widest text-gray-500">Nueva contraseña</label>
                <input className={inputCls} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mín. 8 caracteres" />
              </div>
              <div className="space-y-1">
                <label className="font-label text-xs uppercase tracking-widest text-gray-500">Confirmar contraseña</label>
                <input className={inputCls} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repetir contraseña" />
              </div>
            </div>
            <button
              onClick={handleSavePassword}
              disabled={savingPw || !newPw}
              className="w-full py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              {savingPw ? "Guardando…" : member.hasPassword ? "Actualizar contraseña" : "Establecer contraseña"}
            </button>
          </section>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl border font-label text-xs uppercase tracking-widest shadow-xl ${
          toast.ok
            ? "bg-[#003572] dark:bg-[#0a1929] border-[#00bfff]/30"
            : "bg-red-900/80 border-red-700"
        }`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
