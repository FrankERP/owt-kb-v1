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

import { useId, useState } from "react";
import { revealProps } from "@/app/utils/reveal";
import Collapse from "../ui/Collapse";
import SegmentedControl from "../ui/SegmentedControl";
import { DISPLAY_NOTES, noteAt, rootIndex, semitonesBetween } from "@/app/utils/transpose";
import KeyDial from "./KeyDial";
import TempoPill from "./TempoPill";
import { useTransposeOptional } from "./TransposeProvider";

// The two pills that are never controls. `min-h-[44px]` matches the dial and the
// tempo pill so the row is flush — 2.4rem alone is 38.4px and left them short.
const STATIC_PILL =
  "brand-search-console flex h-[2.4rem] min-h-[44px] items-center px-3 font-label text-[11px] uppercase tracking-widest text-ink-dim";

export default function SongHeroPills({
  keyLabel,
  bpm,
  bpmText,
  timeSig,
  transposable,
  revealIndex,
}: {
  keyLabel: string | null;
  bpm: number | null;
  /** A stored BPM that is not a usable number ("~120", "variable"): shown, never tapped. */
  bpmText?: string | null;
  timeSig: string | null;
  /** true only when the song carries a ChordPro chart — otherwise the key is a static badge. */
  transposable: boolean;
  /** Route-reveal stagger index for this row (spec §2.1) — the hero page passes it since
   * `revealProps` is neutral and legal to call from a client module too, but the wrapper it
   * spreads onto is this component's own root. */
  revealIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  // Per INSTANCE, not a module constant: the gallery fixture and any future page
  // that shows two songs at once would otherwise point two dials at one id.
  const drawerId = useId();
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
      <div {...(revealIndex !== undefined ? revealProps(revealIndex) : {})} className="flex flex-wrap justify-center gap-2.5">
        {keyLabel &&
          (canTranspose ? (
            <KeyDial
              open={open}
              onToggle={() => setOpen((v) => !v)}
              controls={drawerId}
              keyLabel={keyLabel}
            />
          ) : (
            <span className="brand-key-dial min-h-[44px] px-3 font-display text-sm">{keyLabel}</span>
          ))}
        {bpm ? (
          <TempoPill bpm={bpm} />
        ) : bpmText ? (
          <span className={STATIC_PILL}>{bpmText} BPM</span>
        ) : null}
        {timeSig && <span className={STATIC_PILL}>{timeSig}</span>}
      </div>

      {canTranspose && (
        // The gap rides on the Collapse itself — a closed one is a zero-height
        // child and a `space-y-*` parent would reserve its gap forever.
        <Collapse open={open} id={drawerId} className="pt-4">
          <SegmentedControl
            size="sm"
            label="Transponer a"
            value={soundingRoot}
            onChange={(k) => shared?.setSemitones(semitonesBetween(nativeKey!, k))}
            options={DISPLAY_NOTES.map((n) => ({
              value: n,
              label: n,
              // Enharmonic, not textual: a song written in Db is in C#, and the
              // hint belongs on the pill that sounds the same, not the one spelled
              // the same.
              ariaLabel: nativeKey && rootIndex(n) === rootIndex(nativeKey) ? `${n} (original)` : n,
            }))}
            className="justify-center"
          />
        </Collapse>
      )}
    </>
  );
}
