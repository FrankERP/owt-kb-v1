"use client";

import { buildICS, ICSEvent } from "@/app/utils/ics";

// Downloads an .ics of the member's upcoming assigned services so they can
// add them to any calendar app in one tap.
export default function AddToCalendarButton({ services }: { services: ICSEvent[] }) {
  if (!services.length) return null;

  function download() {
    const ics = buildICS(services);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mis-servicios-owt.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      type="button"
      onClick={download}
      title="Descargar tus servicios como evento de calendario (.ics)"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-[10px] uppercase tracking-widest text-gray-500 hover:border-[#00bfff] hover:text-[#00bfff] transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        <line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" />
      </svg>
      Añadir a calendario
    </button>
  );
}
