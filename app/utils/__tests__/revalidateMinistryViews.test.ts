// A ministry's meetings changed → every page that shows them (ADR-0081 W7). The pages are dynamic
// today, so nothing goes stale if one is missing; the list is pinned so a page added later (the
// Calendario, 2026-11-17) is named here the day it exists, not the day it becomes static.
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { revalidateMinistryViews } from "../revalidate";

beforeEach(() => revalidatePath.mockReset());

describe("revalidateMinistryViews", () => {
  it("names the ministry's Inicio, its planner, its Calendario and worship's Calendario", () => {
    revalidateMinistryViews("jovenes");
    expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/jovenes", "/jovenes/admin", "/jovenes/calendario", "/schedule"]);
  });
});
