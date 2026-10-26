// The hairline text field of the «millones» pass (2026-10-26): a `font-label`
// label above, the value at 17 px in the body face, one rule under it — no box.
// ONE spelling for `ProfilePanel`'s Alias/Email/password fields and the note
// sheet's «Razón», so a focus or contrast fix lands in both. Never under 16 px
// on a phone: WebKit auto-zooms a smaller focused control and never zooms back
// (`inputFontSize.test.ts`). NEUTRAL module — strings only, no "use client".

export const HAIRLINE_INPUT_CLASS =
  "w-full rounded-none border-0 border-b border-ink/[0.18] bg-transparent px-0 pb-2 pt-1 font-body text-[17px] text-ink placeholder:text-placeholder transition-colors focus:border-accent focus:outline-none";

export const HAIRLINE_LABEL_CLASS = "font-label text-[11px] uppercase tracking-[0.12em] text-ink-muted";
