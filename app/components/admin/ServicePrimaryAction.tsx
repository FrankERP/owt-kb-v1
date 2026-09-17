"use client";

// The ONE primary action per card (Plan B items 7-9).
//
// The label, kind, disabled flag and rule all come from the shipped 15-rule ladder
// through `servicePrimaryActionProps`; this component never inspects a readiness
// dimension. It is a full-width, always-visible button with a ≥44px touch target —
// no hover-only workflow — and it reports WHY it is disabled when a required
// source is missing.
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
  return (
    <div className="min-w-0 space-y-1">
      <Button
        variant={toneVariant(action)}
        size="md"
        onClick={onAction}
        disabled={action.disabled}
        title={action.reason ?? undefined}
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
