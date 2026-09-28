// MCP tool `swap_assignment` (P3 step 10): swap a whole SECTION (Lead, BGVs,
// Chorus, instruments or FOH) or a whole TEAM between two services — never a
// single seat (roadmap decision 6) — through the same domain writer `/admin`'s
// stored planner calls: `swapRoles` (`app/utils/roleSwapCommit.ts`), via the
// write foundation's `runWriteTool`/`callDomain` (step 7).
//
// INPUT (ruling P3-R1): ONE strict object `{ kind, path?, services }`, not a
// root discriminated union — zod 4 publishes no top-level
// `additionalProperties: false` for a root union. `kind` is `"section"` or
// `"team"` only; there is no `seat` shape, and no `source`/`target`. A section
// needs a `path` and a team takes none: the schema says so (so the SDK refuses
// it before this code runs) and `swapAssignmentResult` checks it again in the
// `pre` phase (so a direct call — every test in this file's suite — refuses in
// Spanish too, before any read). `serviceId`/`rev` are refined with the
// domain's own `isCanonicalDocumentId`/`isRevisionString`, as in steps 8–9.
//
// ADMISSION (§ «Admin surface gates», S1–S4). Before the domain, the tool
// admits the pair exactly as the planner would, from what the server already
// assembles (`../writes/swapAdmission.ts`). A refused admission writes nothing,
// so a legacy weekend role with no lock is refused here and never reaches the
// route's maintenance bootstrap.
//
// THE CALL. `swapAssignmentBody` is the ONE place the domain body is built:
// `{ kind, path?, roles: [{ id, rev }, { id, rev }] }`, the route's own
// section/team shape, so the route's parser runs over it (D1) and every
// counterpart refusal (topology, a hidden Saturday Chorus, the same service
// twice, a stale rev, a raw draft of the role's own id, a wrong-owner lock, a
// dangling moved person, a commit conflict) comes back with the route's code
// through `refusalFor`.
//
// THE REPORT is built from `effects` (step 4; ruling P3-R16: `effects.roles[i]`
// holds `role`, `set`, `seatStates` and `notice`) and NEVER mutates it: a
// slot's nested `person` object may be shared between entries, so every
// comparison and view below builds new objects.
//   - Per service: what moved, from `seatStates` (pre-commit — the same values
//     the notices used), named.
//   - `notifications`: step 7's `swapNotifications` over the two descriptors.
//   - `songLeadsOrphaned` (reported, never refused): on a worship night, the
//     writer's own `validateSongLeads` over each stored song's leaders against
//     the new Lead. The next setlist save is refused until they are fixed.
//   - `unavailablePlaced`: members newly placed on a service whose
//     `unavailableDates` include its day (`computeAvailabilityConflicts`).
//   - `freshRevs` (D8): a read-back through `loadCanonicalRolesByIds`. A rev is
//     returned only when the read-back equals the written state across the
//     whole `ROLE_PROJECTION` except `_rev`: the loaded row overlaid with the
//     raw `set` payload (ruling P3-R17: for section/team a map of whole seat
//     arrays), item for item and `_key` for `_key`. Anything else is
//     `changedAgainAfterSave: true`, with no rev.
// Every post-commit read (the read-back, the member lookup behind names and
// availability, the song titles) goes through `safeReportRead`: a failure
// degrades that one field and never turns the committed write into «No se
// pudo confirmar…».
//
// `revalidateRoleMutation()` touches `/`, `/schedule`, the song pages
// (`revalidateServiceViews`) and `/me`; the text says so plainly.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { swapRoles, type RoleSwapEffects, type RoleSwapRoleEffect } from "@/app/utils/roleSwapCommit";
import {
  isCanonicalDocumentId,
  isRevisionString,
  normalizeStoredSeats,
  seatAssignees,
  storedRoleDate,
  isSpecialRoleType,
  SEAT_PATHS,
  type NormalizedSeats,
  type SeatPath,
} from "@/app/utils/roleWriteRequest";
import { loadCanonicalRolesByIds, type StoredRole } from "@/app/utils/roleWriteOps";
import { serviceError } from "@/app/utils/serviceMutation";
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { songItemLeadIds, validateSongLeads } from "@/app/utils/songLeads";
import { computeAvailabilityConflicts, derivePublishState } from "@/app/components/admin/serviceReadiness";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";
import type { MemberNameLookup } from "../reads/serviceSnapshot";
import { loadSongTitles } from "../reads/songTitles";
import { admissionRefusal, refusalFor } from "../writes/refusals";
import { runWriteTool, safeReportRead, WRITE_REREAD_RULE } from "../writes/runWriteTool";
import {
  OUTBOX_SWEEP_NOTE,
  audienceMember,
  memberLabel,
  resolveNotifications,
  safeMemberLookup,
  swapNotifications,
  type AudienceMember,
} from "../writes/reports";
import { loadSwapAdmission, swapServiceLabel, type SwapAdmissionRefusal } from "../writes/swapAdmission";

