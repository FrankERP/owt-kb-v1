// Test-only routing of the people writer's EXTRA reads (`app/utils/memberCommit.ts`) — NOT a test
// file (no `.test.` in the name). The member route tests mock `serverClient.fetch` to answer the
// person read; since slice M (D5, D6, D12) the writer also reads who else has an email, every
// person's names, the solver rules document and whether a Studio draft exists. This answers those
// with "nobody / no rules / no draft" unless a test passes its own, and hands every other query (the
// person read) to the test's own mock, so the routes' existing assertions keep their meaning.

export interface MemberCommitReadFakes {
  roster?: unknown[];
  emailOwners?: unknown[];
  rules?: unknown;
}

export function routeMemberCommitRead(
  query: string,
  params: Record<string, unknown> | undefined,
  person: (q: string, p: Record<string, unknown> | undefined) => unknown,
  fakes: MemberCommitReadFakes = {},
): unknown {
  if (query.includes("lower(email) in $emails")) return Promise.resolve(fakes.emailOwners ?? []);
  if (query.includes('!(_id in path("drafts.**"))')) return Promise.resolve(fakes.roster ?? []);
  if (params?.id === "solverConfig") {
    if (query.includes("._rev")) return Promise.resolve((fakes.rules as { _rev?: string } | undefined)?._rev ?? null);
    return Promise.resolve(fakes.rules ?? null);
  }
  if (query.startsWith("count(")) return Promise.resolve(0);
  return person(query, params);
}
