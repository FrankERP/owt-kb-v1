/** @vitest-environment jsdom */
// «Calendario» in /me/ajustes after design pass D (2026-10-22): one «Todos / Solo
// los míos» switch drives ONE row of Google / iPhone-Mac / Copiar, the how-it-works
// text folds behind «¿Cómo funciona?», and the one-shot `.ics` is a link to
// «Tu cuenta» on /me, because this page reads no assignments.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { CalendarFeedState } from "@/app/utils/calendarFeed";

installMotionTestEnv();

import CalendarFeedPanel, { feedLinks } from "../CalendarFeedPanel";

beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});
afterEach(cleanup);

const urls = {
  all: "https://owt.test/api/calendar/t",
  mine: "https://owt.test/api/calendar/t?solo=mios",
  webcalAll: "webcal://owt.test/api/calendar/t",
  webcalMine: "webcal://owt.test/api/calendar/t?solo=mios",
  googleAll: "https://calendar.google.com/calendar/r?cid=all",
  googleMine: "https://calendar.google.com/calendar/r?cid=mine",
};

function mount(initial: CalendarFeedState = { kind: "ready", urls }) {
  return render(
    <MotionProvider>
      <ToastProvider>
        <CueDialogProvider>
          <CalendarFeedPanel initial={initial} />
        </CueDialogProvider>
      </ToastProvider>
    </MotionProvider>,
  );
}

const href = (name: RegExp | string) => (screen.getByRole("link", { name }) as HTMLAnchorElement).getAttribute("href");

describe("CalendarFeedPanel", () => {
  it("leads with «Todos» and ONE row of links for that scope", () => {
    mount();
    expect(screen.getByRole("radio", { name: "Todos" }).getAttribute("aria-checked")).toBe("true");
    expect(href("Google Calendar")).toBe(urls.googleAll);
    expect(href("iPhone / Mac")).toBe(urls.webcalAll);
    // One row, not two: the old panel repeated the three buttons per scope.
    expect(screen.getAllByRole("link", { name: "Google Calendar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Copiar enlace/ })).toHaveLength(1);
  });

  it("re-points the whole row at «Solo los míos» from the one switch", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Solo los míos" }));
    expect(href("Google Calendar")).toBe(urls.googleMine);
    expect(href("iPhone / Mac")).toBe(urls.webcalMine);
    fireEvent.click(screen.getByRole("button", { name: /Copiar enlace/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(urls.mine));
  });

  it("folds the how-it-works text behind «¿Cómo funciona?»", () => {
    mount();
    const toggle = screen.getByRole("button", { name: /Cómo funciona/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.textContent).toContain("calendar.google.com");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps the dev warning in the open — it says a button will NOT work here", () => {
    mount({ kind: "ready", urls, preview: true });
    expect(screen.getByText(/Estás en dev/)).toBeTruthy();
  });

  it("sends the one-shot download to «Tu cuenta» on /me instead of exporting here", () => {
    mount();
    expect(href(/Descargar una sola vez/)).toBe("/me#tu-cuenta");
  });

  it("renders only the message when the feed is unavailable", () => {
    mount({ kind: "unavailable", message: "Solo para el equipo de alabanza." });
    expect(screen.getByText("Solo para el equipo de alabanza.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("feedLinks", () => {
  it("never mixes the two scopes", () => {
    expect(feedLinks(urls, "all")).toEqual({ google: urls.googleAll, webcal: urls.webcalAll, https: urls.all });
    expect(feedLinks(urls, "mine")).toEqual({ google: urls.googleMine, webcal: urls.webcalMine, https: urls.mine });
  });
});
