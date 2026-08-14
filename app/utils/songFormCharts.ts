export type ChartDraft = {
  id: string;
  _key?: string;
  key: string;
  content: string;
};

export type StoredChart = {
  _key?: string;
  key?: string;
  content?: string;
};

export type ChartPayload = {
  _key?: string;
  key: string;
  content: string;
};

function defaultLocalId(): string {
  return `local-${Math.random().toString(36).slice(2, 9)}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function chartsFromSong(
  chords: StoredChart[] | undefined,
  nextLocalId: () => string = defaultLocalId,
): ChartDraft[] {
  if (!chords?.length) return [];
  return chords.map((chart) => {
    const key = asText(chart.key);
    const content = asText(chart.content);
    const storedKey = asText(chart._key);
    const _key = storedKey || undefined;
    return {
      id: _key ?? nextLocalId(),
      ...(_key ? { _key } : {}),
      key,
      content,
    };
  });
}

export function chartsToPayload(charts: ChartDraft[]): ChartPayload[] {
  return charts
    .filter((chart) => chart.content.trim() !== "")
    .map((chart) => {
      const row: ChartPayload = { key: chart.key, content: chart.content };
      if (chart._key) row._key = chart._key;
      return row;
    });
}

export function addChart(
  charts: ChartDraft[],
  defaultKey = "",
  nextLocalId: () => string = defaultLocalId,
): ChartDraft[] {
  const id = nextLocalId();
  return [...charts, { id, key: defaultKey, content: "" }];
}

export function removeChart(charts: ChartDraft[], id: string): ChartDraft[] {
  return charts.filter((chart) => chart.id !== id);
}

export function moveChart(charts: ChartDraft[], id: string, dir: -1 | 1): ChartDraft[] {
  const index = charts.findIndex((chart) => chart.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= charts.length) return charts;
  const copy = charts.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

export function updateChart(
  charts: ChartDraft[],
  id: string,
  patch: Partial<Pick<ChartDraft, "key" | "content">>,
): ChartDraft[] {
  return charts.map((chart) => (chart.id === id ? { ...chart, ...patch } : chart));
}
