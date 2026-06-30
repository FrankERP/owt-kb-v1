// app/utils/__tests__/publishTransitions.test.ts
import { describe, it, expect } from "vitest";
import { computePublishTransitions } from "../publishTransitions";

describe("computePublishTransitions", () => {
  it("publishes drafts and notifies only the newly-published", () => {
    const r = computePublishTransitions(
      [{ _id: "a", published: false }, { _id: "b", published: true }, { _id: "c" }],
      true,
    );
    expect(r.toPatch).toEqual(["a"]);   // b already true, c grandfathered-true → skip
    expect(r.toNotify).toEqual(["a"]);
  });

  it("unpublishes published/grandfathered and never notifies", () => {
    const r = computePublishTransitions(
      [{ _id: "a", published: true }, { _id: "b", published: false }, { _id: "c" }],
      false,
    );
    expect(r.toPatch.sort()).toEqual(["a", "c"]); // b already false → skip
    expect(r.toNotify).toEqual([]);
  });
});
