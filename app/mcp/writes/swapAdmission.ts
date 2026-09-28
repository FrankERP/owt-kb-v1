// app/mcp/writes/swapAdmission.ts — `swap_assignment`'s admission (P3 step 10;
// plan § «Admin surface gates», rows S1–S4).
//
// WHY THE TOOL ADMITS AT ALL. `/admin`'s stored planner swaps only two services
// of the month it has open, and only two whose admission is `approved`: no
// duplicate weekend target, no duplicate special identity, no raw draft at the
// target, no dangling assignment anywhere on the role, a valid weekend lock,
// and a special that has a name (`storedRoleReadModel.ts`'s
// `joinStoredRoleInventory`; `MonthGenerator`). `POST /api/admin/roles/swap`
// repeats none of those checks. I15 says the tool refuses AT LEAST what its
// admin counterpart refuses, and the counterpart is the screen (D13), so the
// tool admits the same way before it calls the domain.
//
// FROM WHAT THE SERVER ALREADY ASSEMBLES — never from the planner's own client
// read model (`storedRoleReadModel.ts` is not imported): P1's catalogue snapshot
// (`loadServiceSnapshot`, the same load `get_service` reads) run through
// `assembleService`, plus `loadTargetOccupancy`, the unpublish writer's own
// occupancy check. This module imports no Sanity client: those two loaders do
// the reading.
//
// ONLY THE ROLE-SCOPED FACTS. `publishVerdict`'s full `hard` list would also
// refuse on setlist, proposal and availability problems, which the planner's
// swap admission never considers, so it would refuse swaps `/admin` allows.
//
// ORDER (one deliberate deviation from the brief's numbering): the source gate
// (S4) runs FIRST. A failed `roles` read leaves `rolesById` empty, and
// `assembleService` then answers `null` for every id — a dead catalogue read
// must never read as "that service does not exist". After it, per service in
// request order: existence, the record, the role target (S2a/S2c), dangling
// references (S2d), the weekend lock (S2g), a special's name (S2f); then the
// same-month rule across the pair (S1), which needs no read; and only then the
// two occupancy reads (S2a/S2b/S2c), so a pair already refused costs nothing
// more.
//
// Every refusal here is made BEFORE the domain is called: nothing has been
// written, and the tool's text ends with «No se escribió nada.»
// (`admissionRefusal`). S2g in particular: `/admin`'s route, given a legacy
// weekend role with no lock, COMMITS a maintenance bootstrap and then answers
// `bootstrap_completed_reload`; this admission refuses that role first, so the
// tool never reaches the bootstrap unless the lock disappears between this read
// and the domain's own.
//
// Service text never carries an id — a service is named by kind, date and
// (for a special) name; ids travel in `structuredContent`.

import type { ServiceErrorCode } from "@/app/utils/serviceMutation";
import { assembleService, type AssembledService } from "@/app/utils/publishReadyBundle";
import {
  CONTROL_REQUIRED_SOURCES,
  type ServiceSourceKey,
  type ServiceSourceStates,
} from "@/app/components/admin/serviceReadiness";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { isSpecialRoleType, storedRoleDate } from "@/app/utils/roleWriteRequest";
import type { RoleType } from "@/app/utils/serviceReadModel";
import { loadTargetOccupancy, type TargetOccupancy } from "@/app/utils/roleWriteOps";
import { loadServiceSnapshot, type SnapshotRow } from "../reads/serviceSnapshot";
import { serviceKindOf } from "../reads/servicePresenter";

// ── Shapes ──────────────────────────────────────────────────────────────────

/** One of the two services, as the snapshot knows it. */
export interface SwapCandidate {
  serviceId: string;
  /** The canonical role row the snapshot read, or null when it holds none. */
  row: SnapshotRow | null;
  /** `assembleService(snapshot.readiness, serviceId)`. */
  assembled: AssembledService | null;
}

/** A service that passed the readiness gates, with what the occupancy read needs. */
export interface AdmittedService {
  serviceId: string;
  roleType: RoleType;
  special: boolean;
  /** The stored `YYYY-MM-DD` day string (`week` or `date`). */
  date: string;
  serviceName: string | null;
  /** The Spanish name the texts use: «el domingo 2026-10-04», «el especial «Retiro» del …». */
  label: string;
}

/**
 * A refusal the admission makes. `not_found` is kept apart so the tool renders
 * it through `refusalFor` with the route's own 404 wording (one wording for a
 * missing service, whoever meets it first).
 */
export type SwapAdmissionRefusal =
  | { kind: "not_found"; serviceId: string }
  | { kind: "gate"; code: ServiceErrorCode; detail: string; text: string; serviceId?: string };

export type SwapAdmissionStage<T> = { ok: true; value: T } | { ok: false; refusal: SwapAdmissionRefusal };

// ── Copy ────────────────────────────────────────────────────────────────────

/** S4's text, as the brief fixes it. */
export const SWAP_SOURCES_UNREADY_TEXT = "No se pudo comprobar el estado de los servicios; vuelve a intentar.";

/** Where every admission refusal points the admin. */
const ADMIN_SERVICES = "/admin → Servicios";

