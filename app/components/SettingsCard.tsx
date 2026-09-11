// The one Ajustes card on /me — Tema, Tamaño de texto and (when the profile
// read succeeded) the profile, as three subsections of a single bordered card
// rather than three separate ones. NEUTRAL module — no hooks, no "use client" —
// so this Server Component renders its client children (`ThemeControl`,
// `TextSizeControl`, `ProfilePanel`) as JSX (ADR-0028); it never CALLS them.
//
// `#tema` stays reachable: ThemeControl keeps rendering its own `id="tema"`
// (just without its standalone card chrome, via its `bare` prop), nested inside
// this card's own Tema subsection, so `ThemeAnnouncement`'s `href="#tema"`
// anchor still lands on something.
//
// `member` is nullable on purpose — a failed profile read on /me still renders
// Tema and Tamaño de texto (both device-local), just without the Perfil
// subsection, which has nothing to edit without a profile.
import type { ComponentPropsWithoutRef } from "react";
import ProfilePanel, { type MemberProfile } from "@/app/components/ProfilePanel";
import TextSizeControl from "@/app/components/TextSizeControl";
import ThemeControl from "@/app/components/ui/ThemeControl";

type Props = ComponentPropsWithoutRef<"section"> & {
  member?: MemberProfile | null;
};

export default function SettingsCard({ member, className = "", ...rest }: Props) {
  return (
    <section
      id="ajustes"
      className={`rounded-2xl border border-surface-accent-20 divide-y divide-ink-dim/10 ${className}`}
      {...rest}
    >
      {/* ThemeControl returns null while impersonating, so it owns its own padding
          to avoid leaving an empty divided box when it is hidden */}
      <ThemeControl bare />
      <div className="p-5">
        <TextSizeControl bare />
      </div>
      {member && (
        <div className="p-5">
          <h3 className="font-display text-lg font-bold mb-3">Perfil</h3>
          <ProfilePanel initialMember={member} bare />
        </div>
      )}
    </section>
  );
}
