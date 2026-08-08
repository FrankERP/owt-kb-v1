// Swatches fixture — the compositing layer and the prose block (Child A2 step 2).
//
// Renders the 15 `.brand-*` classes that CARRY COLOUR. The set comes from A1's
// generated inventory (`compositing` rows of kind `selector` dispositioned `D`), NOT
// from a figure in any planning document — the parent said 17 in four places and was
// wrong: `.brand-admin-frame` and `.brand-admin-workspace` declare no colour in any
// rule body, so neither needs a light counterpart and neither would baseline anything
// theme-relevant.
//
// `.brand-atmosphere` is NOT rendered as a tile here. It is the page wash, applied to
// `<body>` by the layout, so this whole surface IS its swatch — cropping it into a card
// would show a fragment of a viewport-sized, `background-attachment: fixed` gradient
// rather than the surface it actually is.
//
// Nothing portals over this fixture and nothing inerts it, so the page scrolls and a
// `fullPage` capture is valid.

import SectionNav from "@/app/components/SectionNav";
import TextSizeControl from "@/app/components/TextSizeControl";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";

/** The 14 tile-able classes. `atmosphere` is the page wash and is demonstrated as such. */
const COMPOSITING_CLASSES = [
  "brand-admin-shell",
  "brand-admin-tabs",
  "brand-facet-panel",
  "brand-key-dial",
  "brand-library-module",
  "brand-lockup-mark",
  "brand-member-row",
  "brand-navbar",
  "brand-search-console",
  "brand-section-heading",
  "brand-song-hero",
  "brand-stage-hero",
  "brand-surface",
  "brand-surface-interactive",
] as const;

function Swatch({ name }: { name: string }) {
  return (
    <figure className="flex flex-col gap-2" data-swatch={name}>
      <div className={`${name} min-h-24 rounded-lg p-4`}>
        <span className="font-label text-xs uppercase tracking-wide">Aa</span>
      </div>
      <figcaption className="font-label text-xs opacity-70">.{name}</figcaption>
    </figure>
  );
}

export function SwatchesFixture() {
  return (
    <div className="flex flex-col gap-10" data-gallery-surface="swatches">
      <header>
        <h1 className="brand-section-heading font-display text-2xl">Paleta — clases de composición</h1>
        <p className="mt-2 text-sm opacity-80">
          Las 15 clases <code>.brand-*</code> que llevan color. <code>.brand-atmosphere</code> es el
          fondo de esta página, no una muestra recortada.
        </p>
      </header>

      <section aria-label="Clases de composición" className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {COMPOSITING_CLASSES.map((c) => (
          <Swatch key={c} name={c} />
        ))}
      </section>

      {/*
        The prose block. Child B adds a `theme.extend.typography` mapping and removes
        `dark:prose-invert`; this is where that lands visually. `/posts/[slug]` uses
        `prose prose-sm sm:prose`, and a top-level `theme.typography` would collapse the
        compiled stylesheet — so this fixture is the early warning for it.
      */}
      <section aria-label="Tipografía" className="prose prose-sm sm:prose dark:prose-invert max-w-none">
        <h2>Letra de ejemplo</h2>
        <p>
          Texto de párrafo con un <a href="#top">enlace</a>, <strong>negrita</strong> y{" "}
          <em>cursiva</em>, para revisar el contraste de la tipografía en ambos temas.
        </p>
        <blockquote>Una cita, con su borde izquierdo.</blockquote>
        <ul>
          <li>Un elemento de lista</li>
          <li>Otro elemento</li>
        </ul>
        <pre>
          <code>const token = &quot;--accent&quot;;</code>
        </pre>
      </section>

      {/*
        Stateless presentational components, named rather than left to the implementer.
        Each was checked to read no session, fetch nothing, and require no context.
      */}
      <section aria-label="Componentes sin estado" className="flex flex-col gap-6">
        <SectionNav
          sections={[
            { id: "a", label: "Sección A" },
            { id: "b", label: "Sección B" },
          ]}
        />
        <TextSizeControl />
        <div className="flex flex-col gap-2">
          <CueDialogStatus tone="info">Mensaje informativo</CueDialogStatus>
          <CueDialogStatus tone="pending">Guardando…</CueDialogStatus>
          <CueDialogStatus tone="success">Guardado</CueDialogStatus>
          <CueDialogStatus tone="error">No se pudo guardar</CueDialogStatus>
        </div>
      </section>
    </div>
  );
}
