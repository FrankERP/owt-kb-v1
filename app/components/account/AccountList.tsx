// «Tu cuenta» — the list at the foot of `/me` (design pass C, 2026-10-22; the
// «millones» pass, 2026-10-24): one row per place a member goes to about
// themselves — Disponibilidad, Calendario, Ajustes, and the one-shot `.ics`
// download — a 17 px title with a one-line status under it, and a chevron.
// Hairline rows in the page's own type since the «millones» pass: the raised
// card and the tinted icon squares it had were the last card on a page that is
// now a run sheet. Before design pass C the page ended on a lone bordered
// «Disponibilidad» link, the settings were only in the avatar menu, and «Añadir
// a calendario» floated top-right above the hero card.
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
  "flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-accent/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";

/** `trailing` is the row's right-hand glyph: the chevron of a link, or what a button row does. */
export function AccountRowBody({ title, status, trailing }: { title: string; status?: string; trailing?: ReactNode }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[17px] font-semibold text-ink">{title}</span>
        {status && <span className="block font-body text-sm text-ink-muted">{status}</span>}
      </span>
      {trailing ?? <ChevronRightIcon size={16} className="shrink-0 text-ink-dim" />}
    </>
  );
}

export function AccountLinkRow({ href, title, status }: { href: string; title: string; status?: string }) {
  return (
    <li>
      <Link href={href} className={ACCOUNT_ROW_CLASS}>
        <AccountRowBody title={title} status={status} />
      </Link>
    </li>
  );
}

/** The list itself: hairline rows, a hairline above and below. */
export default function AccountList({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <ul aria-labelledby={labelledBy} className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
      {children}
    </ul>
  );
}
