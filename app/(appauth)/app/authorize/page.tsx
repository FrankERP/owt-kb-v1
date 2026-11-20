// /app/authorize — the native apps' sign-in confirmation (ADR-0091, spec §3.1, D5).
//
// Behind the session middleware: a browser with no session goes through
// sign-in and comes back with its query intact (NextAuth's DEFAULT `redirect`
// callback, `authRedirectCallback.test.ts`). Then, in order: the preflight
// (404/503), the person (session, impersonation, live access, the Android
// version gate), the request (the SAME validator the POST re-runs). An
// unverified client or redirect is an error PAGE, never a redirect.
//
// ONE VISIBLE TAP, NEVER A SILENT CODE: this page mints nothing and never
// submits itself (no script, no auto-submitting form — tested). Only the
// person's tap on «Entrar a la app» posts to `/app/authorize/submit`, the one
// thing that mints a code. On Android ≤ 11 (refused anyway) or after a manual
// «open by default» approval another app could receive our redirect, so a flow
// started by anything but the person must stop at this screen.
//
// Headers (Referrer-Policy same-origin, framing refused, no-store, Accept-CH
// for the Android version) are set in `next.config.mjs`.

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Button from "@/app/components/ui/Button";
import { appPreflight } from "@/app/appAuth/preflight";
import { appAuthorizeFormFields, validateAppAuthorizeRequest } from "@/app/appAuth/authorizeRequest";
import { AUTHORIZE_REFUSAL_TEXT, checkAuthorizePerson } from "@/app/appAuth/authorizePerson";
import { searchParamsFromRecord } from "@/app/mcp/oauth/authorizeRequest";
import { serverClient } from "@/sanity/lib/serverClient";
import AppAuthScreen, { AppAuthMessage } from "../../AppAuthScreen";

export const dynamic = "force-dynamic";

const ERROR_PAGE_TEXT = {
  invalid_client: "Esta solicitud no viene de la app Backstage. No se autorizó nada.",
  invalid_redirect_uri: "La dirección de regreso de esta solicitud no es la de la app. No se autorizó nada.",
} as const;

async function displayName(sanityId: string): Promise<{ name: string; photoUrl: string | null }> {
  try {
    const row = await serverClient.fetch<{ name?: string | null; photoUrl?: string | null } | null>(
      `*[_type == "teamMembers" && _id == $id][0]{ "name": coalesce(alias, member_name), "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl) }`,
      { id: sanityId },
    );
    return { name: row?.name || "tu cuenta", photoUrl: row?.photoUrl ?? null };
  } catch {
    return { name: "tu cuenta", photoUrl: null };
  }
}

export default async function AppAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const h = await headers();
  const preflight = appPreflight({ headers: h });
  if (!preflight.ok) {
    if (preflight.status === 404) notFound();
    return (
      <AppAuthScreen title="No disponible">
        <AppAuthMessage>La entrada a la app no está disponible en este momento.</AppAuthMessage>
      </AppAuthScreen>
    );
  }
  const { origin } = preflight;

  const person = await checkAuthorizePerson(h);
  if (!person.ok) {
    const text = AUTHORIZE_REFUSAL_TEXT[person.reason];
    return (
      <AppAuthScreen title={text.title}>
        <AppAuthMessage>{text.body}</AppAuthMessage>
      </AppAuthScreen>
    );
  }

  const validation = validateAppAuthorizeRequest(searchParamsFromRecord(await searchParams), origin);
  if (validation.kind === "error-page") {
    return (
      <AppAuthScreen title="Solicitud no válida">
        <AppAuthMessage>{ERROR_PAGE_TEXT[validation.reason]}</AppAuthMessage>
      </AppAuthScreen>
    );
  }
  if (validation.kind === "error-redirect") redirect(validation.location);

  const who = await displayName(person.sanityId);
  return (
    <AppAuthScreen title="Entrar a la app">
      {who.photoUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- a single avatar on a scriptless page; next/image adds a client loader
        <img src={who.photoUrl} alt="" width={72} height={72} className="mx-auto h-18 w-18 rounded-full object-cover" />
      )}
      <AppAuthMessage>
        ¿Entrar a la app Backstage en este dispositivo como <strong className="text-ink">{who.name}</strong>?
      </AppAuthMessage>
      <form method="POST" action="/app/authorize/submit" className="space-y-3">
        {appAuthorizeFormFields(validation.request).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" name="decision" value="allow" variant="primary" size="lg" className="w-full">
          Entrar a la app
        </Button>
        <Button type="submit" name="decision" value="deny" variant="secondary" size="lg" className="w-full">
          Cancelar
        </Button>
      </form>
      <p className="font-body text-sm text-ink-dim">Si no abriste la app Backstage, toca Cancelar.</p>
    </AppAuthScreen>
  );
}
