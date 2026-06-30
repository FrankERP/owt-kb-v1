// app/utils/publishTransitions.ts
export function computePublishTransitions(
  current: { _id: string; published?: boolean }[],
  target: boolean,
): { toPatch: string[]; toNotify: string[] } {
  const isPublished = (p?: boolean) => p !== false; // missing = grandfathered published
  const toPatch: string[] = [];
  const toNotify: string[] = [];
  for (const doc of current) {
    if (isPublished(doc.published) === target) continue; // no-op, skip
    toPatch.push(doc._id);
    if (target && doc.published === false) toNotify.push(doc._id); // draft -> published
  }
  return { toPatch, toNotify };
}
