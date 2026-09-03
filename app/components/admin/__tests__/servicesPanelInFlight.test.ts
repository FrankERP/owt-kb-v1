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
const EDITOR = readFileSync(path.join(HERE, "..", "SetlistEditor.tsx"), "utf8");
const HELPERS = readFileSync(path.join(HERE, "..", "serviceMutationErrors.ts"), "utf8");
const DAY_CARD = readFileSync(path.join(HERE, "..", "..", "DayCard.tsx"), "utf8");
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
// The unknown-outcome record — "a publish may have committed and we could not
// confirm it" — used to be cleared by opening OR closing any publish dialog. So
// it evaporated one Escape or one reopen after being recorded, and
// `submitPublication`'s own refusal ("El resultado anterior es desconocido")
// could never fire. Only verification retires it now.
describe("the unknown-outcome record survives a dismissal", () => {
  it("is cleared only where a result is actually established", () => {
    const clears = (SOURCE.match(/setPendingOutcome\(null\)/g) ?? []).length;
    expect(clears).toBe(2); // verifyPendingOutcome: confirmed, and the 409 that supersedes it
    const verify = SOURCE.slice(SOURCE.indexOf("async function verifyPendingOutcome"));
    const body = verify.slice(0, verify.indexOf("\n  function "));
    expect((body.match(/setPendingOutcome\(null\)/g) ?? []).length).toBe(2);
  });

  it("no dialog open- or close-handler discards it", () => {
    for (const opener of ["openPublishPlan", "openOverride", "openUnpublish"]) {
      const start = SOURCE.indexOf(`function ${opener}(`);
      expect(start, opener).toBeGreaterThan(-1);
      const body = SOURCE.slice(start, start + 400);
      expect(body, opener).not.toContain("setPendingOutcome(null)");
    }
    expect(SOURCE).not.toMatch(/onClose=\{\(\) => \{[^}]*setPendingOutcome\(null\)/);
  });
});

describe("a mutating dialog cannot be abandoned mid-flight", () => {
  it("the Modal wrapper refuses to dismiss while busy", () => {
    expect(SOURCE).toMatch(/onDismiss=\{\(\) => \{ if \(!busy\) onClose\(\); \}\}/);
  });

  it("every mutating dialog is guarded, each by the flag that owns its request", () => {
    // Four share the panel's `submitting`; the setlist editor owns its own save,
    // so it reports upward through `onBusyChange` instead. It was excluded from
    // this guard once on the false grounds that it already had one — it did not,
    // and a lead could lose a whole setlist to an Escape mid-save.
    expect((SOURCE.match(/busy=\{submitting\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(SOURCE).toContain("busy={setlistSaving}");
    expect(SOURCE).toContain("onBusyChange={setSetlistSaving}");
    // DayCard hosts the SAME editor for the same audience and had the same
    // hole; it guards its CueDialog directly rather than through Modal.
    expect(DAY_CARD).toContain("onBusyChange={setSetlistSaving}");
    expect(DAY_CARD).toMatch(/onDismiss=\{\(\) => \{ if \(!setlistSaving\)/);
    // Every `<Modal` in this panel carries a busy decision: one `busy={` per
    // `<Modal`. A new dialog added without one breaks the equality rather than
    // slipping in unguarded.
    const modals = (SOURCE.match(/<Modal\b/g) ?? []).length;
    const guarded = (SOURCE.match(/\bbusy=\{/g) ?? []).length;
    expect(modals).toBeGreaterThan(0);
    expect(guarded).toBe(modals);
  });

  it("the publication footer's Cancelar is disabled while loading", () => {
    const footer = SOURCE.slice(SOURCE.indexOf("function PublicationFooter("));
    const cancel = footer.slice(0, footer.indexOf("Cancelar"));
    expect(cancel).toContain("disabled={loading}");
  });

  it("no mutating request behind THESE busy dialogs can hold one open forever", () => {
    // KNOWINGLY OUT OF SCOPE: `MonthGenerator` blocks Escape and both its
    // header and footer exits — labelled «Cerrar», since `storedTransportActive`
    // can only be true in stored mode — and its seven mutating fetches carry no
    // abort at all. That predates this guard and is not covered here — the
    // title says "these" for that reason rather than implying a proof it does
    // not deliver.
    // `busy` blocks Escape, the backdrop AND the header ✕, so without a timeout
    // a request stalled behind a dead connection left a modal that could not be
    // closed at all until the OS gave up. The scan covers the EDITOR too: its
    // PUT is the fifth mutating request behind a busy dialog, and scanning only
    // this panel is how it was missed once already. Reads carry no abort on
    // purpose — they hold nothing open.
    for (const [name, src] of [["ServicesPanel", SOURCE], ["SetlistEditor", EDITOR]] as const) {
      const mutating = (src.match(/method: "(POST|DELETE|PATCH|PUT)"/g) ?? []).length;
      const aborted = (src.match(/signal: (abort\.signal|controller\.signal)/g) ?? []).length;
      expect(mutating, name).toBeGreaterThan(0);
      expect(aborted, name).toBe(mutating);
    }
  });

  it("and every acquired timer is released", () => {
    // Counting `signal:` alone would pass a `finally` that stopped clearing the
    // timer, leaving an abort armed over an already-settled request.
    expect((SOURCE.match(/mutationSignal\(\)/g) ?? []).length)
      .toBe((SOURCE.match(/abort\.done\(\);/g) ?? []).length);
    expect((EDITOR.match(/new AbortController\(\)/g) ?? []).length)
      .toBe((EDITOR.match(/clearTimeout\(timer\);/g) ?? []).length);
  });

  it("uses AbortController, not the Safari-16-only AbortSignal.timeout", () => {
    // The iOS wrap's deployment target is 15.0. `AbortSignal.timeout` throws a
    // TypeError there — INSIDE the try — which `submitPublication` would record
    // as an unknown outcome for a request never sent, and the verification that
    // could retire it throws the same way. Every publish refused until a
    // reload, and again after it.
    expect(SOURCE + EDITOR + HELPERS).not.toContain("AbortSignal.timeout(");
    expect(HELPERS).toContain("new AbortController()");
  });

  it("the delete modal's Cancelar is disabled while submitting", () => {
    const modal = SOURCE.slice(SOURCE.indexOf('title="Eliminar servicio"'));
    const cancel = modal.slice(0, modal.indexOf("Cancelar"));
    expect(cancel).toContain("disabled={submitting}");
  });
});
