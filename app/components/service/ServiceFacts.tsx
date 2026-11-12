"use client";

// What a folded service says about itself WITHOUT a sentence (ADR-0087): who leads, as faces
// beside their names, and the set, as its songs' pictures beside the count — or «Setlist
// pendiente» when the team was published before the songs (the state most weekends are in from
// Monday to Thursday). One component for Inicio's «Después» cards, `/me` and the Calendario's
// agenda, so the three can never describe one service three ways.
//
// It replaced «Lead Liu, Jakey · Keys Mimí · Drums Tony · EG Frank · EG Pato · AG Vega · 5
// canciones»: every seat spelled out on every row, which is what made the agenda a wall of
// text. The rest of the team is one tap away, on the card's own sheet.

import { joinNames } from "@/app/utils/homeGreeting";
import { plural } from "@/app/utils/plural";
import { songCoverUrl } from "@/app/utils/songCover";
import { FaceStack } from "./Face";
import { CoverRow } from "./SongCover";
import { MusicNoteIcon } from "../ui/icons";

export default function ServiceFacts({
  leads = [],
  songs = [],
  photos,
  myName = "",
  className = "",
}: {
  leads?: string[];
  songs?: Array<{ cover?: string | null }>;
  photos?: Record<string, string>;
  myName?: string;
  className?: string;
}) {
  return (
    <span className={`flex flex-wrap items-center gap-x-4 gap-y-2 font-body text-[14px] leading-snug text-ink-muted ${className}`}>
      {leads.length > 0 && (
        <span className="inline-flex min-w-0 items-center gap-2">
          <FaceStack names={leads} photos={photos} myName={myName} max={3} size="xs" />
          <span className="min-w-0 break-words">Lead {joinNames(leads)}</span>
        </span>
      )}
      {songs.length > 0 ? (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <CoverRow covers={songs.map((song) => songCoverUrl(song.cover))} />
          {plural(songs.length, "canción", "canciones")}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-dim">
          <MusicNoteIcon size={12} />
          Setlist pendiente
        </span>
      )}
    </span>
  );
}
