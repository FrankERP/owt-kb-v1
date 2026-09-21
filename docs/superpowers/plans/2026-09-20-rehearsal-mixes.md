# Rehearsal Mixes (delivery 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can listen to and download one rehearsal mix per instrument track for any song that has them, see where that instrument plays on a waveform, and managers can ingest the mixes `abletonnl` renders with one guarded script.

**Architecture:** A new `rehearsalMixes[]` array on `post` (separate from `audioTracks`) holds one MP3 asset per mix plus the isolated stem's 600-point peak envelope and play windows, both copied verbatim from `abletonnl`'s `manifest.json` by `scripts/ingest-rehearsal-mixes.mjs`. A read-only route `/api/audio/[songId]/[key]` gates every file behind the worship-member session and answers `302` to `cdn.sanity.io` (bytes never cross Vercel). `RehearsalPlayer` — a presentational client component fed by the page's existing single-song read — lists the mixes by family, draws each waveform on a canvas and plays through the existing `PlayerContext`/`AudioTransport`.

**Tech Stack:** Next.js 16 App Router, React 19, Sanity v5 (`next-sanity` client, file assets), Tailwind + colour tokens, vitest (+ jsdom for component tests), Node 22 ESM scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-rehearsal-mixes-design.md` (decisions D1–D6; §5 is the manifest contract, already shipped in `abletonnl` `ef3004e`).

## Global Constraints

- Gates before any "done": `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors**.
- Spanish UI copy. Every member-reachable control is a `Button` (`app/components/ui/Button.tsx`) or carries `buttonClass(...)`; never an inline class string with its own `hover:` colours.
- Colour only through tokens: Tailwind token classes, or `themeColour("--accent-rgb", alpha)` for canvas fills. Never a concatenated hex.
- Form controls on a phone are `text-[16px] sm:text-…` (`inputFontSize.test.ts`). No inputs are added here, but any that appear must follow it.
- A Server Component never CALLS a value imported from a `"use client"` module (ADR-0028); `clientBoundary.test.ts` guards it. `RehearsalPlayer` is rendered as JSX from the page; the page calls only neutral utils.
- The theme-gallery `song` fixture stays hermetic: no session, no fetch, no Sanity, no env. `RehearsalPlayer` therefore takes `preselect` as a prop and never reads a session.
- No new secret or env var. The ingest uses the existing `SANITY_WRITE_TOKEN` / `SANITY_API_READ_TOKEN`; say so in `docs/SECRETS.md`'s «Not yet documented» section only if a reviewer asks — there is nothing to add.
- `_key` on every array item written to Sanity. `revalidate*` is NOT called by the script (it runs outside Next); the page follows its `revalidate = 3600` window and the sheet's read is dynamic.
- Conventional commits, body explains the why, **no AI attribution trailers**.
- Peaks are projected ONLY by the two single-song reads (`app/api/song/[id]/route.ts` and `app/(client)/posts/[slug]/page.tsx`). Task 6 adds the guard.

---

## File map

| File | Responsibility |
|---|---|
| `sanity/schemas/post.ts` (modify) | Studio visibility of `rehearsalMixes[]` |
| `app/utils/interface.tsx` (modify) | `RehearsalMix` type; `Post.rehearsalMixes?` |
| `app/context/PlayerContext.tsx` (modify) | `SongSheetData.rehearsalMixes?`, `.myInstruments?` |
| `app/utils/songSections.ts` (modify) | the «Ensayo» section flag |
| `app/utils/rehearsalMixes.ts` (create) | neutral helpers: family labels/order, `groupMixes`, `preselectMix`, `waveformBars` |
| `scripts/lib/rehearsal-ingest.mjs` (create) | pure ingest logic: folder name parse, match, plan (idempotent) |
| `scripts/ingest-rehearsal-mixes.mjs` (create) | the `--apply` script: read manifests, upload, patch, reports |
| `app/api/audio/[songId]/[key]/route.ts` (create) | session-gated 302 to the CDN |
| `app/api/song/[id]/route.ts` (modify) | project `rehearsalMixes` + `myInstruments` |
| `app/(client)/posts/[slug]/page.tsx` (modify) | project `rehearsalMixes`; read viewer's instruments; render the section |
| `app/components/song/Waveform.tsx` (create) | canvas: peaks + active spans + playhead, click-to-seek |
| `app/components/song/RehearsalPlayer.tsx` (create) | grouped list, play/switch/download, preselection |
| `app/components/SongSheet.tsx` (modify) | host the player under an «Ensayo» eyebrow |
| `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx` (modify) | host the player with inline data |
| `docs/REHEARSAL_MIXES.md` (create), `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` (modify) | runbook + references |

---

### Task 1: Model — schema, types, and the «Ensayo» section

**Files:**
- Modify: `sanity/schemas/post.ts` (after the `audioTracks` field, ~line 106)
- Modify: `app/utils/interface.tsx:20-50`
- Modify: `app/context/PlayerContext.tsx:14-28`
- Modify: `app/utils/songSections.ts`
- Test: `app/utils/__tests__/songSections.test.ts`

**Interfaces:**
- Produces: `RehearsalMix` (`app/utils/interface.tsx`):
  ```ts
  export interface RehearsalMix {
    _key: string;
    kind: "full" | "up";
    track?: string;      // "EG 1" — absent for "full"
    family?: string;     // "electric" — absent for "full"
    tone: string;
    bpm?: number;
    audioFileURL: string; // resolved by the read: audioFile.asset->url
    peaks?: number[];    // uint8 × 600 — absent for "full"
    active?: number[][]; // [[start_s, end_s], …] — absent for "full"
    sourceHash: string;
  }
  ```
- Produces: `SongSection["id"]` gains `"ensayo"`, label «Ensayo», listed FIRST (before «Audio»), shown when `rehearsalMixes` is non-empty.

- [ ] **Step 1: Write the failing section test**

Append to `app/utils/__tests__/songSections.test.ts` inside `describe("songSections")`:

```ts
  it("shows Ensayo first when the song has rehearsal mixes, and not for an empty array", () => {
    expect(ids({ rehearsalMixes: [{}], audioTracks: [{}] })).toEqual(["ensayo", "audio"]);
    expect(ids({ rehearsalMixes: [] })).toEqual([]);
    expect(songSections({ rehearsalMixes: [{}] }, 0)[0].label).toBe("Ensayo");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/utils/__tests__/songSections.test.ts`
Expected: FAIL — `rehearsalMixes` is not in `SongSectionInput` (tsc error inside vitest) / `["audio"]` received.

- [ ] **Step 3: Implement the section flag**

In `app/utils/songSections.ts`:

```ts
export interface SongSection {
  id: "ensayo" | "audio" | "tutoriales" | "referencia" | "letra" | "historial";
  label: string;
  show: boolean;
}

export interface SongSectionInput {
  rehearsalMixes?: unknown[] | null;
  audioTracks?: unknown[] | null;
  // …unchanged
}
```

and in the returned list, first entry:

```ts
    { id: "ensayo" as const,     label: "Ensayo",     show: filled(post?.rehearsalMixes) },
    { id: "audio" as const,      label: "Audio",      show: filled(post?.audioTracks) },
```

- [ ] **Step 4: Add the type and the sheet field**

`app/utils/interface.tsx` — add above `export interface Post`:

```ts
/** One rehearsal mix on `post.rehearsalMixes[]` — spec 2026-09-20-rehearsal-mixes §6. */
export interface RehearsalMix {
  _key: string;
  kind: "full" | "up";
  track?: string;
  family?: string;
  tone: string;
  bpm?: number;
  audioFileURL: string;
  peaks?: number[];
  active?: number[][];
  sourceHash: string;
}
```

and inside `Post`, after `audioTracks`:

```ts
  rehearsalMixes?: Array<RehearsalMix>;
```

`app/context/PlayerContext.tsx` — import the type and extend `SongSheetData`:

```ts
import type { PortableTextBody, RehearsalMix } from "@/app/utils/interface";
// …
  audioTracks?: { title: string; tone?: string; audioFileURL: string }[];
  rehearsalMixes?: RehearsalMix[];
  /** The viewer's declared instruments (`teamMembers.instruments`), for preselection. */
  myInstruments?: string[];
```

- [ ] **Step 5: Add the Studio field**

`sanity/schemas/post.ts`, right after the `audioTracks` field object (before `lyrics`):

```ts
		{
			name: 'rehearsalMixes',
			title: 'Mixes de ensayo',
			description: 'Escritos por scripts/ingest-rehearsal-mixes.mjs desde el manifest de abletonnl. No editar a mano: peaks son 600 números.',
			type: 'array',
			readOnly: true,
			of: [
				{
					type: 'object',
					name: 'rehearsalMix',
					fields: [
						{ name: 'kind', type: 'string', title: 'Kind', options: { list: ['full', 'up'] } },
						{ name: 'track', type: 'string', title: 'Track' },
						{ name: 'family', type: 'string', title: 'Family' },
						{ name: 'tone', type: 'string', title: 'Tone' },
						{ name: 'bpm', type: 'number', title: 'BPM' },
						{ name: 'audioFile', type: 'file', title: 'Audio File', options: { accept: '.mp3' } },
						{ name: 'peaks', type: 'array', title: 'Peaks', of: [{ type: 'number' }], hidden: true },
						{ name: 'active', type: 'array', title: 'Active spans', of: [{ type: 'array', of: [{ type: 'number' }] }], hidden: true },
						{ name: 'sourceHash', type: 'string', title: 'Source set sha1' },
					],
					preview: {
						select: { kind: 'kind', track: 'track', tone: 'tone' },
						prepare: ({ kind, track, tone }: { kind?: string; track?: string; tone?: string }) => ({
							title: kind === 'full' ? 'Banda completa' : `${track ?? '?'} UP`,
							subtitle: tone,
						}),
					},
				},
			],
		},
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run app/utils/__tests__/songSections.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add sanity/schemas/post.ts app/utils/interface.tsx app/context/PlayerContext.tsx app/utils/songSections.ts app/utils/__tests__/songSections.test.ts
git commit -m "feat(model): rehearsalMixes[] on post, RehearsalMix type, Ensayo section flag

Separate from audioTracks on purpose: that array is reference recordings
and guide tracks, and folding mixes into it would leave no read able to tell
the two apart later (spec 2026-09-20-rehearsal-mixes §6). Studio field is
read-only — the ingest script writes it and peaks are 600 numbers."
```

