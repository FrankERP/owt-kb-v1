import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				// Child B, Layer 1 — the 18 base roles. Alpha-capable: each is a
				// triplet, so `bg-accent/20` works. `theme.extend.colors` is ADDITIVE,
				// which is the whole reason B is sliceable at all.
				"accent": "rgb(var(--accent-rgb) / <alpha-value>)",
				"accent-deep": "rgb(var(--accent-deep-rgb) / <alpha-value>)",

				"ink": "rgb(var(--ink-rgb) / <alpha-value>)",
				"ink-muted": "rgb(var(--ink-muted-rgb) / <alpha-value>)",
				"ink-dim": "rgb(var(--ink-dim-rgb) / <alpha-value>)",

				"surface-base": "rgb(var(--surface-base-rgb) / <alpha-value>)",
				"surface-raised": "rgb(var(--surface-raised-rgb) / <alpha-value>)",
				"surface-raised-alt": "rgb(var(--surface-raised-alt-rgb) / <alpha-value>)",
				"surface-console": "rgb(var(--surface-console-rgb) / <alpha-value>)",
				"surface-sunken": "rgb(var(--surface-sunken-rgb) / <alpha-value>)",

				"warning-fg": "rgb(var(--warning-fg-rgb) / <alpha-value>)",
				"warning-surface": "rgb(var(--warning-surface-rgb) / <alpha-value>)",
				"warning-border": "rgb(var(--warning-border-rgb) / <alpha-value>)",

				"info-fg": "rgb(var(--info-fg-rgb) / <alpha-value>)",
				"info-surface": "rgb(var(--info-surface-rgb) / <alpha-value>)",
				"info-border": "rgb(var(--info-border-rgb) / <alpha-value>)",

				"positive-fg": "rgb(var(--positive-fg-rgb) / <alpha-value>)",
				"negative-fg": "rgb(var(--negative-fg-rgb) / <alpha-value>)",

				// Added in B3 — five values that render with no role in the vocabulary.
				// The two "deep" surfaces are the DARK halves of pairs whose light halves
				// the vocabulary named; the three overlay navies are drift that B preserves
				// rather than collapses. See brand.css for why.
				"warning-surface-deep": "rgb(var(--warning-surface-deep-rgb) / <alpha-value>)",
				"info-surface-deep": "rgb(var(--info-surface-deep-rgb) / <alpha-value>)",
				"surface-overlay": "rgb(var(--surface-overlay-rgb) / <alpha-value>)",
				"surface-overlay-deep": "rgb(var(--surface-overlay-deep-rgb) / <alpha-value>)",
				"surface-overlay-deepest": "rgb(var(--surface-overlay-deepest-rgb) / <alpha-value>)",

				// The last two groups from the vocabulary's "no role here" table.
				// `elevation` is the shadow black; the six `chart-*` are categorical
				// hues keyed by seat, not a semantic state. See brand.css.
				"elevation": "rgb(var(--elevation-rgb) / <alpha-value>)",
				"surface-lift": "rgb(var(--surface-lift-rgb) / <alpha-value>)",
				"scrim": "rgb(var(--scrim-rgb) / <alpha-value>)",
				"on-fill": "rgb(var(--on-fill-rgb) / <alpha-value>)",
				"chart-lead": "rgb(var(--chart-lead-rgb) / <alpha-value>)",
				"chart-bgv": "rgb(var(--chart-bgv-rgb) / <alpha-value>)",
				"chart-coro": "rgb(var(--chart-coro-rgb) / <alpha-value>)",
				"chart-especial": "rgb(var(--chart-especial-rgb) / <alpha-value>)",
				"chart-instr": "rgb(var(--chart-instr-rgb) / <alpha-value>)",
				"chart-foh": "rgb(var(--chart-foh-rgb) / <alpha-value>)",

				// Child C — the palette families. 34 roles carrying Tailwind's exact
				// values, so the migration renders byte-identically. See brand.css for
				// why the gray scale is `mono` and not `neutral`.

				"mono-200": "rgb(var(--mono-200-rgb) / <alpha-value>)",
				"mono-300": "rgb(var(--mono-300-rgb) / <alpha-value>)",
				"mono-400": "rgb(var(--mono-400-rgb) / <alpha-value>)",
				"mono-500": "rgb(var(--mono-500-rgb) / <alpha-value>)",
				"mono-600": "rgb(var(--mono-600-rgb) / <alpha-value>)",
				"mono-700": "rgb(var(--mono-700-rgb) / <alpha-value>)",
				"mono-800": "rgb(var(--mono-800-rgb) / <alpha-value>)",

				"negative-faint": "rgb(var(--negative-faint-rgb) / <alpha-value>)",
				"negative-soft": "rgb(var(--negative-soft-rgb) / <alpha-value>)",
				"negative-muted": "rgb(var(--negative-muted-rgb) / <alpha-value>)",
				"negative-strong": "rgb(var(--negative-strong-rgb) / <alpha-value>)",
				"negative-border": "rgb(var(--negative-border-rgb) / <alpha-value>)",
				"negative-surface": "rgb(var(--negative-surface-rgb) / <alpha-value>)",
				"negative-surface-deep": "rgb(var(--negative-surface-deep-rgb) / <alpha-value>)",
				"negative-surface-deepest": "rgb(var(--negative-surface-deepest-rgb) / <alpha-value>)",

				"warning-faint": "rgb(var(--warning-faint-rgb) / <alpha-value>)",
				"warning-soft": "rgb(var(--warning-soft-rgb) / <alpha-value>)",
				"warning-strong": "rgb(var(--warning-strong-rgb) / <alpha-value>)",

				"recency-faint": "rgb(var(--recency-faint-rgb) / <alpha-value>)",
				"recency-soft": "rgb(var(--recency-soft-rgb) / <alpha-value>)",
				"recency-strong": "rgb(var(--recency-strong-rgb) / <alpha-value>)",
				"recency-fg": "rgb(var(--recency-fg-rgb) / <alpha-value>)",

				"positive-soft": "rgb(var(--positive-soft-rgb) / <alpha-value>)",
				"positive-strong": "rgb(var(--positive-strong-rgb) / <alpha-value>)",
				"positive-deep": "rgb(var(--positive-deep-rgb) / <alpha-value>)",

				"availability-faint": "rgb(var(--availability-faint-rgb) / <alpha-value>)",
				"availability-soft": "rgb(var(--availability-soft-rgb) / <alpha-value>)",
				"availability-strong": "rgb(var(--availability-strong-rgb) / <alpha-value>)",
				"availability-fg": "rgb(var(--availability-fg-rgb) / <alpha-value>)",
				"availability-deep": "rgb(var(--availability-deep-rgb) / <alpha-value>)",

				"badge-violet-fg": "rgb(var(--badge-violet-fg-rgb) / <alpha-value>)",
				"badge-violet-deep": "rgb(var(--badge-violet-deep-rgb) / <alpha-value>)",

				"badge-azure-fg": "rgb(var(--badge-azure-fg-rgb) / <alpha-value>)",
				"badge-azure-deep": "rgb(var(--badge-azure-deep-rgb) / <alpha-value>)",

				// Child B, Layer 2 — the 23 composed tokens. These bake their own alpha
				// and are therefore NOT alpha-capable: no `<alpha-value>`, and an
				// opacity modifier on one is a bug that B-final's lint clause bans.
				"surface-accent-solid": "var(--surface-accent-solid)",
				"surface-accent-30": "var(--surface-accent-30)",
				"surface-accent-hover": "var(--surface-accent-hover)",
				"edge-accent-subtle": "var(--edge-accent-subtle)",
				"surface-accent-20": "var(--surface-accent-20)",
				"surface-accent-faint": "var(--surface-accent-faint)",
				"surface-accent-wash": "var(--surface-accent-wash)",
				"surface-accent-l20-d60-sunken": "var(--surface-accent-l20-d60-sunken)",
				"surface-accent-l100-d10": "var(--surface-accent-l100-d10)",
				"surface-accent-l40-d20": "var(--surface-accent-l40-d20)",
				"surface-accent-l30-d25": "var(--surface-accent-l30-d25)",
				"surface-accent-l10-d4": "var(--surface-accent-l10-d4)",
				"surface-ink-l60-d50": "var(--surface-ink-l60-d50)",
				"surface-ink-l40-d100-base": "var(--surface-ink-l40-d100-base)",
				"surface-accent-l25-d20": "var(--surface-accent-l25-d20)",
				"surface-accent-l25-d15": "var(--surface-accent-l25-d15)",
				"surface-ink-l70-d50": "var(--surface-ink-l70-d50)",
				"surface-accent-l15-d4": "var(--surface-accent-l15-d4)",
				"surface-accent-l100-d15": "var(--surface-accent-l100-d15)",
				"surface-ink-l50-d35": "var(--surface-ink-l50-d35)",
				"surface-accent-l5-d3": "var(--surface-accent-l5-d3)",
				"surface-accent-l50-d40": "var(--surface-accent-l50-d40)",
				"surface-accent-l50-d15": "var(--surface-accent-l50-d15)",

				// Control affordances. COMPOSED, so not alpha-capable — an opacity
				// modifier on one double-applies the baked alpha and the lint clause
				// bans it. Added after a measured WCAG failure; see brand.css.
				// THE KEY IS THE COLOUR NAME, NOT THE UTILITY NAME. This one shipped wrong
				// once: it was keyed `text-placeholder`, which generates the utility
				// `text-text-placeholder`. The class written at 13 call sites is
				// `placeholder:text-placeholder` — it matched no colour called `placeholder`,
				// so Tailwind emitted NOTHING. No build error, no failing test: every site
				// silently fell back to preflight #9ca3af, which measured 2.12:1 in light,
				// WORSE than the 3.09 the change was meant to fix. Guarded now by
				// tokenLayer.test.ts, which rejects any key starting with a utility prefix.
				"placeholder": "var(--placeholder)",
				"edge-control": "var(--edge-control)",
			},
			fontFamily: {
				display: ["var(--font-display)", "sans-serif"],
				body:    ["var(--font-body)",    "sans-serif"],
				label:   ["var(--font-label)",   "sans-serif"],
			},
			fontSize: {
				xs:   ["0.8125rem", { lineHeight: "1.2rem" }],
				sm:   ["0.9375rem", { lineHeight: "1.45rem" }],
				base: ["1.0625rem", { lineHeight: "1.65rem" }],
			},
			scrollSnapType: {
				x: "x mandatory",
			},
      boxShadow: {
        bottom: "0px 6px 4px -4px rgb(var(--elevation-rgb) / 0.1)",
      },
			scrollSnapAlign: {
				start: "start",
			},
		},
	},
	plugins: [typography],
};
export default config;
