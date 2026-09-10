/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceReadinessCard, { type CardGates } from "../ServiceReadinessCard";
import { deriveServiceReadiness } from "../serviceReadiness";
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

function renderCard(gates: CardGates) {
  return render(
    <ServiceReadinessCard
      card={buildCard()}
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
