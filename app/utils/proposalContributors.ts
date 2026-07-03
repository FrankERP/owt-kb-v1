// app/utils/proposalContributors.ts
//
// The shared setlist proposal tracks every Lead who has saved an edit in a
// `contributors[]` array. This builds the next array for a write: preserve
// existing entries (and their `_key`s), append the current editor exactly once.
// Pure + injectable key fn so it's deterministically testable.

export interface StoredContributor {
  _key: string;
  person?: { _ref?: string };
}

export interface ContributorWrite {
  _type: "contributor";
  _key: string;
  person: { _type: "reference"; _ref: string };
}

export function mergeContributor(
  existing: StoredContributor[] | undefined,
  editorId: string,
  newKey: () => string,
): ContributorWrite[] {
  const out: ContributorWrite[] = (existing ?? [])
    .filter((c) => c.person?._ref)
    .map((c) => ({
      _type: "contributor",
      _key: c._key,
      person: { _type: "reference", _ref: c.person!._ref! },
    }));
  if (!out.some((c) => c.person._ref === editorId)) {
    out.push({ _type: "contributor", _key: newKey(), person: { _type: "reference", _ref: editorId } });
  }
  return out;
}

export interface NamedContributor {
  id: string;
  name: string;
}

// Label for co-contributors OTHER than me, e.g. "con Ana, Beto". Empty string
// when I'm the only contributor (or there are none) — callers hide the hint.
export function describeContributors(
  contributors: NamedContributor[] | undefined,
  myId: string,
): string {
  const others = (contributors ?? [])
    .filter((c) => c.id && c.id !== myId && c.name)
    .map((c) => c.name);
  return others.length ? `con ${others.join(", ")}` : "";
}
