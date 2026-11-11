"use client";

import Select from "@/app/components/ui/Select";
import { HAIRLINE_INPUT_CLASS } from "@/app/components/ui/hairlineField";

export type { JovenesPerson } from "@/app/utils/jovenesPeople";
import type { JovenesPerson } from "@/app/utils/jovenesPeople";

/** The select's value for «Escribir un nombre…». Never a member id: it never reaches `onChange`. */
const TYPED = "__typed__";

/**
 * One person for a seat or a program line, from Jóvenes' active members. A stored person who is
 * no longer in the list (left the ministry, or a weak reference to a deleted member) stays as an
 * option under their stored name, so opening an editor never drops them silently; the server
 * keeps such an item only while it is unchanged (W5).
 *
 * TYPED MODE is opt-in (`onTypedName`), and only the seats of a whole-ministry meeting pass it
 * (plan `2026-11-10-jovenes-place-and-names.md` P7): someone without an account («Ana») or the
 * group that hosts («Emprendedores»). The program editor never passes it — its lines keep members
 * only, and a typed name there would be dropped on save. `typedName` is `null` when the seat holds
 * a member or nobody, and a string (possibly empty, while typing) in typed mode.
 */
export default function PersonSelect({
  value,
  onChange,
  people,
  storedName,
  ariaLabel,
  typedName = null,
  onTypedName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  people: readonly JovenesPerson[];
  storedName?: string | null;
  ariaLabel: string;
  typedName?: string | null;
  onTypedName?: (name: string | null) => void;
}) {
  const typed = !!onTypedName && typedName !== null;
  const known = value === null || people.some((p) => p.id === value);
  return (
    <>
      <Select
        aria-label={ariaLabel}
        size="lg"
        className="w-full"
        value={typed ? TYPED : (value ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === TYPED) {
            onChange(null);
            onTypedName?.("");
            return;
          }
          onTypedName?.(null);
          onChange(v || null);
        }}
      >
        <option value="">Sin asignar</option>
        {!known && value && <option value={value}>{storedName ?? "Persona anterior"} (ya no está en Jóvenes)</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {onTypedName && <option value={TYPED}>Escribir un nombre…</option>}
      </Select>
      {typed && (
        <>
          <input
            aria-label={`${ariaLabel}: nombre`}
            className={`${HAIRLINE_INPUT_CLASS} mt-2`}
            maxLength={60}
            placeholder="Nombre (por ejemplo Ana, o Emprendedores)"
            value={typedName ?? ""}
            onChange={(e) => onTypedName?.(e.target.value.replace(/[\r\n\u2028\u2029]/g, " "))}
          />
          <span className="mt-1 block font-body text-[13px] text-ink-muted">
            Para quien no tiene cuenta en Jóvenes. No le aparece en su calendario.
          </span>
        </>
      )}
    </>
  );
}
