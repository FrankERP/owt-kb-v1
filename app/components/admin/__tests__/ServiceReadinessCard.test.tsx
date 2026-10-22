/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceReadinessCard, { type CardGates } from "../ServiceReadinessCard";
import { deriveServiceReadiness } from "../serviceReadiness";
import { buildSetlistRead } from "@/app/utils/setlistReadContract";
import type { ServiceCardModel, ServiceRole } from "../serviceCardModel";
import type { ServiceSourceStates } from "../serviceReadiness";

afterEach(cleanup);

const SOURCES: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

const ROLE: ServiceRole = {
  _id: "role-1",
  _rev: "rev-1",
  _type: "sunday_role",
  date: "2026-09-13",
  published: false,
  leads: [],
  bgvs: [],
  chorus: [],
  instruments: [],
  foh: [],
  songs: [],
};

function buildCard(): ServiceCardModel {
  const readiness = deriveServiceReadiness({
    sources: SOURCES,
    published: false,
    recordValid: true,
    roleTarget: "single",
    team: { assignedRefs: [], danglingRefs: [] },
    setlistResponse: null,
    proposal: null,
    serviceDate: "2026-09-13",
    members: [],
    integrityIssues: [],
  });
  return {
    role: ROLE,
    cardId: "role-1",
    day: "2026-09-13",
    isPast: false,
    readiness,
    observation: {
      recordValid: true,
      roleTarget: "single",
      roleTargetIds: [],
      roleTargetKey: null,
      setlistTargetKey: null,
      team: { assignedRefs: [], danglingRefs: [] },
      setlistResponse: null,
      proposal: null,
    },
    integrityEntries: [],
  };
}

const ENABLED = { enabled: true, reason: null };

function buildGates(overrides: Partial<CardGates> = {}): CardGates {
  return {
    editTeam: ENABLED,
    editSetlist: ENABLED,
    copyInstruments: ENABLED,
    deleteService: ENABLED,
    publish: ENABLED,
    unpublish: ENABLED,
    swap: ENABLED,
    proposalHandoff: ENABLED,
    ...overrides,
  };
}

