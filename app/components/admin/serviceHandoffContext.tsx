"use client";

// The handoff API a service card calls (Plan B item 6).
//
// `AdminPanel` owns the active tab and the ONE transient target, and publishes
// these setters through context. Item 7-9 wires the card's `Revisar propuesta(s)`
// / `Revisar datos` actions to them without `AdminPanel` needing another change:
//
//   const { openReviewTarget } = useServiceHandoff();
//   openReviewTarget(buildProposalHandoff({ ...card observations }));
//
// A card therefore never owns the target, never keeps it across a tab change, and
// never decides which tab it opens — `reduceReviewTarget` does all three.

import { createContext, useContext } from "react";

import type {
  AdminReviewTarget,
  IntegrityIssueTarget,
  ProposalReviewTarget,
} from "./proposalHandoff";

export interface ServiceHandoffApi {
  /** A1-validated singleton or explicit grouping-conflict target -> `Propuestas`. */
  openProposalReview: (target: ProposalReviewTarget) => void;
  /** Explicit document/draft ids -> read-only integrity details. */
  openIntegrityIssue: (target: IntegrityIssueTarget) => void;
  /** Whatever `buildProposalHandoff` returned; `null` is a no-op. */
  openReviewTarget: (target: AdminReviewTarget | null) => void;
  /** Drop the transient target. */
  clearReviewTarget: () => void;
}

/** Outside a provider every setter is a no-op, so a card can render standalone. */
const NO_HANDOFF: ServiceHandoffApi = {
  openProposalReview: () => {},
  openIntegrityIssue: () => {},
  openReviewTarget: () => {},
  clearReviewTarget: () => {},
};

export const ServiceHandoffContext = createContext<ServiceHandoffApi>(NO_HANDOFF);

export const ServiceHandoffProvider = ServiceHandoffContext.Provider;

export function useServiceHandoff(): ServiceHandoffApi {
  return useContext(ServiceHandoffContext);
}
