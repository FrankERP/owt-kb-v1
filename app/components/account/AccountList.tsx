// «Tu cuenta» — the list at the foot of `/me` (design pass C, 2026-10-22): one
// row per place a member goes to about themselves — Disponibilidad, Calendario,
// Ajustes, and the one-shot `.ics` download — each an icon in a tinted square,
// a title, a one-line status, and a chevron. Before this the page ended on a
// lone bordered «Disponibilidad» link, the settings were only in the avatar
// menu, and «Añadir a calendario» floated top-right above the hero card.
//
// NEUTRAL module — no hooks, no "use client" — so the Server Component that is
// `/me` renders the links as JSX (ADR-0028). The download row needs a click
// handler, so it is a sibling client component (`DownloadCalendarRow`) that
// renders the same `AccountRowBody`: one body, two hosts, so a link row and a
// button row cannot drift apart.

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/app/components/ui/icons";

/** The row's one layout. The status wraps under the title, never beside it, so
 *  «Disponibilidad» and «3 fechas marcadas» — two unbreakable words — fit a
 *  375pt phone at «Máximo» text size (`textZoomLayout.test.ts`). */
export const ACCOUNT_ROW_CLASS =
  "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-accent/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";

export function AccountRowBody({ icon, title, status }: { icon: ReactNode; title: string; status?: string }) {
  return (
    <>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-base font-semibold text-ink">{title}</span>
        {status && <span className="block font-body text-[13px] text-mono-500">{status}</span>}
      </span>
      <ChevronRightIcon size={16} className="shrink-0 text-mono-500" />
    </>
  );
}

export function AccountLinkRow({ href, icon, title, status }: { href: string; icon: ReactNode; title: string; status?: string }) {
  return (
    <li>
      <Link href={href} className={ACCOUNT_ROW_CLASS}>
        <AccountRowBody icon={icon} title={title} status={status} />
      </Link>
    </li>
  );
}

/** The list itself: a raised card whose rows are divided by a hairline. */
export default function AccountList({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className="divide-y divide-ink/[0.06] overflow-hidden rounded-2xl border border-edge-accent-subtle bg-surface-raised"
    >
      {children}
    </ul>
  );
}