function renderCard(gates: CardGates, card: ServiceCardModel = buildCard()) {
  return render(
    <ServiceReadinessCard
      card={card}
      sources={SOURCES}
      todayIso="2026-09-08"
      gates={gates}
      onPrimaryAction={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onSetlist={vi.fn()}
      onPublish={vi.fn()}
      onUnpublish={vi.fn()}
      swapMode={false}
      swapSource={null}
      onCardSwapSelect={vi.fn()}
      onMemberChipClick={vi.fn()}
      copyMode={false}
      isCopySource={false}
      onCopyStart={vi.fn()}
      onCopyPick={vi.fn()}
    />,
  );
}

describe("ServiceReadinessCard — kebab gate reasons", () => {
  it("shows a blocked Publicar item's reason visibly, not screen-reader-only", () => {
    const reason = "Faltan datos de disponibilidad.";
    renderCard(buildGates({ publish: { enabled: false, reason } }));

    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));

    const item = screen.getByRole("menuitem", { name: /Publicar/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");

    // Visible to sighted users — not `sr-only` — so a keyboard user who can
    // never reach this disabled item still sees why on the trigger itself.
    const line = screen.getByText(reason);
    expect(line.className).not.toContain("sr-only");
    expect(line.className).toContain("text-warning-fg");
  });
});

// ── The compact card (2026-10-22) ────────────────────────────────────────────

/** A stored, valid setlist read — so the ladder gets past its data rules. */
const SETLIST_OK = buildSetlistRead(
  [{ id: "sl1", rev: "r1", songs: [{ _key: "k1", play_key: "G", songRef: "song1", song: { _id: "song1", title: "Uno" } }] }],
  [],
  {},
);

function cardWith(over: Partial<ServiceRole>, published = false): ServiceCardModel {
  const base = buildCard();
  const role: ServiceRole = { ...ROLE, ...over, published };
  const readiness = deriveServiceReadiness({
    sources: SOURCES,
    published,
    recordValid: true,
    roleTarget: "single",
    team: { assignedRefs: [...(role.leads ?? []), ...(role.bgvs ?? [])].map((m) => m._id), danglingRefs: [] },
    setlistResponse: SETLIST_OK,
    proposal: { validated: [], conflicts: [], recordIssues: [], draftIds: [] },
    serviceDate: role.date,
    members: [...(role.leads ?? []), ...(role.bgvs ?? [])].map((m) => ({
      _id: m._id,
      member_name: m.member_name,
      memberType: "vocalist",
      ministries: ["worship"],
    })) as never,
    integrityIssues: [],
  });
  return { ...base, role, readiness };
}

describe("ServiceReadinessCard — the compact card", () => {
  it("takes its day colour on a 3px rail and nowhere else (ADR-0059)", () => {
    const { container } = renderCard(buildGates());
    const root = container.firstElementChild as HTMLElement;
    const rail = root.querySelector("[data-card-rail]") as HTMLElement;

    expect(rail.className).toContain("w-[3px]");
    expect(rail.className).toContain("bg-accent");
    // The root is the neutral card surface: no day-coloured border or header ground.
    expect(root.className).toContain("bg-surface-card");
    expect(root.className).toContain("border-ink/[0.08]");
    expect(root.className).not.toMatch(/border-(accent|warning-fg|info-fg)\b/);
    expect(root.querySelector("[data-card-header]")!.className).not.toMatch(/bg-(surface-sunken|warning-surface-deep|info-surface-deep)/);
  });

  it("leads with one line — `Dom 13 sep`, the countdown and the state — and no type chip", () => {
    renderCard(buildGates());
    const h3 = screen.getByRole("heading", { level: 3 });
    // es-ES abbreviates September as «sept».
    expect(h3.textContent).toBe("Dom 13 sept");
    // The long date survives as the heading's tooltip, first letter up only.
    expect(h3.getAttribute("title")).toBe("Domingo, 13 de septiembre de 2026");
    expect(h3.className).not.toContain("capitalize");
    expect(screen.getByText("En 5 días")).toBeTruthy();
    expect(screen.getByText("Borrador")).toBeTruthy();
    expect(screen.queryByText("Domingo")).toBeNull();
  });

  it("keeps the ONE primary action, inside the header row, as a ≥44px house Button", () => {
    const card = buildCard();
    const { container } = renderCard(buildGates(), card);
    const header = container.querySelector("[data-card-header]") as HTMLElement;
    const button = header.querySelector("[data-action-kind]") as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.getAttribute("data-action-kind")).toBe(card.readiness.primaryAction.kind);
    expect(button.className).toContain("min-h-[44px]");
    // Full-width on a phone, its own width from `sm`.
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("sm:w-auto");
    const wrap = button.closest("[data-card-primary-action]") as HTMLElement;
    expect(wrap.className).toContain("basis-full");
    expect(wrap.className).toContain("order-last");
    expect(wrap.className).toContain("sm:basis-auto");
    expect(container.querySelectorAll("[data-action-kind]").length).toBe(1);
  });

  it("hides the icon whose flow the primary action already opens, never the other", () => {
    // A valid setlist and an empty team → rule 12 «Editar equipo», which routes
    // to the service modal, so the «Editar equipo» icon would be the same
    // control twice.
    renderCard(buildGates(), cardWith({}));
    expect(screen.getAllByRole("button", { name: "Editar equipo" }).length).toBe(1);
    expect(screen.getByRole("button", { name: "Editar equipo" }).getAttribute("data-action-route")).toBe("service_modal");
    expect(screen.getByRole("button", { name: "Editar setlist" }).getAttribute("data-action-kind")).toBeNull();
  });

  it("lays the team beside the setlist in the container-queried body", () => {
    const { container } = renderCard(
      buildGates(),
      cardWith({
        leads: [{ _id: "m1", member_name: "Ana" }],
        bgvs: [{ _id: "m2", member_name: "Luis" }],
        instruments: [{ _key: "i1", instrument: "Bajo", person: { _id: "m3", member_name: "Mkz" } }],
        foh: [{ _key: "f1", role: "Audio", person: { _id: "m4", member_name: "Rex" } }],
        songs: [
          { play_key: "D", song: { _id: "song-1", title: "Nadie", author: "Elevation", key: "C", slug: "nadie" } },
          { play_key: "", song: { _id: "song-2", title: "Lavado", author: "Elevation Rhythm", key: "B", slug: "lavado" } },
        ],
      }),
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("brand-service-card");
    const body = container.querySelector(".brand-service-card-body") as HTMLElement;
    expect(body.querySelector("[data-card-team]")).toBeTruthy();
    expect(body.querySelector("[data-card-setlist]")).toBeTruthy();

    // All three vocal columns, an empty one as «—», and one band of neutral chips.
    expect(screen.getByText("Lead")).toBeTruthy();
    expect(screen.getByText("Coro")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    const band = body.querySelector("[data-card-band]") as HTMLElement;
    expect(band.textContent).toContain("Bajo");
    expect(band.textContent).toContain("Audio");
    expect(band.querySelector("[style]")).toBeNull();

    // The setlist: the count in the label, the key at the end of each row, «orig.» only when transposed.
    expect(screen.getByText("Setlist · 2 canciones")).toBeTruthy();
    expect(screen.getByText("orig. C")).toBeTruthy();
    expect(screen.queryByText("orig. B")).toBeNull();
  });

  it("says so when there is no team and no setlist yet", () => {
    renderCard(buildGates());
    expect(screen.getByText("Sin miembros asignados")).toBeTruthy();
    expect(screen.getByText("Sin canciones todavía.")).toBeTruthy();
  });
});
