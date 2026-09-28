// app/mcp/writes/reports.ts — what an MCP write says it QUEUED (P3 step 7, spec
// I9). Every entry is built from the step-2 descriptors the `*Commit` modules
// return in `effects` — the values the side-effect helpers themselves used,
// captured pre-commit — never from a second derivation of the audience.
//
//   notifications: [{ channel: "push" | "email" | "outbox_email", title,
//                     status, audience: [{ memberId, name }], when, conditions }]
//
// HONEST WORDING. A descriptor is never a delivery claim: pushes start
// fire-and-forget or inside `after()`, outbox notices are sent (or not) by a
// later sweep, and every downstream filter still applies. So an entry is
// «encolada» or «no encolada», never «enviada» or «entregada», and
// `conditions` names the filters that can still drop a member. Ruling P3-R12:
// an EMPTY recipient list means the helper ran and notified nobody (rendered
// «nadie»); a `null` descriptor means nothing was queued — the helper skipped
// or swallowed a failure before it registered anything — and is rendered as
// «no se encoló», never dropped and never given an invented audience.
//
// NAMES come from P1's `loadMemberNames` (a canonical read), through
// `safeReportRead`: a post-commit report read that fails degrades the names to
// «unresolved» and never turns the committed write into an error. An id whose
// name cannot be read is reported as unresolved, and one with no member
// document as missing; neither is ever dropped.
//
// THE PUBLISH EMAIL has no recipient list of its own: `sendAssignmentEmailsBatch`
// derives it at send time from the service bodies it is handed. The report runs
// that same derivation over the `emailBatch` descriptor — `assigneesOf(body)`,
// kept where `rolesForMember(id, body)` is non-empty — and labels the result as
// exactly that («candidatos según el envío por lotes»).
// `publishEmailCandidates.test.ts` pins it equal to the ids the batch then
// queries members with.
//
// WHEN. Three values only:
//   - «tras la respuesta»: every push, and the publish email batch. The
//     assignment pushes and the batch run inside `after()`. The setlist push
//     (`notifySetlistSaved`) is started fire-and-forget during the handler and
//     never awaited; it fits none of the three exactly, and "after the
//     response" is the closest honest reading of when a member receives it.
//   - «inmediato (ADR-0037)»: the publish-time «Setlist listo» outbox notice,
//     queued with `debounceMs: 0` and flushed by the sweep in the same `after()`.
//   - «tras la ventana de agrupación (NOTIFY_DEBOUNCE_MINUTES)»: every other
//     outbox notice (role and setlist edits).
//
// Neutral apart from `loadMemberNames`, whose module is `server-only`. The
// `*Commit` imports are TYPE-ONLY: this module calls no writer
// (`serviceCommitCallers.test.ts` counts value imports only).

import { assigneesOf, rolesForMember, type ServiceBody } from "@/app/utils/assignmentEmail";
import { storedRoleDate } from "@/app/utils/roleWriteRequest";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";
import type { RolePublishedDescriptor } from "@/app/utils/serviceMutationSideEffects";
import type { SetlistSaveEffects } from "@/app/utils/setlistSaveCommit";
import type { RoleSwapEffects } from "@/app/utils/roleSwapCommit";
import type { PublishReadyEffects } from "@/app/utils/publishReadyCommit";
import { loadMemberNames, type MemberNameLookup } from "../reads/serviceSnapshot";
import { safeReportRead } from "./runWriteTool";

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type NotificationChannel = "push" | "email" | "outbox_email";

export const WHEN_AFTER_RESPONSE = "tras la respuesta";
export const WHEN_IMMEDIATE = "inmediato (ADR-0037)";
export const WHEN_DEBOUNCED = "tras la ventana de agrupación (NOTIFY_DEBOUNCE_MINUTES)";
export type NotificationWhen = typeof WHEN_AFTER_RESPONSE | typeof WHEN_IMMEDIATE | typeof WHEN_DEBOUNCED;

/** «encolada» — never «enviada» or «entregada». */
export type NotificationStatus = "encolada" | "no encolada";

/** The label the publish email's audience carries: it is the batch's own derivation. */
export const PUBLISH_EMAIL_AUDIENCE_NOTE = "candidatos según el envío por lotes";

/**
 * Any write that queues an outbox notice also runs the derated layer-2 sweep in
 * the same `after()` block, which can deliver OTHER services' already-due
 * notices to their own recipients — exactly as the same `/admin` write does.
 */
export const OUTBOX_SWEEP_NOTE =
  "Encolar un correo agrupado también ejecuta el barrido del buzón, que puede enviar otros avisos ya vencidos de otros servicios, igual que la misma acción en /admin.";