// ── Input ───────────────────────────────────────────────────────────────────

const SERVICE_ID_MESSAGE = "serviceId no es un id de servicio válido; usa el que devuelve get_service.";
const REV_MESSAGE = "rev no es una revisión válida; usa la que devuelve get_service.";
const SERVICES_MESSAGE = "services debe tener exactamente dos servicios, cada uno con { serviceId, rev }.";
const KIND_MESSAGE = 'kind debe ser "section" (una sección completa) o "team" (el equipo completo).';
export const SECTION_PATH_MESSAGE =
  'Un intercambio de sección necesita path: "Lead", "BGVs", "Chorus", "instruments" o "foh_team".';
export const TEAM_PATH_MESSAGE = "Un intercambio de equipo completo no lleva path: se intercambian las cinco secciones.";

const SWAP_SERVICE_SELECTION = z
  .object({
    serviceId: z.string().refine(isCanonicalDocumentId, { message: SERVICE_ID_MESSAGE }),
    rev: z.string().refine(isRevisionString, { message: REV_MESSAGE }),
  })
  .strict();

export const SWAP_ASSIGNMENT_INPUT = z
  .object({
    kind: z.enum(["section", "team"]),
    path: z.enum(SEAT_PATHS).optional(),
    services: z.array(SWAP_SERVICE_SELECTION).length(2, { message: SERVICES_MESSAGE }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "section" && value.path === undefined) {
      ctx.addIssue({ code: "custom", path: ["path"], message: SECTION_PATH_MESSAGE });
    }
    if (value.kind === "team" && value.path !== undefined) {
      ctx.addIssue({ code: "custom", path: ["path"], message: TEAM_PATH_MESSAGE });
    }
  });

export type SwapAssignmentArgs = z.infer<typeof SWAP_ASSIGNMENT_INPUT>;

export const SWAP_ASSIGNMENT_DESCRIPTION =
  "Intercambia las asignaciones entre DOS servicios del equipo de alabanza, exactamente como el planner de " +
  "/admin → Servicios: una sección completa (kind: \"section\" con path \"Lead\", \"BGVs\", \"Chorus\", " +
  "\"instruments\" o \"foh_team\") o el equipo completo (kind: \"team\", sin path, las cinco secciones). Nunca " +
  "mueve un solo asiento. Se intercambian los arreglos guardados tal cual (con sus claves, instrumentos y " +
  "etiquetas de FOH); nada más del servicio cambia. Solo intercambia dos servicios del MISMO mes que el planner " +
  "de /admin dejaría intercambiar: antes de escribir comprueba, como el planner, que cada uno sea un único " +
  "documento sin borradores de Studio encima, sin asignaciones a personas que ya no existen, con su dato de " +
  "coordinación de fin de semana válido y, si es especial, con nombre propio; si algo falla, no escribe nada y " +
  "explica por qué. Cada servicio publicado avisa " +
  "por push «Servicio actualizado» a quien entra nuevo y encola un correo agrupado a quien estaba antes y a " +
  "quien está después (después de la ventana de agrupación); un borrador no avisa a nadie. /, /schedule, /me y " +
  "las páginas de canciones se actualizan. Informa, sin rechazar, a quien quedó en un día que marcó como no " +
  "disponible y, en una Noche de alabanza, las canciones cuyos líderes ya no están en Lead. serviceId y rev de " +
  "cada servicio son observaciones (observations.roleId y observations.roleRev de get_service, o serviceId y " +
  "roleRev de list_services): pásalas SIN CAMBIOS, tal como llegaron; nunca las construyas a mano. Un intercambio " +
  "mueve las dos revisiones, así que para otra escritura usa freshRevs o vuelve a leer. " +
  WRITE_REREAD_RULE;

/** The Spanish label of each seat path. */
export const SWAP_PATH_LABEL: Readonly<Record<SeatPath, string>> = {
  Lead: "Lead",
  BGVs: "BGVs",
  Chorus: "Coro",
  instruments: "Instrumentos",
  foh_team: "FOH",
};

