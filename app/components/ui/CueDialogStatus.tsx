"use client";

type CueDialogStatusTone = "error" | "pending" | "info" | "success";

const toneClasses: Record<CueDialogStatusTone, string> = {
  error: "border-red-400/35 bg-red-500/10 text-red-100",
  pending: "border-accent/30 bg-accent/10 text-ink",
  info: "border-ink-dim/25 bg-ink-dim/10 text-ink",
  success: "border-positive-fg/35 bg-positive-fg/10 text-ink",
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
