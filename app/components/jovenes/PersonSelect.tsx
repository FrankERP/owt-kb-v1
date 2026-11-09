"use client";

import Select from "@/app/components/ui/Select";

export type { JovenesPerson } from "@/app/utils/jovenesPeople";
import type { JovenesPerson } from "@/app/utils/jovenesPeople";

/**
 * One person for a seat or a program line, from Jóvenes' active members. A stored person who is
 * no longer in the list (left the ministry, or a weak reference to a deleted member) stays as an
 * option under their stored name, so opening an editor never drops them silently; the server
 * keeps such an item only while it is unchanged (W5).
 */
export default function PersonSelect({
  value,
  onChange,
  people,
  storedName,
  ariaLabel,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  people: readonly JovenesPerson[];
  storedName?: string | null;
  ariaLabel: string;
}) {
  const known = value === null || people.some((p) => p.id === value);
  return (
    <Select aria-label={ariaLabel} size="lg" className="w-full" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Sin asignar</option>
      {!known && value && <option value={value}>{storedName ?? "Persona anterior"} (ya no está en Jóvenes)</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