---

### Task 2: Neutral helpers — families, grouping, preselection, waveform bars

**Files:**
- Create: `app/utils/rehearsalMixes.ts`
- Test: `app/utils/__tests__/rehearsalMixes.test.ts`

**Interfaces:**
- Consumes: `RehearsalMix` (Task 1), `INSTRUMENT_SEAT_OPTIONS` (`sanity/schemas/instrumentSeats.ts`, `["Bass","Keys","Drums","EG","AG"]`).
- Produces (all exported, no imports from `"use client"` modules so the page may call them):
  ```ts
  export const FAMILY_ORDER: readonly string[]; // ["bass","keys","organ","synth","drums","electric","acoustic"]
  export const FAMILY_LABEL: Record<string, string>; // es labels
  export const SEAT_TO_FAMILY: Record<string, string>; // Bass→bass, Keys→keys, Drums→drums, EG→electric, AG→acoustic
  export function mixLabel(mix: RehearsalMix): string; // "Banda completa" | track
  export function groupMixes(mixes: RehearsalMix[]): { family: string; label: string; mixes: RehearsalMix[] }[];
  export function preselectMix(mixes: RehearsalMix[], instruments?: string[] | null): RehearsalMix | null;
  export function waveformBars(peaks: number[], bars: number): number[]; // 0..1 per bar
  export function isActiveAt(active: number[][] | undefined, seconds: number): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

`app/utils/__tests__/rehearsalMixes.test.ts`:

```ts
// The rehearsal player's pure half: how mixes group, which one a member sees
// first, and how a 600-point envelope collapses to the bars a row can draw.
import { describe, expect, it } from "vitest";
import { INSTRUMENT_SEAT_OPTIONS } from "@/sanity/schemas/instrumentSeats";
import type { RehearsalMix } from "@/app/utils/interface";
import {
  FAMILY_ORDER, SEAT_TO_FAMILY, groupMixes, isActiveAt, mixLabel, preselectMix, waveformBars,
} from "../rehearsalMixes";

const mix = (over: Partial<RehearsalMix>): RehearsalMix => ({
  _key: over._key ?? Math.random().toString(36).slice(2),
  kind: "up", tone: "G", audioFileURL: "https://cdn.test/x.mp3", sourceHash: "abc",
  ...over,
});

const full = mix({ _key: "full", kind: "full" });
const eg2 = mix({ _key: "eg2", track: "EG 2", family: "electric" });
const eg1 = mix({ _key: "eg1", track: "EG 1", family: "electric" });
const bass = mix({ _key: "bass", track: "Bass", family: "bass" });
const organ = mix({ _key: "org", track: "Órgano", family: "organ" });

describe("SEAT_TO_FAMILY", () => {
  it("maps every app seat and nothing else", () => {
    expect(Object.keys(SEAT_TO_FAMILY).sort()).toEqual([...INSTRUMENT_SEAT_OPTIONS].sort());
    expect(SEAT_TO_FAMILY).toEqual({ Bass: "bass", Keys: "keys", Drums: "drums", EG: "electric", AG: "acoustic" });
  });
});

describe("groupMixes", () => {
  it("puts Full first, then families in FAMILY_ORDER, tracks sorted naturally", () => {
    const groups = groupMixes([eg2, organ, full, bass, eg1]);
    expect(groups.map((g) => g.family)).toEqual(["full", "bass", "organ", "electric"]);
    expect(groups[3].mixes.map((m) => m.track)).toEqual(["EG 1", "EG 2"]);
    expect(groups[0].label).toBe("Banda completa");
    expect(groups[3].label).toBe("Guitarra eléctrica");
  });
  it("drops nothing and tolerates an unknown family at the end", () => {
    const odd = mix({ _key: "odd", track: "Kazoo", family: "other" });
    const groups = groupMixes([odd, full]);
    expect(groups.map((g) => g.family)).toEqual(["full", "other"]);
    expect(groups[1].label).toBe("Otros");
  });
  it("returns [] for no mixes", () => expect(groupMixes([])).toEqual([]));
});

describe("mixLabel", () => {
  it("names Full in Spanish and UP mixes by their track", () => {
    expect(mixLabel(full)).toBe("Banda completa");
    expect(mixLabel(eg1)).toBe("EG 1");
  });
});

describe("preselectMix", () => {
  it("prefers the first track of the member's first instrument's family", () => {
    expect(preselectMix([full, eg2, eg1, bass], ["EG", "Bass"])?._key).toBe("eg1");
    expect(preselectMix([full, eg2, eg1, bass], ["Bass"])?._key).toBe("bass");
  });
  it("falls back to Full when the member has no instruments or none match", () => {
    expect(preselectMix([full, eg1], null)?._key).toBe("full");
    expect(preselectMix([full, eg1], ["Drums"])?._key).toBe("full");
  });
  it("falls back to the first mix when there is no Full, and null for none", () => {
    expect(preselectMix([eg2, eg1], ["Keys"])?._key).toBe("eg2");
    expect(preselectMix([], ["Keys"])).toBeNull();
  });
});

describe("waveformBars", () => {
  it("collapses 600 points to N bars by max, scaled to 0..1", () => {
    const peaks = Array.from({ length: 600 }, (_, i) => (i < 300 ? 255 : 51));
    const bars = waveformBars(peaks, 6);
    expect(bars).toHaveLength(6);
    expect(bars.slice(0, 3)).toEqual([1, 1, 1]);
    expect(bars[5]).toBeCloseTo(0.2, 2);
  });
  it("handles fewer points than bars and empty input", () => {
    expect(waveformBars([255, 0], 4)).toEqual([1, 1, 0, 0]);
    expect(waveformBars([], 3)).toEqual([0, 0, 0]);
  });
});

describe("isActiveAt", () => {
  it("is true inside a span, inclusive start, exclusive end", () => {
    const a = [[10, 20], [30.5, 31]];
    expect(isActiveAt(a, 10)).toBe(true);
    expect(isActiveAt(a, 19.99)).toBe(true);
    expect(isActiveAt(a, 20)).toBe(false);
    expect(isActiveAt(a, 30.7)).toBe(true);
    expect(isActiveAt(undefined, 5)).toBe(false);
  });
});

describe("FAMILY_ORDER", () => {
  it("covers the seven isolated families and nothing else", () => {
    expect(FAMILY_ORDER).toEqual(["bass", "keys", "organ", "synth", "drums", "electric", "acoustic"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/utils/__tests__/rehearsalMixes.test.ts`
Expected: FAIL — module `../rehearsalMixes` not found.

- [ ] **Step 3: Implement**

`app/utils/rehearsalMixes.ts`:

```ts
// The rehearsal player's pure half — grouping, preselection and the waveform's
// bar reduction. Neutral (no "use client", no imports from client modules) so
// the song page, a Server Component, may call `preselectMix` (ADR-0028).
//
// Family names are abletonnl's (`families.toml`): bass, keys, organ, synth,
// drums, electric, acoustic are the seven the render step isolates (spec
// 2026-09-20-rehearsal-mixes §4). App seats (`INSTRUMENT_SEAT_OPTIONS`) map onto
// five of them; organ and synth have no seat of their own and sit with keys.
import type { RehearsalMix } from "@/app/utils/interface";

export const FAMILY_ORDER = ["bass", "keys", "organ", "synth", "drums", "electric", "acoustic"] as const;

export const FAMILY_LABEL: Record<string, string> = {
  full: "Banda completa",
  bass: "Bajo",
  keys: "Teclado",
  organ: "Órgano",
  synth: "Sinte",
  drums: "Batería",
  electric: "Guitarra eléctrica",
  acoustic: "Guitarra acústica",
  other: "Otros",
};

/** App seat (`teamMembers.instruments[]`) → abletonnl family. */
export const SEAT_TO_FAMILY: Record<string, string> = {
  Bass: "bass",
  Keys: "keys",
  Drums: "drums",
  EG: "electric",
  AG: "acoustic",
};

export function mixLabel(mix: RehearsalMix): string {
  return mix.kind === "full" ? FAMILY_LABEL.full : (mix.track ?? "Pista");
}

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export function groupMixes(mixes: RehearsalMix[]): { family: string; label: string; mixes: RehearsalMix[] }[] {
  if (mixes.length === 0) return [];
  const fulls = mixes.filter((m) => m.kind === "full");
  const byFamily = new Map<string, RehearsalMix[]>();
  for (const m of mixes) {
    if (m.kind === "full") continue;
    const fam = m.family ?? "other";
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(m);
  }
  const rank = (fam: string) => {
    const i = (FAMILY_ORDER as readonly string[]).indexOf(fam);
    return i === -1 ? FAMILY_ORDER.length : i;
  };
  const families = [...byFamily.keys()].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));
  const groups = families.map((family) => ({
    family,
    label: FAMILY_LABEL[family] ?? FAMILY_LABEL.other,
    mixes: [...byFamily.get(family)!].sort((a, b) => collator.compare(a.track ?? "", b.track ?? "")),
  }));
  return fulls.length ? [{ family: "full", label: FAMILY_LABEL.full, mixes: fulls }, ...groups] : groups;
}

/**
 * Which mix a member sees highlighted on arrival: the first track of the family
 * their FIRST declared instrument maps to, else Full, else the first mix.
 * Highlight only — nothing autoplays.
 */
export function preselectMix(mixes: RehearsalMix[], instruments?: string[] | null): RehearsalMix | null {
  if (mixes.length === 0) return null;
  const family = instruments?.length ? SEAT_TO_FAMILY[instruments[0]] : undefined;
  if (family) {
    const group = groupMixes(mixes).find((g) => g.family === family);
    if (group) return group.mixes[0];
  }
  return mixes.find((m) => m.kind === "full") ?? mixes[0];
}

/** Collapse a 0–255 envelope to `bars` values in 0..1 (max per slice). */
export function waveformBars(peaks: number[], bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  if (peaks.length === 0 || bars <= 0) return out;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * peaks.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * peaks.length) / bars));
    let max = 0;
    for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
    out[b] = max / 255;
  }
  return out;
}

