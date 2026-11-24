// The ONE Spanish wording of an app role — the admin Miembros chips and the
// member's own Perfil section read the same word, so «Editor» cannot become
// «Editor de contenido» on one screen and not the other. Neutral: no hooks.

export type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

export const ROLE_LABEL: Readonly<Record<OWTRole, string>> = {
  "super-admin":    "Super Admin",
  "admin":          "Admin",
  "content-editor": "Editor",
  "member":         "Miembro",
};

/** The label for a stored role string; an unknown value reads as itself rather than crashing a profile. */
export function roleLabel(role: string): string {
  return (ROLE_LABEL as Record<string, string>)[role] ?? role;
}
