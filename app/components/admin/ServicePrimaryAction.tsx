"use client";

// The ONE primary action per card (Plan B items 7-9).
//
// The label, kind, disabled flag and rule all come from the shipped 15-rule ladder
// through `servicePrimaryActionProps`; this component never inspects a readiness
// dimension. It is an always-visible button with a ≥44px touch target — no
// hover-only workflow — and it reports WHY it is disabled when a required source
// is missing.
//
// Since 2026-10-22 it lives in the card's HEADER row, beside the icon cluster,
// instead of at the foot of the card: twelve full-width buttons under twelve
// setlists made the board 5 570 px tall, and the foot of a card is wherever its
// longest list ends. From `sm` it is a normal-width button; below `sm` the header
// has no room beside three 44px icons, so it wraps to its own full-width line
// (`basis-full order-last`, with the reason line under it).
//
// It is a house `Button` (R5 Task 4). The tone is carried by the VARIANT, not by a
// colour override on `className`: `Button` documents `className` as additive
// utilities only, and a second `bg-…`/`text-…` beside a variant's own leaves the
// winner to Tailwind's emission order rather than to the tone that was asked for.
// `className` therefore carries only `CARD_STYLE.primaryAction` (the 44px full-width
// target), which no variant sets.

import Button from "@/app/components/ui/Button";
import type { ButtonVariant } from "@/app/components/ui/Button";
import { CARD_STYLE } from "./serviceCardModel";
import type { PrimaryActionProps } from "./serviceCardModel";
import type { PrimaryActionKind } from "./serviceReadiness";

/**
 * The ladder's four BLOCKER kinds — an integrity or availability problem the admin
 * has to look at before the card can move. Since phase 5 of the «millones» pass
 * (Frank, 2026-10-27: «no me gusta ese aviso enorme que solo estorba») these are
 * not a button at all but `ServiceReviewFlag`, a small amber mark in the card's
 * corner that opens the same flow. Every other kind is still the button.
 */
const REVIEW_KINDS: ReadonlySet<PrimaryActionKind> = new Set<PrimaryActionKind>([
  "review_data",
  "review_duplicate_roles",
  "review_setlist_data",
  "resolve_conflict",
]);

export function isReviewKind(kind: PrimaryActionKind): boolean {
  return REVIEW_KINDS.has(kind);
}

/**
 * The blocker as a 44 px icon control in the header's icon cluster: an amber
 * triangle on a faint amber disc, named by the ladder's label («Revisar datos»,
 * «Resolver conflicto») and, when a source is missing, disabled with that reason
 * on its `title`. It keeps the ladder's trace (`data-action-kind`/`-rule`/`-route`
 * and `data-tone="danger"`) so the DOM still says which rule fired. A raw
 * `<button>`, like the cluster's other two icons: the house `Button`'s icon
 * variant hovers to the accent, and a blocker must never read as the cyan «go».
 */
export function ServiceReviewFlag({
  action,
  onAction,
}: {
  action: PrimaryActionProps;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={action.disabled}
      aria-label={action.label}
      title={action.reason ?? action.label}
      data-card-primary-action=""
      data-tone="danger"
      data-action-kind={action.kind}
      data-action-rule={action.rule}
      data-action-route={action.route}
      className={`${CARD_STYLE.menuTrigger} flex items-center justify-center rounded-lg transition-colors hover:bg-surface-lift/15 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-warning-fg/15 text-warning-strong"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v4M12 17.5v.5" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Accent = the actionable default. A review kind never reaches this button any
 * more (the card renders `ServiceReviewFlag` for it), but the mapping stays
 * total so a card that did would still wear the blocker's tone, never the «go».
 */
function toneVariant(props: PrimaryActionProps): ButtonVariant {
  if (isReviewKind(props.kind)) return "danger";
  // A retry is not a commit: it stays the quiet outlined control it was.
  return props.kind === "retry_load" ? "secondary" : "primary";
}

export default function ServicePrimaryAction({
  action,
  onAction,
}: {
  action: PrimaryActionProps;
  onAction: () => void;
}) {
  const tone = toneVariant(action);
  return (
    <div
      data-card-primary-action=""
      className="order-last min-w-0 basis-full space-y-1 sm:order-none sm:ml-auto sm:basis-auto"
    >
      <Button
        variant={tone}
        size="md"
        onClick={onAction}
        disabled={action.disabled}
        title={action.reason ?? undefined}
        // The variant, in the DOM: the tone is otherwise only readable by
        // matching a class string against `Button`'s internal VARIANT table.
        data-tone={tone}
        data-action-kind={action.kind}
        data-action-rule={action.rule}
        data-action-route={action.route}
        className={CARD_STYLE.primaryAction}
      >
        {action.label}
      </Button>
      {action.reason && (
        <p className={`font-body text-[11px] text-warning-strong ${CARD_STYLE.longText}`}>
          {action.reason}
        </p>
      )}
    </div>
  );
}
