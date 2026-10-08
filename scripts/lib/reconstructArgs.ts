// scripts/lib/reconstructArgs.ts
//
// The reconstruction CLI's arguments (solver v3 C4, spec «Provides → To C7»), its
// month scope (R1) and its private-path refusal (R11). Pure except the path refusal,
// which follows symlinks and reads the repository's `.git` layout through
// `solverHistoryDiffRun.ts`'s exported helpers — the same refusal, not a copy: every
// working tree of the repository counts as «inside».
//
// Nothing here echoes an argument value: an operator who typed a name where a flag
// belongs must not see it repeated on a terminal or in a transcript (R12).

import path from "node:path";

import { isMonthString, monthIndex, shiftMonth } from "../../app/utils/fairnessVocabulary";
import { isInsideRoot, nodeGitFs, realLocation, repositoryRoots, type GitFs } from "./solverHistoryDiffRun";

export type RunMode = "dry-run" | "apply" | "rollback" | "rollback-apply";

export interface ReconstructArgs {
  mode: RunMode;
  /** Oldest first; null only for an apply, which takes them from its plan. */
  months: string[] | null;
  out: string;
  overrides: string | null;
  /** null = the default: the month after the last requested month (R11). */
  previewRun: string | null;
  plan: string | null;
  fingerprint: string | null;
}

export const USAGE =
  "uso: npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months YYYY-MM[,YYYY-MM…] --out <carpeta> " +
  "[--overrides <archivo>] [--preview-run YYYY-MM] [--rollback] [--apply --plan <archivo> --fingerprint <64 hex>]";

const VALUE_FLAGS = new Set(["--months", "--out", "--overrides", "--preview-run", "--plan", "--fingerprint"]);
const BOOLEAN_FLAGS = new Set(["--apply", "--rollback"]);

export function parseReconstructArgs(argv: readonly string[]): ReconstructArgs | { error: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (flags.has(flag)) return { error: `${flag} se dio dos veces` };
      flags.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { error: `argumento inesperado en la posición ${i + 1}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} necesita un valor` };
    if (values.has(flag)) return { error: `${flag} se dio dos veces` };
    values.set(flag, value);
    i += 1;
  }
  const apply = flags.has("--apply");
  const rollback = flags.has("--rollback");
  const mode: RunMode = rollback ? (apply ? "rollback-apply" : "rollback") : apply ? "apply" : "dry-run";

  const out = values.get("--out");
  if (!out) return { error: "--out <carpeta> es obligatorio: una carpeta privada fuera del repositorio" };

  let months: string[] | null = null;
  const monthsText = values.get("--months");
  if (monthsText !== undefined) {
    const list = monthsText.split(",").map((m) => m.trim());
    if (!list.every((m) => isMonthString(m))) return { error: "--months debe ser YYYY-MM[,YYYY-MM…]" };
    if (new Set(list).size !== list.length) return { error: "--months repite un mes" };
    months = [...list].sort((a, b) => monthIndex(a) - monthIndex(b));
  } else if (!apply) {
    return { error: "--months es obligatorio (no tiene valor por defecto)" };
  }

  const previewRun = values.get("--preview-run") ?? null;
  if (previewRun !== null && !isMonthString(previewRun)) return { error: "--preview-run debe ser YYYY-MM" };
  const overrides = values.get("--overrides") ?? null;
  const plan = values.get("--plan") ?? null;
  const fingerprint = values.get("--fingerprint") ?? null;

  if (rollback && overrides !== null) return { error: "--rollback no acepta --overrides: un borrado no infiere nada (R18)" };
  if (rollback && previewRun !== null) return { error: "--rollback no acepta --preview-run (R18)" };
  if (apply) {
    if (plan === null) return { error: "--apply necesita --plan <archivo>: el plan que se revisó" };
    if (fingerprint === null || !/^[0-9a-f]{64}$/.test(fingerprint)) {
      return { error: "--apply necesita --fingerprint con la huella de 64 hex a la que Frank dio su consentimiento" };
    }
  } else {
    if (plan !== null) return { error: "--plan solo va con --apply" };
    if (fingerprint !== null) return { error: "--fingerprint solo va con --apply" };
  }
  return { mode, months, out, overrides, previewRun, plan, fingerprint };
}

/** R1: the months that are NOT strictly before the current CDMX month (empty = the run may go on). */
export function notPastMonths(months: readonly string[], currentMonth: string): string[] {
  return months.filter((m) => monthIndex(m) >= monthIndex(currentMonth));
}

/** R11's default preview run: the month after the last requested month. */
export function defaultPreviewRun(months: readonly string[]): string {
  return shiftMonth(months[months.length - 1], 1);
}

/**
 * R11: `--out`, `--overrides` and `--plan` hold member names, so each must resolve —
 * symlinks followed — outside every working tree of the repository. Checked before
 * any read. A `.git` file that cannot be followed is a `problem`: the caller refuses
 * rather than guard only part of the repository.
 */
export function privatePathRefusals(
  entries: ReadonlyArray<{ flag: string; file: string }>,
  repoRoot: string,
  platform: string,
  fs: GitFs = nodeGitFs,
): { problem: string | null; refusals: string[] } {
  const { roots, problem } = repositoryRoots(repoRoot, fs);
  if (problem) return { problem, refusals: [] };
  const caseInsensitive = platform === "darwin" || platform === "win32";
  const resolvedRoots = roots.flatMap((r) => [path.resolve(r), realLocation(r)]);
  const refusals: string[] = [];
  for (const { flag, file } of entries) {
    const candidates = [path.resolve(file), realLocation(file)];
    if (resolvedRoots.some((root) => candidates.some((c) => isInsideRoot(c, root, caseInsensitive)))) {
      refusals.push(
        `${flag} está dentro del repositorio o de uno de sus árboles de trabajo: los archivos de la reconstrucción ` +
          "llevan nombres de miembros y el repositorio es público. Usa una carpeta privada fuera de él (p. ej. ~/owt-private/c4/).",
      );
    }
  }
  return { problem: null, refusals };
}
