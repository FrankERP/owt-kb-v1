// R1 (spec §12.2, decision H): /tag* and /author* fold into /biblioteca as
// permanent (308) redirects — bookmarks and the old nav keep working, no data
// change. `next.config.mjs` runs `assertDeploymentCoherence(process.env)` at
// import time (A3 §3), but that guard is a no-op without
// `VERCEL_GIT_COMMIT_REF` (an ordinary local/test run never sets it), so the
// config can be imported directly here.
import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config.mjs";

describe("next.config.mjs redirects", () => {
  it("folds /tag* and /author* into /biblioteca, permanently", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual([
      { source: "/tag", destination: "/biblioteca", permanent: true },
      { source: "/tag/:slug", destination: "/biblioteca?tag=:slug", permanent: true },
      { source: "/author", destination: "/biblioteca", permanent: true },
      { source: "/author/:slug", destination: "/biblioteca?author=:slug", permanent: true },
    ]);
  });
});
