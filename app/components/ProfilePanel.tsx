"use client";

import { useState, useRef, useEffect, useId } from "react";
import { ACCOUNT_ROW_CLASS, AccountRowBody } from "./account/AccountList";
import Button from "./ui/Button";
import CueDialog from "./ui/CueDialog";
import CueDialogStatus from "./ui/CueDialogStatus";
import EmailPrefToggles, { EMAIL_PREF_ROWS, resolveEmailPrefs } from "./ui/EmailPrefToggles";
import Skeleton from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { roleLabel } from "@/app/utils/roleLabel";

// The member's own profile on `/me/ajustes`: three sections in the page's own
// type (the «millones» pass, 2026-10-26) — Perfil (photo, name, alias and email
// as hairline fields, «Guardar perfil»), Contraseña (one row that opens a sheet
// with the password form) and Correos (the five switches as hairline rows). It
// used to be a compact card whose «Editar perfil» opened a sheet holding all of
// it: a member changing one switch went through a dialog to reach it, and the
// sheet put three password fields in front of everyone, every time. Only the
// password keeps a sheet now, because it is the one edit with a form that is
// not worth a screen's height when nobody is changing it.
//
// Rendered as a FRAGMENT of sections, so `SettingsCard` can stack them in its
// right column with the same rhythm as the left one.

export interface MemberProfile {
  _id: string;
  member_name: string;
  alias?: string;
  email: string;
  role: string;
  photoUrl?: string;
  hasPassword: boolean;
  notifPrefs?: Record<string, unknown>;
}

// A hairline field: the label in the sheet's small caps above, the value at
// 17 px, a rule under it. Never under 16 px on a phone: WebKit auto-zooms any
// focused control smaller than that and never zooms back, which pushed the tab
// bar off screen on the simulator (F3). `inputFontSize.test.ts` is the guard.
const inputCls =
  "w-full rounded-none border-0 border-b border-ink/[0.18] bg-transparent px-0 pb-2 pt-1 font-body text-[17px] text-ink placeholder:text-placeholder transition-colors focus:border-accent focus:outline-none";
const labelCls = "font-label text-[11px] uppercase tracking-[0.12em] text-ink-muted";