const PUSH_TITLE_SETLIST = "Setlist de la semana";
const PUSH_TITLE_UPDATED = "Servicio actualizado";
const PUSH_TITLE_CREATED = "Nuevo servicio asignado";
const EMAIL_TITLE_ASSIGNMENT = "Asignación (correo consolidado)";
const OUTBOX_TITLE_ROLE = "Cambio en el servicio (correo agrupado)";
const OUTBOX_TITLE_SETLIST = "Cambio de setlist (correo agrupado)";
const OUTBOX_TITLE_SETLIST_READY = "Setlist listo";

function pushConditions(preference: string): string[] {
  return [
    "solo miembros con un dispositivo registrado (deviceTokens)",
    `respeta la preferencia de push «${preference}» de cada miembro`,
  ];
}

const EMAIL_BATCH_CONDITIONS: readonly string[] = [
  "solo miembros con correo registrado",
  "solo direcciones permitidas por EMAIL_ALLOWLIST",
  "respeta la preferencia de correo «asignado» de cada miembro (wantsNotification)",
  "si EMAIL_REDIRECT_TO está definida, todo se redirige a esa dirección",
];

function outboxConditions(extra: string[] = []): string[] {
  return [
    ...extra,
    "los destinatarios finales se resuelven al enviar, no ahora",
    "solo direcciones permitidas por EMAIL_ALLOWLIST",
    "respeta la preferencia de correo por tipo de cada miembro (wantsNotification)",
    "si EMAIL_REDIRECT_TO está definida, todo se redirige a esa dirección",
  ];
}

// ── Shapes ──────────────────────────────────────────────────────────────────

/** One member an entry names. `name` is null when it could not be read or the member is gone. */
export interface AudienceMember {
  memberId: string;
  name: string | null;
  /** The member read failed: the name is UNKNOWN, which is not the same as missing. */
  unresolved?: true;
  /** No member document has this id. */
  missing?: true;
}

interface NotificationFields {
  channel: NotificationChannel;
  title: string;
  status: NotificationStatus;
  when: NotificationWhen;
  conditions: string[];
  /** The service day this entry is about (`YYYY-MM-DD`), when it is about one service. */
  date?: string;
  /** Who the audience is, when it is not simply "these members". */
  audienceNote?: string;
  /** Why nothing was queued, or what still decides whether it is. */
  note?: string;
}

/** An entry before names are read: member ids only. */
export interface PendingNotification extends NotificationFields {
  memberIds: string[];
}

/** An entry as a tool reports it. */
export interface NotificationReport extends NotificationFields {
  audience: AudienceMember[];
  /** One Spanish sentence for the tool's text content. */
  summary: string;
}

const NOT_QUEUED_NOTE =
  "No se encoló: el servicio no tenía nada que avisar por este canal, o el aviso falló antes de encolarse.";

// ── Builders, one per writer (pure) ─────────────────────────────────────────

/**
 * The publish email's audience: `sendAssignmentEmailsBatch`'s own derivation,
 * run over the descriptor's copy of its argument — per service, each distinct
 * `assigneesOf(body)` id with a non-empty `rolesForMember(id, body)`, in the
 * batch's first-seen order. These are the ids the batch then reads members for;
 * the address, allowlist and preference filters apply after that.
 */
export function publishEmailCandidates(batch: RolePublishedDescriptor["emailBatch"]): string[] {
  const candidates = new Set<string>();
  for (const service of batch) {
    const body: ServiceBody = service.body;
    for (const id of new Set(assigneesOf(body))) {
      if (!rolesForMember(id, body).length) continue;
      candidates.add(id);
    }
  }
  return [...candidates];
}

/**
 * `saveSetlist`'s notifications. A draft service or a role-less week queues
 * nothing and returns `[]`: the tool says «ninguna» and why, since it knows
 * which of the two it is (`effects.subject`).
 */
