/**
 * The «Verificador» teamMembers document (spec §3.1). Pure so the exact shape is
 * unit-tested; scripts/dev-verify-seed.mjs is the only writer.
 *
 * `retiredFrom` is the load-bearing field: it is hidden in Studio, so this script
 * is the only way to set it, and it is what keeps the member out of every pool.
 */
export const VERIFIER_ID = "member-dev-verify";

export interface VerifierDoc {
  _id: string;
  _type: "teamMembers";
  member_name: string;
  alias: string;
  slug: { _type: "slug"; current: string };
  email: string;
  role: "admin";
  ministries: string[];
  managesMinistries: string[];
  retiredFrom: string[];
  notifPrefs: Record<string, boolean | string>;
  passwordHash: string;
}

export function buildVerifierDoc(input: { email: string; passwordHash: string }): VerifierDoc {
  return {
    _id: VERIFIER_ID,
    _type: "teamMembers",
    member_name: "Verificador (bot)",
    alias: "Verificador",
    slug: { _type: "slug", current: "verificador-bot" },
    email: input.email,
    role: "admin",
    // Worship member, retired from it: every worship selection point honours
    // retiredFrom. NOT a kids member — kids reads are resolution-only and never
    // filter on retiredFrom (retirementGatingCoverage.test.ts pins that), so kids
    // membership would make the bot a seatable pair member. Kids MANAGEMENT alone
    // is enough for /kids/admin (requireMinistryManager needs no membership).
    ministries: ["worship"],
    managesMinistries: ["kids"],
    retiredFrom: ["worship"],
    notifPrefs: {
      assignments: false,
      email: false,
      emailAssigned: false,
      emailRemoved: false,
      emailRoleChanged: false,
      emailSetlist: false,
      emailProposals: false,
      setlist: "off",
      proposals: false,
      reminders: false,
    },
    passwordHash: input.passwordHash,
  };
}
