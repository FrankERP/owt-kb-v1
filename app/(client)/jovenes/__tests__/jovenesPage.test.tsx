// `/jovenes`: its gates (sign-in, membership, the rollout on the SERVER), and that it reads through
// the one reader in member mode (ADR-0081; plan R1, R4, G6).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NavSignal extends Error {
  constructor(readonly target: string) {
    super(`NAV ${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (t: string) => {
    throw new NavSignal(t);
  },
  notFound: () => {
    throw new NavSignal("404");
  },
}));

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireMinistryMember: vi.fn(),
  getMemberAccess: vi.fn(),
  readMinistryEvents: vi.fn(),
}));
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => h.requireActiveSession(),
  requireMinistryMember: (m: string) => h.requireMinistryMember(m),
}));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/app/utils/ministryEventReads", async () => {
  class MinistryEventReadUnavailable extends Error {}
  return {
    MinistryEventReadUnavailable,
    readMinistryEvents: (a: unknown, o: unknown) => h.readMinistryEvents(a, o),
  };
});
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));

import JovenesPage from "../page";
import { MinistryEventReadUnavailable } from "@/app/utils/ministryEventReads";

async function visit(): Promise<string> {
  try {
    return renderToStaticMarkup(await JovenesPage());
  } catch (e) {
    if (e instanceof NavSignal) return `→ ${e.target}`;
    throw e;
  }
}

const session = { user: { role: "super-admin", sanityId: "s1", email: "x@y.z" } };
const SUPER = { active: true, role: "super-admin", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
const PASTOR = { active: true, role: "member", ministries: ["jovenes"], managesMinistries: [], ministryRoles: [{ ministry: "jovenes", level: "member", groups: ["otro-nivel"] }] };
const ADMIN = { ...PASTOR, ministryRoles: [{ ministry: "jovenes", level: "admin", groups: [] }] };

const EVENT = {
  _id: "ministryEvent.a",
  ministry: "jovenes",
  audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] },
  kind: "joint",
  date: "2026-11-14",
  time: "18:00",
  arrival: "17:30",
  title: null,
  notes: "Traer Biblia",
  published: true,
  seats: [
    { _key: "s1", role: "encargado", memberId: "s1", name: "Frank", mine: true },
    { _key: "s2", role: "apoyo", memberId: "gone", name: null, mine: false },
  ],
  program: [{ _key: "g1", label: "Oración", note: "5 min", memberId: "p9", name: "Ana", mine: false }],
  createdById: null,
  createdByName: null,
};

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.requireActiveSession.mockResolvedValue(session);
  h.requireMinistryMember.mockResolvedValue(session);
  h.getMemberAccess.mockResolvedValue(SUPER);
  h.readMinistryEvents.mockResolvedValue([]);
});

describe("/jovenes gates", () => {
  it("no active session goes to sign-in, before any read", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    expect(await visit()).toBe("→ /auth/signin?callbackUrl=/jovenes");
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });

  it("an active non-member goes to /, and membership asked is Jóvenes'", async () => {
    h.requireMinistryMember.mockResolvedValue(null);
    expect(await visit()).toBe("→ /");
    expect(h.requireMinistryMember).toHaveBeenCalledWith("jovenes");
  });

  it("the rollout holds on the server: a pastor and a Jóvenes admin get 404 while the stage is superAdmin", async () => {
    for (const access of [PASTOR, ADMIN]) {
      h.getMemberAccess.mockResolvedValue(access);
      expect(await visit()).toBe("→ 404");
    }
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });
});

describe("/jovenes read", () => {
  it("reads through the one reader in member mode, from CDMX today, as the session's member", async () => {
    await visit();
    const [access, opts] = h.readMinistryEvents.mock.calls[0];
    expect(access).toBe(SUPER);
    const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
    expect(opts).toMatchObject({ me: "s1", ministry: "jovenes", mode: "member", from: today });
    expect(opts.to > opts.from).toBe(true);
  });

  it("renders a meeting: heading, audience, «Te toca», an empty seat, the program and notes", async () => {
    h.readMinistryEvents.mockResolvedValue([EVENT]);
    const html = await visit();
    expect(html).toContain("Junta de grupos");
    expect(html).toContain("Otro Nivel · Emprendedores");
    expect(html).toContain("Te toca — Encargado");
    expect(html).toContain("Sin asignar");
    expect(html).toContain("Oración");
    expect(html).toContain("llegada 17:30");
    expect(html).toContain("Traer Biblia");
  });

  it("says when there is nothing published", async () => {
    expect(await visit()).toContain("Aún no hay reuniones publicadas");
  });

  it("without the read token it says it could not read — never «no meetings»", async () => {
    h.readMinistryEvents.mockRejectedValue(new MinistryEventReadUnavailable());
    const html = await visit();
    expect(html).toContain("No pudimos leer las reuniones");
    expect(html).not.toContain("Aún no hay reuniones");
  });

  it("any other failure is not swallowed", async () => {
    h.readMinistryEvents.mockRejectedValue(new Error("boom"));
    await expect(visit()).rejects.toThrow("boom");
  });
});
