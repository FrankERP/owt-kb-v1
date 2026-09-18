"use client";

// The ONE select (spec §19.3, decision M; R5 ruling 8). Two renders of ONE control.
//
// On a COARSE pointer the element stays a bare <select>: iOS's picker wheel is the
// better phone control, and every test that reaches one by label or querySelector
// keeps working. What changes there is only the chrome: tokenised border, focus
// glow, a drawn chevron over the hidden native arrow.
//
// On `(hover: hover) and (pointer: fine)` — a desktop mouse — the native menu is the
// one piece of OS chrome the house cannot style, so the control grows a house
// trigger that opens `Menu` (roving focus, Escape, first-letter jump). The native
// <select> STAYS MOUNTED, `sr-only`: it is still the form value, still what the
// <label> points at, still what a keyboard user tabs into (they get the native
// picker, which is fine — it is the accessible control). Picking from the menu sets
// that element's value and dispatches a real, bubbling `change` on it, so the
// consumer's `onChange` fires with a genuine event and reads `e.target.value`
// exactly as it always has. No consumer changes.
//
// Detection is `useSyncExternalStore` over the media query, whose SERVER snapshot is
// `false`: SSR and hydration are the native path and never disagree, and a hybrid
// device that gains a mouse mid-session switches without a remount.
// `popover={false}` opts any consumer out; a test environment without `matchMedia`
// stays native.
//
// CLIENT (it owns pointer state). Server Components may still render it as JSX.

import React, { useCallback, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { normalizeText } from "@/app/utils/normalizeText";
import Button from "./Button";
import Menu, { MenuItem } from "./Menu";

// 16 px on a phone, the design's size from `sm` up: WebKit zooms into any focused
// control under 16 px and never zooms back (F3). `sm` is the admin-density skin and
// keeps its 11 px — those tables are not a phone surface. `inputFontSize.test.ts`.
const SIZE = {
  sm: "px-2 py-1 pr-8 text-[11px]",
  md: "px-3 py-2 pr-9 text-[16px] sm:text-sm",
  lg: "min-h-[44px] px-3 py-2 pr-9 text-[16px] sm:text-sm",
} as const;

const CHROME =
  "w-full appearance-none rounded-lg border border-surface-accent-30 bg-surface-raised-alt font-body text-ink " +
  "transition-[border-color,box-shadow] duration-fast ease-out-brand focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/** `matchMedia` is absent in jsdom and on the server; both answer the COARSE path. */
function mql() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(FINE_POINTER);
}
function subscribeFine(onChange: () => void) {
  const q = mql();
  q?.addEventListener?.("change", onChange);
  return () => q?.removeEventListener?.("change", onChange);
}
const fineSnapshot = () => mql()?.matches ?? false;
const fineServerSnapshot = () => false;

// `popover` is Omitted, not just shadowed: React's own `popover` attribute is
// `"" | "auto" | "manual"`, and an intersection with `boolean` collapses to
// `undefined` — the prop would type-check as unusable. No consumer puts the HTML
// Popover API on a <select>.
type Base = Omit<ComponentPropsWithoutRef<"select">, "className" | "children" | "size" | "popover"> & {
  size?: keyof typeof SIZE;
  className?: string;
  /** Desktop only: open a house `Menu` instead of the OS menu. Default `true`. */
  popover?: boolean;
  children: ReactNode;
};
type Props = (Base & { label: ReactNode; id: string }) | (Base & { label?: undefined });

type Option = { value: string; label: ReactNode; text: string; disabled: boolean };

/** Flatten the `<option>` children (through fragments and `<optgroup>`s) into menu rows. */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (nodes: ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment || child.type === "optgroup") {
        walk((child.props as { children?: ReactNode }).children);
        return;
      }
      if (child.type !== "option") return;
      const props = child.props as ComponentPropsWithoutRef<"option">;
      const label = props.children ?? props.label ?? "";
      const text = typeof label === "string" || typeof label === "number" ? String(label) : "";
      out.push({
        value: props.value !== undefined ? String(props.value) : text,
        label,
        text,
        disabled: Boolean(props.disabled),
      });
    });
  };
  walk(children);
  return out;
}