/** A weekend lock issue kind, in words (`roleTargetLock.ts`'s vocabulary). */
const LOCK_ISSUE_COPY: Readonly<Record<string, string>> = {
  malformed_lock: "su dato de coordinación del fin de semana está mal formado",
  id_mismatch: "su dato de coordinación del fin de semana no está en el documento que le corresponde",
  claimed_without_role: "su dato de coordinación del fin de semana no indica a qué servicio pertenece",
  vacant_with_role: "su dato de coordinación del fin de semana está libre pero todavía nombra un servicio",
  wrong_owner: "su dato de coordinación del fin de semana pertenece a otro servicio",
  orphan_lock: "su dato de coordinación del fin de semana pertenece a un servicio que ya no existe",
};

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * «el domingo 2026-10-04», «el sábado 2026-10-03», «el especial «Retiro» del
 * 2026-10-10». Built from `serviceKindOf`, never from a type literal (I2).
 */
export function swapServiceLabel(
  row: { _type?: unknown; week?: unknown; date?: unknown; service_name?: unknown } | null,
): string {
  if (!row) return "el servicio";
  const date = storedRoleDate(row) ?? "sin fecha";
  const kind = serviceKindOf(row._type);
  if (kind === "special") {
    const name = stringOrNull(row.service_name)?.trim();
    return name ? `el especial «${name}» del ${date}` : `el especial sin nombre del ${date}`;
  }
  if (kind === "saturday") return `el sábado ${date}`;
  if (kind === "sunday") return `el domingo ${date}`;
  return `el servicio del ${date}`;
}

function gate(
  code: ServiceErrorCode,
  detail: string,
  text: string,
  serviceId?: string,
): { ok: false; refusal: SwapAdmissionRefusal } {
  return { ok: false, refusal: { kind: "gate", code, detail, text, ...(serviceId ? { serviceId } : {}) } };
}

/** The first lock issue's kind, from `lockIssuesToIntegrity`'s `reason` (`"kind"` or `"kind: detail"`). */
function lockIssueKind(reason: string | undefined): string {
  const kind = (reason ?? "").split(":")[0]?.trim();
  return kind || "lock";
}

// ── Stage 1: the snapshot (pure) ────────────────────────────────────────────

/**
 * Admits the pair on everything the snapshot already knows: the sources the
 * planner's swap control needs (S4), each service's existence, record, role
 * target, dangling references, weekend lock and special name (S2a, S2c, S2d,
 * S2f, S2g), and the same-month rule across the two (S1). Pure.
 */
export function admitSwapServices(
  sources: ServiceSourceStates,
  candidates: readonly SwapCandidate[],
): SwapAdmissionStage<AdmittedService[]> {
  // S4 — first, so a failed catalogue read never reads as a missing service.
  const unready: ServiceSourceKey[] = CONTROL_REQUIRED_SOURCES.swap.filter((key) => sources[key] !== "ready");
  if (unready.length) {
    return gate("integrity_conflict", `sources:${unready.join(",")}`, SWAP_SOURCES_UNREADY_TEXT);
  }

  const admitted: AdmittedService[] = [];
  for (const candidate of candidates) {
    const { serviceId, row, assembled } = candidate;
    if (!assembled) return { ok: false, refusal: { kind: "not_found", serviceId } };

    const label = swapServiceLabel(row);
    const Label = capitalize(label);
    const readiness = assembled.readiness;

    if (readiness.recordStatus !== "valid" || !assembled.observation) {
      return gate(
        "integrity_conflict",
        "invalid_record",
        `${Label}: el registro del servicio está mal formado, y ${ADMIN_SERVICES} tampoco lo deja intercambiar; revísalo ahí o en Studio.`,
        serviceId,
      );
    }

    switch (readiness.roleTargetStatus) {
      case "single":
        break;
      case "duplicate":
        // S2a: two canonical roles on one weekend target.
        return gate(
          "ambiguous_target",
          "duplicate_weekend_target",
          `${Label}: hay más de un servicio guardado en ese mismo fin de semana, y ${ADMIN_SERVICES} no lo deja intercambiar; corrige el duplicado primero.`,
          serviceId,
        );
      case "draft_conflict":
        // S2c: a raw draft of a canonical id at the target.
        return gate(
          "integrity_conflict",
          "raw_draft",
          `${Label}: hay un borrador de Studio sobre ese servicio, y ${ADMIN_SERVICES} no lo deja intercambiar; descártalo o publícalo en Studio y vuelve a leer.`,
          serviceId,
        );
      default:
        return gate(
          "integrity_conflict",
          `role_target_${readiness.roleTargetStatus}`,
          `${Label}: no se pudo identificar un único documento para ese servicio; revísalo en ${ADMIN_SERVICES}.`,
          serviceId,
        );
    }

    if (readiness.danglingRefCount > 0) {
      // S2d: anywhere on the role, not only in the section being moved.
      return gate(
        "integrity_conflict",
        "dangling_assignment",
        `${Label}: tiene asignada a una persona que ya no existe como miembro, y ${ADMIN_SERVICES} no lo deja intercambiar; corrige esa asignación primero.`,
        serviceId,
      );
    }

    const lockIssue = readiness.integrityIssues.find((issue) => issue.kind === "lock");
    if (lockIssue) {
      // S2g: a missing lock (`missing_lock`) or any other lock problem.
      const kind = lockIssueKind(lockIssue.reason);
      const text =
        kind === "missing_lock"
          ? `${Label} es un servicio antiguo sin su dato de coordinación; guárdalo una vez desde el planner de /admin y vuelve a leer.`
          : `${Label}: ${LOCK_ISSUE_COPY[kind] ?? "su dato de coordinación del fin de semana no es válido"}, y ${ADMIN_SERVICES} no lo deja intercambiar; revísalo ahí.`;
      return gate("integrity_conflict", `lock:${kind}`, text, serviceId);
    }

    const observation = assembled.observation;
    const special = isSpecialRoleType(observation.roleType);
    const serviceName = row ? stringOrNull(row.service_name) : null;
    if (special && !normalizeServiceName(serviceName)) {
      // S2f: a special with no name has no identity for S2b to check.
      return gate(
        "integrity_conflict",
        "invalid_special_name",
        `${Label}: el servicio especial no tiene nombre, así que no tiene identidad propia, y ${ADMIN_SERVICES} no lo deja intercambiar; ponle nombre primero.`,
        serviceId,
      );
    }

    const date = row ? storedRoleDate(row) : null;
    if (!date) {
      return gate(
        "integrity_conflict",
        "date",
        `${Label}: el servicio no tiene una fecha válida; revísalo en ${ADMIN_SERVICES}.`,
        serviceId,
      );
    }

    admitted.push({ serviceId, roleType: observation.roleType, special, date, serviceName, label });
  }

  // S1 — the planner shows and swaps only the services of the month it has
  // open: the stored day strings' `YYYY-MM`, never a `Date`.
  const months = [...new Set(admitted.map((service) => service.date.slice(0, 7)))];
  if (months.length > 1) {
    return gate(
      "invalid_request",
      "cross_month",
      `Los dos servicios están en meses distintos (${months.join(" y ")}); el planner de ${ADMIN_SERVICES} solo intercambia servicios del mismo mes.`,
    );
  }

  return { ok: true, value: admitted };
}

