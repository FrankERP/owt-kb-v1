"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isNativeApp, nativeGoogleIdToken } from "@/app/utils/native";
import Image from "next/image";
import Button from "@/app/components/ui/Button";
import Presence from "@/app/components/ui/Presence";
import { revealProps } from "@/app/utils/reveal";
import { PAGE_LEDE, PAGE_TITLE, SHEET_TITLE } from "@/app/utils/homeHero";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get("callbackUrl") ?? "/";
  const urlError     = searchParams.get("error");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleGoogle() {
    if (isNativeApp()) {
      setLoading(true);
      try {
        const idToken = await nativeGoogleIdToken();
        if (!idToken) { setCredError("No se pudo iniciar sesión con Google."); return; }
        const res = await signIn("google-native", { idToken, callbackUrl, redirect: false });
        if (res?.error) setCredError("Acceso denegado."); else window.location.assign(res?.url ?? "/");
      } catch {
        // The native sign-in sheet was dismissed or the plugin threw: without
        // this the spinner just stops and the screen stays silent.
        setCredError("No se pudo iniciar sesión con Google.");
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
    <div className="flex min-h-screen items-center justify-center px-6 py-12 sm:py-16">
      <div className="w-full max-w-md md:max-w-[440px]">

        {/* The lockup: the mark, the name in the display face and one lede — the same
            page head as every screen of the «millones» pass (ADR-0070), no card and
            no beam. */}
        <div className="space-y-4 md:space-y-5" {...revealProps(0)}>
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={88}
            height={88}
            priority
            className="brand-lockup-mark h-[72px] w-[72px] rounded-[20px] md:h-[88px] md:w-[88px] md:rounded-[24px]"
          />
          <h1 className={PAGE_TITLE}>Backstage</h1>
          <p className={PAGE_LEDE}>Oasis Worship Team · inicia sesión para ver tus servicios y canciones.</p>
        </div>

        <div className="mt-9 space-y-6 md:mt-10" {...revealProps(3)}>
          {/* Error — inside Presence so the region is ABSENT until there is
              something to announce, rather than an empty live region sitting in
              the tree for a screen reader to walk past. A strip, not a box. */}
          <Presence show={!!errorMsg} variant="rise" as="div">
            <p role="alert" className="border-l-2 border-negative-strong/60 py-1 pl-4 font-body text-[15px] leading-snug text-negative-fg">
              {errorMsg}
            </p>
          </Presence>

          <div {...revealProps(4)}>
            <Button variant="secondary" size="lg" className="w-full gap-3" onClick={handleGoogle} disabled={loading}>
              <GoogleIcon />
              Continuar con Google
            </Button>
          </div>

          <div className="flex items-center gap-3.5" aria-hidden="true">
            <span className="h-px flex-1 bg-ink/[0.10]" />
            <span className={SHEET_TITLE}>o con tu correo</span>
            <span className="h-px flex-1 bg-ink/[0.10]" />
          </div>

          {/* Credentials — the hairline fields of Mi perfil (`ui/hairlineField.ts`). */}
          <form onSubmit={handleCredentials} className="space-y-6">
            <div className="space-y-5">
              <label className="block space-y-1.5" {...revealProps(5)}>
                <span className={HAIRLINE_LABEL_CLASS}>Correo</span>
                <input
                  type="email"
                  placeholder="tu@correo.com"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={HAIRLINE_INPUT_CLASS}
                />
              </label>
              <label className="block space-y-1.5" {...revealProps(6)}>
                <span className={HAIRLINE_LABEL_CLASS}>Contraseña</span>
                {/* «Mostrar» sits on the field's own rule: a sign-in typed on a phone is
                    the one place a member cannot see what they wrote. */}
                <span className="relative block">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`${HAIRLINE_INPUT_CLASS} pr-24`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((on) => !on)}
                    className="absolute bottom-1 right-0"
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </Button>
                </span>
              </label>
            </div>
            <div {...revealProps(7)}>
              <Button type="submit" variant="primary" size="lg" className="w-full" busy={loading} busyLabel="Entrando…" disabled={loading}>
                Iniciar sesión
              </Button>
            </div>
            <p className="text-center font-body text-[13px] leading-snug text-ink-dim">
              ¿Olvidaste tu contraseña? Pídele a un administrador que la restablezca.
            </p>
          </form>
        </div>

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
    /* The Google brand mark. These four fills are a third-party trademark: theming
       them would misrepresent someone else's mark, so they are literal by rule, not by
       oversight. Row-level rather than a whole-file ignore — 36 of this file's rows are
       Child B's own, and a file ignore would switch the clause off across all of them. */
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {/* eslint-disable no-restricted-syntax -- Google brand mark, must not be themed */}
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      {/* eslint-enable no-restricted-syntax */}
    </svg>
  );
}
