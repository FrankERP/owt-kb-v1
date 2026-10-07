// Solver v3 C1-R1 — the three role types declare «Cuenta para equidad»: a visible
// boolean, read-only with its document, with no Studio default (the default has one
// spelling, app/utils/countsForFairness.ts, which sanity/ cannot import).
import { describe, expect, it } from "vitest";

import { saturdayRole } from "@/sanity/schemas/satRole";
import { specialRole } from "@/sanity/schemas/specialRole";
import { sundayRole } from "@/sanity/schemas/sunRole";
import { isInternalStudioField } from "@/app/utils/studioProtection";

interface Field {
  name: string;
  title?: string;
  type: string;
  hidden?: unknown;
  initialValue?: unknown;
  description?: string;
}

const SCHEMAS = [
  ["sunday_role", sundayRole],
  ["saturday_role", saturdayRole],
  ["special_role", specialRole],
] as const;

describe("countsForFairness in the Studio (solver v3 C1-R1)", () => {
  it.each(SCHEMAS)("%s declares a visible boolean «Cuenta para equidad» and stays read-only", (typeName, schema) => {
    expect(schema.name).toBe(typeName);
    expect(schema.readOnly).toBe(true);
    const field = (schema.fields as unknown as Field[]).find((f) => f.name === "countsForFairness");
    expect(field, `${typeName}.countsForFairness`).toBeTruthy();
    expect(field?.type).toBe("boolean");
    expect(field?.title).toBe("Cuenta para equidad");
    expect(field?.hidden).toBeUndefined();
    expect("initialValue" in (field ?? {})).toBe(false);
    expect(field?.description).toBe(
      "Vacío = valor del tipo: domingo y sábado sí, especial no. Solo lo usa el nuevo solver.",
    );
    expect(isInternalStudioField(typeName, "countsForFairness")).toBe(false);
  });
});
