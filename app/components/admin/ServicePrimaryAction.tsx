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

/** Accent = the actionable default; danger for an integrity/conflict blocker. */
function toneVariant(props: PrimaryActionProps): ButtonVariant {
  switch (props.kind) {
    case "review_data":
    case "review_duplicate_roles":
    case "review_setlist_data":
    case "resolve_conflict":
      return "danger";
    // A retry is not a commit: it stays the quiet outlined control it was.
    case "retry_load":
      return "secondary";
    default:
      return "primary";
  }
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
