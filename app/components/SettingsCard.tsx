// The whole of `/me/ajustes` under its title (R3 F3; the «millones» pass,
// 2026-10-26): six sections in the page's own type — Tema, Tamaño de texto,
// Calendario, then (when the profile read succeeded) Perfil, Contraseña and
// Correos — each a small-caps section title, a 15 px hint and its control. The
// bordered card with `divide-y` rails and bold subsection headings is gone: on a
// page that is a list of settings the card was a box around the page.
//
// NEUTRAL module — no hooks, no "use client" — so this Server Component renders
// its client children (`ThemeControl`, `TextSizeControl`, `CalendarFeedPanel`,
// `ProfilePanel`) as JSX (ADR-0028); it never CALLS them.
//
// Two columns from `md` (the approved mock): Tema, Tamaño and Calendario on the
// left; Perfil, Contraseña and Correos on the right. The columns are two flex
// stacks, not one grid of six — in a grid the rows share a height, so a tall
// Perfil would push a gap under Tema.
//
// `#tema` stays reachable: ThemeControl keeps rendering its own `id="tema"`,
// so the avatar menu's cross-page `/me/ajustes#tema` still lands on something.
// (The theme announcement banner pointed here too until it was retired on
// 2026-09-13 — ADR-0033.) `#calendario` is `/me`'s «Calendario» row's target.
//
// `member` is nullable on purpose — a failed profile read still renders the
// left column, just without the three profile sections, which have nothing to
// edit without a profile. Tamaño de texto is device-local; Tema is not — it
// PATCHes /api/me/theme and reports its own write failure.
import type { ComponentPropsWithoutRef } from "react";
import { UNDER_NAVBAR_SCROLL_MT } from "@/app/utils/navbarHeight";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import ProfilePanel, { type MemberProfile } from "@/app/components/ProfilePanel";
import TextSizeControl from "@/app/components/TextSizeControl";
import ThemeControl from "@/app/components/ui/ThemeControl";
import CalendarFeedPanel from "@/app/components/CalendarFeedPanel";
import type { CalendarFeedState } from "@/app/utils/calendarFeed";

type Props = ComponentPropsWithoutRef<"section"> & {
  member?: MemberProfile | null;
  /** The «Calendario» section (signed feed URLs from the server). Absent → not rendered. */
  calendarFeed?: CalendarFeedState | null;
};

/** The one vertical rhythm between sections, in both columns. */
export const SETTINGS_COLUMN_CLASS = "space-y-12";

export default function SettingsCard({ member, calendarFeed, className = "", ...rest }: Props) {
  return (
    <section
      id="ajustes"
      className={`md:grid md:grid-cols-2 md:items-start md:gap-x-20 ${className}`}
      {...rest}
    >
      <div className={SETTINGS_COLUMN_CLASS}>
        {/* ThemeControl returns null while impersonating; nothing here wraps it,
            so there is no empty slot left behind. */}
        <ThemeControl />
        <TextSizeControl />
        {/* A link target (`/me`'s «Calendario» row), so it clears the navbar. */}
        {calendarFeed && (
          <section id="calendario" className={UNDER_NAVBAR_SCROLL_MT}>
            <h2 className={`${SHEET_TITLE} mb-4`}>Calendario</h2>
            <CalendarFeedPanel initial={calendarFeed} />
          </section>
        )}
      </div>
      {member && (
        <div className={`${SETTINGS_COLUMN_CLASS} mt-12 md:mt-0`}>
          <ProfilePanel initialMember={member} />
        </div>
      )}
    </section>
  );
}