function Avatar({
  name, photoUrl, size = "md", onClick, uploading,
}: {
  name: string; photoUrl?: string; size?: "sm" | "md" | "lg";
  onClick?: () => void; uploading?: boolean;
}) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const dim = size === "sm" ? "w-10 h-10" : size === "lg" ? "h-[72px] w-[72px]" : "w-12 h-12";
  const textSize = size === "lg" ? "text-2xl" : "text-sm";

  const inner = (
    <>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-surface-accent-l100-d10 text-on-fill flex items-center justify-center">
          <span className={`font-display ${textSize} text-accent`}>{initials}</span>
        </div>
      )}
      {onClick && (
        <div className="absolute inset-0 bg-scrim/50 flex flex-col items-center justify-center gap-1 opacity-0 group-hover/av:opacity-100 transition-opacity">
          {uploading ? (
            <Skeleton rounded="full" className="w-4 h-4" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        className={`relative ${dim} rounded-full overflow-hidden shrink-0 group/av cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base`}>
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
  // The password sheet, and the row that opens it (focus returns there).
  const [pwOpen, setPwOpen]   = useState(false);
  const pwRowRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const fid = (name: string) => `${ids}-${name}`;
  const { toast } = useToast();
  const [panelStatus, setPanelStatus] = useState<{ tone: "error" | "pending"; message: string } | null>(null);

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

  // Email notifications — the RESOLVED value per type, not the raw field. With no
  // data migration the five are unset for anyone who opted out of the legacy
  // `notifPrefs.email`, and an unset boolean would draw as its `true` default:
  // five switches ON for a member receiving nothing.
  const [emailPrefs, setEmailPrefs] = useState(() => resolveEmailPrefs(initialMember.notifPrefs));
  const [savingPrefField, setSavingPrefField] = useState<string | null>(null);

  // Re-seed the form when the PERSON changes — keyed on `_id`, not on the object.
  //
  // `initialMember` is a fresh object on every server render of `/me`, and this
  // effect overwrites `alias`/`email` with the server's values. Keyed on the
  // object it was one `router.refresh()` away from wiping a half-typed alias
  // mid-word, with no way for the member to tell what happened. Nothing on `/me`
  // refreshes the route today (audited 2026-09-13: the four `router.refresh()`
  // calls are all on other surfaces), so this was latent rather than live — but
  // "latent" here means "the next feature on this page turns it on".
  //
  // `_id` is the dependency that expresses the real intent: a DIFFERENT member is
  // now being shown — a super-admin ending an impersonation is the case that
  // exists — so the form must be re-seeded. Same member, new object, means the
  // page re-rendered, and a re-render must not touch what the member is typing.
  // Post-save sync is unaffected: `handleSaveProfile` sets `member` itself.
  useEffect(() => {
    setMember(initialMember);
    setAlias(initialMember.alias ?? "");
    setEmail(initialMember.email ?? "");
    setEmailPrefs(resolveEmailPrefs(initialMember.notifPrefs));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity, not the object: see above
  }, [initialMember._id]);

  const showToast = (msg: string, ok = true) => toast({ message: msg, tone: ok ? "ok" : "error", duration: 3500 });

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setPanelStatus({ tone: "pending", message: "Guardando perfil…" });
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, email }),
      });
      if (res.ok) {
        setMember((m) => ({ ...m, alias: alias.trim() || undefined, email }));
        setPanelStatus(null);
        showToast("Perfil actualizado.");
      } else {
        const { error } = await res.json().catch(() => ({ error: "Error al guardar." }));
        setPanelStatus({ tone: "error", message: error });
      }
    } catch {
      setPanelStatus({ tone: "error", message: "Error de conexión." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadingPhoto(true);
    setPanelStatus({ tone: "pending", message: "Subiendo foto…" });
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch("/api/me/photo", { method: "POST", body: fd });
      if (res.ok) {
        const { photoUrl } = await res.json();
        setMember((m) => ({ ...m, photoUrl }));
        setPanelStatus(null);
        showToast("Foto actualizada.");
      } else {
        const { error } = await res.json().catch(() => ({ error: "Error al subir la foto." }));
        setPanelStatus({ tone: "error", message: error });
      }
    } catch {
      setPanelStatus({ tone: "error", message: "Error de conexión." });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSavePassword = async () => {
    setPwError(null);
    if (newPw.length < 8) { setPwError("Mínimo 8 caracteres."); return; }
    if (newPw !== confirmPw) { setPwError("Las contraseñas no coinciden."); return; }
    setSavingPw(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw || undefined, newPassword: newPw }),
      });
      if (res.ok) {
        setCurrentPw(""); setNewPw(""); setConfirmPw("");
        setMember((m) => ({ ...m, hasPassword: true }));
        setPwOpen(false);
        showToast("Contraseña actualizada.");
      } else {
        const { error } = await res.json().catch(() => ({ error: "Error al actualizar contraseña." }));
        setPwError(error);
      }
    } catch {
      setPwError("Error de conexión.");
    } finally {
      setSavingPw(false);
    }
  };

  const handleToggleEmailPref = async (field: string, next: boolean) => {
    const label = EMAIL_PREF_ROWS.find((r) => r.field === field)?.label ?? "Correos";
    setEmailPrefs((p) => ({ ...p, [field]: next }));   // optimistic
    setSavingPrefField(field);
    setPanelStatus({ tone: "pending", message: "Guardando preferencia…" });
    try {
      const res = await fetch("/api/me/notif-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (res.ok) {
        setPanelStatus(null);
        showToast(`${label}: correos ${next ? "activados" : "desactivados"}.`);
      } else {
        setEmailPrefs((p) => ({ ...p, [field]: !next }));   // revert on failure
        setPanelStatus({ tone: "error", message: "Error al guardar la preferencia." });
      }
    } catch {
      setEmailPrefs((p) => ({ ...p, [field]: !next }));     // revert on network error too
      setPanelStatus({ tone: "error", message: "Error al guardar la preferencia." });
    } finally {
      setSavingPrefField(null);
    }
  };

  const displayName = member.alias?.trim() || member.member_name;
  // «Frank Rocha · Super Admin», or just the role when the alias is the name.
  const roleLine = [member.alias?.trim() ? member.member_name : null, roleLabel(member.role)]
    .filter(Boolean)
    .join(" · ");

  function closePw() {
    if (savingPw) return;
    setPwOpen(false);
    setPwError(null);
  }

  return (
    <>
      {/* ── Perfil ─────────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <h2 className={SHEET_TITLE}>Perfil</h2>
        <div className="flex items-center gap-4">
          <Avatar
            name={displayName}
            photoUrl={member.photoUrl}
            size="lg"
            onClick={() => photoInputRef.current?.click()}
            uploading={uploadingPhoto}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-xl font-semibold text-ink">{displayName}</p>
            <p className="truncate font-body text-sm text-ink-muted">{roleLine}</p>
          </div>
        </div>
        <input ref={photoInputRef} type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
        <div>
          <Button
            variant="ghost"
            size="lg"
            className="-ml-4"
            onClick={() => photoInputRef.current?.click()}
            busy={uploadingPhoto}
            busyLabel="Subiendo foto…"
          >
            Cambiar foto
          </Button>
        </div>

        {panelStatus && <CueDialogStatus tone={panelStatus.tone}>{panelStatus.message}</CueDialogStatus>}

        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSaveProfile(); }}>
          <div className="space-y-1">
            <label htmlFor={fid("alias")} className={labelCls}>Alias</label>
            <input
              id={fid("alias")}
              className={inputCls}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Nombre corto o apodo (opcional)"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={fid("email")} className={labelCls}>Email</label>
            <input
              id={fid("email")}
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <Button type="submit" variant="secondary" size="lg" busy={savingProfile} busyLabel="Guardando…">
              Guardar perfil
            </Button>
          </div>
        </form>
      </section>

      {/* ── Contraseña ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={SHEET_TITLE}>Contraseña</h2>
        <div className="border-y border-ink/[0.10]">
          <button ref={pwRowRef} type="button" onClick={() => setPwOpen(true)} className={ACCOUNT_ROW_CLASS}>
            <AccountRowBody
              title={member.hasPassword ? "Cambiar contraseña" : "Establecer contraseña"}
              status={
                member.hasPassword
                  ? "Para entrar con tu correo. Tu sesión actual no se cierra."
                  : "Para entrar con tu correo además de Google."
              }
            />
          </button>
        </div>
      </section>

      {/* ── Correos ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={SHEET_TITLE}>Correos</h2>
        <p className="font-body text-[15px] leading-snug text-ink-muted">Elige qué avisos quieres recibir por correo.</p>
        <EmailPrefToggles
          values={emailPrefs}
          onToggle={handleToggleEmailPref}
          memberRole={member.role}
          busyField={savingPrefField}
          layout="list"
        />
      </section>

      {/* The password form, in a sheet: the one edit whose three fields are not
          worth a screen's height when nobody is changing them. Focus rules are
          `CueDialog`'s own (entry focus on the presence edge — ADR-0034). */}
      <CueDialog
        open={pwOpen}
        title={member.hasPassword ? "Cambiar contraseña" : "Establecer contraseña"}
        label="Contraseña"
        restoreFocusRef={pwRowRef}
        mode="sheet"
        size="sm"
        onDismiss={closePw}
      >
        <form
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6"
          onSubmit={(e) => { e.preventDefault(); void handleSavePassword(); }}
        >
          <p className="font-body text-[15px] leading-snug text-ink-muted">
            {member.hasPassword
              ? "Actualiza tu contraseña de acceso por correo."
              : "Establece una contraseña para iniciar sesión con tu correo además de Google."}
          </p>
          {pwError && <CueDialogStatus tone="error">{pwError}</CueDialogStatus>}
          {member.hasPassword && (
            <div className="space-y-1">
              <label htmlFor={fid("current-pw")} className={labelCls}>Contraseña actual</label>
              <input id={fid("current-pw")} autoComplete="current-password" className={inputCls} type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor={fid("new-pw")} className={labelCls}>Nueva contraseña</label>
            <input id={fid("new-pw")} autoComplete="new-password" className={inputCls} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mín. 8 caracteres" />
          </div>
          <div className="space-y-1">
            <label htmlFor={fid("confirm-pw")} className={labelCls}>Confirmar contraseña</label>
            <input id={fid("confirm-pw")} autoComplete="new-password" className={inputCls} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repetir contraseña" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="lg" onClick={closePw} disabled={savingPw}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={!newPw} busy={savingPw} busyLabel="Guardando…">
              {member.hasPassword ? "Actualizar contraseña" : "Establecer contraseña"}
            </Button>
          </div>
        </form>
      </CueDialog>
    </>
  );
}
