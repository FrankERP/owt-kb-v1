/** @vitest-environment jsdom */
// The quick-actions sheet (spec §12.8, decision L): what a long press opens.
// A `CueDialog mode="sheet"` whose body is one house Button per action.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "../CueDialogProvider";
import { MotionProvider } from "../MotionProvider";
import { installMotionTestEnv } from "./motionTestSetup";
import QuickActions from "../QuickActions";

installMotionTestEnv();

beforeAll(async () => {
  await import("../motionFeatures");
});

afterEach(cleanup);

function mount(props: Partial<React.ComponentProps<typeof QuickActions>> = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <MotionProvider>
      <CueDialogProvider>
        <QuickActions
          open
          onClose={onClose}
          title="Canción s1"
          subtitle="Oasis"
          actions={[{ label: "Abrir", onSelect }]}
          {...props}
        />
      </CueDialogProvider>
    </MotionProvider>,
  );
  return { ...utils, onClose, onSelect };
}

describe("QuickActions", () => {
  it("renders a title, a subtitle and one button per action inside a dialog", () => {
    mount();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Canción s1");
    expect(dialog.textContent).toContain("Oasis");
    expect(screen.getByRole("button", { name: "Abrir" }).tagName).toBe("BUTTON");
  });

  it("runs onSelect and then closes", () => {
    const { onSelect, onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("«Cancelar» closes and runs nothing", () => {
    const { onSelect, onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an href action is a link, and it closes the sheet behind it", () => {
    const { onClose } = mount({ actions: [{ label: "Ver", href: "/schedule" }] });
    const link = screen.getByRole("link", { name: "Ver" });
    expect(link.getAttribute("href")).toBe("/schedule");
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    mount({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir" })).toBeNull();
  });
});
