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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo + title */}
        <div className="flex flex-col items-center gap-4">
          <Image src="/LogoOasis.png" alt="Oasis Worship Team" width={64} height={64} />
          <h1 className="font-display text-2xl uppercase tracking-wide text-center">
            Oasis Worship Team
          </h1>
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">
            Iniciar sesión
          </p>
        </div>

        {/* Error */}
        {errorMsg && (
          <p className="text-sm text-red-400 text-center bg-red-900/20 border border-red-800 rounded-lg px-4 py-3">
            {errorMsg}
          </p>
        )}

        {/* SSO buttons */}
        <div className="space-y-3">
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-[#00bfff]/30 bg-[#00bfff]/5 hover:bg-[#00bfff]/10 transition-colors font-label text-xs uppercase tracking-widest disabled:opacity-50"
          >
            <GoogleIcon />
            Continuar con Google
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-700" />
          <span className="font-label text-xs uppercase tracking-widest text-gray-500">o</span>
          <div className="flex-1 h-px bg-gray-700" />
        </div>

        {/* Credentials */}
        <form onSubmit={handleCredentials} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-[#003572] hover:bg-[#003572]/80 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30 transition-colors font-label text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {loading ? "Iniciando..." : "Iniciar sesión"}
          </button>
          <p className="font-body text-xs text-gray-500 text-center pt-1">
            ¿Olvidaste tu contraseña? Pídele a un administrador que la restablezca.
          </p>
        </form>

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

