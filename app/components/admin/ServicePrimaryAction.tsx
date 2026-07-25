"use client";

// The ONE primary action per card (Plan B items 7-9).
//
// The label, kind, disabled flag and rule all come from the shipped 15-rule ladder
// through `servicePrimaryActionProps`; this component never inspects a readiness
// dimension. It is a full-width, always-visible button with a ≥44px touch target —
// no hover-only workflow — and it reports WHY it is disabled when a required
// source is missing.

import { CARD_STYLE } from "./serviceCardModel";
import type { PrimaryActionProps } from "./serviceCardModel";

/** Cyan = the actionable default; red for an integrity blocker; grey when disabled. */
function toneClass(props: PrimaryActionProps): string {
  if (props.disabled) return "border-gray-600/50 bg-transparent text-gray-500 cursor-not-allowed";
  switch (props.kind) {
    case "review_data":
    case "review_duplicate_roles":
    case "review_setlist_data":
      return "border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20";
    case "resolve_conflict":
      return "border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20";
    case "retry_load":
      return "border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20";
    case "publish":
      return "border-green-500/50 bg-green-500/10 text-green-300 hover:bg-green-500/20";
    default:
      return "border-[#00bfff]/50 bg-[#00bfff]/10 text-[#00bfff] hover:bg-[#00bfff]/20";
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
      <button
        type="button"
        onClick={onAction}
        disabled={action.disabled}
        title={action.reason ?? undefined}
        data-action-kind={action.kind}
        data-action-rule={action.rule}
        data-action-route={action.route}
        className={`${CARD_STYLE.primaryAction} rounded-lg border px-3 font-label text-xs uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00bfff] ${toneClass(action)}`}
      >
        {action.label}
      </button>
      {action.reason && (
        <p className={`font-body text-[11px] text-amber-400/90 ${CARD_STYLE.longText}`}>
          {action.reason}
        </p>
      )}
    </div>
  );
}
