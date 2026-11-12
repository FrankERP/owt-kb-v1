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
  readJovenesPeople: vi.fn(),
  rolloutOpen: false,
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
vi.mock("@/app/utils/jovenesPeople", () => ({ readJovenesPeople: () => h.readJovenesPeople() }));
vi.mock("@/app/components/jovenes/ProgramEditor", () => ({
  default: ({ event, people }: { event: { _id: string }; people: unknown[] }) => `[programa ${event._id} · ${people.length}]`,
}));
// The real rollout, unless a row opens it to reach a pastor (the encargado's program button).
vi.mock("@/app/utils/rollout", async (orig) => {
  const real = await orig<typeof import("@/app/utils/rollout")>();
  return { ...real, rolloutAllows: (f: never, a: never) => h.rolloutOpen || real.rolloutAllows(f, a) };
});

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
  for (const f of Object.values(h)) if (typeof f === "function") f.mockReset();
  h.rolloutOpen = false;
  h.readJovenesPeople.mockResolvedValue([{ id: "p9", name: "Ana" }]);
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

  it("before the rollout reaches someone, a non-member gets the same 404 as a member — no redirect hint", async () => {
    h.getMemberAccess.mockResolvedValue({ ...PASTOR, ministries: ["worship"], ministryRoles: [] });
    h.requireMinistryMember.mockResolvedValue(null);
    expect(await visit()).toBe("→ 404");
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

  it("renders a meeting as a card: its name as the title, the date as a leaf, chips per group, «Tú», an empty seat, the program and notes", async () => {
    h.readMinistryEvents.mockResolvedValue([EVENT]);
    const html = await visit();
    // The card's title is the meeting's name, one level under the list's section label.
    expect(html).toMatch(/<h2[^>]*>Próxima reunión/);
    // The date is drawn as a leaf and READ in the heading (capital first, «de» lowercase), so
    // two «Sábado de Jóvenes» are two different headings; the drawn leaf is hidden from AT.
    expect(html).toMatch(/<h3[^>]*>Junta de grupos<span class="sr-only">, Sábado 14 de noviembre<\/span><\/h3>/);
    expect(html).toMatch(/<time dateTime="2026-11-14" aria-hidden="true"/);
    // One chip per group, each with its monogram (the colour is never the only signal).
    expect(html).toMatch(/>ON<\/span>Otro Nivel</);
    expect(html).toMatch(/>EM<\/span>Emprendedores</);
    expect(html).toContain("text-group-otro-nivel");
    expect(html).toContain("text-group-emprendedores");
    // The clock and the arrival, with their icon.
    expect(html).toContain('data-icon="clock"');
    expect(html).toContain(">18:00</span>");
    expect(html).toContain("llegada 17:30");
    // «Tú», as the Calendario says it, never the old accent chip «Te toca — …»: on the card's
    // chip, in the seat's own name, and in the lede.
    expect(html).toContain("Tú · Encargado");
    expect(html).toContain("Tú · Frank");
    expect(html).not.toContain("Te toca");
    // The next meeting opens: its sections sit one level under the card's title.
    expect(html).toMatch(/<h4[^>]*>Equipo<\/h4>/);
    expect(html).toMatch(/<h4[^>]*>Programa<\/h4>/);
    expect(html).toContain("1 reunión por venir");
    expect(html).toContain("te toca el sábado 14 de noviembre");
    expect(html).toContain("Sin asignar");
    expect(html).toContain("Oración");
    expect(html).toContain("5 min");
    expect(html).toContain("Traer Biblia");
    // It is the one lit card.
    expect(html.match(/data-lit=""/g)).toHaveLength(1);
  });

  it("the next meeting is featured and open; the ones after it fold under their month", async () => {
    const later = { ...EVENT, _id: "ministryEvent.b", date: "2026-12-05", audience: { kind: "ministry" }, kind: "saturday" };
    h.readMinistryEvents.mockResolvedValue([EVENT, later]);
    const html = await visit();
    expect(html).toMatch(/<h2[^>]*>Diciembre/);
    expect(html).toMatch(/<h3[^>]*>Sábado de Jóvenes<span class="sr-only">, Sábado 5 de diciembre<\/span><\/h3>/);
    expect(html).toContain("Todo Jóvenes");
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html.match(/data-lit=""/g)).toHaveLength(1);
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

describe("/jovenes program editor and «Planear» (cosmetic; the server decides)", () => {
  const SATURDAY = { ...EVENT, _id: "ministryEvent.sat", audience: { kind: "ministry" }, kind: "saturday" };

  it("an admin gets «Planear» and the program button on every meeting, with the people list", async () => {
    h.readMinistryEvents.mockResolvedValue([EVENT, SATURDAY]);
    const html = await visit();
    expect(html).toContain("Planear");
    expect(html).toContain("[programa ministryEvent.a · 1]");
    expect(html).toContain("[programa ministryEvent.sat · 1]");
    expect(h.readJovenesPeople).toHaveBeenCalledTimes(1);
  });

  it("the encargado of a whole-ministry meeting gets the button there only; a pastor gets no «Planear»", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(PASTOR);
    h.readMinistryEvents.mockResolvedValue([EVENT, SATURDAY]);
    const html = await visit();
    expect(html).toContain("[programa ministryEvent.sat · 1]");
    expect(html).not.toContain("[programa ministryEvent.a");
    expect(html).not.toContain(">Planear<");
  });

  it("«Planear» for a leader of at least one group; none for a `leader` who leads no group", async () => {
    h.rolloutOpen = true;
    const leader = (leaderOf: string[]) => ({
      ...PASTOR,
      ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf }],
    });
    h.readMinistryEvents.mockResolvedValue([EVENT]);
    h.getMemberAccess.mockResolvedValue(leader(["invencibles"]));
    expect(await visit()).toContain(">Planear<");
    h.getMemberAccess.mockResolvedValue(leader([]));
    expect(await visit()).not.toContain(">Planear<");
  });

  it("nobody who may edit nothing costs a people read", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(PASTOR);
    h.readMinistryEvents.mockResolvedValue([{ ...SATURDAY, seats: [{ ...SATURDAY.seats[0], role: "comparte" }] }]);
    const html = await visit();
    expect(html).not.toContain("[programa");
    expect(h.readJovenesPeople).not.toHaveBeenCalled();
  });
});
