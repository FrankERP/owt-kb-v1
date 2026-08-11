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
				// The seven retired keys. They stay until B-final, so both spellings
				// work while call sites migrate in batches. Removing one while a call
				// site still uses it is the single unsafe transition in Child B:
				// `bg-brand-beam` with no `brand.beam` key compiles to NOTHING and the
				// element loses its colour silently.
				brand: {
					blackout: "rgb(var(--brand-blackout) / <alpha-value>)",
					console: "rgb(var(--brand-console) / <alpha-value>)",
					deck: "rgb(var(--brand-deck) / <alpha-value>)",
					beam: "rgb(var(--brand-beam) / <alpha-value>)",
					signal: "rgb(var(--brand-signal) / <alpha-value>)",
					frost: "rgb(var(--brand-frost) / <alpha-value>)",
					steel: "rgb(var(--brand-steel) / <alpha-value>)",
				},

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
				"chart-lead": "rgb(var(--chart-lead-rgb) / <alpha-value>)",
				"chart-bgv": "rgb(var(--chart-bgv-rgb) / <alpha-value>)",
				"chart-coro": "rgb(var(--chart-coro-rgb) / <alpha-value>)",
				"chart-especial": "rgb(var(--chart-especial-rgb) / <alpha-value>)",
				"chart-instr": "rgb(var(--chart-instr-rgb) / <alpha-value>)",
				"chart-foh": "rgb(var(--chart-foh-rgb) / <alpha-value>)",

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