/** The exact domain body this tool ever sends — the route's section/team shape, nothing else. */
export function swapAssignmentBody(args: SwapAssignmentArgs) {
  const roles = args.services.map((service) => ({ id: service.serviceId, rev: service.rev }));
  return args.kind === "section"
    ? { kind: "section" as const, path: args.path, roles }
    : { kind: "team" as const, roles };
}

/** The shape checks the schema makes, again, for a direct call. Null when the input is well formed. */
function inputRefusal(args: SwapAssignmentArgs): CallToolResult | null {
  if (args.kind !== "section" && args.kind !== "team") {
    return admissionRefusal("invalid_request", "invalid_kind", KIND_MESSAGE);
  }
  if (args.kind === "section" && !(SEAT_PATHS as readonly unknown[]).includes(args.path)) {
    return admissionRefusal("invalid_request", "path_required", SECTION_PATH_MESSAGE);
  }
  if (args.kind === "team" && args.path !== undefined) {
    return admissionRefusal("invalid_request", "path_not_allowed", TEAM_PATH_MESSAGE);
  }
  if (!Array.isArray(args.services) || args.services.length !== 2) {
    return admissionRefusal("invalid_request", "invalid_services", SERVICES_MESSAGE);
  }
  for (const service of args.services) {
    if (!isCanonicalDocumentId(service?.serviceId)) {
      return admissionRefusal("invalid_request", "invalid_service_id", SERVICE_ID_MESSAGE);
    }
    if (!isRevisionString(service?.rev)) {
      return admissionRefusal("invalid_request", "invalid_revision", REV_MESSAGE);
    }
  }
  return null;
}

/** An admission refusal as a tool result. `not_found` keeps the route's own 404 wording. */
function admissionResult(refusal: SwapAdmissionRefusal): CallToolResult {
  const result =
    refusal.kind === "not_found"
      ? refusalFor({ ok: false, ...serviceError("not_found", { details: { id: refusal.serviceId } }) })
      : admissionRefusal(refusal.code, refusal.detail, refusal.text);
  return refusal.serviceId
    ? { ...result, structuredContent: { ...(result.structuredContent ?? {}), serviceId: refusal.serviceId } }
    : result;
}

// ── freshRevs (D8) ──────────────────────────────────────────────────────────

/**
 * A value as the read side sees it: object keys sorted, and a key whose value
 * is `undefined` or `null` dropped — GROQ projects an absent field as `null`,
 * and `effects.roles[i].role` carries all five seat keys as own properties
 * (possibly `undefined`), so "absent" has three spellings that all mean the
 * same stored state. Array order and every item (its `_key` included) count.
 * Builds new values; never mutates its argument.
 */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      out[key] = comparable(v);
    }
    return out;
  }
  return value;
}

function withoutRev(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  delete copy._rev;
  return copy;
}

/**
 * The state this swap wrote for one role: the row it was loaded with, overlaid
 * with the raw `set` payload the transaction wrote (whole seat arrays for a
 * section or team swap, ruling P3-R17), without `_rev`. A new top-level object;
 * nothing in `effects` is touched.
 */
export function swapWrittenState(effect: RoleSwapRoleEffect): Record<string, unknown> {
  return withoutRev({ ...(effect.role as unknown as Record<string, unknown>), ...effect.set });
}

/** True only when `readBack` equals `written` across every field except `_rev`. */
export function readBackMatchesWrite(written: Record<string, unknown>, readBack: Record<string, unknown>): boolean {
  return JSON.stringify(comparable(written)) === JSON.stringify(comparable(withoutRev(readBack)));
}

// ── Views ───────────────────────────────────────────────────────────────────

const NORMALIZED_KEY: Readonly<Record<SeatPath, keyof NormalizedSeats>> = {
  Lead: "leads",
  BGVs: "bgvs",
  Chorus: "chorus",
  instruments: "instruments",
  foh_team: "foh",
};

/** One seat path of normalized seats, as names («Ana», «Bajo: Luis»). */
function seatNames(seats: NormalizedSeats, path: SeatPath, lookup: MemberNameLookup): string[] {
  const name = (id: string) => memberLabel(audienceMember(id, lookup));
  if (path === "instruments") return seats.instruments.map((slot) => `${slot.instrument}: ${name(slot.personId)}`);
  if (path === "foh_team") return seats.foh.map((slot) => `${slot.role}: ${name(slot.personId)}`);
  return (seats[NORMALIZED_KEY[path]] as string[]).map(name);
}

