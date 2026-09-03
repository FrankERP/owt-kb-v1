// In-flight protection on the Servicios mutation surface.
//
// WHY THIS EXISTS
// ---------------
// Every mutating control here is protected from a double submission by its
// BUTTON — `disabled={submitting}` on the delete modal, `disabled={loading}` in
// the publication footer. «Pegar aquí» is the exception: it is rendered by
// `ServiceReadinessCard` and gated on capability alone
// (`disabled={!gates.copyInstruments.enabled}`), so nothing stopped a second
// click. On a slow network an admin clicked, confirmed, saw nothing change, and
// clicked again — and the second POST carried the now-stale target `_rev`, so
// the server answered 409 and the panel reported "Alguien más cambió este
// servicio. Recarga e intenta de nuevo." immediately after that admin's OWN
// successful copy. A false conflict alarm is worse than silence: it teaches the
// admin to distrust a control that worked.
//
// The handler therefore has to guard itself. That is the asymmetry this file
// pins, so a future reader does not "tidy" the early return away on the grounds
// that every other handler manages without one.
//
// WHAT THIS DOES NOT CLAIM. It is a source scan, not a render. It proves the
// early return exists and precedes the fetch; it does not prove the flag is
// reset, nor that the server behaves. It catches removal of a guard whose
// absence is invisible until a slow network exposes it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, "..", "ServicesPanel.tsx"), "utf8");
const CARD = readFileSync(path.join(HERE, "..", "ServiceReadinessCard.tsx"), "utf8");

/** The body of a named handler, up to the next declaration at the same depth. */
function handlerBody(name: string): string {
  const start = SOURCE.search(new RegExp(`(async function|const) ${name}\\b`));
  if (start === -1) throw new Error(`no handler named ${name} in ServicesPanel.tsx`);
  const next = SOURCE.slice(start + 1).search(/\n {2}(async function|function|const) \w+/);
  return next === -1 ? SOURCE.slice(start) : SOURCE.slice(start, start + 1 + next);
}

describe("copyInstrumentsTo guards itself, because its button does not", () => {
  it("returns early on the in-flight flag, before it can send", () => {
    const body = handlerBody("copyInstrumentsTo");
    expect(body).toMatch(/if \(submitting\) return;/);
    expect(body.indexOf("if (submitting) return;")).toBeLessThan(body.indexOf("fetch("));
  });

  it("and the button really is gated on capability alone — the reason the guard is needed", () => {
    // If this ever gains `disabled={submitting}`, the handler's early return
    // becomes belt-and-braces rather than the only protection, and the comment
    // above should be revisited rather than left saying something false.
    expect(CARD).toContain("disabled={!gates.copyInstruments.enabled}");
  });
});

// A dialog dismissed mid-request unmounts the surface that reports the failure
// AND the one offering «Verificar resultado» after a lost response — so a failed
// publish reported nothing at all, and the unknown-outcome contract this panel
// documents at length was silently dropped, because the next open clears
// `pendingOutcome`. Disabling Cancelar is not enough on its own: CueDialog
// routes Escape and a backdrop click to the same `onDismiss`.
describe("a mutating dialog cannot be abandoned mid-flight", () => {
  it("the Modal wrapper refuses to dismiss while busy", () => {
    expect(SOURCE).toMatch(/onDismiss=\{\(\) => \{ if \(!busy\) onClose\(\); \}\}/);
  });

  it("all four mutating dialogs pass busy={submitting}", () => {
    // delete, publish-ready, override, unpublish. The setlist editor modal is
    // deliberately absent: it owns its own save and its own guard.
    expect((SOURCE.match(/busy=\{submitting\}/g) ?? []).length).toBe(4);
  });

  it("the publication footer's Cancelar is disabled while loading", () => {
    const footer = SOURCE.slice(SOURCE.indexOf("function PublicationFooter("));
    const cancel = footer.slice(0, footer.indexOf("Cancelar"));
    expect(cancel).toContain("disabled={loading}");
  });

  it("the delete modal's Cancelar is disabled while submitting", () => {
    const modal = SOURCE.slice(SOURCE.indexOf('title="Eliminar servicio"'));
    const cancel = modal.slice(0, modal.indexOf("Cancelar"));
    expect(cancel).toContain("disabled={submitting}");
  });
});
