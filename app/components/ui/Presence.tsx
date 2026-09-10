"use client";

// Mount/unmount with an exit animation (spec §4). Wraps AnimatePresence so a feature
// component writes `<Presence show={open} variant="sheet">` instead of reaching for
// `motion` — the import boundary (motionImportBoundary.test.ts) is what keeps every
// exit in the app on one clock.
//
// Only opacity and transform animate (VARIANTS is guarded for that). Interruptions
// reverse smoothly because AnimatePresence tracks the in-flight value; a
// show→hide→show within EXIT_MS never snaps.
//
// The enter transition is per-variant: `sheet` enters on `SPRINGS.sheet`
// (matching `CueDialog`'s sheet — bottom sheets and the audio transport should
// spring into place, not ease), every other variant enters on the tokenised
// `ENTER` ease. Exit always stays on `EXIT` regardless of variant — a spring on
// the way out would overshoot past the edge it's leaving toward.
//
// A `Presence` mounted already-shown does NOT animate in by default — `initial`
// controls the FIRST RENDER OF THIS INSTANCE, not page load, so a toast created on
// demand or a row appended to a list would otherwise snap in. For the common case
// (a `Presence` that is already mounted and toggles `show`), do nothing — the enter
// animation runs on every show→true transition regardless. Pass `appear` only for a
// `Presence` that mounts already-shown and should still animate in, e.g. an
// on-demand toast or a newly appended list row.
//
// Hosts are block-level only (div | section | aside | li): transforms — half of
// every rise/scale/sheet variant — do not apply to non-replaced inline elements, so
// an inline host would silently drop them.
//
// `as` is limited to hosts that never carry `position: fixed` children: a
// transformed ancestor is a containing block for fixed descendants (the WebKit trap
// CueDialog.tsx documents). Toasts and FABs portal instead of nesting here.

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ComponentPropsWithoutRef } from "react";
import { EASE_IN, EASE_OUT, EXIT_MS, MS, SPRINGS, VARIANTS, type VariantName } from "@/app/utils/motionPresets";

type Host = "div" | "section" | "aside" | "li";

type Props = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  show: boolean;
  variant?: VariantName;
  as?: Host;
  /** Animate the enter transition even when this instance mounts already-shown. */
  appear?: boolean;
  onExited?: () => void;
  /** Fires once the ENTER animation completes — under skipAnimations, synchronously after mount.
    * A `Presence` mounted already-shown without `appear` runs no enter animation, so
    * `onEntered` never fires there. Pass `appear` when you need the callback on mount. */
  onEntered?: () => void;
  children: React.ReactNode;
};

const ENTER = { duration: MS.base / 1000, ease: EASE_OUT };
const EXIT = { duration: EXIT_MS / 1000, ease: EASE_IN };

/** The sheet variant enters on SPRINGS.sheet; every other variant enters on ENTER. */
const enterFor = (variant: VariantName) => (variant === "sheet" ? SPRINGS.sheet : ENTER);

export default function Presence({
  show,
  variant = "fade",
  as = "div",
  appear = false,
  onExited,
  onEntered,
  children,
  ...rest
}: Props) {
  // `m[as]` is a union across four host components whose native event-handler
  // generics differ per element (HTMLDivElement vs HTMLLIElement, …) — TS can't
  // reconcile that union against a single prop bag. Alias to `typeof m.div` so the
  // render call still gets full `HTMLMotionProps<"div">` checking on the spread
  // props (initial/animate/exit/transition, etc.); the public `Props` type above
  // (Omit<ComponentPropsWithoutRef<"div">, …>) constrains what callers may pass.
  const Tag = m[as] as typeof m.div;
  const v = VARIANTS[variant];
  return (
    <AnimatePresence initial={appear} onExitComplete={onExited}>
      {show && (
        <Tag
          key="presence"
          initial={v.initial}
          animate={{ ...v.animate, transition: enterFor(variant) }}
          exit={{ ...v.exit, transition: EXIT }}
          onAnimationComplete={(definition) => {
            // motion passes the completed animation's DEFINITION object (the `animate`
            // for an enter, the `exit` for an exit). Distinguish by content: only the
            // enter target lands on opacity 1. This guard relies on every VARIANTS.*.animate
            // having opacity: 1, pinned by motionPresets.test.ts.
            const opacity =
              typeof definition === "object" && definition !== null && "opacity" in definition
                ? (definition as { opacity?: number }).opacity
                : undefined;
            if (opacity === 1) onEntered?.();
          }}
          {...rest}
        >
          {children}
        </Tag>
      )}
    </AnimatePresence>
  );
}
