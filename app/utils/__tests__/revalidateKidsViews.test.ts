import { describe, expect, it, vi } from "vitest";

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { revalidateKidsViews } from "../revalidate";

describe("revalidateKidsViews", () => {
  it("also refreshes the Calendario, which shows Kids Sundays to a member of both ministries", () => {
    revalidateKidsViews();
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/kids", "/kids/admin", "/me", "/schedule"]);
  });
});
