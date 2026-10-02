// app/components/admin/__tests__/pinSolveHarness.ts
//
// Solve stubs for the «Solo llenar vacíos» suites — NOT a test file. `stubSolve` records every
// solve body and answers it with `respond`; the fairness-history read is answered ahead of it
// (`stubFetchWithHistory`), so the per-browser suite can use it too (it never reads history).
import { vi } from "vitest";

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { stubFetchWithHistory } from "./derivedHistoryHarness";

type Schedule = NonNullable<SolveResponse["schedule"]>;
export type Respond = (body: SolveRequest, call: number) => SolveResponse & { status?: number };

/** Every week of the request, every seat empty; week `weeks + 1` (the trailing Saturday) has no Sunday. */
export function emptySchedule(body: SolveRequest): Schedule {
  const out: Schedule = {};
  for (let w = 1; w <= body.weeks; w++) {
    out[String(w)] = {
      Sunday: { Lead: [], BGV: [], Choir: [] },
      ...(body.weekends_with_saturday.includes(w) ? { Saturday: { Lead: [], BGV: [] } } : {}),
    };
  }
  if (body.weekends_with_saturday.includes(body.weeks + 1)) {
    out[String(body.weeks + 1)] = { Saturday: { Lead: [], BGV: [] } };
  }
  return out;
}

/** A pin-aware solver that seats exactly the pins and nothing else. */
export function echoPins(body: SolveRequest): SolveResponse {
  const schedule = emptySchedule(body);
  for (const p of body.pinned ?? []) {
    const week = schedule[String(p.week)];
    const service = (p.role.startsWith("Sun") ? week.Sunday : week.Saturday) as Record<string, string[]>;
    service[p.role.slice(4)].push(p.person);
  }
  return {
    ok: true, schedule, pinned_honored: (body.pinned ?? []).length,
    pin_violations: [], violation_ceiling_proven: body.pinned ? true : undefined, unfilled_seats: [],
  };
}

export function stubSolve(respond: Respond) {
  const bodies: SolveRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url === "/api/admin/solve") {
      const body = JSON.parse(init?.body ?? "{}") as SolveRequest;
      bodies.push(body);
      const { status = 200, ...payload } = respond(body, bodies.length);
      return { ok: status >= 200 && status < 300, status, json: async () => payload };
    }
    if (url === "/api/admin/roles") return { ok: true, status: 200, json: async () => ({}) };
    throw new Error(`unexpected fetch to ${url}`);
  });
  stubFetchWithHistory(fetchMock);
  return { fetchMock, bodies };
}
