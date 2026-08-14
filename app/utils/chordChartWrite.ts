export type ChordChartWrite = {
  _type: "chord_chart";
  _key: string;
  key: string;
  content: string;
};

export type NormalizeChartsResult =
  | { ok: true; charts: ChordChartWrite[] }
  | { ok: false; error: string };

// Same class as `isSeatItemKey` in roleWriteRequest.ts — copied, not imported,
// so the song writer does not take a dependency on the role writer.
const CHART_ITEM_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function fail(error: string): NormalizeChartsResult {
  return { ok: false, error };
}

export function normalizeChordCharts(
  input: unknown,
  mintKey: () => string,
): NormalizeChartsResult {
  if (!Array.isArray(input)) {
    return fail("chords must be an array");
  }

  const charts: ChordChartWrite[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!item || typeof item !== "object") {
      return fail(`chords[${i}] must be an object`);
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.content !== "string") {
      return fail(`chords[${i}] is missing content`);
    }
    if (raw.content.trim() === "") continue;

    const key = typeof raw.key === "string" ? raw.key : "";
    let _key: string;
    if (raw._key == null || raw._key === "") {
      _key = mintKey();
    } else if (typeof raw._key !== "string" || !CHART_ITEM_KEY_RE.test(raw._key)) {
      return fail(`chords[${i}] has an invalid _key`);
    } else {
      _key = raw._key;
    }

    if (seen.has(_key)) {
      return fail(`chords[${i}] has a duplicate _key`);
    }
    seen.add(_key);

    charts.push({ _type: "chord_chart", _key, key, content: raw.content });
  }

  return { ok: true, charts };
}
