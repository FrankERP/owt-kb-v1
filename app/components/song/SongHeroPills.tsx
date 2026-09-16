"use client";

// The song hero's pill row — key, tempo, compás — plus the transposer drawer it
// discloses. The row itself is unchanged from the static version; what is new is
// that two of the three pills are controls when the song supports them.
//
// The key is a DIAL only when the song carries a ChordPro chart (`transposable`)
// and a key worth transposing from. On a song with a plain-text chart or no key
// there is nothing for the drawer to move, so the key stays the static badge it
// has always been rather than a button that does nothing.
//
// The drawer is the ONE 12-key picker (R4 ruling 2): the ± pair inside
// `ChordChart` steps the same provider value, so the readout above and the chart
// below can never disagree.

import { useState } from "react";
import Collapse from "../ui/Collapse";
import SegmentedControl from "../ui/SegmentedControl";
import { DISPLAY_NOTES, noteAt, rootIndex, semitonesBetween } from "@/app/utils/transpose";
import KeyDial from "./KeyDial";
import TempoPill from "./TempoPill";
import { useTransposeOptional } from "./TransposeProvider";

const DRAWER_ID = "song-transposer";

export default function SongHeroPills({
  keyLabel,
  bpm,
  timeSig,
  transposable,
}: {
  keyLabel: string | null;
  bpm: number | null;
  timeSig: string | null;
  /** true only when the song carries a ChordPro chart — otherwise the key is a static badge. */
  transposable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shared = useTransposeOptional();

  const nativeKey = shared?.nativeKey ?? keyLabel;
  // A key the maths cannot parse ("—", "Modal") transposes to nonsense, so it
  // stays a badge too.
  const canTranspose = Boolean(transposable && shared && nativeKey && rootIndex(nativeKey) >= 0);
  // The ROOT of the sounding key, which is what the 12 pills are: `soundingKey`
  // carries the quality too ("Gm"), and a minor song would then match no option
  // and show no checked pill.
  const soundingRoot =
    canTranspose && nativeKey ? noteAt(rootIndex(nativeKey) + (shared?.semitones ?? 0)) : null;

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2.5">
        {keyLabel &&
          (canTranspose ? (
            <KeyDial
              open={open}
              onToggle={() => setOpen((v) => !v)}
              controls={DRAWER_ID}
              keyLabel={keyLabel}
            />
          ) : (
            <span className="brand-key-dial px-3 font-display text-sm">{keyLabel}</span>
          ))}
        {bpm ? <TempoPill bpm={bpm} /> : null}
        {timeSig && (
          <span className="brand-search-console flex h-[2.4rem] items-center px-3 font-label text-[11px] uppercase tracking-widest text-ink-dim">
            {timeSig}
          </span>
        )}
      </div>

      {canTranspose && (
        // The gap rides on the Collapse itself — a closed one is a zero-height
        // child and a `space-y-*` parent would reserve its gap forever.
        <Collapse open={open} id={DRAWER_ID} className="pt-4">
          <SegmentedControl
            size="sm"
            label="Transponer a"
            value={soundingRoot}
            onChange={(k) => shared?.setSemitones(semitonesBetween(nativeKey!, k))}
            options={DISPLAY_NOTES.map((n) => ({
              value: n,
              label: n,
              ariaLabel: n === nativeKey ? `${n} (original)` : n,
            }))}
            className="justify-center"
          />
        </Collapse>
      )}
    </>
  );
}
