import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import SettingsCard from "@/app/components/SettingsCard";
import { revealProps } from "@/app/utils/reveal";
import { MEMBER_PROFILE_QUERY } from "../queries";

// Ajustes, alone (R3 F3). Tema, Tamaño de texto and Perfil used to sit at the
// bottom of `/me`, below the services, the availability calendar and the Kids
// block — so «Editar perfil» in the header was a hash link across most of a
// phone-page. They are a destination now, reached from the avatar menu, and
// `/me` answers "who am I and when do I serve".
//
// MINISTRY-NEUTRAL: a theme, a text size and an email address belong to the
// person, not to a ministry, so a kids-only volunteer reaches this page and gets
// the whole card. No `requireWorshipPage`, and nothing here reads a Tipo, an
// assignment or a ministry.

export const metadata: Metadata = {
  title: "Ajustes — Oasis Worship Team",
  description: "Tu tema, el tamaño del texto y tu perfil.",
};

export const revalidate = 60;

export default async function AjustesPage() {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me/ajustes");

  const { sanityId } = session.user;

  // Typed so a projection edit that drops a field `MemberProfile` requires fails
  // the compiler rather than the panel: `email`, `role` and `hasPassword` are
  // non-optional there because every `teamMembers` document carries them.
  const member = await serverClient.fetch<{
    _id: string;
    // `_rev` comes back with the shared projection and is NOT a save precondition
    // here: `ProfilePanel` PATCHes its fields through `/api/me`, `/api/me/photo`,
    // `/api/me/password` and `/api/me/notif-prefs`, none of which take an
    // `ifRevisionId`. Do not start writing with it — the one write a revision
    // guards is the availability calendar's, on `/me/disponibilidad`.
    _rev: string;
    member_name: string;
    email: string;
    role: string;
    alias?: string;
    notifPrefs?: Record<string, unknown>;
    photoUrl?: string;
    hasPassword: boolean;
  } | null>(MEMBER_PROFILE_QUERY, { id: sanityId });

  return (
    <div>
      <Navbar title={member?.alias?.trim() || "Ajustes"} schedule tags />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        <div {...revealProps(0)}>
          {/* Back to the page this hangs off, not to wherever history points. */}
          <Button variant="ghost" size="sm" href="/me">
            ← Mi semana
          </Button>
          <h1 className="font-display text-2xl uppercase tracking-wide mt-2">
            Ajustes
          </h1>
        </div>

        {/* A null read is not an empty state — every signed-in member has a
            document, so null means this one was not found. Tema and Tamaño de
            texto still render: the second is device-local, and the first PATCHes
            /api/me/theme and reports its own write failure. Only Perfil goes,
            because it has nothing to edit. */}
        {member ? (
          <SettingsCard member={member} {...revealProps(1)} />
        ) : (
          <>
            {/* No live-region role: this is server-rendered and present at first
                paint, so nothing is being INSERTED for a live region to
                announce. The heading carries the message. */}
            <section
              className="rounded-xl border border-negative-strong/30 bg-negative-surface-deepest/35 px-5 py-8 text-center"
              {...revealProps(1)}
            >
              <h2 className="font-display text-lg uppercase text-negative-fg">No pudimos cargar tu perfil</h2>
              <p className="font-body text-sm text-mono-500 mt-1">
                Tus datos de perfil no están disponibles ahora mismo.
                Recarga la página; si sigue igual, avísale a un administrador.
              </p>
            </section>
            <SettingsCard member={null} {...revealProps(2)} />
          </>
        )}
      </div>
    </div>
  );
}
