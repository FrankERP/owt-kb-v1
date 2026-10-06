/**
 * `--layout`: a read-only measurement of horizontal overflow, evaluated in the page.
 *
 * Added 2026-10-06 because a `--full-page` capture is NOT evidence of page-level
 * horizontal scroll. Playwright sizes a full-page capture as
 * `max(body.scrollWidth, documentElement.scrollWidth, body/documentElement
 * offsetWidth and clientWidth)`, so a capture can come out wider than the viewport
 * while the page itself cannot pan — and the question ADR-0035 asks («does /admin
 * scroll sideways?») is `scrollingElement.scrollWidth > clientWidth`, which only a
 * measurement answers.
 *
 * A SOURCE STRING, not a function: tsx/esbuild can wrap a function in helpers
 * (`__name`) that do not exist in the page, and `page.evaluate` would then throw
 * there. The string is evaluated as-is. It only READS layout and computed style —
 * no scrolling, no events: a `scrollTo` round trip would queue a `scroll` event,
 * and `Menu` closes on any document scroll, so `--click <menu> --layout
 * --screenshot` would capture the menu already closed. It makes no request.
 *
 * `escapers` are the OUTERMOST elements whose box crosses the viewport's RIGHT edge
 * (left-edge overflow is unreachable by scrolling and never widens the page) with no
 * ancestor that clips between them and `<html>` — a non-visible `overflow-x` (auto,
 * scroll, hidden, clip), or layout/paint containment (`contain`, or
 * `content-visibility: auto`), which turns the overflow inside it into ink overflow.
 * NOT `container-type`: Chromium applies size and style containment for it but no
 * layout containment, so it neither contains overflow nor anchors an out-of-flow
 * box (measured, Chromium 151). An overflow-x-auto box's own wide child is
 * contained and is not listed;
 * the box itself, if IT is wider than the page, is. For an absolute or fixed box only
 * ancestors from its containing block outward count — an overflow box BELOW the
 * containing block does not clip it — and the walk re-anchors at every absolute or
 * fixed ancestor on the way up. A fixed box anchored to the viewport adds no
 * scrollable overflow and is skipped. The list is diagnostic; `pageOverflowsX`,
 * computed by the browser, is the verdict.
 * `pseudoCandidates` are `::before`/`::after` boxes at least as wide as the
 * viewport — the one kind of box `querySelectorAll` cannot see.
 */

export interface LayoutBox {
  path: string;
  position: string;
  left: number;
  right: number;
  width: number;
}

export interface LayoutReport {
  viewport: { innerWidth: number; clientWidth: number };
  scrollingElement: { scrollWidth: number; clientWidth: number };
  html: { scrollWidth: number; offsetWidth: number; clientWidth: number };
  body: { scrollWidth: number; offsetWidth: number; clientWidth: number };
  /** The width a Playwright `fullPage` capture would take. */
  fullPageWidth: number;
  /** `scrollingElement.scrollWidth > clientWidth` — the page can scroll sideways. */
  pageOverflowsX: boolean;
  /** `scrollWidth - clientWidth` of the scrolling element: its horizontal scrollable overflow in px (computed, never scrolled). The user can pan it unless the root sets `overflow-x: hidden`/`clip` — no rule in this app does. */
  maxScrollX: number;
  escapers: LayoutBox[];
  pseudoCandidates: (LayoutBox & { pseudo: string })[];
}