export function isActiveAt(active: number[][] | undefined, seconds: number): boolean {
  if (!active) return false;
  return active.some(([s, e]) => seconds >= s && seconds < e);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/utils/__tests__/rehearsalMixes.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/rehearsalMixes.ts app/utils/__tests__/rehearsalMixes.test.ts
git commit -m "feat(rehearsal): neutral helpers — family order/labels, grouping, preselection, waveform bars

Neutral module so the song page (a Server Component) can call preselectMix
without crossing a client boundary (ADR-0028). Seat→family pins against
INSTRUMENT_SEAT_OPTIONS so a new seat fails a test before it fails a member."
```

---

### Task 3: Ingest logic — folder parse, matching, idempotent plan (pure)

**Files:**
- Create: `scripts/lib/rehearsal-ingest.mjs`
- Test: `scripts/lib/__tests__/rehearsal-ingest.test.mjs`

**Interfaces:**
- Consumes: `buildCatalogIndex(posts)`, `matchSong(rawName, index, aliases)` from `scripts/lib/setlist-match.mjs`; `normalizeForMatch` from `scripts/lib/catalog-reconcile.mjs`.
- Produces:
  ```js
  export function parseFolderName(name)            // "Amor sin Condición_144BPM_G Project" → { title: "Amor sin Condición", bpm: 144, tone: "G" }; tone/bpm null when absent
  export function songNameFromManifest(manifest)   // strips a leading "N. " from manifest.song.name
  export function mixKey(setSha1, filePath)        // sha1(setSha1 + basename(filePath)).slice(0, 24)
  export function matchFolder({ folderName, manifest, index, overrides }) // → { postId } | { unmatched: { reason, candidates } }
  export function planIngest({ manifest, folderName, post, existing }) // → { items, uploads, kept, skipped, replaced }
  ```
  where `existing` is the post's current `rehearsalMixes[]` projected as
  `{ _key, sourceHash, assetId, sha1 }` and `planIngest` returns
  `items` (the full array to `.set`, uploads referenced by `{ uploadIndex }`),
  `uploads` (`[{ path, filename, uploadIndex }]`), `kept` (`_key`s reused),
  `skipped` (`_key`s whose asset sha1 matched — no upload), `replaced` (asset ids to delete).

- [ ] **Step 1: Write the failing tests**

`scripts/lib/__tests__/rehearsal-ingest.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { buildCatalogIndex } from "../setlist-match.mjs";
import { matchFolder, mixKey, parseFolderName, planIngest, songNameFromManifest } from "../rehearsal-ingest.mjs";

const manifest = {
  set: { path: "/ssd/Amor sin Condición_144BPM_G Project/x.als", sha1: "aaaa1111" },
  song: { name: "2. AMOR SIN CONDICIÓN", bpm_range: [144, 144] },
  files: [
    { path: "/out/Amor - Full.mp3", kind: "full", target: null },
    { path: "/out/Amor - EG 1 UP.mp3", kind: "up", target: "EG 1", family: "electric", peaks: [0, 255], active: [[1, 2]] },
    { path: "/out/Amor - Keys 2 UP.mp3", kind: "up", target: "Keys 2", family: "keys", peaks: [9, 9], active: [] },
  ],
};
const posts = [
  { _id: "p1", title: "Amor sin condición" },
  { _id: "p2", title: "Amor sin condición (Unconditional)" },
  { _id: "p3", title: "Gracias, Dios" },
];

describe("parseFolderName", () => {
  it("reads title, bpm and tone from the render folder convention", () => {
    expect(parseFolderName("Amor sin Condición_144BPM_G Project")).toEqual({ title: "Amor sin Condición", bpm: 144, tone: "G" });
    expect(parseFolderName("Gracias, Dios_130BPM_Db")).toEqual({ title: "Gracias, Dios", bpm: 130, tone: "Db" });
    expect(parseFolderName("Praise_127BPM_A")).toEqual({ title: "Praise", bpm: 127, tone: "A" });
  });
  it("returns nulls when the suffix is missing", () => {
    expect(parseFolderName("Tomaste mi lugar")).toEqual({ title: "Tomaste mi lugar", bpm: null, tone: null });
  });
});

describe("songNameFromManifest", () => {
  it("strips the set's ordinal prefix", () => {
    expect(songNameFromManifest(manifest)).toBe("AMOR SIN CONDICIÓN");
    expect(songNameFromManifest({ song: { name: "FIEL" } })).toBe("FIEL");
  });
});

describe("mixKey", () => {
  it("is deterministic on set sha1 + file basename only", () => {
    const a = mixKey("aaaa1111", "/out/Amor - EG 1 UP.mp3");
    expect(a).toBe(mixKey("aaaa1111", "/elsewhere/Amor - EG 1 UP.mp3"));
    expect(a).not.toBe(mixKey("bbbb2222", "/out/Amor - EG 1 UP.mp3"));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("matchFolder", () => {
  const index = buildCatalogIndex(posts);
  it("matches an unambiguous title from the folder name", () => {
    expect(matchFolder({ folderName: "Gracias, Dios_130BPM_Db", manifest: { song: { name: "3. GRACIAS DIOS" } }, index, overrides: {} }))
      .toEqual({ postId: "p3" });
  });
  it("reports candidates when the folder AND the manifest name are ambiguous", () => {
    const r = matchFolder({ folderName: "Amor sin Condición_144BPM_G Project", manifest, index, overrides: {} });
    expect(r.unmatched.reason).toBe("ambiguous");
    expect(r.unmatched.candidates).toEqual(["p1", "p2"]);
  });
  it("an override wins outright", () => {
    expect(matchFolder({ folderName: "Amor sin Condición_144BPM_G Project", manifest, index, overrides: { "Amor sin Condición_144BPM_G Project": "p1" } }))
      .toEqual({ postId: "p1" });
  });
  it("reports no-match when nothing resolves", () => {
    const r = matchFolder({ folderName: "Canción Nueva_90BPM_C", manifest: { song: { name: "1. CANCIÓN NUEVA" } }, index, overrides: {} });
    expect(r.unmatched.reason).toBe("no-match");
  });
});

describe("planIngest", () => {
  const folderName = "Amor sin Condición_144BPM_G Project";
  const post = { _id: "p1", key: "A" };

  it("plans one item per file with deterministic keys, tone from the folder, bpm from the manifest", () => {
    const plan = planIngest({ manifest, folderName, post, existing: [] });
    expect(plan.items).toHaveLength(3);
    expect(plan.uploads).toHaveLength(3);
    const eg = plan.items.find((i) => i.track === "EG 1");
    expect(eg).toMatchObject({ _type: "rehearsalMix", kind: "up", family: "electric", tone: "G", bpm: 144, peaks: [0, 255], active: [[1, 2]], sourceHash: "aaaa1111" });
    expect(eg._key).toBe(mixKey("aaaa1111", "Amor - EG 1 UP.mp3"));
    expect(eg.audioFile).toEqual({ _type: "file", asset: { _type: "reference", uploadIndex: 1 } });
    const full = plan.items.find((i) => i.kind === "full");
    expect(full.track).toBeUndefined(); expect(full.peaks).toBeUndefined();
    expect(plan.uploads[1]).toEqual({ path: "/out/Amor - EG 1 UP.mp3", filename: "Amor - EG 1 UP.mp3", uploadIndex: 1 });
  });

  it("falls back to the post's key when the folder has no tone", () => {
    const plan = planIngest({ manifest, folderName: "Amor sin Condición", post, existing: [] });
    expect(plan.items[0].tone).toBe("A");
  });

  it("skips the upload when the same key already holds an asset with the same sha1", () => {
    const key = mixKey("aaaa1111", "Amor - EG 1 UP.mp3");
    const existing = [{ _key: key, sourceHash: "aaaa1111", assetId: "file-abc-mp3", sha1: "SHA_EG1" }];
    const plan = planIngest({ manifest, folderName, post, existing, localSha1: { "/out/Amor - EG 1 UP.mp3": "SHA_EG1" } });
    expect(plan.skipped).toEqual([key]);
    expect(plan.uploads.map((u) => u.filename)).toEqual(["Amor - Full.mp3", "Amor - Keys 2 UP.mp3"]);
    const eg = plan.items.find((i) => i._key === key);
    expect(eg.audioFile).toEqual({ _type: "file", asset: { _type: "reference", _ref: "file-abc-mp3" } });
    expect(plan.replaced).toEqual([]);
  });

  it("replaces a changed file under the same key and lists its old asset for deletion", () => {
    const key = mixKey("aaaa1111", "Amor - EG 1 UP.mp3");
    const existing = [{ _key: key, sourceHash: "aaaa1111", assetId: "file-old-mp3", sha1: "OLD" }];
    const plan = planIngest({ manifest, folderName, post, existing, localSha1: { "/out/Amor - EG 1 UP.mp3": "NEW" } });
    expect(plan.replaced).toEqual(["file-old-mp3"]);
    expect(plan.uploads.map((u) => u.filename)).toContain("Amor - EG 1 UP.mp3");
  });

  it("keeps items from OTHER renders (another sourceHash) untouched, and drops stale items of THIS render", () => {
    const stale = mixKey("aaaa1111", "Amor - Bass UP.mp3");
    const existing = [
      { _key: "otherkey", sourceHash: "zzzz9999", assetId: "file-z-mp3", sha1: "Z" },
      { _key: stale, sourceHash: "aaaa1111", assetId: "file-stale-mp3", sha1: "S" },
    ];
    const plan = planIngest({ manifest, folderName, post, existing, existingItems: { otherkey: { _key: "otherkey", kind: "up", track: "X", sourceHash: "zzzz9999" } } });
    expect(plan.kept).toEqual(["otherkey"]);
    expect(plan.items.some((i) => i._key === "otherkey")).toBe(true);
    expect(plan.items.some((i) => i._key === stale)).toBe(false);
    expect(plan.replaced).toEqual(["file-stale-mp3"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/lib/__tests__/rehearsal-ingest.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`scripts/lib/rehearsal-ingest.mjs`:

```js
// Pure half of scripts/ingest-rehearsal-mixes.mjs: folder-name parsing,
// catalog matching and the idempotent write plan. No I/O here, so the plan
// is testable and the dry run prints EXACTLY what --apply would do.
//
// Contract: abletonnl manifest.json (spec 2026-09-20-rehearsal-mixes §5):
//   set.sha1, song.name ("2. NADIE"), song.bpm_range, files[]{ path, kind,
//   target, family, peaks, active }.
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeForMatch } from "./catalog-reconcile.mjs";
import { matchSong } from "./setlist-match.mjs";

const FOLDER_RE = /^(.*?)_(\d+(?:\.\d+)?)BPM_([A-G](?:#|b)?m?)(?:\s+Project)?$/i;

export function parseFolderName(name) {
  const m = name.match(FOLDER_RE);
  if (!m) return { title: name.replace(/\s+Project$/i, "").trim(), bpm: null, tone: null };
  return { title: m[1].trim(), bpm: Number(m[2]), tone: m[3] };
}

export function songNameFromManifest(manifest) {
  return String(manifest?.song?.name ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

export function mixKey(setSha1, filePath) {
  return createHash("sha1").update(`${setSha1}${path.basename(filePath)}`).digest("hex").slice(0, 24);
}

/** Folder name first, manifest song name second; an override wins outright. */
export function matchFolder({ folderName, manifest, index, overrides }) {
  if (overrides && overrides[folderName]) return { postId: overrides[folderName] };
  const tried = [];
  for (const raw of [parseFolderName(folderName).title, songNameFromManifest(manifest)]) {
    if (!raw) continue;
    const r = matchSong(raw, index);
    tried.push({ raw, key: normalizeForMatch(raw), result: r });
    if (r?.postId) return { postId: r.postId };
  }
  const ambiguous = tried.find((t) => t.result?.candidates);
  if (ambiguous) return { unmatched: { reason: "ambiguous", candidates: ambiguous.result.candidates, tried } };
  return { unmatched: { reason: "no-match", candidates: [], tried } };
}

/**
 * The full `rehearsalMixes` array to `.set`, plus what to upload and delete.
 * Items from OTHER renders (different sourceHash) are kept verbatim from
 * `existingItems`; items of THIS render are rebuilt from the manifest, reusing
 * an asset when its sha1 equals the local file's.
 */
export function planIngest({ manifest, folderName, post, existing = [], existingItems = {}, localSha1 = {} }) {
  const setSha1 = manifest.set.sha1;
  const folder = parseFolderName(folderName);
  const tone = folder.tone ?? post.key ?? "";
  const bpm = Number.isFinite(manifest?.song?.bpm_range?.[0]) ? manifest.song.bpm_range[0] : folder.bpm ?? undefined;
  const byKey = new Map(existing.map((e) => [e._key, e]));

  const items = [];
  const uploads = [];
  const skipped = [];
  const replaced = [];
  const thisRenderKeys = new Set();

  for (const f of manifest.files) {
    const filename = path.basename(f.path);
    const _key = mixKey(setSha1, f.path);
    thisRenderKeys.add(_key);
    const prior = byKey.get(_key);
    let audioFile;
    if (prior && prior.assetId && prior.sha1 && localSha1[f.path] === prior.sha1) {
      skipped.push(_key);
      audioFile = { _type: "file", asset: { _type: "reference", _ref: prior.assetId } };
    } else {
      if (prior?.assetId) replaced.push(prior.assetId);
      const uploadIndex = uploads.length;
      uploads.push({ path: f.path, filename, uploadIndex });
      audioFile = { _type: "file", asset: { _type: "reference", uploadIndex } };
    }
    const item = { _key, _type: "rehearsalMix", kind: f.kind, tone, sourceHash: setSha1, audioFile };
    if (bpm !== undefined) item.bpm = bpm;
    if (f.kind === "up") {
      item.track = f.target;
      item.family = f.family;
      item.peaks = f.peaks;
      item.active = f.active;
    }
    items.push(item);
  }

  const kept = [];
  for (const e of existing) {
    if (e.sourceHash === setSha1) {
      if (!thisRenderKeys.has(e._key) && e.assetId) replaced.push(e.assetId);
      continue;
    }
    const full = existingItems[e._key];
    if (full) { items.push(full); kept.push(e._key); }
  }
  return { items, uploads, kept, skipped, replaced };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/lib/__tests__/rehearsal-ingest.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rehearsal-ingest.mjs scripts/lib/__tests__/rehearsal-ingest.test.mjs
git commit -m "feat(scripts): pure ingest plan for rehearsal mixes — folder parse, catalog match, idempotent items

_key = sha1(set.sha1 + basename) so a re-run updates instead of duplicating;
an asset is reused only when its sha1 equals the local file's; items from
another render of the same song (a second key) are kept, stale items of this
render are dropped and their assets listed for deletion. Matching reuses the
setlist matcher and reports ambiguity instead of guessing."
```

---

### Task 4: The ingest script (`--apply`)

**Files:**
- Create: `scripts/ingest-rehearsal-mixes.mjs`
- Create: `docs/REHEARSAL_MIXES.md`

**Interfaces:**
- Consumes: Task 3 exports; `buildCatalogIndex` (`scripts/lib/setlist-match.mjs`).
- Produces: a runnable script. No unit test (I/O); the dry run IS the test, and its output is pasted into `docs/REHEARSAL_MIXES.md`'s «Verified runs» when the first batch lands.

- [ ] **Step 1: Write the script**

`scripts/ingest-rehearsal-mixes.mjs`:

```js
// Ingest abletonnl rehearsal mixes into post.rehearsalMixes[] (spec
// 2026-09-20-rehearsal-mixes §7). Dry-run by default; --apply writes.
//
//   node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs <root>
//   node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs <root> --apply
//
// <root> holds one folder per song, each with abletonnl's manifest.json and
// the MP3s it names. Optional <root>/matches.json = { "<folder>": "<post _id>" }
// overrides matching. Unmatched folders go to <root>/unmatched.json; nothing
// is written for them. Re-running is safe: keys are deterministic, an asset
// whose sha1 already matches is not re-uploaded, and items from other
// renders of the same song are kept.
//
// Uses the existing SANITY_WRITE_TOKEN / SANITY_API_READ_TOKEN — no new secret.
import { createClient } from "next-sanity";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCatalogIndex } from "./lib/setlist-match.mjs";
import { matchFolder, planIngest } from "./lib/rehearsal-ingest.mjs";

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith("--"));
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
if (!root || !existsSync(root)) {
  console.error("Usage: ingest-rehearsal-mixes.mjs <root> [--apply]");
  process.exit(1);
}
const apply = argv.includes("--apply");

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}
const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: process.env.SANITY_API_READ_TOKEN });
const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: process.env.SANITY_WRITE_TOKEN });

console.log(`ingest-rehearsal-mixes\n  project: ${projectId}\n  dataset: ${dataset}\n  root:    ${root}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const overridesPath = path.join(root, "matches.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const posts = await reader.fetch(`*[_type == "post"]{ _id, title, key }`);
const index = buildCatalogIndex(posts);
const postById = new Map(posts.map((p) => [p._id, p]));

const sha1Of = (file) => createHash("sha1").update(readFileSync(file)).digest("hex");

const folders = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, "manifest.json")))
  .map((d) => d.name)
  .sort();
console.log(`  Carpetas con manifest.json: ${folders.length}`);

const unmatched = {};
let totalUploads = 0, totalBytes = 0, totalSkipped = 0, totalReplaced = 0, written = 0;

for (const folderName of folders) {
  const dir = path.join(root, folderName);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (!manifest?.set?.sha1 || !Array.isArray(manifest.files)) {
    console.log(`  ! ${folderName}: manifest sin set.sha1 o files — se omite`);
    continue;
  }
  const m = matchFolder({ folderName, manifest, index, overrides });
  if (!m.postId) {
    unmatched[folderName] = m.unmatched;
    console.log(`  ? ${folderName}: ${m.unmatched.reason}${m.unmatched.candidates.length ? " → " + m.unmatched.candidates.join(", ") : ""}`);
    continue;
  }
  const post = postById.get(m.postId);
  // Resolve file paths relative to the folder when the manifest's absolute path moved with the SSD.
  for (const f of manifest.files) {
    if (!existsSync(f.path)) f.path = path.join(dir, path.basename(f.path));
  }
  const missing = manifest.files.filter((f) => !existsSync(f.path));
  if (missing.length) {
    console.log(`  ! ${folderName}: faltan ${missing.length} archivo(s) — se omite: ${missing.map((f) => path.basename(f.path)).join(", ")}`);
    continue;
  }
  const existing = await reader.fetch(
    `*[_type == "post" && _id == $id][0].rehearsalMixes[]{ _key, sourceHash, "assetId": audioFile.asset._ref, "sha1": audioFile.asset->sha1hash }`,
    { id: post._id },
  ) ?? [];
  const existingFull = await reader.fetch(`*[_type == "post" && _id == $id][0].rehearsalMixes`, { id: post._id }) ?? [];
  const existingItems = Object.fromEntries(existingFull.map((i) => [i._key, i]));
  const localSha1 = Object.fromEntries(manifest.files.map((f) => [f.path, sha1Of(f.path)]));

  const plan = planIngest({ manifest, folderName, post, existing, existingItems, localSha1 });
  const bytes = plan.uploads.reduce((n, u) => n + readFileSync(u.path).length, 0);
  totalUploads += plan.uploads.length; totalBytes += bytes; totalSkipped += plan.skipped.length; totalReplaced += plan.replaced.length;
  console.log(`  ${apply ? "+" : "="} ${folderName} → ${post.title} (${post._id}): ${plan.items.length} items, sube ${plan.uploads.length} (${(bytes / 1e6).toFixed(1)} MB), reusa ${plan.skipped.length}, conserva ${plan.kept.length}, reemplaza ${plan.replaced.length}`);

  if (!apply) continue;
  const assetIds = [];
  for (const u of plan.uploads) {
    const asset = await writer.assets.upload("file", readFileSync(u.path), { filename: u.filename, contentType: "audio/mpeg" });
    assetIds[u.uploadIndex] = asset._id;
  }
  const items = plan.items.map((i) =>
    i.audioFile?.asset?.uploadIndex !== undefined
      ? { ...i, audioFile: { _type: "file", asset: { _type: "reference", _ref: assetIds[i.audioFile.asset.uploadIndex] } } }
      : i,
  );
  await writer.patch(post._id).set({ rehearsalMixes: items }).commit();
  written += 1;
  for (const id of plan.replaced) {
    try { await writer.delete(id); } catch (e) { console.log(`    (no se pudo borrar ${id}: ${e.message})`); }
  }
}

if (Object.keys(unmatched).length) {
  writeFileSync(path.join(root, "unmatched.json"), JSON.stringify(unmatched, null, 2));
  console.log(`\n  Sin casar: ${Object.keys(unmatched).length} → ${path.join(root, "unmatched.json")} (añade matches.json para resolverlos)`);
}
console.log(`\n  Total: sube ${totalUploads} archivos (${(totalBytes / 1e6).toFixed(1)} MB), reusa ${totalSkipped}, reemplaza ${totalReplaced}${apply ? `, escribió ${written} canciones` : ""}`);
console.log(apply
  ? "\nDONE. La ficha (/api/song) muestra los mixes de inmediato; /posts/[slug] dentro de 1 h (revalidate = 3600)."
  : "\nDRY-RUN. Vuelve a correr con --apply para escribir.");
```

- [ ] **Step 2: Lint the script**

Run: `npx eslint scripts/ingest-rehearsal-mixes.mjs scripts/lib/rehearsal-ingest.mjs`
Expected: 0 errors.

- [ ] **Step 3: Dry-run against an empty folder to prove the harness**

```bash
mkdir -p /tmp/rm-empty && node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs /tmp/rm-empty
```
Expected: header, `Carpetas con manifest.json: 0`, `DRY-RUN.` and exit 0. (Reads the catalog; writes nothing.)

- [ ] **Step 4: Write the runbook**

`docs/REHEARSAL_MIXES.md`:

```markdown
# Rehearsal mixes — render and ingest runbook

Spec: `docs/superpowers/specs/2026-09-20-rehearsal-mixes-design.md`. Model: `post.rehearsalMixes[]`
(`docs/DATA_MODEL.md`). Route: `/api/audio/[songId]/[key]` (`docs/API_REFERENCE.md`).

## One batch, start to finish

1. Connect the SSD with the Ableton projects. Nothing in the app ever reads it.
2. Render with `abletonnl` (its MCP or CLI), one song per call, into one output root, e.g.
   `~/Rehearsal-out/<song folder>/`. Isolate the seven families the team plays:
   `tracks` = every band track whose family is one of
   `electric, acoustic, keys, organ, synth, bass, drums` (read them from `inspect_set`).
   Pads, strings, loops, FX and vocals stay in the bed. Each folder ends with
   `manifest.json` carrying per-file `kind`, `family`, `peaks`, `active`.
3. Dry run:
   `node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs ~/Rehearsal-out`
   Read every line. `?` lines are unmatched folders — write `~/Rehearsal-out/matches.json`
   (`{ "<folder>": "<post _id>" }`) and re-run until none remain.
4. Apply (production dataset — needs Frank's explicit go on the dry-run output):
   `node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs ~/Rehearsal-out --apply`
5. The song sheet shows the mixes at once; `/posts/[slug]` within its 1 h ISR window.

Re-running is safe: keys are `sha1(set.sha1 + file name)`, an asset whose sha1 already
matches is reused, items from another render of the same song (a second key) are kept.

## Quotas to watch (Sanity Free)

100 GB assets / 100 GB bandwidth per month. ~11 files per song at 192 kbps ≈ 7 MB each →
the whole catalog is ~11 GB. Bandwidth with offline download ≈ 7 GB/month. Check the
project's Usage page after the first two batches.

## Verified runs

_(paste the dry-run and apply summaries of each batch here, with the date)_
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-rehearsal-mixes.mjs docs/REHEARSAL_MIXES.md
git commit -m "feat(scripts): ingest-rehearsal-mixes — dry-run/--apply upload + patch from abletonnl manifests

Same shape as the backfills: dry run by default, unknown flags refuse,
production writes need Frank's go on the dry-run output. Unmatched folders
land in unmatched.json; matches.json overrides. No new secret."
```

---

### Task 5: `/api/audio/[songId]/[key]` — session-gated redirect

**Files:**
- Create: `app/api/audio/[songId]/[key]/route.ts`
- Test: `app/api/__tests__/audioRoute.test.ts`

**Interfaces:**
- Consumes: `requireMinistryMember("worship")` (`app/utils/authGuards.ts`), `serverClient` (`sanity/lib/serverClient.ts`).
- Produces: `GET /api/audio/<songId>/<key>[?download=1]` → `403` / `404` / `302 Location: https://cdn.sanity.io/...[?dl=<filename>]` with `Cache-Control: private, no-store`.

- [ ] **Step 1: Write the failing test**

`app/api/__tests__/audioRoute.test.ts`:

```ts
// The rehearsal-mix redirect (spec 2026-09-20-rehearsal-mixes §8.1, decision D2):
// it protects DISCOVERY — no page ever holds a cdn.sanity.io URL and a
// non-member gets nothing — and nothing more. Bytes never pass through here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireMinistryMember: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryMember: (m: string) => h.requireMinistryMember(m),
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p: unknown) => h.fetch(q, p) },
}));

import { GET } from "@/app/api/audio/[songId]/[key]/route";

const params = (songId = "post-1", key = "abc123") => Promise.resolve({ songId, key });
const req = (url: string) => ({ nextUrl: new URL(url), url } as unknown as NextRequest);

beforeEach(() => {
  h.requireMinistryMember.mockReset();
  h.fetch.mockReset();
});

describe("GET /api/audio/[songId]/[key]", () => {
  it("403s without worship membership and never reads Sanity", async () => {
    h.requireMinistryMember.mockResolvedValue(null);
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(403);
    expect(h.requireMinistryMember).toHaveBeenCalledWith("worship");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("404s when the key is not on the song", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue(null);
    const res = await GET(req("http://x/api/audio/post-1/nope"), { params: params("post-1", "nope") });
    expect(res.status).toBe(404);
    expect(h.fetch.mock.calls[0][1]).toEqual({ id: "post-1", key: "nope" });
  });

  it("302s to the CDN URL, private and uncacheable", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://cdn.sanity.io/files/p/d/aaa.mp3", filename: "Amor - EG 1 UP.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.sanity.io/files/p/d/aaa.mp3");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("?download=1 asks the CDN for a content-disposition with the original filename", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://cdn.sanity.io/files/p/d/aaa.mp3", filename: "Amor - EG 1 UP.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123?download=1"), { params: params() });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.sanity.io/files/p/d/aaa.mp3?dl=Amor%20-%20EG%201%20UP.mp3");
  });

  it("refuses to redirect anywhere but cdn.sanity.io", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://evil.example/x.mp3", filename: "x.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/__tests__/audioRoute.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

`app/api/audio/[songId]/[key]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireMinistryMember } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";

// Session-gated redirect to a rehearsal mix (spec 2026-09-20-rehearsal-mixes
// §8.1, decision D2). Bytes never pass through Vercel: this answers 302 to
// cdn.sanity.io, and that is the whole of the protection — it hides the URL
// from anyone without a worship session and lets access be withdrawn when a
// member leaves; past the redirect the member holds the raw URL. Same guard as
// /api/song/[id]: the catalog is a worship surface.

const CDN_HOST = "cdn.sanity.io";

export async function GET(req: NextRequest, { params }: { params: Promise<{ songId: string; key: string }> }) {
  const worship = await requireMinistryMember("worship");
  if (!worship) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { songId, key } = await params;
  const mix = await serverClient.fetch<{ url?: string; filename?: string } | null>(
    `*[_type == "post" && _id == $id][0].rehearsalMixes[_key == $key][0]{
      "url": audioFile.asset->url,
      "filename": audioFile.asset->originalFilename
    }`,
    { id: songId, key },
  );
  if (!mix?.url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let target: URL;
  try { target = new URL(mix.url); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  if (target.hostname !== CDN_HOST) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (req.nextUrl.searchParams.get("download") === "1") {
    // Sanity's documented download hook: `?dl=<name>` sets content-disposition.
    target.searchParams.set("dl", mix.filename || `${key}.mp3`);
  }
  const res = NextResponse.redirect(target.toString(), 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/__tests__/audioRoute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm the middleware matcher already covers it**

Run: `grep -n "api" app/utils/routeMatcher.ts proxy.ts | head`
Expected: `/api/*` (outside `/api/cron`) is matched; no change needed. If the matcher lists routes explicitly instead, STOP and report — the spec assumes the blanket match.

- [ ] **Step 6: Commit**

```bash
git add "app/api/audio/[songId]/[key]/route.ts" app/api/__tests__/audioRoute.test.ts
git commit -m "feat(api): /api/audio/[songId]/[key] — worship-session 302 to the CDN

Discovery gate only (D2): no page holds a cdn.sanity.io URL, a non-member
gets 403, and access ends with membership. Bytes never cross Vercel. Host
is pinned to cdn.sanity.io so a bad asset URL cannot turn this into an open
redirect. ?download=1 uses Sanity's ?dl= hook."
```

---

### Task 6: Single-song reads project the mixes; the peaks guard

**Files:**
- Modify: `app/api/song/[id]/route.ts:15-27` (GROQ) and the response
- Modify: `app/(client)/posts/[slug]/page.tsx:52-84` (GROQ)
- Test: `app/utils/__tests__/postPeaksProjection.test.ts`

**Interfaces:**
- Produces: both reads project
  ```groq
  rehearsalMixes[] { _key, kind, track, family, tone, bpm, "audioFileURL": audioFile.asset->url, peaks, active, sourceHash }
  ```
  `/api/song/[id]` also returns `myInstruments: string[]` (the viewer's `teamMembers.instruments`, `[]` when none).

- [ ] **Step 1: Write the failing guard test**

`app/utils/__tests__/postPeaksProjection.test.ts`:

```ts
// `rehearsalMixes[].peaks` is 600 numbers per mix, ~25 KB per song. Only the
// two SINGLE-SONG reads may project it; a list read that did would ship
// 142 × 25 KB of numbers nobody renders (spec 2026-09-20-rehearsal-mixes §6).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALLOWED = new Set(["app/api/song/[id]/route.ts", "app/(client)/posts/[slug]/page.tsx"]);

describe("post GROQ reads", () => {
  const files = execSync('git ls-files "app/**/*.ts" "app/**/*.tsx" "sanity/**/*.ts"', { encoding: "utf8" })
    .split("\n").filter((f) => f && !f.includes("__tests__"));
  const postReaders = files.filter((f) => /_type\s*==\s*"post"/.test(readFileSync(f, "utf8")));

  it("finds the readers this guard is about", () => {
    expect(postReaders).toEqual(expect.arrayContaining([...ALLOWED]));
  });

  it("projects peaks only in the two single-song reads", () => {
    const offenders = postReaders.filter((f) => !ALLOWED.has(f) && /\bpeaks\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("both single-song reads project the mixes with peaks and active", () => {
    for (const f of ALLOWED) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/rehearsalMixes\[\]\s*\{[^}]*peaks[^}]*active[^}]*\}/s);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/utils/__tests__/postPeaksProjection.test.ts`
Expected: FAIL on the third test (neither read projects `rehearsalMixes` yet).

- [ ] **Step 3: Project in `/api/song/[id]`**

In `app/api/song/[id]/route.ts`, add after the `audioTracks[]` line inside the GROQ:

```ts
        rehearsalMixes[] { _key, kind, track, family, tone, bpm, "audioFileURL": audioFile.asset->url, peaks, active, sourceHash },
```

Add a third read to the `Promise.all` — the viewer's instruments — and return it. The session comes back from the guard:

```ts
  const [song, historyRaw, myInstruments] = await Promise.all([
    serverClient.fetch(/* …unchanged… */),
    operationalClient.fetch<unknown[]>(/* …unchanged… */),
    serverClient.fetch<string[] | null>(
      `*[_type == "teamMembers" && _id == $me][0].instruments`,
      { me: worship.user.sanityId },
    ),
  ]);
```

and change the final line `return NextResponse.json({ ...song, history });` to `return NextResponse.json({ ...song, history, myInstruments: myInstruments ?? [] });`. Keep every existing field.

- [ ] **Step 4: Project in the page read**

In `app/(client)/posts/[slug]/page.tsx`'s `getPost` GROQ, after the `audioTracks[] { … }` block:

```ts
      rehearsalMixes[] { _key, kind, track, family, tone, bpm, "audioFileURL": audioFile.asset->url, peaks, active, sourceHash },
```

- [ ] **Step 5: Run the guard and the type check**

Run: `npx vitest run app/utils/__tests__/postPeaksProjection.test.ts && npx tsc --noEmit`
Expected: PASS ×3, no type errors (`Post.rehearsalMixes?` exists from Task 1).

- [ ] **Step 6: Commit**

```bash
git add "app/api/song/[id]/route.ts" "app/(client)/posts/[slug]/page.tsx" app/utils/__tests__/postPeaksProjection.test.ts
git commit -m "feat(reads): single-song reads project rehearsalMixes (+ viewer instruments); guard keeps peaks out of lists

Only the sheet API and the song page may project peaks — 600 numbers per
mix. The guard greps every post reader so a list read that adds it fails
the suite instead of shipping 3.5 MB of numbers to /biblioteca."
```

---

### Task 7: `Waveform` — canvas with peaks, active spans and playhead

**Files:**
- Create: `app/components/song/Waveform.tsx`
- Test: `app/components/song/__tests__/waveform.test.tsx`

**Interfaces:**
- Consumes: `waveformBars`, `isActiveAt` (Task 2), `themeColour` (`app/utils/themeColour.ts`).
- Produces:
  ```tsx
  export default function Waveform(props: {
    peaks: number[];            // 0..255
    active?: number[][];        // seconds
    duration: number;           // seconds, 0 when unknown
    progress: number;           // 0..1
    label: string;              // for aria
    onSeek?: (fraction: number) => void;
    className?: string;
  }): JSX.Element
  ```
  Renders a `<canvas role="img" aria-label={label}>` wrapped in a `<button type="button">` when `onSeek` is given (so keyboard users can seek with ←/→ by 5 %), else a plain `<div>`.

- [ ] **Step 1: Write the failing test**

`app/components/song/__tests__/waveform.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Waveform from "../Waveform";

beforeAll(() => {
  // jsdom has no canvas; the component must survive a null context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const peaks = Array.from({ length: 600 }, (_, i) => (i % 2 ? 255 : 0));

describe("Waveform", () => {
  it("renders an accessible image and seeks by click fraction", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<Waveform peaks={peaks} active={[[0, 10]]} duration={100} progress={0.25} label="Onda EG 1" onSeek={onSeek} />);
    const btn = getByRole("button", { name: "Onda EG 1" });
    Object.defineProperty(btn, "getBoundingClientRect", { value: () => ({ left: 0, width: 200, top: 0, height: 40, right: 200, bottom: 40 }) });
    fireEvent.click(btn, { clientX: 50 });
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it("seeks 5 % with the arrow keys, clamped to 0..1", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<Waveform peaks={peaks} duration={100} progress={0.98} label="Onda" onSeek={onSeek} />);
    const btn = getByRole("button", { name: "Onda" });
    fireEvent.keyDown(btn, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(btn, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(0.93);
  });

  it("is a plain image without onSeek", () => {
    const { queryByRole, getByRole } = render(<Waveform peaks={peaks} duration={0} progress={0} label="Onda" />);
    expect(queryByRole("button")).toBeNull();
    expect(getByRole("img", { name: "Onda" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/song/__tests__/waveform.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`app/components/song/Waveform.tsx`:

```tsx
"use client";

// The rehearsal player's waveform: the ISOLATED instrument's envelope (600
// peaks from abletonnl's manifest, spec §5) drawn as bars, the `active` spans
// painted in the accent so a member sees where their part sounds, and the
// playhead. One canvas per row; it redraws on resize, progress or theme
// change. Colours come from `themeColour` — a canvas cannot read Tailwind
// classes, and a concatenated hex is the failure `themeColour` exists to
// prevent. Seeking is a click (fraction of width) or ←/→ (5 %).
import { useCallback, useEffect, useRef } from "react";
import { isActiveAt, waveformBars } from "@/app/utils/rehearsalMixes";
import { themeColour } from "@/app/utils/themeColour";

const BAR_W = 2;
const GAP = 1;
const STEP = 5 / 100;

export default function Waveform({
  peaks, active, duration, progress, label, onSeek, className = "",
}: {
  peaks: number[];
  active?: number[][];
  duration: number;
  progress: number;
  label: string;
  onSeek?: (fraction: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const bars = Math.max(1, Math.floor(w / (BAR_W + GAP)));
    const values = waveformBars(peaks, bars);
    const playedUntil = progress * w;
    for (let i = 0; i < bars; i++) {
      const x = i * (BAR_W + GAP);
      const seconds = duration > 0 ? ((i + 0.5) / bars) * duration : -1;
      const on = seconds >= 0 && isActiveAt(active, seconds);
      const played = x <= playedUntil;
      ctx.fillStyle = on
        ? themeColour("--accent-rgb", played ? 1 : 0.55)
        : themeColour("--mono-400-rgb", played ? 0.9 : 0.35);
      const bh = Math.max(2, values[i] * (h - 2));
      ctx.fillRect(x, (h - bh) / 2, BAR_W, bh);
    }
    // playhead
    ctx.fillStyle = themeColour("--accent-rgb");
    ctx.fillRect(Math.min(w - 1, playedUntil), 0, 1, h);
  }, [peaks, active, duration, progress]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const seekFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };
  const seekFromKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!onSeek) return;
    if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(1, +(progress + STEP).toFixed(2))); }
    if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(0, +(progress - STEP).toFixed(2))); }
  };

  const canvas = (
    <canvas ref={canvasRef} role="img" aria-label={label} className="block h-10 w-full" />
  );
  if (!onSeek) return <div className={className}>{canvas}</div>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={seekFromEvent}
      onKeyDown={seekFromKey}
      className={`block w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${className}`}
    >
      {canvas}
    </button>
  );
}
```

`--mono-400-rgb` exists in `app/brand.css` `:root` (verified).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/components/song/__tests__/waveform.test.tsx`
Expected: PASS (3 tests). Note the nested `role="img"` inside the button: the test queries the button by its own `aria-label`.

- [ ] **Step 5: Commit**

```bash
git add app/components/song/Waveform.tsx app/components/song/__tests__/waveform.test.tsx
git commit -m "feat(song): Waveform canvas — isolated-stem envelope, active spans in accent, playhead, click/keys seek

Colours through themeColour because a canvas cannot read Tailwind and a
concatenated hex is the exact failure that util exists to prevent."
```

---

### Task 8: `RehearsalPlayer` — list, play, switch keeping position, download, preselection

**Files:**
- Create: `app/components/song/RehearsalPlayer.tsx`
- Test: `app/components/song/__tests__/rehearsalPlayer.test.tsx`

**Interfaces:**
- Consumes: `usePlayer()` (`player`, `playTrack`, `togglePlay`, `seek`, `getAudio`), `groupMixes`/`mixLabel`/`preselectMix` (Task 2), `Waveform` (Task 7), `Button` + `buttonClass` (`app/components/ui/Button.tsx`), `Equalizer`, `PlayPauseGlyph`.
- Produces:
  ```tsx
  export default function RehearsalPlayer(props: {
    mixes: RehearsalMix[];
    songId: string;
    songTitle: string;
    songSlug: string;
    preselect?: string[] | null;   // the viewer's instruments — highlight only
  }): JSX.Element | null
  ```
  Track URLs handed to the player are `/api/audio/<songId>/<_key>` (never the CDN URL); download links are the same with `?download=1`.

- [ ] **Step 1: Write the failing test**

`app/components/song/__tests__/rehearsalPlayer.test.tsx`:

```tsx
/** @vitest-environment jsdom */
// Behaviour the spec pins (§8.2): one <audio> through PlayerContext, switching
// tracks keeps the position, preselection only highlights, and no URL on the
// page is a cdn.sanity.io URL.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RehearsalMix } from "@/app/utils/interface";
import RehearsalPlayer from "../RehearsalPlayer";

const playTrack = vi.fn();
const togglePlay = vi.fn();
const seek = vi.fn();
let player = { track: null as null | { url: string }, isPlaying: false };
const audio = { currentTime: 0, duration: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() };

vi.mock("@/app/context/PlayerContext", () => ({
  usePlayer: () => ({ playTrack, togglePlay, seek, player, getAudio: () => audio }),
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  playTrack.mockReset(); togglePlay.mockReset(); seek.mockReset();
  audio.addEventListener.mockReset(); audio.currentTime = 0;
  player = { track: null, isPlaying: false };
});

const mix = (over: Partial<RehearsalMix>): RehearsalMix => ({
  _key: "k", kind: "up", tone: "G", audioFileURL: "https://cdn.sanity.io/files/x.mp3", sourceHash: "s",
  peaks: [0, 255], active: [[0, 1]], ...over,
});
const mixes = [
  mix({ _key: "full", kind: "full", peaks: undefined, active: undefined }),
  mix({ _key: "eg1", track: "EG 1", family: "electric" }),
  mix({ _key: "bass", track: "Bass", family: "bass" }),
];
const props = { mixes, songId: "post-1", songTitle: "Amor", songSlug: "amor" };

describe("RehearsalPlayer", () => {
  it("renders nothing for no mixes", () => {
    const { container } = render(<RehearsalPlayer {...props} mixes={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists Full then families, plays through the API route, and never exposes the CDN URL", () => {
    const { getByRole, container } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Reproducir EG 1" }));
    expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/eg1", title: "EG 1", songTitle: "Amor", songSlug: "amor" }));
    expect(container.innerHTML).not.toContain("cdn.sanity.io");
    expect(getByRole("link", { name: "Descargar EG 1" }).getAttribute("href")).toBe("/api/audio/post-1/eg1?download=1");
  });

  it("switching tracks keeps the position", () => {
    player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
    audio.currentTime = 42;
    const { getByRole } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Reproducir Bass" }));
    expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/bass" }));
    const [event, handler] = audio.addEventListener.mock.calls[0];
    expect(event).toBe("loadedmetadata");
    audio.currentTime = 0;
    (handler as () => void)();
    expect(audio.currentTime).toBe(42);
  });

  it("pauses the current track instead of restarting it", () => {
    player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
    const { getByRole } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Pausar EG 1" }));
    expect(togglePlay).toHaveBeenCalled();
    expect(playTrack).not.toHaveBeenCalled();
  });

  it("preselects the member's instrument row without playing, and keeps focus on the pressed row", () => {
    const { getByRole } = render(<RehearsalPlayer {...props} preselect={["Bass"]} />);
    const row = getByRole("listitem", { name: "Bass" });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(playTrack).not.toHaveBeenCalled();
    const btn = getByRole("button", { name: "Reproducir Bass" });
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).toBe(btn);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/song/__tests__/rehearsalPlayer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`app/components/song/RehearsalPlayer.tsx`:

```tsx
"use client";

// The rehearsal player (spec 2026-09-20-rehearsal-mixes §8.2). Presentational:
// mixes and the viewer's instruments arrive as props, so the song page (a
// Server Component) can render it and the theme-gallery fixture can host it
// with inline data. ONE <audio>, the app's, through PlayerContext — the fixed
// AudioTransport keeps working unchanged. Every URL on the page is the
// session-gated route, never cdn.sanity.io (decision D2).
import { useEffect, useMemo, useState } from "react";
import { usePlayer, type AudioTrack } from "@/app/context/PlayerContext";
import Equalizer from "@/app/components/ui/Equalizer";
import PlayPauseGlyph from "@/app/components/ui/PlayPauseGlyph";
import Button, { buttonClass } from "@/app/components/ui/Button";
import type { RehearsalMix } from "@/app/utils/interface";
import { groupMixes, mixLabel, preselectMix } from "@/app/utils/rehearsalMixes";
import Waveform from "./Waveform";

export default function RehearsalPlayer({
  mixes, songId, songTitle, songSlug, preselect,
}: {
  mixes: RehearsalMix[];
  songId: string;
  songTitle: string;
  songSlug: string;
  preselect?: string[] | null;
}) {
  const { player, playTrack, togglePlay, seek, getAudio } = usePlayer();
  const groups = useMemo(() => groupMixes(mixes), [mixes]);
  const highlighted = useMemo(() => preselectMix(mixes, preselect)?._key ?? null, [mixes, preselect]);
  const [time, setTime] = useState({ current: 0, duration: 0 });

  // Playhead: follow the app's <audio> while one of OUR tracks is loaded.
  useEffect(() => {
    const el = getAudio();
    if (!el) return;
    const tick = () => setTime({ current: el.currentTime || 0, duration: el.duration || 0 });
    el.addEventListener("timeupdate", tick);
    el.addEventListener("loadedmetadata", tick);
    return () => { el.removeEventListener("timeupdate", tick); el.removeEventListener("loadedmetadata", tick); };
  }, [getAudio]);

  if (mixes.length === 0) return null;

  const urlFor = (m: RehearsalMix) => `/api/audio/${encodeURIComponent(songId)}/${encodeURIComponent(m._key)}`;
  const isCurrent = (m: RehearsalMix) => player.track?.url === urlFor(m);
  const anyCurrent = mixes.some(isCurrent);

  const play = (m: RehearsalMix) => {
    if (isCurrent(m)) { togglePlay(); return; }
    // Switching keeps the position: read before the src changes, restore once
    // the new file knows its duration.
    const el = getAudio();
    const resumeAt = anyCurrent && el ? el.currentTime : 0;
    const track: AudioTrack = { url: urlFor(m), title: mixLabel(m), tone: m.tone, songTitle, songSlug };
    playTrack(track);
    if (el && resumeAt > 0) {
      el.addEventListener("loadedmetadata", () => { el.currentTime = resumeAt; }, { once: true });
    }
  };

  const progress = time.duration > 0 ? Math.min(1, time.current / time.duration) : 0;

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.family} className="space-y-2">
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">{g.label}</p>
          <ul className="space-y-2">
            {g.mixes.map((m) => {
              const label = mixLabel(m);
              const current = isCurrent(m);
              const playing = current && player.isPlaying;
              return (
                <li
                  key={m._key}
                  aria-label={label}
                  aria-current={highlighted === m._key ? "true" : undefined}
                  className={`brand-library-module flex flex-col gap-2 px-4 py-3 ${
                    current ? "border-accent/50 bg-accent/10" : highlighted === m._key ? "border-accent/30" : "border-accent-deep/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Button
                      variant="icon"
                      size="lg"
                      onClick={() => play(m)}
                      aria-label={`${playing ? "Pausar" : "Reproducir"} ${label}`}
                    >
                      <PlayPauseGlyph playing={playing} size={16} />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold truncate">{label}</p>
                      <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                        {m.tone}{m.bpm ? ` · ${m.bpm} BPM` : ""}
                      </p>
                    </div>
                    <Equalizer playing={playing} />
                    <a
                      href={`${urlFor(m)}?download=1`}
                      download
                      aria-label={`Descargar ${label}`}
                      className={buttonClass("ghost", "sm")}
                    >
                      Descargar
                    </a>
                  </div>
                  {m.kind === "up" && m.peaks && (
                    <Waveform
                      peaks={m.peaks}
                      active={m.active}
                      duration={current ? time.duration : 0}
                      progress={current ? progress : 0}
                      label={`Onda ${label}`}
                      onSeek={current ? seek : undefined}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

`Button` is the default export and `buttonClass` a named one (verified); `variant="icon" size="lg"` is the 44 px icon spelling (`Button.tsx:80`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/components/song/__tests__/rehearsalPlayer.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the repo-wide guards this component can trip**

Run: `npx vitest run app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/inputFontSize.test.ts app/utils/__tests__/bottomNavOffsetSync.test.ts app/utils/__tests__/rawMotionLiterals.test.ts`
Expected: PASS. (No fixed elements, no inputs, no raw motion literals were added.)

- [ ] **Step 6: Commit**

```bash
git add app/components/song/RehearsalPlayer.tsx app/components/song/__tests__/rehearsalPlayer.test.tsx
git commit -m "feat(song): RehearsalPlayer — grouped mixes, one <audio>, position kept on switch, session-gated URLs

Presentational so the page can render it and the gallery can host it. The
CDN URL never reaches the DOM: play and download both go through
/api/audio (D2). Preselection highlights the member's instrument row and
plays nothing."
```

---

### Task 9: Host the player — song page, sheet, gallery fixture

**Files:**
- Modify: `app/(client)/posts/[slug]/page.tsx` (imports, ~line 155 read, ~line 297 sections)
- Modify: `app/components/SongSheet.tsx:185-225`
- Modify: `app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx`
- Test: `app/utils/__tests__/themeGallery.test.ts` (existing sweep must stay green)

**Interfaces:**
- Consumes: `RehearsalPlayer` (Task 8), `SongSection` id `"ensayo"` (Task 1), `SongSheetData.rehearsalMixes`/`.myInstruments` (Task 1/6), `serverClient`.

- [ ] **Step 1: Page — read the viewer's instruments and render the section**

In `app/(client)/posts/[slug]/page.tsx`:

Import: `import RehearsalPlayer from "@/app/components/song/RehearsalPlayer";`

Replace `await requireWorshipPage(\`/posts/${slug}\`);` with:

```ts
  const session = await requireWorshipPage(`/posts/${slug}`);
```

After `const history = await getSongHistory(post._id);` add:

```ts
  // Preselection only (spec §8.2): the viewer's declared instruments pick which
  // rehearsal row is highlighted. Plain data — this stays a Server Component.
  const myInstruments = post.rehearsalMixes?.length
    ? (await serverClient.fetch<string[] | null>(
        `*[_type == "teamMembers" && _id == $me][0].instruments`,
        { me: session.user.sanityId },
      )) ?? []
    : [];
  const hasRehearsal   = shows("ensayo");
```

Import `serverClient` from `@/sanity/lib/serverClient` (the token-bearing read client used by
Server Components) — NOT the page's public `client` from `@/sanity/lib/client`, which must never
be pointed at `teamMembers`.

Before the `{/* Audio */}` section add:

```tsx
        {/* Ensayo */}
        {hasRehearsal && (
          <section id="ensayo" className="scroll-mt-[calc(8rem+env(safe-area-inset-top))] lg:scroll-mt-[calc(10rem+env(safe-area-inset-top))]">
            <SectionHeader>Ensayo</SectionHeader>
            <RehearsalPlayer
              mixes={post.rehearsalMixes!}
              songId={post._id}
              songTitle={post.title}
              songSlug={post.slug.current}
              preselect={myInstruments}
            />
          </section>
        )}
```

- [ ] **Step 2: Sheet — host under an «Ensayo» eyebrow**

In `app/components/SongSheet.tsx`, import `RehearsalPlayer` and, immediately BEFORE the `{/* Audio tracks */}` block:

```tsx
              {(sheet?.rehearsalMixes?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">Ensayo</p>
                  <RehearsalPlayer
                    mixes={sheet!.rehearsalMixes!}
                    songId={sheet!._id}
                    songTitle={sheet!.title}
                    songSlug={sheet!.slug}
                    preselect={sheet!.myInstruments}
                  />
                </div>
              )}
```

- [ ] **Step 3: Gallery — host with inline data**

In `SongPracticeFixture.tsx` add, next to `TRACKS`:

```tsx
import RehearsalPlayer from "@/app/components/song/RehearsalPlayer";
// …
/** Two rehearsal rows with a synthetic envelope: no network, no session. */
const PEAKS = Array.from({ length: 600 }, (_, i) => (i > 120 && i < 420 ? 40 + Math.round(200 * Math.abs(Math.sin(i / 9))) : 8));
const MIXES = [
  { _key: "g-full", kind: "full" as const, tone: "Sol", audioFileURL: SILENT_WAV, sourceHash: "gallery" },
  { _key: "g-eg1", kind: "up" as const, track: "EG 1", family: "electric", tone: "Sol", bpm: 120, audioFileURL: SILENT_WAV, peaks: PEAKS, active: [[12, 42]], sourceHash: "gallery" },
];
```

and render, after the existing `SongAudioSection` block inside the fixture's layout:

```tsx
          <section className="space-y-4">
            <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">Ensayo</p>
            <RehearsalPlayer mixes={MIXES} songId="gallery" songTitle="Santo" songSlug="santo" preselect={["EG"]} />
          </section>
```

The player's play URL will be `/api/audio/gallery/...` (a 307 for an anonymous visit) — acceptable: the fixture is for looking, and the sweep forbids only reads at render time. Nothing here fetches.

- [ ] **Step 4: Run the gallery sweep, songSections, and the three gates**

Run: `npx vitest run app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/songSections.test.ts && npx tsc --noEmit && npx eslint . && npm test`
Expected: all green, eslint 0 errors.

- [ ] **Step 5: Look at it**

Run: `preview_start` on the dev server (per `.claude/launch.json`), open `/theme-gallery/dark/song` and `/theme-gallery/light/song`, screenshot the «Ensayo» block: two rows, waveform on the `EG 1` row with the accent span between 12 s and 42 s of 0 duration → drawn as a flat band (no duration until it plays). Then open a real song page — with no mixes ingested yet the section must be absent and the page unchanged. Attach both screenshots to the PR.

- [ ] **Step 6: Commit**

```bash
git add "app/(client)/posts/[slug]/page.tsx" app/components/SongSheet.tsx "app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx"
git commit -m "feat(song): host RehearsalPlayer on the song page, the sheet and the gallery fixture

The page reads the viewer's instruments only when the song has mixes. A
song without mixes paints no section — partial coverage is the normal
state (spec §8.3)."
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/DATA_MODEL.md` (the `post` section), `docs/API_REFERENCE.md` (routes list), `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` («Reusable utils»), `docs/superpowers/specs/2026-09-20-rehearsal-mixes-design.md` (status line, §6 read-discipline wording)

- [ ] **Step 1: DATA_MODEL — the field**

Under `post`, after `audioTracks`:

```markdown
- `rehearsalMixes[]` — rehearsal mixes written ONLY by `scripts/ingest-rehearsal-mixes.mjs`
  (`docs/REHEARSAL_MIXES.md`): `{ _key, kind: "full"|"up", track?, family?, tone, bpm?, audioFile,
  peaks?: uint8[600], active?: [[s,e]…], sourceHash }`. `_key = sha1(set.sha1 + file name)`.
  Separate from `audioTracks` on purpose (spec 2026-09-20 §6). `peaks` is projected only by the
  two single-song reads — `postPeaksProjection.test.ts` guards it.
```

- [ ] **Step 2: API_REFERENCE — the route**

```markdown
### `GET /api/audio/[songId]/[key]`
Worship members only (`requireMinistryMember("worship")`, same as `/api/song/[id]`). Answers
`302` to the mix's `cdn.sanity.io` URL with `Cache-Control: private, no-store`; `?download=1`
appends Sanity's `?dl=<original filename>`. `403` without membership, `404` for an unknown key or
a non-CDN asset URL. Bytes never pass through Vercel — this is a discovery gate, not file
protection (spec 2026-09-20 decision D2).
```

- [ ] **Step 3: UTILITIES_AND_COMPONENTS + CLAUDE.md**

Add to `docs/UTILITIES_AND_COMPONENTS.md` a «Rehearsal» entry describing `rehearsalMixes.ts`, `Waveform`, `RehearsalPlayer` (props, the one-`<audio>` rule, URLs through `/api/audio`). Add to `CLAUDE.md`'s «Reusable utils» list, after `TutorialPoster`:

```markdown
`RehearsalPlayer`/`Waveform` (`app/components/song/` — the ONLY rehearsal-mix player; one `<audio>`
through `PlayerContext`, URLs are always `/api/audio/[song]/[key]`, never `cdn.sanity.io`; the
canvas paints with `themeColour`), `rehearsalMixes.ts` (`app/utils/` — neutral `groupMixes`/
`preselectMix`/`waveformBars`; `SEAT_TO_FAMILY` pins app seats to abletonnl families),
```

- [ ] **Step 4: Spec status**

In the spec's header line replace `spec awaiting Frank's review` with `implemented on branch <branch> (this plan)`, and in §6 «Read discipline» change «projected **only** by the single-song read (`/api/song/[id]`)» to «projected **only** by the two single-song reads (`/api/song/[id]` and `posts/[slug]/page.tsx`)».

- [ ] **Step 5: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: green, 0 eslint errors.

```bash
git add docs/DATA_MODEL.md docs/API_REFERENCE.md docs/UTILITIES_AND_COMPONENTS.md CLAUDE.md docs/superpowers/specs/2026-09-20-rehearsal-mixes-design.md
git commit -m "docs: rehearsal mixes — model, route, components, runbook pointers"
```

---

## After the last task

Close with the repo's release order (CLAUDE.md): gates green → **fresh code review of the merge range** (`main..HEAD`) → fix → re-verify → merge the feature branch into `preview`, push, verify the dev alias by `alias` + `githubCommitSha` → PR to `main`, wait for `gates` → merge. The first real ingest (`--apply`) is a separate, consented step after the release, recorded in `docs/REHEARSAL_MIXES.md` «Verified runs».
