import type { SeatView } from "@/app/utils/kidsPlannerView";
import type { KidsSeat } from "@/app/utils/kidsTypes";

/** One Sunday's chrome — everything the header of a column or a card renders. */
export interface KidsSundayState {
  date: string;
  /** Already formatted in Spanish at LOCAL NOON by the planner shell. */
  label: string;
  published: boolean;
  filled: number;
  publishing: boolean;
}

/**
 * What the two layouts — the desktop board and the phone cards — both need.
 *
 * They are separate components rather than one responsive tree because they are
 * genuinely different interactions, not one interaction at two widths: the board
 * drags, the cards tap. ADR-0012 is the reason (a drag never starts from a touch,
 * and a lifted chip fights the scroll), so a shrunken board would be a dead
 * surface on the phone Niza actually plans on. This interface is what keeps the
 * two from drifting apart on everything else.
 */
export interface KidsBoardProps {
  sundays: KidsSundayState[];
  seatOf: (date: string, seat: KidsSeat) => SeatView;
  /** Falls back to the stored pair's name when it has left the seat's pool. */
  pairName: (pairId: string) => string;
  monthLoad: Record<string, number>;
  /** Anything the seat must say when it is empty — unfillable, or a generator note. */
  noteFor: (date: string, seat: KidsSeat) => string | null;
  busy: boolean;
  onOpenSeat: (date: string, seat: KidsSeat) => void;
  onTogglePublish: (date: string, next: boolean) => void;
}