export function setlistSaveNotifications(effects: SetlistSaveEffects): PendingNotification[] {
  const subject = effects.subject;
  if (!subject || subject.published === false) return [];
  const out: PendingNotification[] = [];

  out.push(
    effects.push
      ? {
          channel: "push",
          title: PUSH_TITLE_SETLIST,
          status: "encolada",
          memberIds: [...effects.push.recipients],
          when: WHEN_AFTER_RESPONSE,
          date: effects.week,
          audienceNote:
            "miembros del equipo de alabanza con preferencia de setlist «todos», más los asignados a un servicio publicado esa semana",
          conditions: pushConditions("setlist"),
        }
      : {
          channel: "push",
          title: PUSH_TITLE_SETLIST,
          status: "no encolada",
          memberIds: [],
          when: WHEN_AFTER_RESPONSE,
          date: effects.week,
          note: NOT_QUEUED_NOTE,
          conditions: pushConditions("setlist"),
        },
  );

  out.push(
    effects.notice
      ? {
          channel: "outbox_email",
          title: OUTBOX_TITLE_SETLIST,
          status: "encolada",
          memberIds: [...effects.notice.knownRecipients],
          when: WHEN_DEBOUNCED,
          date: effects.week,
          audienceNote: "participantes del servicio ofrecidos al aviso",
          conditions: outboxConditions(["solo mientras el servicio siga publicado"]),
        }
      : {
          channel: "outbox_email",
          title: OUTBOX_TITLE_SETLIST,
          status: "no encolada",
          memberIds: [],
          when: WHEN_DEBOUNCED,
          date: effects.week,
          note: effects.songs.length === 0 ? "No se encoló: el setlist quedó sin canciones." : NOT_QUEUED_NOTE,
          conditions: outboxConditions(),
        },
  );
  return out;
}

/**
 * `swapRoles`' notifications: one push per destination role with added members
 * (published roles only — the helper drops the rest), and one outbox notice per
 * role to the union of its before and after assignees. Reads `effects` and
 * never writes to it (its nested seat objects are shared, ruling P3-R16).
 */
export function swapNotifications(effects: RoleSwapEffects): PendingNotification[] {
  const out: PendingNotification[] = [];
  if (effects.push.pushes.length === 0) {
    out.push({
      channel: "push",
      title: PUSH_TITLE_UPDATED,
      status: "encolada",
      memberIds: [],
      when: WHEN_AFTER_RESPONSE,
      note: "Ningún servicio publicado ganó miembros nuevos.",
      conditions: pushConditions("asignaciones"),
    });
  }
  for (const push of effects.push.pushes) {
    out.push({
      channel: "push",
      title: push.kind === "created" ? PUSH_TITLE_CREATED : PUSH_TITLE_UPDATED,
      status: "encolada",
      memberIds: [...push.recipients],
      when: WHEN_AFTER_RESPONSE,
      date: push.date,
      audienceNote: "miembros añadidos a este servicio",
      conditions: pushConditions("asignaciones"),
    });
  }
  for (const role of effects.roles) {
    const date = storedRoleDate(role.role) ?? undefined;
    out.push(
      role.notice
        ? {
            channel: "outbox_email",
            title: OUTBOX_TITLE_ROLE,
            status: "encolada",
            memberIds: [...role.notice.memberIds],
            when: WHEN_DEBOUNCED,
            ...(date ? { date } : {}),
            audienceNote: "asignados antes y después del cambio",
            conditions: outboxConditions(["un cambio que se deshace dentro de la ventana no envía nada"]),
          }
        : {
            channel: "outbox_email",
            title: OUTBOX_TITLE_ROLE,
            status: "no encolada",
            memberIds: [],
            when: WHEN_DEBOUNCED,
            ...(date ? { date } : {}),
            note:
              role.role.published === false
                ? "No se encoló: el servicio es un borrador."
                : NOT_QUEUED_NOTE,
            conditions: outboxConditions(),
          },
    );
  }
  return out;
}

/**
 * `publishReady`'s notifications: a push per published service to every
 * current assignee, the consolidated assignment email (the batch's own
 * derivation, labelled as such), and «Setlist listo» per service, queued only
 * if the service has songs — decided inside `after()`, so it is stated as a
 * condition. A recovered request queued nothing.
 */