// ── Stage 2: the occupancy reads (pure over their results) ──────────────────

/**
 * Admits each service on its target's occupancy: no other canonical role at the
 * target (S2a; S2b for a special, matched by normalized name) and no raw draft
 * there (S2c). `occupancies[i]` belongs to `services[i]`. Pure.
 */
export function admitSwapOccupancy(
  services: readonly AdmittedService[],
  occupancies: readonly TargetOccupancy[],
): SwapAdmissionStage<AdmittedService[]> {
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    const occupancy = occupancies[i];
    if (!occupancy) throw new Error("swap admission: an occupancy result is missing");
    const Label = capitalize(service.label);
    if (occupancy.canonicalRoleIds.length) {
      return service.special
        ? gate(
            "ambiguous_target",
            "duplicate_special_identity",
            `${Label}: hay otro servicio especial ese mismo día con el mismo nombre, y ${ADMIN_SERVICES} no lo deja intercambiar; cámbiale el nombre a uno de los dos primero.`,
            service.serviceId,
          )
        : gate(
            "ambiguous_target",
            "duplicate_weekend_target",
            `${Label}: hay más de un servicio guardado en ese mismo fin de semana, y ${ADMIN_SERVICES} no lo deja intercambiar; corrige el duplicado primero.`,
            service.serviceId,
          );
    }
    if (occupancy.rawDraftIds.length) {
      return gate(
        "integrity_conflict",
        "raw_draft",
        `${Label}: hay un borrador de Studio en ese mismo lugar del calendario, y ${ADMIN_SERVICES} no lo deja intercambiar; descártalo o publícalo en Studio y vuelve a leer.`,
        service.serviceId,
      );
    }
  }
  return { ok: true, value: [...services] };
}

// ── The thin loader ─────────────────────────────────────────────────────────

/**
 * Reads what the admission needs — the catalogue snapshot, then (only for a
 * pair that passed stage 1) each target's occupancy — and runs both stages. A
 * throw from a read propagates: the tool is still in its `pre` phase, so the
 * runner reports «No se pudo preparar el cambio… No se escribió nada.».
 */
export async function loadSwapAdmission(serviceIds: readonly string[]): Promise<SwapAdmissionStage<AdmittedService[]>> {
  const snapshot = await loadServiceSnapshot();
  const stage1 = admitSwapServices(
    snapshot.readiness.sources,
    serviceIds.map((serviceId) => ({
      serviceId,
      row: snapshot.readiness.rolesById.get(serviceId) ?? null,
      assembled: assembleService(snapshot.readiness, serviceId),
    })),
  );
  if (!stage1.ok) return stage1;

  const occupancies = await Promise.all(
    stage1.value.map((service) =>
      loadTargetOccupancy({
        roleType: service.roleType,
        date: service.date,
        serviceName: service.serviceName,
        excludeRoleId: service.serviceId,
      }),
    ),
  );
  return admitSwapOccupancy(stage1.value, occupancies);
}
