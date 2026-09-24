import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { revealProps } from "@/app/utils/reveal";
import Button from "@/app/components/ui/Button";
import { mcpRoutePreflight } from "@/app/mcp/oauth/guard";
import {
  authorizeFormFields,
  searchParamsFromRecord,
  validateAuthorizeRequest,
  type AuthorizeErrorPageReason,
} from "@/app/mcp/oauth/authorizeRequest";
import { registrationAgeLabel } from "@/app/mcp/oauth/registrationAge";

// The OAuth consent screen (P0 plan step 7, spec O1/O8). claude.ai sends the
// browser here to connect the MCP connector; the approval itself is a POST to
// `/api/oauth/authorize`, the only thing that mints a code. This page mints
// nothing and redirects only an error, only to a VERIFIED redirect_uri.
//
// Registration is open to anyone, so this screen is what stands between a
// super-admin who opens someone else's authorize link and a silently issued
// code (the confused-deputy attack). Hence: the client's name is shown as
// self-declared and unverified, the exact redirect URI and the registration's
// age are shown, the warning is explicit, and consent is NEVER remembered —
// every request renders this page and needs its own «Permitir».
//
// Gated by the session middleware (`proxy.ts`), deliberately: a cookie-less
// browser goes through sign-in and comes back with the full query, because
// NextAuth's DEFAULT `redirect` callback keeps a relative callbackUrl verbatim.
//
// Order: the preflight (R17 — a Server Component cannot return its Response,
// so 404 → notFound() and 503 → «no disponible»), then the human (no session,
// impersonation, live role — shown here and never redirected to the client),
// then the request through the SAME validator the POST re-runs (R18).

export const metadata: Metadata = {
  title: "Autorizar conexión — Oasis Worship Team",
  robots: { index: false, follow: false },
};

// Every request is a fresh decision: nothing about a consent is cached.
export const dynamic = "force-dynamic";

const ERROR_PAGE_TEXT: Record<AuthorizeErrorPageReason, string> = {
  invalid_client:
    "La aplicación que pidió esta conexión no está registrada en este sitio. No se autorizó nada.",
  invalid_redirect_uri:
    "La dirección de regreso de esta solicitud no coincide con la que registró la aplicación. No se autorizó nada.",
};

/** The dt/dd label style, shared by the three facts. */
const FACT_LABEL = "font-label text-[11px] uppercase tracking-widest text-ink-dim";

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6" {...revealProps(0)}>
        <h1 className="font-display text-xl uppercase tracking-wide text-center">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="font-body text-sm text-ink-dim text-center">{children}</p>;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preflight = mcpRoutePreflight({ headers: await headers() });
  if (!preflight.ok) {
    if (preflight.response.status === 404) notFound();
    return (
      <Screen title="No disponible">
        <Message>La conexión con Claude no está disponible en este momento.</Message>
      </Screen>
    );
  }
  const { origin, key } = preflight;

  const session = await requireActiveSession();
  if (!session) {
    return (
      <Screen title="Inicia sesión">
        <Message>Necesitas una sesión activa de super-admin para autorizar una conexión.</Message>
      </Screen>
    );
  }
  if (session.user.isImpersonating) {
    return (
      <Screen title="Suplantación activa">
        <Message>Estás viendo la app como otro miembro: sal de la suplantación para conectar.</Message>
      </Screen>
    );
  }
  const access = await getMemberAccess(session.user.sanityId);
  if (!access.active || access.role !== "super-admin") {
    return (
      <Screen title="Sin permiso">
        <Message>Sólo un super-admin puede autorizar conexiones con Claude.</Message>
      </Screen>
    );
  }

  const validation = await validateAuthorizeRequest(searchParamsFromRecord(await searchParams), { origin, key });
  if (validation.kind === "error-page") {
    return (
      <Screen title="Solicitud no válida">
        <Message>{ERROR_PAGE_TEXT[validation.reason]}</Message>
      </Screen>
    );
  }
  if (validation.kind === "error-redirect") redirect(validation.location);

  const { request, client } = validation;
  return (
    <Screen title="Autorizar conexión">
      <Message>Una aplicación pide acceso a Backstage con tu cuenta.</Message>
      <dl className="space-y-4 rounded-lg border border-ink-dim/20 bg-surface-console/75 p-5">
        <div>
          <dt className={FACT_LABEL}>Nombre declarado por la aplicación (no verificado)</dt>
          <dd className="mt-1 font-body text-base text-ink break-words">
            {client.name !== null ? <bdi>{client.name}</bdi> : "Sin nombre declarado"}
          </dd>
        </div>
        <div>
          <dt className={FACT_LABEL}>Dirección de regreso</dt>
          <dd className="mt-1 font-body text-sm text-ink break-all">{request.redirectUri}</dd>
        </div>
        <div>
          <dt className={FACT_LABEL}>Registrada</dt>
          <dd className="mt-1 font-body text-sm text-ink">{registrationAgeLabel(client.ageSeconds)}</dd>
        </div>
      </dl>
      <p role="note" className="rounded-lg border border-warning-fg/40 bg-warning-fg/10 px-4 py-3 font-body text-sm text-warning-strong">
        Aprueba sólo si acabas de iniciar esta conexión en Claude.
      </p>
      <form method="POST" action="/api/oauth/authorize" className="flex gap-3">
        {authorizeFormFields(request).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" name="decision" value="deny" variant="secondary" size="lg" className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" name="decision" value="allow" variant="primary" size="lg" className="flex-1">
          Permitir
        </Button>
      </form>
    </Screen>
  );
}
