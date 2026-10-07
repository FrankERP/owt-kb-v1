/** @vitest-environment jsdom */
// Solver v3 C1 §6 — the one «Cuenta para equidad» control and its v2 note. The
// engine constant ships "v2" here; `fairnessEngineV3.test.tsx` mocks it to "v3".
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MotionProvider } from "../../ui/MotionProvider";
import { installMotionTestEnv } from "../../ui/__tests__/motionTestSetup";
import { FairnessEngineNote, FairnessSwitch } from "../FairnessSwitch";
import {
  FAIRNESS_ENGINE_NOTE,
  FAIRNESS_PAST_REASON,
  FAIRNESS_SPECIAL_HELP,
} from "../fairnessToggleModel";

installMotionTestEnv();
afterEach(cleanup);

function describedText(el: HTMLElement): string | null {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

describe("FairnessSwitch", () => {
  it("is a named house switch that reports the flipped value", () => {
    const onChange = vi.fn();
    render(
      <MotionProvider>
        <FairnessSwitch checked onChange={onChange} past={false} ariaLabel="Cuenta para equidad 2026-11-01" />
      </MotionProvider>,
    );
    const sw = screen.getByRole("switch", { name: "Cuenta para equidad 2026-11-01" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("in a past month is disabled and names the reason as its accessible description", () => {
    const onChange = vi.fn();
    render(
      <MotionProvider>
        <FairnessSwitch checked={false} onChange={onChange} past ariaLabel="Cuenta para equidad" />
      </MotionProvider>,
    );
    const sw = screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(describedText(sw)).toBe(FAIRNESS_PAST_REASON);
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is disabled by its caller without a reason line when the month is not past", () => {
    render(
      <MotionProvider>
        <FairnessSwitch checked onChange={() => {}} disabled past={false} ariaLabel="Cuenta para equidad" />
      </MotionProvider>,
    );
    expect((screen.getByRole("switch", { name: "Cuenta para equidad" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(FAIRNESS_PAST_REASON)).toBeNull();
  });

  it("shows the help line it is given", () => {
    render(
      <MotionProvider>
        <FairnessSwitch checked={false} onChange={() => {}} past={false} ariaLabel="Cuenta para equidad" help={FAIRNESS_SPECIAL_HELP} />
      </MotionProvider>,
    );
    expect(screen.getByText(FAIRNESS_SPECIAL_HELP)).toBeTruthy();
  });
});

describe("FairnessEngineNote", () => {
  it('shows the note while the engine is "v2"', () => {
    render(<FairnessEngineNote />);
    expect(screen.getByText(FAIRNESS_ENGINE_NOTE)).toBeTruthy();
  });
});
