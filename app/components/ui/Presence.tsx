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
// `as` is limited to block-level hosts that never carry `position: fixed` children:
// a transformed ancestor is a containing block for fixed descendants (the WebKit trap
// CueDialog.tsx documents). Toasts and FABs portal instead of nesting here.

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { EASE_IN, EASE_OUT, EXIT_MS, MS, VARIANTS, type VariantName } from "@/app/utils/motionPresets";

type Host = "div" | "section" | "aside" | "li" | "span";

type Props = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
> & {
  show: boolean;
  variant?: VariantName;
  as?: Host;
  onExited?: () => void;
  children: React.ReactNode;
};

const ENTER = { duration: MS.base / 1000, ease: EASE_OUT };
const EXIT = { duration: EXIT_MS / 1000, ease: EASE_IN };

export default function Presence({ show, variant = "fade", as = "div", onExited, children, ...rest }: Props) {
  // `m[as]` is a union across five host components whose native event-handler
  // generics differ per element (HTMLDivElement vs HTMLLIElement, …) — TS can't
  // reconcile that union against a single prop bag. Widen the render-only alias;
  // the public `Props` type above (Omit<ComponentPropsWithoutRef<"div">, …>) still
  // constrains what callers may pass.
  const Tag = m[as] as ComponentType<Record<string, unknown>>;
  const v = VARIANTS[variant];
  return (
    <AnimatePresence initial={false} onExitComplete={onExited}>
      {show && (
        <Tag
          key="presence"
          initial={v.initial}
          animate={{ ...v.animate, transition: ENTER }}
          exit={{ ...v.exit, transition: EXIT }}
          {...rest}
        >
          {children}
        </Tag>
      )}
    </AnimatePresence>
  );
}
