// PersonAvatar: a person's face on a Jóvenes meeting. The photo is the profile's own (the one
// `/me` and the worship team block show), painted as a background OVER the initials so a photo
// that fails to load still leaves a face; a seat nobody holds never draws one.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PersonAvatar from "../PersonAvatar";

const html = (props: Parameters<typeof PersonAvatar>[0]) => renderToStaticMarkup(<PersonAvatar {...props} />);

describe("PersonAvatar", () => {
  it("draws initials for a person with no photo, and no image", () => {
    const out = html({ name: "Marianne" });
    expect(out).toContain("MA");
    expect(out).not.toContain("data-photo");
  });
  it("draws the profile photo over the initials, a Sanity upload asked for small and as JPEG", () => {
    const out = html({ name: "Marianne", photo: "https://cdn.sanity.io/images/p/d/abc.webp" });
    expect(out).toContain("url(&quot;https://cdn.sanity.io/images/p/d/abc.webp?w=96&amp;h=96&amp;fit=crop&amp;fm=jpg&quot;)");
    // Never an <img>: one that fails draws the browser's broken-image glyph over the face.
    expect(out).not.toContain("<img");
    // Decorative: the name is always written beside the face.
    expect(out).toContain('aria-hidden="true"');
    // The initials stay underneath: they are what is left if the photo fails to load.
    expect(out).toContain("MA");
  });
  it("passes a Google photo through untouched", () => {
    expect(html({ name: "Jacob", photo: "https://lh3.googleusercontent.com/a/xyz=s96-c" })).toContain(
      "url(&quot;https://lh3.googleusercontent.com/a/xyz=s96-c&quot;)",
    );
  });
  it("a URL cannot end its own CSS string: not with a quote, not with a control character", () => {
    const out = html({ name: "Jacob", photo: 'https://example.test/a").x{color:red}/*' });
    expect(out).toContain("https://example.test/a%22).x{color:red}/*&quot;)");
    expect(out).not.toContain('a&quot;).x');
    // CSS ends a string at a newline, and a form feed counts as one.
    for (const control of ["\f", "\n", "\r", "\u0000", "\u000b", "\u007f"]) {
      const broken = html({ name: "Jacob", photo: `https://example.test/a${control}); position:fixed; x:` });
      expect(broken).not.toContain(control);
      expect(broken).toContain(`https://example.test/a${encodeURIComponent(control)}); position:fixed`);
    }
  });
  it("paints only an https URL; anything else leaves the initials", () => {
    for (const photo of ["javascript:alert(1)", "http://example.test/a.jpg", "data:image/png;base64,AAAA", "/icons/a.png", ""]) {
      const out = html({ name: "Jacob", photo });
      expect(out).not.toContain("data-photo");
      expect(out).toContain("JA");
    }
  });
  it("lets a tap through to whatever is under the face", () => {
    // A positioned face would otherwise sit above a card head's stretched hit area.
    expect(html({ name: "Jacob" })).toContain("pointer-events-none");
    expect(html({ name: "Jacob", photo: "https://lh3.googleusercontent.com/a/j" })).toContain("pointer-events-none");
  });
  it("keeps the green ring on «Tú» with a photo", () => {
    const out = html({ name: "Frank", photo: "https://lh3.googleusercontent.com/a/f", mine: true });
    expect(out).toContain("border-positive-fg");
    expect(out).toContain("data-photo");
  });
  it("never draws a photo on a seat nobody holds", () => {
    const out = html({ name: null, photo: "https://lh3.googleusercontent.com/a/stray" });
    expect(out).not.toContain("data-photo");
    expect(out).toContain("border-dashed");
  });
});
