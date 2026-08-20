export type KidsRoom = "chiquitos" | "medianos" | "grandes";
export type KidsSeat = "ensenanza" | KidsRoom;
export const KIDS_ROOMS: KidsRoom[] = ["chiquitos", "medianos", "grandes"];
export const KIDS_SEATS: KidsSeat[] = ["ensenanza", "chiquitos", "medianos", "grandes"];
export const KIDS_SEAT_LABELS: Record<KidsSeat, string> = {
  ensenanza: "Enseñanza",
  chiquitos: "RG Chiquitos",
  medianos: "RG Medianos",
  grandes: "RG Grandes",
};

export interface RotationPair {
  id: string;                 // kidsPair._id
  name: string;
  room: KidsRoom;
  memberIds: [string, string];
}

/** One Sunday's assignment: pair id per seat; a missing key = empty seat. */
export interface KidsAssignment {
  date: string;                              // YYYY-MM-DD
  seats: Partial<Record<KidsSeat, string>>;  // seat -> kidsPair._id
}

export interface RotationWarning {
  date: string;
  seat: KidsSeat;
  pairId: string;
  memberId: string;
  kind: "worship-overlap";
}

export interface RotationDiagnostic {
  date: string;
  seat: KidsSeat;
  kind: "unfillable";
  reason: string; // Spanish, shown verbatim in the planner
}

export interface RotationInput {
  sundays: string[];                          // ascending YYYY-MM-DD
  pairs: RotationPair[];                      // ACTIVE pairs only
  unavailable: Record<string, string[]>;      // memberId -> ISO dates
  history: KidsAssignment[];                  // prior assignments, ascending by date
  worshipAssignments?: Record<string, string[]>; // date -> memberIds serving worship
}

export interface RotationResult {
  proposal: KidsAssignment[];
  warnings: RotationWarning[];
  diagnostics: RotationDiagnostic[];
}
