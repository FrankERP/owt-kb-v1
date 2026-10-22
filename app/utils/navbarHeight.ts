// Neutral. The ONE spelling of the top bar's height — Navbar and NavbarSkeleton
// both import it so loading.tsx never hard-codes a height that can drift from
// the real navbar (spec §5.3).
export const NAVBAR_H_CLASS = "h-20 lg:h-24";

// The scroll margin an anchored section needs to land BELOW that sticky navbar
// (5rem / 6rem = the heights above, plus the safe-area inset and the
// impersonation banner's `--impersonation-offset`, never `--impersonation-h`).
// One spelling, so `#tu-cuenta`, `#calendario` and the library's letter sections
// cannot drift from each other when the navbar's height changes.
export const UNDER_NAVBAR_SCROLL_MT =
  "scroll-mt-[calc(5rem+env(safe-area-inset-top)+var(--impersonation-offset))] lg:scroll-mt-[calc(6rem+env(safe-area-inset-top)+var(--impersonation-offset))]";
