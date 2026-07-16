"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isNativeApp, nativeGoogleIdToken } from "@/app/utils/native";
import Image from "next/image";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get("callbackUrl") ?? "/";
  const urlError     = searchParams.get("error");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  async function handleGoogle() {
    if (isNativeApp()) {
      setLoading(true);
      try {
        const idToken = await nativeGoogleIdToken();
        if (!idToken) { setCredError("No se pudo iniciar sesión con Google."); return; }
        const res = await signIn("google-native", { idToken, callbackUrl, redirect: false });
        if (res?.error) setCredError("Acceso denegado."); else window.location.assign(res?.url ?? "/");
      } finally {
        setLoading(false);
      }
      return;
    }
    signIn("google", { callbackUrl }); // unchanged web behavior
  }

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setCredError(null);
    const res = await signIn("credentials", { email, password, callbackUrl, redirect: false });
    setLoading(false);
    if (res?.error) {
      setCredError("Email o contraseña incorrectos.");
    } else if (res?.url) {
      window.location.href = res.url;
    }
  };

  const errorMsg = credError ?? (urlError ? "Error al iniciar sesión. Intenta de nuevo." : null);

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10 sm:py-14">
      <div className="w-full max-w-md">

        {/* Backstage identity */}
        <div className="brand-stage-hero mb-7 flex flex-col items-center text-center">
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={88}
            height={88}
            priority
            className="brand-lockup-mark h-[88px] w-[88px] rounded-[24px]"
          />
          <h1 className="mt-5 font-display text-3xl uppercase tracking-[0.16em] text-brand-frost">
            Backstage
          </h1>
          <p className="mt-1 font-label text-[10px] uppercase tracking-[0.24em] text-brand-steel">
            Oasis Worship Team
          </p>
        </div>

        <section className="brand-facet-panel rounded-[var(--brand-radius-panel)] border border-brand-steel/20 bg-brand-console/75 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-6">
          <div className="mb-5">
            <h2 className="font-label text-[10px] uppercase tracking-[0.22em] text-brand-beam">Acceso del equipo</h2>
            <p className="mt-1 font-body text-sm text-brand-steel">Inicia sesión para ver tus servicios y canciones.</p>
          </div>

          {/* Error */}
          {errorMsg && (
            <p className="mb-4 text-sm text-red-300 bg-red-950/35 border border-red-500/30 rounded-[var(--brand-radius-control)] px-4 py-3">
              {errorMsg}
            </p>
          )}

          {/* SSO buttons */}
          <div className="space-y-3">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full min-h-11 flex items-center justify-center gap-3 px-4 py-3 rounded-[var(--brand-radius-control)] border border-brand-beam/35 bg-brand-beam/[0.06] hover:bg-brand-beam/10 transition-colors font-label text-xs uppercase tracking-widest disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-beam/70"
            >
              <GoogleIcon />
              Continuar con Google
            </button>
          </div>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-brand-steel/20" />
            <span className="font-label text-[10px] uppercase tracking-widest text-brand-steel">o</span>
            <div className="flex-1 h-px bg-brand-steel/20" />
          </div>

          {/* Credentials */}
          <form onSubmit={handleCredentials} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              aria-label="Correo electrónico"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full min-h-11 px-4 py-3 rounded-[var(--brand-radius-control)] border border-brand-steel/25 bg-brand-blackout/35 font-body text-sm text-brand-frost placeholder:text-brand-steel/70 focus:outline-none focus:border-brand-beam focus:ring-1 focus:ring-brand-beam/40 transition-colors"
            />
            <input
              type="password"
              placeholder="Contraseña"
              aria-label="Contraseña"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full min-h-11 px-4 py-3 rounded-[var(--brand-radius-control)] border border-brand-steel/25 bg-brand-blackout/35 font-body text-sm text-brand-frost placeholder:text-brand-steel/70 focus:outline-none focus:border-brand-beam focus:ring-1 focus:ring-brand-beam/40 transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-11 py-3 rounded-[var(--brand-radius-control)] bg-brand-beam/20 hover:bg-brand-beam/30 border border-brand-beam/30 transition-colors font-label text-xs uppercase tracking-widest disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-beam/70"
            >
              {loading ? "Iniciando..." : "Iniciar sesión"}
            </button>
            <p className="font-body text-xs text-brand-steel text-center pt-1">
              ¿Olvidaste tu contraseña? Pídele a un administrador que la restablezca.
            </p>
          </form>
        </section>

      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
