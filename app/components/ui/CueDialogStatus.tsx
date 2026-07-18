"use client";

type CueDialogStatusTone = "error" | "pending" | "info" | "success";

const toneClasses: Record<CueDialogStatusTone, string> = {
  error: "border-red-400/35 bg-red-500/10 text-red-100",
  pending: "border-brand-beam/30 bg-brand-beam/10 text-brand-frost",
  info: "border-brand-steel/25 bg-brand-steel/10 text-brand-frost",
  success: "border-brand-signal/35 bg-brand-signal/10 text-brand-frost",
};

export default function CueDialogStatus({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: CueDialogStatusTone;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`rounded-lg border px-3 py-2 font-body text-sm ${toneClasses[tone]}`}
    >
      {children}
    </div>
  );
}
