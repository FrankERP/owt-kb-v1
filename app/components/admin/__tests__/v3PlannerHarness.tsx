// app/components/admin/__tests__/v3PlannerHarness.tsx
//
// Shared by the MonthGenerator v3 suites — NOT a test file. Renders the CREATE planner under the
// v3 engine prop with a coherent stored read (roles + integrity, the stored editor's own shape), and
// routes `fetch` by URL so each suite scripts only what it is about. Fictitious people only.
import { render } from "@testing-library/react";
import { vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import type { ServiceRole } from "../serviceCardModel";
import type { SolverConfig } from "../plannerModel";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import { MEMBERS } from "./v3Fixtures";

const person = (id: string, key: string) => ({ _id: id, _key: key, member_name: id });

export function storedRole(over: Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_type" | "date">): ServiceRole {
  return { _rev: `rev-${over._id}`, published: false, leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over } as ServiceRole;
}
export const seat = (memberId: string, i = 0) => person(memberId, `${memberId}-k${i}`);

function targetFor(value: ServiceRole): RoleTarget {
  const isSpecial = value._type === "special_role";
  const refs = [...new Set([...value.leads, ...value.bgvs, ...value.chorus].map((x) => x._id))];
  return {
    targetKey: isSpecial ? value._id : `${value._type}:${value.date}`,
    type: value._type, canonicalCount: 1, canonicalIds: [value._id], canonicalState: "single", publicState: "single",
    memberVisibleCount: value.published === false ? 0 : 1, draftIds: [],
    records: [{ id: value._id, rev: value._rev, type: value._type, serviceDate: value.date, published: value.published !== false, assignedRefs: refs, members: [], danglingRefs: [] }],
    expectsLock: !isSpecial,
    lock: isSpecial ? null : { id: `roleTarget.${value._type}.${value.date}`, rev: `lock-${value._id}`, state: "claimed", roleId: value._id, generation: 1 },
    lockIssues: [],
  } as RoleTarget;
}

export function storedSourceOf(roles: ServiceRole[], status: "ready" | "loading" | "error" = "ready") {
  const integrity: RoleDomainSummary = { targets: roles.map(targetFor), recordIssues: [], lockIssues: [] } as RoleDomainSummary;
  return { roles, integrity, rolesStatus: status, integrityStatus: status, rolesGeneration: 1, integrityGeneration: 1, reload: vi.fn(async () => true) };
}

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

/** `fetch` routed by URL: the first route that answers wins; anything unrouted throws (no silent calls). */
export function routeFetch(...routes: Route[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) {
        const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
        return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => JSON.parse(text), text: async () => text };
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

export function renderV3(opts: {
  roles?: ServiceRole[];
  config?: SolverConfig;
  initialMonth?: string;
  storedStatus?: "ready" | "loading" | "error";
  engine?: "v2" | "v3";
  members?: typeof MEMBERS;
  onClose?: () => void;
} = {}) {
  const roles = opts.roles ?? [];
  return render(
    <AdminProviders>
      <MonthGenerator
        engine={opts.engine ?? "v3"}
        // WN-1's engine half, as ServicesPanel passes it (Task 16).
        showCadencePoolWarning={(opts.engine ?? "v3") === "v3"}
        members={opts.members ?? MEMBERS}
        existingRoles={roles}
        allRoles={roles}
        storedSource={storedSourceOf(roles, opts.storedStatus)}
        rules={readyRules(opts.config)}
        initialMonth={opts.initialMonth ?? "2026-11"}
        onClose={opts.onClose ?? vi.fn()}
        onCreated={vi.fn()}
      />
    </AdminProviders>,
  );
}