export const LAYOUT_PROBE_SOURCE = String.raw`(() => {
  const html = document.documentElement;
  const body = document.body;
  const se = document.scrollingElement || html;
  const vw = html.clientWidth;
  const sx = window.scrollX;
  const round = (n) => Math.round(n * 10) / 10;
  // Clipping, for this purpose: anything that keeps a descendant's overflow from
  // widening the page — a non-visible overflow-x, or layout/paint containment, which
  // turns the overflow inside it into ink overflow. container-type is deliberately
  // absent: it carries no layout containment (see the header).
  const contained = (cs) =>
    /paint|layout|strict|content/.test(cs.contain || "") ||
    cs.contentVisibility === "auto";
  const clipsX = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== "visible" || contained(cs);
  };
  // What makes an element the containing block of a fixed descendant (and so also of
  // an absolute one, which additionally takes any non-static position).
  const makesCb = (el, position) => {
    const cs = getComputedStyle(el);
    // translate/rotate/scale are separate properties: Chromium leaves the computed
    // transform at "none" when only they are set.
    const fixedCb =
      cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" ||
      (cs.translate || "none") !== "none" || (cs.rotate || "none") !== "none" || (cs.scale || "none") !== "none" ||
      (cs.backdropFilter || "none") !== "none" ||
      /transform|translate|rotate|scale|filter|perspective/.test(cs.willChange || "") ||
      contained(cs);
    return position === "fixed" ? fixedCb : cs.position !== "static" || fixedCb;
  };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 8) : [];
    if (cls.length) s += "." + cls.join(".");
    const data = Array.from(el.attributes).map((a) => a.name).filter((n) => n.startsWith("data-")).slice(0, 4);
    if (data.length) s += "[" + data.join("][") + "]";
    return s;
  };
  const pathOf = (el) => {
    const parts = [];
    for (let a = el; a && a !== html && parts.length < 6; a = a.parentElement) parts.unshift(label(a));
    return parts.join(" > ");
  };
  const box = (el, r) => ({
    path: pathOf(el),
    position: getComputedStyle(el).position,
    left: round(r.left + sx),
    right: round(r.right + sx),
    width: round(r.width),
  });
  const all = Array.from(body.querySelectorAll("*"));
  const found = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right + sx <= vw + 0.5) continue;
    // An overflow ancestor clips an out-of-flow box only from the box's containing
    // block outward: an absolute box whose containing block lies OUTSIDE an
    // overflow-x-auto scroller is not clipped by it, and overflows the page.
    let mode = getComputedStyle(el).position;
    let awaitingCb = mode === "absolute" || mode === "fixed";
    let clipped = false;
    for (let a = el.parentElement; a && a !== html; a = a.parentElement) {
      if (awaitingCb && makesCb(a, mode)) awaitingCb = false;
      if (awaitingCb) continue;
      if (a !== body && clipsX(a)) { clipped = true; break; }
      const pos = getComputedStyle(a).position;
      if (pos === "absolute" || pos === "fixed") { mode = pos; awaitingCb = true; }
    }
    // Still awaiting a fixed box's containing block at <html>: it is anchored to the
    // viewport and adds no scrollable overflow.
    if (awaitingCb && mode === "fixed") continue;
    if (!clipped) found.push(el);
  }
  const foundSet = new Set(found);
  const outermost = found.filter((el) => {
    for (let a = el.parentElement; a && a !== html; a = a.parentElement) if (foundSet.has(a)) return false;
    return true;
  });
  const escapers = outermost
    .map((el) => box(el, el.getBoundingClientRect()))
    .sort((a, b) => b.right - a.right)
    .slice(0, 12);
  const pseudoCandidates = [];
  pseudo: for (const el of all) {
    for (const pseudo of ["::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === "none" || cs.content === "normal") continue;
      const w = parseFloat(cs.width);
      if (!(w >= vw)) continue;
      const r = el.getBoundingClientRect();
      pseudoCandidates.push({ ...box(el, r), pseudo, width: round(w) });
      if (pseudoCandidates.length >= 12) break pseudo;
    }
  }
  const maxScrollX = Math.max(0, se.scrollWidth - se.clientWidth);
  return {
    viewport: { innerWidth: window.innerWidth, clientWidth: vw },
    scrollingElement: { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth },
    html: { scrollWidth: html.scrollWidth, offsetWidth: html.offsetWidth, clientWidth: html.clientWidth },
    body: { scrollWidth: body.scrollWidth, offsetWidth: body.offsetWidth, clientWidth: body.clientWidth },
    fullPageWidth: Math.max(body.scrollWidth, html.scrollWidth, body.offsetWidth, html.offsetWidth, body.clientWidth, html.clientWidth),
    pageOverflowsX: se.scrollWidth > se.clientWidth,
    maxScrollX,
    escapers,
    pseudoCandidates,
  };
})()`;
