// The one blob download for an `.ics` built by `buildICS` (2026-10-22): the
// member's whole upcoming list (`DownloadCalendarRow` on `/me`) and a single
// service (`DayCardDisclosure`'s long-press action) used to carry the same nine
// lines each. Browser-only — it touches `document` and `URL.createObjectURL` —
// so it is called from client event handlers, never during a render.

import { buildICS, type ICSEvent } from "./ics";

export function downloadICS(events: ICSEvent[], filename: string): void {
  const blob = new Blob([buildICS(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
