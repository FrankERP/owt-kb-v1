// The publish email's reported audience IS the batch's own derivation (P3 step
// 7, I9). `publishEmailCandidates` must name exactly the ids the REAL
// `sendAssignmentEmailsBatch` then reads members for (`assignmentEmail.ts`,
// the `_id in $ids` fetch), for the same argument — so the report can never
// drift into a second computation of who gets the email. The address,
// allowlist and preference filters come after that fetch, and the report
// states them as conditions instead.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ fetch: vi.fn(), sendEmail: vi.fn() }));

vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) }, writeClient: {} }));
vi.mock("@/app/utils/email", () => ({ sendEmail: (...a: unknown[]) => h.sendEmail(...a) }));
// `reports.ts` reaches the canonical clients through P1's member lookup; unused here.
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: vi.fn() }, rawIntegrityClient: { fetch: vi.fn() } }));

import { sendAssignmentEmailsBatch } from "@/app/utils/assignmentEmail";
import type { RolePublishedDescriptor } from "@/app/utils/serviceMutationSideEffects";
import { publishEmailCandidates } from "../reports";

type Batch = RolePublishedDescriptor["emailBatch"];

/** The `ids` the real batch queried members with, or null when it never queried. */
async function idsTheBatchQueries(batch: Batch): Promise<string[] | null> {
  h.fetch.mockReset();
  h.fetch.mockResolvedValue([]);
  await sendAssignmentEmailsBatch(structuredClone(batch));
  if (h.fetch.mock.calls.length === 0) return null;
  expect(h.fetch).toHaveBeenCalledTimes(1);
  const params = h.fetch.mock.calls[0][1] as { ids: string[] };
  return params.ids;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const CASES: [string, Batch][] = [
  [
    "one service, every seat path",
    [
      {
        type: "sunday_role",
        date: "2026-10-04",
        body: {
          leads: ["mem-ana"],
          bgvs: ["mem-sofia"],
          chorus: ["mem-luis"],
          instruments: [{ instrument: "Bajo", personId: "mem-luis" }],
          foh: [{ role: "Sonido", personId: "mem-pablo" }],
        },
      },
    ],
  ],
  [
    "a member repeated inside one service and across two, plus a blank person id",
    [
      {
        type: "saturday_role",
        date: "2026-10-03",
        body: {
          leads: ["mem-ana", "mem-ana"],
          instruments: [
            { instrument: "Batería", personId: "" },
            { instrument: "Teclado", personId: "mem-sofia" },
          ],
        },
      },
      {
        type: "special_role",
        date: "2026-10-17",
        body: { bgvs: ["mem-sofia"], foh: [{ role: "Luces", personId: "mem-ana" }], leads: ["mem-luis"] },
      },
    ],
  ],
];

describe("publishEmailCandidates equals the ids sendAssignmentEmailsBatch reads members for", () => {
  it.each(CASES)("%s", async (_label, batch) => {
    const queried = await idsTheBatchQueries(batch);
    expect(queried).not.toBeNull();
    expect(publishEmailCandidates(batch)).toEqual(queried);
  });

  it("the empty case: the batch never queries, and the report names nobody", async () => {
    const batch: Batch = [{ type: "sunday_role", date: "2026-10-04", body: {} }];
    expect(await idsTheBatchQueries(batch)).toBeNull();
    expect(publishEmailCandidates(batch)).toEqual([]);
  });
});
