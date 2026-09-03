/**
 * The «Verificador» teamMembers document (spec §3.1). Pure so the exact shape is
 * unit-tested; scripts/dev-verify-seed.mjs is the only writer.
 *
 * An EMPTY `memberType` is the load-bearing field: the pools and every seat are
 * built from it (`memberType?.includes(...)`), so a member with no Tipo matches
 * nothing and can be selected neither by an admin nor by the solver. It replaces
 * the `retiredFrom` this document used to carry, which was removed with the
 * retirement mechanism it belonged to.
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
  memberType: string[];
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
    // A worship member with no Tipo: it can sign in and read every worship
    // surface, and it is in no pool and eligible for no seat. NOT a kids member —
    // kids rotation seats from the pair register rather than from Tipo, so kids
    // membership would make the bot a seatable pair member. Kids MANAGEMENT alone
    // is enough for /kids/admin (requireMinistryManager needs no membership).
    ministries: ["worship"],
    managesMinistries: ["kids"],
    memberType: [],
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