function Chevron({ className }: { className: string }) {
  return (
    <svg data-select-chevron="" aria-hidden="true" viewBox="0 0 20 20" className={className}>
      <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Select({ label, size = "md", className = "", popover = true, children, ...select }: Props) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const fine = useSyncExternalStore(subscribeFine, fineSnapshot, fineServerSnapshot) && popover;
  // The value the native element actually carries, for the UNCONTROLLED case; a
  // controlled consumer's `value` prop wins over it below.
  const [live, setLive] = useState<string | null>(null);

  const onChange = select.onChange;
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      // Only the popover path reads `live`; the native path must not re-render for it.
      if (fine) setLive(e.target.value);
      onChange?.(e);
    },
    [fine, onChange],
  );

  /** Select `value` on the native element and let React hear a real `change`. */
  const pick = useCallback((value: string) => {
    const el = nativeRef.current;
    if (!el) return;
    // Re-picking the current option is a no-op on a native <select>, which fires no
    // `change`. Dispatching one anyway sent a spurious PATCH from `PairRoster`.
    if (el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, []);

  // First-letter jump: move focus to the next item whose label starts with the key,
  // accent- and case-insensitively. Bound on the control's OWN wrapper, which holds
  // both the trigger and (until the panel was portalled) the menu — so it also works
  // from the trigger, where focus stays after a click-open. `Menu` owns the arrows,
  // Home/End and Escape. With the menu closed there are no items and it does nothing.
  const onTypeAhead = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = normalizeText(e.key);
    if (!key.trim()) return;
    // The panel is portalled to `document.body`, so it is found through the trigger's
    // `aria-controls` id rather than by walking the DOM.
    const panelId = e.currentTarget.querySelector("[aria-controls]")?.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    const items = Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (items.length === 0) return;
    const from = items.indexOf(document.activeElement as HTMLElement);
    for (let step = 1; step <= items.length; step++) {
      const candidate = items[(from + step + items.length) % items.length];
      if (normalizeText(candidate.textContent ?? "").startsWith(key)) {
        e.preventDefault();
        e.stopPropagation();
        candidate.focus();
        return;
      }
    }
  }, []);

  const Label = label ? (
    <label htmlFor={select.id} className="mb-1 block font-label text-[10px] uppercase tracking-widest text-mono-500">
      {label}
    </label>
  ) : null;

  const nativeClass = `${CHROME} ${SIZE[size]}`;

  if (!popover || !fine) {
    return (
      <div className={`block ${className}`.trim()}>
        {Label}
        <div className="relative">
          <select {...select} ref={nativeRef} onChange={handleChange} className={nativeClass}>
            {children}
          </select>
          <Chevron className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mono-500" />
        </div>
      </div>
    );
  }

  const options = readOptions(children);
  const current =
    select.value !== undefined
      ? String(select.value)
      : live ?? (select.defaultValue !== undefined ? String(select.defaultValue) : options[0]?.value ?? "");
  // No `?? options[0]`: a controlled value matching no option leaves the native
  // element blank, and the trigger must say the same thing rather than name a
  // choice nobody made.
  const chosen = options.find((o) => o.value === current);
  const ariaLabel = typeof select["aria-label"] === "string" ? select["aria-label"] : undefined;
  const named = ariaLabel ?? (typeof label === "string" ? label : undefined);
  // The trigger is named "<field>: <choice>" — never the bare field name, which
  // would leave two elements answering to it, and never `aria-labelledby` pointing
  // at the <label> for the same reason (a labelledby reference is matched on its
  // own, not as part of the composed name). A non-string `label` gives no field
  // text to compose with, so the trigger falls back to its own content.
  const triggerNaming = named ? { "aria-label": `${named}: ${chosen?.text ?? ""}` } : {};

  return (
    <div className={`block ${className}`.trim()} onKeyDown={onTypeAhead}>
      {Label}
      {/*
        `tabIndex={-1}` AFTER the spread: `sr-only` is visually hidden but still
        focusable, so the native element was an invisible tab stop in front of the
        trigger. It keeps `htmlFor`, so it is still what the <label> and AT name.
      */}
      <select {...select} ref={nativeRef} tabIndex={-1} onChange={handleChange} className={`${nativeClass} sr-only`}>
        {children}
      </select>
      <Menu
        label={named ? `Opciones de ${named}` : "Opciones"}
        align="start"
        // `Menu`'s root defaults to `inline-block`, which collapses the trigger's
        // `w-full` to content width and spills out of a capped wrapper
        // (`MonthGenerator`'s `w-24 max-w-[96px]` week select).
        className="block w-full"
        trigger={
          <Button
            variant="secondary"
            size={size}
            disabled={select.disabled}
            className="w-full min-w-0 justify-between"
            {...triggerNaming}
          >
            <span data-select-value="" className="min-w-0 truncate">{chosen?.label ?? ""}</span>
            <Chevron className="h-4 w-4 shrink-0 text-mono-500" />
          </Button>
        }
      >
        {options.map((o) => (
          <MenuItem key={o.value} disabled={o.disabled} selected={o.value === current} onSelect={() => pick(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}
