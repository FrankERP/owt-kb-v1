/** @vitest-environment jsdom */
//
// The submit-confirmation modal, rendered for real.
//
// `dialogSemantics.test.ts` scans source and can only prove the file CONTAINS
// dialog semantics and a focus trap. That is the systematic guard. This is the
// local one: it opens the modal the way a member does and checks the behaviour
// they actually get — focus lands inside, Tab cannot escape into the editor
// behind, Escape closes, and focus returns to the button that opened it.
//
// The bug this pins: the modal shipped as a bare styled <div>. Tab walked
// straight out of it into the song list and the "Enviar propuesta" button that
// opened it, so a member could reorder the setlist — or fire submit a second
// time — while still being asked to confirm the first.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import ProposalEditor from "../ProposalEditor";

// jsdom does no layout, so offsetParent is always null and the trap's visibility
// filter would treat every element as hidden. Same shim as useFocusTrap.test.tsx.
let originalOffsetParent: PropertyDescriptor | undefined;
beforeAll(() => {
  originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});
afterAll(() => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});
afterEach(() => cleanup());

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2026-08-16",
  service_type: "sunday" as const,
  service_date: "2026-08-16",
};

const proposal = {
  _id: "proposal-1",
  _rev: "rev-1",
  status: "draft" as const,
  songs: [
    { song_id: "song-1", title: "Sublime gracia", author: "Newton", key: "G", play_key: "G" },
    { song_id: "song-2", title: "Cuán grande es Él", author: "Boberg", key: "D", play_key: "D" },
  ],
};

/** Open the confirmation the way a member does: click "Enviar propuesta". */
function openConfirm() {
  render(<ProposalEditor roleDoc={roleDoc} proposal={proposal} currentUserId="member-1" />);
  const submit = screen.getAllByRole("button", { name: /enviar propuesta/i })[0];
  submit.focus();
  fireEvent.click(submit);
  return submit;
}

describe("submit-confirmation modal", () => {
  it("is a labelled, modal dialog", () => {
    openConfirm();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The name comes from the heading rather than a duplicated aria-label, so a
    // copy change moves both together. Resolve it the way a screen reader does.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toMatch(/enviar propuesta/i);
  });

  it("moves focus into the dialog instead of leaving it on the opener", () => {
    const opener = openConfirm();
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(opener);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog — the editor behind it stays unreachable", () => {
    openConfirm();
    const dialog = screen.getByRole("dialog");
    // Far more presses than the dialog has focusables: if the trap were absent,
    // focus would have walked out into the song list long before this.
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(document, { key: "Tab" });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  // These two assert on the modal's CONTENT ("Confirmar"), not on role="dialog".
  // Querying the role would make them pass vacuously against the old markup — no
  // role means queryByRole returns null and "it closed" reads true for the wrong
  // reason. Checked against a reverted tree: the Escape case fails there (there
  // was no Escape handler); the Cancelar case still passes, because that button
  // always worked — it is here to prove the fix did not break it, not to prove
  // the fix.
  it("closes on Escape and gives focus back to the opener", () => {
    const opener = openConfirm();
    expect(screen.queryByRole("button", { name: /^confirmar$/i })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /^confirmar$/i })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("still closes on Cancelar, and dismissing never submits", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(screen.queryByRole("button", { name: /^confirmar$/i })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
