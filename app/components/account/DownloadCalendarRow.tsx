"use client";

// The «Tu cuenta» row that downloads the member's upcoming services as one
// `.ics` (the one-shot export, not the subscription — that is Ajustes ›
// Calendario). It replaced `AddToCalendarButton`, the secondary button that
// floated above the hero card (design pass C, 2026-10-22): the download is an
// account action, so it lives with the others. Client, because it needs the
// click; the row body is `AccountList`'s, so it matches its link neighbours.
//
// Frank's call (2026-10-22): the download stays on `/me` as well as the
// subscription living under Ajustes — `/me/ajustes` is ministry-neutral and
// reads no assignments, so this page is the one that has the events to export.

import { ACCOUNT_ROW_CLASS, AccountRowBody } from "./AccountList";
import { CalendarAddIcon } from "@/app/components/ui/icons";
import type { ICSEvent } from "@/app/utils/ics";
import { downloadICS } from "@/app/utils/icsDownload";

export default function DownloadCalendarRow({ services }: { services: ICSEvent[] }) {
  if (!services.length) return null;
  const n = services.length;
  return (
    <li>
      {/* A raw `<button>`, deliberately, and the one place a list row is one:
          this is a LIST ROW that happens to act, not a button — the house
          `Button` is an inline, uppercase, tracked control, and a list of four
          rows with one of them styled as a pill would read as a mistake. Its
          hover and focus physics are the list's, shared byte for byte with the
          link rows through `ACCOUNT_ROW_CLASS`, so the two cannot drift. */}
      <button
        type="button"
        className={ACCOUNT_ROW_CLASS}
        onClick={() => downloadICS(services, "mis-servicios-owt.ics")}
      >
        <AccountRowBody
          icon={<CalendarAddIcon size={18} strokeWidth={1.8} />}
          title="Descargar mis servicios"
          status={`${n} servicio${n === 1 ? "" : "s"} · archivo .ics, una sola vez`}
        />
      </button>
    </li>
  );
}