function hasSeats(seats: NormalizedSeats, path: SeatPath): boolean {
  return (seats[NORMALIZED_KEY[path]] as unknown[]).length > 0;
}

function list(names: readonly string[]): string {
  return names.length ? names.join(", ") : "nadie";
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function roleRecord(role: StoredRole): Record<string, unknown> {
  return role as unknown as Record<string, unknown>;
}

/** The fields every per-service view shares. */
function serviceHeader(row: Record<string, unknown>) {
  const date = storedRoleDate(row);
  const special = isSpecialRoleType(row._type);
  const name = special && typeof row.service_name === "string" ? row.service_name : null;
  return {
    date,
    ...(name !== null ? { name } : {}),
    published: derivePublishState(row.published),
  };
}

// ── Report shapes ───────────────────────────────────────────────────────────

export interface SwapServiceReport {
  serviceId: string;
  date: string | null;
  name?: string;
  published: "published" | "draft";
  /** Per moved path: who sat there before the swap and who sits there now. */
  moved: Partial<Record<SeatPath, { before: string[]; after: string[] }>>;
}

export interface OrphanedSongLeads {
  serviceId: string;
  /** 1-based position of the song in the stored setlist. */
  position: number;
  songId: string | null;
  songTitle: string | null;
  /** The song's leaders who are no longer in the service's Lead. */
  leaders: AudienceMember[];
}

export interface UnavailablePlacement {
  serviceId: string;
  date: string;
  memberId: string;
  name: string | null;
  note?: string;
}

export type FreshRev =
  | { serviceId: string; rev: string }
  | {
      serviceId: string;
      changedAgainAfterSave: true;
      /** The service as read back now; null when the read-back holds no such service. */
      current: {
        date: string | null;
        name?: string;
        published: "published" | "draft";
        seats: Record<SeatPath, string[]>;
      } | null;
    };

const SONG_LEADS_ISSUE = /^songs\[(\d+)\]\.leadIds$/;

export const SONG_LEADS_ORPHANED_NOTE = "el próximo guardado del setlist se rechaza hasta corregir los líderes";

export const READ_BACK_FAILED_TEXT =
  "No se pudo releer los servicios después del intercambio; vuelve a leer con get_service antes de otra escritura.";

const AVAILABILITY_UNKNOWN_TEXT =
  "No se pudo comprobar la disponibilidad de las personas que entraron (el intercambio sí se guardó).";

interface OrphanCandidate {
  effect: RoleSwapRoleEffect;
  index: number;
  songId: string | null;
  leaderIds: string[];
}

/** Every stored song of a worship night whose leaders `validateSongLeads` refuses against the new Lead. */
function orphanCandidates(effects: RoleSwapEffects): OrphanCandidate[] {
  const out: OrphanCandidate[] = [];
  for (const effect of effects.roles) {
    if (!isWorshipNight(effect.role)) continue;
    const songs = Array.isArray(effect.role.songs) ? effect.role.songs : [];
    const lead = new Set(effect.seatStates.after.leads);
    const verdict = validateSongLeads(
      songs.map((song) => ({ leadIds: songItemLeadIds(song) })),
      { worshipNight: true, leadIds: lead },
    );
    if (verdict.ok) continue;
    for (const issue of verdict.issues) {
      const match = SONG_LEADS_ISSUE.exec(issue);
      if (!match) continue;
      const index = Number(match[1]);
      const song = songs[index] as { song?: { _ref?: unknown } } | undefined;
      const songId = typeof song?.song?._ref === "string" ? song.song._ref : null;
      out.push({ effect, index, songId, leaderIds: songItemLeadIds(song).filter((id) => !lead.has(id)) });
    }
  }
  return out;
}

// ── The tool ────────────────────────────────────────────────────────────────

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function swapAssignmentResult(args: SwapAssignmentArgs): Promise<CallToolResult> {
  return runWriteTool("swap_assignment", async ({ callDomain }) => {
    const shape = inputRefusal(args);
    if (shape) return shape;

    const serviceIds = args.services.map((service) => service.serviceId);
    const admission = await loadSwapAdmission(serviceIds);
    if (!admission.ok) return admissionResult(admission.refusal);

    const outcome = await callDomain(() => swapRoles(swapAssignmentBody(args)));
    if (!outcome.ok) return refusalFor(outcome);

    return swapReport(args, outcome.effects);
  });
}

/** The success report — every read in it is a post-commit report read, caught locally. */
async function swapReport(args: SwapAssignmentArgs, effects: RoleSwapEffects): Promise<CallToolResult> {
  const ids = effects.roles.map((effect) => effect.role._id);

  // freshRevs' read-back.
  const readBack = await safeReportRead("swap read-back", () => loadCanonicalRolesByIds(ids));
  const readBackById = new Map<string, Record<string, unknown>[]>();
  if (readBack.ok) {
    for (const row of readBack.value) {
      const record = roleRecord(row);
      readBackById.set(row._id, [...(readBackById.get(row._id) ?? []), record]);
    }
  }
  const changed = new Map<string, Record<string, unknown> | null>();
  const fresh = new Map<string, string>();
  if (readBack.ok) {
    for (const effect of effects.roles) {
      const rows = readBackById.get(effect.role._id) ?? [];
      const row = rows.length === 1 ? rows[0] : null;
      if (row && typeof row._rev === "string" && row._rev && readBackMatchesWrite(swapWrittenState(effect), row)) {
        fresh.set(effect.role._id, row._rev);
      } else {
        changed.set(effect.role._id, row);
      }
    }
  }

  const orphans = orphanCandidates(effects);

  // ONE member read: names for every seat, audience and leader, and the
  // `unavailableDates` behind `unavailablePlaced`.
  const memberIds = new Set<string>();
  for (const effect of effects.roles) {
    for (const id of seatAssignees(effect.seatStates.before)) memberIds.add(id);
    for (const id of seatAssignees(effect.seatStates.after)) memberIds.add(id);
  }
  for (const orphan of orphans) for (const id of orphan.leaderIds) memberIds.add(id);
  for (const row of changed.values()) if (row) for (const id of seatAssignees(normalizeStoredSeats(row))) memberIds.add(id);
  const lookup = await safeMemberLookup([...memberIds]);

  const notifications = await resolveNotifications(swapNotifications(effects), lookup.byId);
  const sweepNote = effects.roles.some((effect) => effect.notice) ? OUTBOX_SWEEP_NOTE : null;

  // Song titles, only when there is an orphaned leader to name.
  const songIds = [...new Set(orphans.map((o) => o.songId).filter((id): id is string => !!id))];
  const titles = songIds.length ? await safeReportRead("song titles", () => loadSongTitles(songIds)) : null;
  const titleOf = (id: string | null) =>
    id && titles?.ok && titles.value.ok ? (titles.value.byId.get(id)?.title ?? null) : null;

  // ── Per service ────────────────────────────────────────────────────────
  const paths: SeatPath[] = args.kind === "section" && args.path ? [args.path] : [...SEAT_PATHS];
  const services: SwapServiceReport[] = effects.roles.map((effect) => {
    const moved: SwapServiceReport["moved"] = {};
    for (const path of paths) {
      const { before, after } = effect.seatStates;
      if (args.kind === "team" && !hasSeats(before, path) && !hasSeats(after, path)) continue;
      moved[path] = { before: seatNames(before, path, lookup), after: seatNames(after, path, lookup) };
    }
    return { serviceId: effect.role._id, ...serviceHeader(roleRecord(effect.role)), moved };
  });

  const songLeadsOrphaned: OrphanedSongLeads[] = orphans.map((orphan) => ({
    serviceId: orphan.effect.role._id,
    position: orphan.index + 1,
    songId: orphan.songId,
    songTitle: titleOf(orphan.songId),
    leaders: orphan.leaderIds.map((id) => audienceMember(id, lookup)),
  }));

  let unavailablePlaced: UnavailablePlacement[] | null = null;
  if (lookup.ok) {
    unavailablePlaced = [];
    for (const effect of effects.roles) {
      const date = storedRoleDate(roleRecord(effect.role));
      if (!date) continue;
      const before = new Set(seatAssignees(effect.seatStates.before));
      const placed = seatAssignees(effect.seatStates.after).filter((id) => !before.has(id));
      const members = placed
        .map((id) => lookup.byId.get(id))
        .filter((member): member is Readonly<CanonicalMember> => !!member);
      for (const conflict of computeAvailabilityConflicts(members as CanonicalMember[], date)) {
        unavailablePlaced.push({
          serviceId: effect.role._id,
          date,
          memberId: conflict.memberId,
          name: conflict.memberName || null,
          ...(conflict.note ? { note: conflict.note } : {}),
        });
      }
    }
  }

  const freshRevs: FreshRev[] | null = readBack.ok
    ? effects.roles.map((effect): FreshRev => {
        const id = effect.role._id;
        const rev = fresh.get(id);
        if (rev) return { serviceId: id, rev };
        const row = changed.get(id) ?? null;
        if (!row) return { serviceId: id, changedAgainAfterSave: true, current: null };
        const seats = normalizeStoredSeats(row);
        const current = {
          ...serviceHeader(row),
          seats: Object.fromEntries(SEAT_PATHS.map((path) => [path, seatNames(seats, path, lookup)])) as Record<
            SeatPath,
            string[]
          >,
        };
        return { serviceId: id, changedAgainAfterSave: true, current };
      })
    : null;

  // ── Text ───────────────────────────────────────────────────────────────
  const labelOf = new Map(effects.roles.map((effect) => [effect.role._id, swapServiceLabel(effect.role)]));
  const labels = effects.roles.map((effect) => labelOf.get(effect.role._id) as string);
  const what =
    args.kind === "section" && args.path ? `la sección ${SWAP_PATH_LABEL[args.path]}` : "el equipo completo";
  const lines: string[] = [
    `Intercambio hecho: ${what} entre ${labels.join(" y ")}. /, /schedule, /me y las páginas de canciones se actualizan.`,
  ];
  for (const service of services) {
    const Label = capitalize(labelOf.get(service.serviceId) as string);
    for (const path of Object.keys(service.moved) as SeatPath[]) {
      const move = service.moved[path] as { before: string[]; after: string[] };
      lines.push(`${Label}, ${SWAP_PATH_LABEL[path]}: antes ${list(move.before)}; ahora ${list(move.after)}.`);
    }
  }
  lines.push(...notifications.map((n) => n.summary));
  if (sweepNote) lines.push(sweepNote);

  for (const orphan of songLeadsOrphaned) {
    const Label = capitalize(labelOf.get(orphan.serviceId) as string);
    const song = orphan.songTitle ? `«${orphan.songTitle}»` : `la canción ${orphan.position}`;
    const who = orphan.leaders.map(memberLabel).join(" y ");
    const plural = orphan.leaders.length > 1;
    lines.push(
      `${Label}: ${song} todavía nombra como ${plural ? "líderes" : "líder"} a ${who}, que ya no ${plural ? "están" : "está"} en Lead; ${SONG_LEADS_ORPHANED_NOTE}.`,
    );
  }

  if (unavailablePlaced === null) {
    lines.push(AVAILABILITY_UNKNOWN_TEXT);
  } else {
    for (const placed of unavailablePlaced) {
      const who = memberLabel(audienceMember(placed.memberId, lookup));
      const note = placed.note ? ` («${placed.note}»)` : "";
      lines.push(
        `Atención: ${who} quedó en ${labelOf.get(placed.serviceId)}, pero marcó ese día como no disponible${note}.`,
      );
    }
  }

  if (freshRevs === null) {
    lines.push(READ_BACK_FAILED_TEXT);
  } else {
    for (const entry of freshRevs) {
      if ("changedAgainAfterSave" in entry) {
        lines.push(
          `${capitalize(labelOf.get(entry.serviceId) as string)} cambió otra vez después del intercambio; vuelve a leer con get_service antes de otra escritura.`,
        );
      }
    }
    const freshOnes = freshRevs.filter((entry) => "rev" in entry);
    if (freshOnes.length === freshRevs.length) {
      lines.push("Las revisiones nuevas de los dos servicios van en freshRevs, para la próxima escritura.");
    } else if (freshOnes.length === 1) {
      // Every label starts «el …»: «de el» contracts to «del».
      const label = labelOf.get(freshOnes[0].serviceId) as string;
      const ofLabel = label.startsWith("el ") ? `del ${label.slice(3)}` : `de ${label}`;
      lines.push(`La revisión nueva ${ofLabel} va en freshRevs, para la próxima escritura.`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      ok: true,
      kind: args.kind,
      ...(args.kind === "section" && args.path ? { path: args.path } : {}),
      services,
      notifications,
      ...(sweepNote ? { sweepNote } : {}),
      songLeadsOrphaned,
      unavailablePlaced,
      freshRevs,
    },
  };
}

/** Registers `swap_assignment` on a per-request MCP server. */
export function registerSwapAssignment(server: McpServer): void {
  server.registerTool(
    "swap_assignment",
    {
      title: "Intercambiar una sección o el equipo entre dos servicios",
      description: SWAP_ASSIGNMENT_DESCRIPTION,
      inputSchema: SWAP_ASSIGNMENT_INPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => swapAssignmentResult(args),
  );
}
