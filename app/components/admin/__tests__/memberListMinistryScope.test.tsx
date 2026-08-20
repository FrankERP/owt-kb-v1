/** @vitest-environment jsdom */
// The Miembros ministry filter, mounted through the real panel.
//
// `GET /api/admin/members` is deliberately UNFILTERED for `super-admin` — they
// are the only role that can edit `ministries`, so scoping their read would
// leave a Kids-only member permanently uneditable. The cost is that Frank opens
// Miembros to the whole church; this control gives him his ~35 worship members
// back without hiding anyone from the one account that can fix them.
//
// The assertion that matters most is the LEGACY one: `ministries` is absent on
// every member predating Oasis Kids, and absent means worship. Read raw and the
// default view empties itself — which looks exactly like mass deletion.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Sibling tabs are never rendered here (Miembros is the super-admin landing
// tab), but AdminPanel imports them at module scope.
vi.mock("../ServicesPanel", () => ({ default: () => null }));
vi.mock("../ActivityPanel", () => ({ default: () => null }));
vi.mock("../ContentPanel", () => ({ default: () => null }));
vi.mock("../AvailabilityPanel", () => ({ default: () => null }));
vi.mock("../ProposalsPanel", () => ({ default: () => null }));
vi.mock("../IntegrityQueuePanel", () => ({ default: () => null }));

import AdminPanel from "../AdminPanel";

const LEGACY  = { _id: "1", member_name: "Ana Legacy",  email: "ana@x.mx",  role: "member", memberType: ["voz"], hasPassword: true };
const WORSHIP = { _id: "2", member_name: "Beto Worship", email: "beto@x.mx", role: "member", memberType: ["voz"], hasPassword: true, ministries: ["worship"] };
const KIDS    = { _id: "3", member_name: "Cami Kids",   email: "cami@x.mx", role: "member", memberType: ["support"], hasPassword: true, ministries: ["kids"] };
const BOTH    = { _id: "4", member_name: "Dani Ambos",  email: "dani@x.mx", role: "member", memberType: ["voz"], hasPassword: true, ministries: ["worship", "kids"] };

async function mount(members: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => members })));
  const view = render(<AdminPanel role="super-admin" />);
  // The count line renders only once the fetch has settled — waiting on the
  // heading would pass while the list is still empty.
  await waitFor(() => expect(screen.queryByText(/miembros?$/)).not.toBeNull());
  return view;
}

/** Display names currently rendered in the member list. */
function shownNames(members: { member_name: string }[]) {
  return members.filter((m) => screen.queryByText(m.member_name) !== null).map((m) => m.member_name);
}

const scopeButton = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("Miembros — ministry scope", () => {
  it("defaults to Alabanza and hides a kids-only member", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    expect(shownNames([LEGACY, WORSHIP, KIDS, BOTH])).toEqual(["Ana Legacy", "Beto Worship", "Dani Ambos"]);
    expect(scopeButton("Alabanza").getAttribute("aria-pressed")).toBe("true");
  });

  it("KEEPS a legacy member with NO stored ministries in the default view", async () => {
    await mount([LEGACY, KIDS]);
    expect(screen.queryByText("Ana Legacy")).not.toBeNull();
    expect(screen.queryByText("Cami Kids")).toBeNull();
  });

  it("shows only Kids — including a dual-ministry member — under Oasis Kids", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    fireEvent.click(scopeButton("Oasis Kids"));
    expect(shownNames([LEGACY, WORSHIP, KIDS, BOTH])).toEqual(["Cami Kids", "Dani Ambos"]);
  });

  it("shows everyone under Todos", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    fireEvent.click(scopeButton("Todos"));
    expect(shownNames([LEGACY, WORSHIP, KIDS, BOTH]))
      .toEqual(["Ana Legacy", "Beto Worship", "Cami Kids", "Dani Ambos"]);
  });

  it("does not render the control when every member is worship-only", async () => {
    await mount([LEGACY, WORSHIP]);
    expect(screen.queryByRole("button", { name: /^Oasis Kids/ })).toBeNull();
    // NOT /^Todos$/ — the count span lives inside the button, so the accessible
    // name is "Todos 4" and an end-anchored pattern can never match, making the
    // assertion pass no matter what the component does.
    expect(screen.queryByRole("button", { name: /^Todos/ })).toBeNull();
    expect(shownNames([LEGACY, WORSHIP])).toEqual(["Ana Legacy", "Beto Worship"]);
  });

  it("shows everyone when the control is hidden, even if no one is worship", async () => {
    // The `visible &&` guard in resolveMinistryScope. Without it a list holding
    // only kids members would render EMPTY under the "worship" default, with no
    // control on screen to change the scope — hidden members and no way to
    // reveal them. Unreachable with today's data (a super-admin's fetch always
    // contains worship members), which is exactly why it needs a test rather
    // than a reader's confidence.
    await mount([KIDS]);
    expect(screen.queryByRole("button", { name: /^Oasis Kids/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Alabanza/ })).toBeNull();
    expect(shownNames([KIDS])).toEqual(["Cami Kids"]);
  });

  it("counts the filtered set against the whole list beside the heading", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    expect(screen.queryByText("3 de 4 miembros")).not.toBeNull();
    fireEvent.click(scopeButton("Todos"));
    expect(screen.queryByText("4 miembros")).not.toBeNull();
  });

  it("composes with the search box — searching inside Kids searches Kids only", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    fireEvent.click(scopeButton("Oasis Kids"));
    fireEvent.change(screen.getByPlaceholderText("Buscar por nombre, alias o email…"), {
      target: { value: "Beto" },
    });
    expect(screen.queryByText("Beto Worship")).toBeNull();
  });

  it("labels each option with its own count", async () => {
    await mount([LEGACY, WORSHIP, KIDS, BOTH]);
    expect(within(scopeButton("Alabanza")).queryByText("3")).not.toBeNull();
    expect(within(scopeButton("Oasis Kids")).queryByText("2")).not.toBeNull();
    expect(within(scopeButton("Todos")).queryByText("4")).not.toBeNull();
  });
});
