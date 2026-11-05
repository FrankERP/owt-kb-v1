// @vitest-environment node
//
// The month confirm's seat-clash pre-check (ADR-0078) reads seats with the
// server's own `normalizeSeats`, from the planner — a client bundle. That
// function used to live beside `roleCreationReceipt`'s `node:crypto`, and the
// import dragged it into `/admin`'s chunk; no gate ran `next build`, so only a
// bundle of the client entry points catches it. `roleSeats.ts` is the
// client-safe home; this pins that nothing reachable from these entries
// imports a Node built-in.

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const CLIENT_ENTRIES = [
  "app/utils/roleSeats.ts",
  "app/utils/seatClashGuard.ts",
  "app/utils/monthDraftCreate.ts",
  "app/components/admin/v3ConfirmRun.ts",
  "app/components/admin/MonthGenerator.tsx",
];

describe("seat-clash pre-check stays client-safe", () => {
  it.each(CLIENT_ENTRIES)("%s bundles for the browser with no Node built-in", async (entry) => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "browser",
      packages: "external",
      logLevel: "silent",
      metafile: true,
      jsx: "automatic",
      loader: { ".css": "empty" },
    });
    const nodeImports = Object.entries(result.metafile.inputs).flatMap(([file, input]) =>
      input.imports.filter((i) => i.path.startsWith("node:")).map((i) => `${file} → ${i.path}`),
    );
    expect(nodeImports).toEqual([]);
  }, 30_000);
});