export function publishNotifications(effects: PublishReadyEffects): PendingNotification[] {
  if (effects.recovered) return [];
  const out: PendingNotification[] = [];

  if (!effects.push) {
    // The writer hands the helper only services with an assignee, and the
    // helper returns null — registering nothing — when it gets none.
    const note = "No se encoló: el servicio no tiene a nadie asignado.";
    out.push({
      channel: "push",
      title: PUSH_TITLE_CREATED,
      status: "no encolada",
      memberIds: [],
      when: WHEN_AFTER_RESPONSE,
      note,
      conditions: pushConditions("asignaciones"),
    });
    out.push({
      channel: "email",
      title: EMAIL_TITLE_ASSIGNMENT,
      status: "no encolada",
      memberIds: [],
      when: WHEN_AFTER_RESPONSE,
      note,
      conditions: [...EMAIL_BATCH_CONDITIONS],
    });
  } else {
    for (const push of effects.push.pushes) {
      out.push({
        channel: "push",
        title: PUSH_TITLE_CREATED,
        status: "encolada",
        memberIds: [...push.recipients],
        when: WHEN_AFTER_RESPONSE,
        date: push.date,
        audienceNote: "todos los asignados actuales del servicio",
        conditions: pushConditions("asignaciones"),
      });
    }
    out.push({
      channel: "email",
      title: EMAIL_TITLE_ASSIGNMENT,
      status: "encolada",
      memberIds: publishEmailCandidates(effects.push.emailBatch),
      when: WHEN_AFTER_RESPONSE,
      audienceNote: PUBLISH_EMAIL_AUDIENCE_NOTE,
      conditions: [...EMAIL_BATCH_CONDITIONS],
    });
  }

  if (effects.notice) {
    for (const subject of effects.notice.subjects) {
      const observation = effects.observations.find((o) => o.roleId === subject.roleId);
      out.push({
        channel: "outbox_email",
        title: OUTBOX_TITLE_SETLIST_READY,
        status: "encolada",
        memberIds: [...subject.knownRecipients],
        when: WHEN_IMMEDIATE,
        ...(observation?.serviceDate ? { date: observation.serviceDate } : {}),
        audienceNote: "participantes del servicio ofrecidos al aviso",
        note: "Se encola solo si el servicio tiene canciones; eso se decide al encolar, después de la respuesta.",
        conditions: outboxConditions(),
      });
    }
  } else {
    out.push({
      channel: "outbox_email",
      title: OUTBOX_TITLE_SETLIST_READY,
      status: "no encolada",
      memberIds: [],
      when: WHEN_IMMEDIATE,
      note: NOT_QUEUED_NOTE,
      conditions: outboxConditions(),
    });
  }
  return out;
}

// ── Names (the one post-commit read here) ───────────────────────────────────

/**
 * `loadMemberNames(ids, known)`, caught locally: a throw becomes a lookup with
 * `ok: false` and nothing resolved, so every name reads as unresolved and the
 * committed write stays `ok`. Tools reuse it for any other member facts the
 * canonical projection carries (e.g. `unavailableDates`).
 */
export async function safeMemberLookup(
  ids: readonly string[],
  known: ReadonlyMap<string, Readonly<CanonicalMember>> = new Map(),
): Promise<MemberNameLookup> {
  if (ids.length === 0) return { ok: true, byId: new Map() };
  const read = await safeReportRead("member names", () => loadMemberNames(ids, known));
  return read.ok ? read.value : { ok: false, byId: new Map() };
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** One member as an entry names them: resolved, missing (the read worked), or unresolved (it did not). */
export function audienceMember(memberId: string, lookup: MemberNameLookup): AudienceMember {
  const member = lookup.byId.get(memberId);
  if (member) return { memberId, name: nonEmpty(member.member_name) ?? nonEmpty(member.alias) };
  return lookup.ok ? { memberId, name: null, missing: true } : { memberId, name: null, unresolved: true };
}

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  push: "Push",
  email: "Correo",
  outbox_email: "Correo agrupado",
};

/** A member as a text names them: the name, or the id marked unresolved / missing. */
export function memberLabel(member: AudienceMember): string {
  if (member.name) return member.name;
  if (member.unresolved) return `${member.memberId} (nombre no resuelto)`;
  return `${member.memberId} (miembro inexistente)`;
}

/** The entry as one Spanish sentence: «encolada para …» or «no se encoló», never «enviada». */
export function notificationSummary(entry: NotificationFields & { audience: AudienceMember[] }): string {
  const head = `${CHANNEL_LABEL[entry.channel]} «${entry.title}»${entry.date ? ` (${entry.date})` : ""}`;
  if (entry.status === "no encolada") {
    return `${head}: ${entry.note ?? NOT_QUEUED_NOTE}`;
  }
  const note = entry.note ? ` ${entry.note}` : "";
  // Ruling P3-R12: an empty list means the helper ran and notified nobody.
  if (!entry.audience.length) return `${head}: nadie.${note}`;
  const who = entry.audience.map(memberLabel).join(", ");
  const label = entry.audienceNote ? ` (${entry.audienceNote})` : "";
  return `${head}: encolada para ${who}${label}, ${entry.when}.${note}`;
}

/**
 * Reads every name the entries need in ONE lookup and returns the reports. A
 * failed read leaves every name unresolved; it never throws.
 */
export async function resolveNotifications(
  pending: readonly PendingNotification[],
  known: ReadonlyMap<string, Readonly<CanonicalMember>> = new Map(),
): Promise<NotificationReport[]> {
  const ids = [...new Set(pending.flatMap((entry) => entry.memberIds))];
  const lookup = await safeMemberLookup(ids, known);
  return pending.map(({ memberIds, ...fields }) => {
    const audience = memberIds.map((id) => audienceMember(id, lookup));
    return { ...fields, audience, summary: notificationSummary({ ...fields, audience }) };
  });
}
