// A draft's display label for the connector's answers — the v3 planner's own service label
// («domingo 8 nov», «Noche de alabanza 18 nov»), never an id.

import { kindOfType, serviceLabel } from "@/app/components/admin/v3Services";
import type { DraftCard } from "@/app/components/admin/plannerModel";

export function draftLabel(draft: Pick<DraftCard, "_type" | "date" | "service_name">): string {
  const kind = kindOfType(draft._type);
  return kind ? serviceLabel(kind, draft.date, draft.service_name) : draft.date;
}
