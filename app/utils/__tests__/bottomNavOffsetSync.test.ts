import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// The bar publishes its MEASURED height as --bottom-nav-h on <html>; every
// fixed-bottom element offsets by it. Nothing but this test connects the halves.
describe("bottom nav offset sync", () => {
  const nav = read("app/components/BottomNav.tsx");
  const varName = /export const NAV_H_VAR = "([^"]+)"/.exec(nav)?.[1];
  const className = /export const NAV_CLASS = "([^"]+)"/.exec(nav)?.[1];

  it("names the variable and class the CSS expects", () => {
    expect(varName).toBe("--bottom-nav-h");
    expect(className).toBe("has-bottom-nav");
  });

  it("publishes with a px unit and clears on unmount", () => {
    expect(nav).toMatch(/setProperty\(NAV_H_VAR, `\$\{[^}]+\}px`\)/);
    expect(nav).toMatch(/removeProperty\(NAV_H_VAR\)/);
    expect(nav).toMatch(/classList\.add\(NAV_CLASS\)/);
    expect(nav).toMatch(/classList\.remove\(NAV_CLASS\)/);
  });

  it("brand.css declares the variable with a unit and pads the page under the class", () => {
    const css = read("app/brand.css");
    expect(css).toMatch(/--bottom-nav-h:\s*0px;/);
    expect(css).toMatch(/html\.has-bottom-nav \[data-route-main\]\s*\{[^}]*padding-bottom:\s*var\(--bottom-nav-h\)/);
  });

  it.each([
    ["app/components/ui/Toast.tsx"],
    ["app/components/AudioPlayer.tsx"],
    ["app/components/EditSongButton.tsx"],
    ["app/components/assistant/AssistantBubble.tsx"],
    // «Editar mes»'s sticky save bar (Cerrar · N con cambios · Guardar).
    ["app/components/admin/MonthGenerator.tsx"],
  ])("%s offsets its fixed bottom by the variable", (rel) => {
    // `,0px` without the space too: a Tailwind arbitrary value cannot hold one.
    expect(read(rel)).toMatch(/var\(--bottom-nav-h(, ?0px)?\)/);
  });

  // The assistant bubble sits above the audio transport too, and the song FAB steps aside for it.
  // Each half publishes a variable and clears it; nothing else connects them.
  it("the audio transport publishes its measured height and clears it", () => {
    const audio = read("app/components/AudioPlayer.tsx");
    expect(/export const AUDIO_H_VAR = "([^"]+)"/.exec(audio)?.[1]).toBe("--audio-player-h");
    expect(audio).toMatch(/setProperty\(AUDIO_H_VAR, `\$\{[^}]+\}px`\)/);
    expect(audio).toMatch(/removeProperty\(AUDIO_H_VAR\)/);
  });

  it("the bubble clears the transport and publishes the footprint the song FAB steps aside by", () => {
    const bubble = read("app/components/assistant/AssistantBubble.tsx");
    expect(bubble).toMatch(/var\(--audio-player-h, ?0px\)/);
    expect(/export const ASSISTANT_FAB_VAR = "([^"]+)"/.exec(bubble)?.[1]).toBe("--assistant-fab-w");
    expect(bubble).toMatch(/setProperty\(ASSISTANT_FAB_VAR,/);
    expect(bubble).toMatch(/removeProperty\(ASSISTANT_FAB_VAR\)/);
    expect(read("app/components/EditSongButton.tsx")).toMatch(/right: "calc\(1\.5rem \+ var\(--assistant-fab-w, 0px\)\)"/);
  });

  it("the client layout mounts the bubble inside Provider", () => {
    const layout = read("app/(client)/layout.tsx");
    expect(layout.indexOf("<Provider>")).toBeLessThan(layout.indexOf("<AssistantBubble />"));
    expect(layout.indexOf("<AssistantBubble />")).toBeLessThan(layout.indexOf("</Provider>"));
  });

  it("the client layout mounts BottomNav inside Provider", () => {
    const layout = read("app/(client)/layout.tsx");
    expect(layout).toMatch(/<BottomNav \/>/);
    expect(layout.indexOf("<Provider>")).toBeLessThan(layout.indexOf("<BottomNav />"));
  });
});
