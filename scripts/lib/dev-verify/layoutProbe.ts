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
 * there. The string is evaluated as-is. It reads layout and computed style, and its
 * one side effect is the pan check — `scrollTo` to the far right and back — which
 * is client-side scroll position only; lock 1 still aborts any request.
 *
 * `escapers` are the OUTERMOST elements whose box crosses the viewport's left or
 * right edge with no ancestor that clips `overflow-x` (auto, scroll, hidden or
 * clip) between them and `<html>`: an overflow-x-auto box's own wide child is
 * contained and is not listed; the box itself, if IT is wider than the page, is.
 * For an absolute or fixed box only ancestors from its containing block outward
 * count — an overflow box BELOW the containing block does not clip it.
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
  /** `scrollX` after `scrollTo(1e6, 0)` — how far the page actually pans. */
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
  const clipsX = (el) => getComputedStyle(el).overflowX !== "visible";
  const makesCb = (el, position) => {
    const cs = getComputedStyle(el);
    const fixedCb = cs.transform !== "none" || cs.filter !== "none" || /paint|layout|strict|content/.test(cs.contain || "");
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
    if (r.right + sx <= vw + 0.5 && r.left + sx >= -0.5) continue;
    // An overflow ancestor clips an out-of-flow box only from the box's containing
    // block outward: an absolute box whose containing block lies OUTSIDE an
    // overflow-x-auto scroller is not clipped by it, and overflows the page.
    const own = getComputedStyle(el).position;
    let awaitingCb = own === "absolute" || own === "fixed";
    let clipped = false;
    for (let a = el.parentElement; a && a !== html; a = a.parentElement) {
      if (awaitingCb && makesCb(a, own)) awaitingCb = false;
      if (!awaitingCb && a !== body && clipsX(a)) { clipped = true; break; }
    }
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
  for (const el of all) {
    for (const pseudo of ["::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === "none" || cs.content === "normal") continue;
      const w = parseFloat(cs.width);
      if (!(w >= vw)) continue;
      const r = el.getBoundingClientRect();
      pseudoCandidates.push({ ...box(el, r), pseudo, width: round(w) });
      if (pseudoCandidates.length >= 12) break;
    }
  }
  const before = { x: window.scrollX, y: window.scrollY };
  window.scrollTo(1e6, before.y);
  const maxScrollX = window.scrollX;
  window.scrollTo(before.x, before.y);
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
