// A seat's glyph (ADR-0088): the microphone of a voice, the keys, the drum, the guitar of the
// three string seats, the sliders of the booth. Drawn on a face's corner and beside «Tú · EG»,
// so the eye finds «what do I play» without reading the seat's word — which still stands next to
// it, because EG, AG and Bass share one guitar.
//
// NEUTRAL — no hooks. An unknown seat (a new instrument an admin typed) gets the note.
import { DrumIcon, GuitarIcon, KeysIcon, MicIcon, MusicNoteIcon, SlidersIcon } from "../ui/icons";
import { normalizeSeatName } from "../admin/seatModel";
import type { TeamSectionId } from "@/app/utils/teamSections";

type IconKind = "mic" | "keys" | "drum" | "guitar" | "sliders" | "note";

const BY_SEAT: Record<string, IconKind> = {
  lead: "mic",
  bgv: "mic",
  bgvs: "mic",
  coro: "mic",
  keys: "keys",
  drums: "drum",
  eg: "guitar",
  ag: "guitar",
  bass: "guitar",
  console: "sliders",
};

const SECTION_ICON: Record<TeamSectionId, IconKind> = { voces: "mic", banda: "guitar", cabina: "sliders" };

/** Which glyph a seat takes; `section` decides for a seat the list does not know. */
export function seatIconKind(seat: string, section?: TeamSectionId): IconKind {
  const known = BY_SEAT[normalizeSeatName(seat).toLowerCase()];
  if (known) return known;
  if (section === "voces") return "mic";
  if (section === "cabina") return "sliders";
  return "note";
}

function Glyph({ kind, size }: { kind: IconKind; size: number }) {
  if (kind === "mic") return <MicIcon size={size} />;
  if (kind === "keys") return <KeysIcon size={size} />;
  if (kind === "drum") return <DrumIcon size={size} />;
  if (kind === "guitar") return <GuitarIcon size={size} />;
  if (kind === "sliders") return <SlidersIcon size={size} />;
  return <MusicNoteIcon size={size} />;
}

export default function SeatIcon({ seat, section, size = 11 }: { seat: string; section?: TeamSectionId; size?: number }) {
  return <Glyph kind={seatIconKind(seat, section)} size={size} />;
}

/** A team section's glyph: Voces, Banda, Cabina. */
export function SectionIcon({ id, size = 16 }: { id: TeamSectionId; size?: number }) {
  return <Glyph kind={SECTION_ICON[id]} size={size} />;
}
