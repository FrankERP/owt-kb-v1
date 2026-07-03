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
