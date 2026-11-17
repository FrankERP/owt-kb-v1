import "server-only";

// Sends what a write to a Jóvenes meeting owes by email (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` M5, M6). The four meeting routes
// call `sendMinistryEventNotices` inside `after()`, with the notices the WRITER computed from its
// pre-commit `before` (`ministryEventNotices.ts`); this module re-reads no meeting.
//
// THE AUDIENCE is this file's whole job, and it only ever narrows what the writer named:
//   · «Te toca» goes to the member ids of `assigned`, minus anyone who, read NOW, is not an
//     active member of Jóvenes, has no email, is outside the allowlist, or turned off
//     «Asignaciones» (`wantsNotification`, the one preference resolver). Never a group, never the
//     ministry, never a typed name.
//   · The music request goes to the super-admins who are people (the system accounts are left
//     out), minus the actor, under the «Propuestas» switch — today that is Frank alone.
// The sender is a free Gmail account (~500 recipients a day): nothing here may fan out.
//
// Best-effort: it never throws, and a failed send is logged, never retried — the write already
// answered, and a retry would be a second email to the people the first try did reach.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { appBaseUrl, getAllowlist, isEmailAllowed } from "./assignmentEmail";
import { SEND_CONCURRENCY, sendEmail } from "./email";
import { accessFromDoc, type MemberAccessDoc } from "./memberAccess";
import { isMinistryMember } from "./ministryAccess";
import { buildAssignedEmail, buildMusicEmail, meetingPath } from "./ministryEventEmail";
import { hasNotices, type EventNoticeEffects } from "./ministryEventNotices";
import { wantsNotification } from "./notifyPrefs";

export type { EventNoticeEffects };

type PersonRow = MemberAccessDoc & { email?: unknown; notifPrefs?: unknown; name?: unknown };

/** The people a notice names, by id: recipients and the partners their email mentions. */
export const NOTICE_PEOPLE_QUERY =
  `*[_type == "teamMembers" && !(_id in path("drafts.**")) && _id in $ids]` +
  `{ _id, disabled, role, ministries, managesMinistries, ministryRoles, email, notifPrefs, "name": coalesce(alias, member_name) }`;

/** Whoever arranges the worship team: the super-admins who are people (as the outbox excludes them). */
export const MUSIC_AUDIENCE_QUERY =
  `*[_type == "teamMembers" && !(_id in path("drafts.**")) && role == "super-admin" && disabled != true` +
  ` && !(string::startsWith(_id, "service-account-") || _id == "member-dev-verify")]` +
  `{ _id, disabled, role, ministries, managesMinistries, ministryRoles, email, notifPrefs, "name": coalesce(alias, member_name) }`;

export type PlannedEmail = { memberId: string; email: string; subject: string; html: string };

const emailOf = (p: PersonRow): string | null => (typeof p.email === "string" && p.email.trim() ? p.email.trim().toLowerCase() : null);
const nameOf = (p: PersonRow | undefined): string | null => (p && typeof p.name === "string" && p.name.trim() ? p.name.trim() : null);

/**
 * Pure half: the emails these notices become, given the people read. `people` answers the
 * assigned ids and their partners; `musicAudience` is the answer of `MUSIC_AUDIENCE_QUERY`.
 */
export function planEventEmails(
  effects: EventNoticeEffects,
  people: readonly PersonRow[],
  musicAudience: readonly PersonRow[],
  env: { baseUrl: string; allow: string[] },
): PlannedEmail[] {
  const byId = new Map(people.filter((p) => p && typeof p._id === "string").map((p) => [p._id, p]));
  const link = `${env.baseUrl}${meetingPath(effects.meeting.id)}`;
  const settingsLink = `${env.baseUrl}/me/ajustes`;
  const out: PlannedEmail[] = [];

  for (const a of effects.assigned) {
    // The writer already left the actor out; said again here because this is the audience.
    if (a.memberId === effects.actorId) continue;
    const person = byId.get(a.memberId);
    if (!person) continue;
    const access = accessFromDoc(person);
    if (!access.active || !isMinistryMember(access, effects.ministry)) continue;
    const email = emailOf(person);
    if (!email || !isEmailAllowed(email, env.allow) || !wantsNotification(person.notifPrefs, "assigned")) continue;
    const roles = a.roles.map((r) => ({
      kind: r.kind,
      id: r.id,
      label: r.label,
      partnerNames: r.partners.map((id) => nameOf(byId.get(id))).filter((n): n is string => n !== null),
    }));
    const { subject, html } = buildAssignedEmail({
      name: nameOf(person) ?? "",
      meeting: effects.meeting,
      roles,
      moved: effects.moved,
      link,
      settingsLink,
    });
    out.push({ memberId: a.memberId, email, subject, html });
  }

  for (const m of effects.music) {
    const who = [...m.members.map((id) => nameOf(byId.get(id))).filter((n): n is string => n !== null), ...m.names];
    const { subject, html } = buildMusicEmail({ meeting: effects.meeting, part: m.part, asks: m.asks, note: m.note, who, link, settingsLink });
    for (const person of musicAudience) {
      if (!person || typeof person._id !== "string" || person._id === effects.actorId) continue;
      if (person.role !== "super-admin" || !accessFromDoc(person).active) continue;
      if (person._id.startsWith("service-account-") || person._id === "member-dev-verify") continue;
      const email = emailOf(person);
      if (!email || !isEmailAllowed(email, env.allow) || !wantsNotification(person.notifPrefs, "proposals")) continue;
      out.push({ memberId: person._id, email, subject, html });
    }
  }
  return out;
}

/**
 * Read the people, plan, send. Awaited inside `after()` so the function stays alive until the
 * sends settle; never throws.
 */
export async function sendMinistryEventNotices(effects: EventNoticeEffects | null | undefined): Promise<void> {
  if (!effects || !hasNotices(effects)) return;
  try {
    const ids = [
      ...new Set([
        ...effects.assigned.flatMap((a) => [a.memberId, ...a.roles.flatMap((r) => r.partners)]),
        ...effects.music.flatMap((m) => m.members),
      ]),
    ];
    const [people, musicAudience] = await Promise.all([
      ids.length ? operationalClient.fetch<PersonRow[] | null>(NOTICE_PEOPLE_QUERY, { ids }) : Promise.resolve([]),
      effects.music.length ? operationalClient.fetch<PersonRow[] | null>(MUSIC_AUDIENCE_QUERY) : Promise.resolve([]),
    ]);
    const planned = planEventEmails(effects, people ?? [], musicAudience ?? [], { baseUrl: appBaseUrl(), allow: getAllowlist() });
    // Preview mail goes to one address (docs/SECRETS.md), like every other app email.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    // In waves as wide as the transport's pool (as the outbox sweeps): every email of a wave goes
    // out at once, and none starts its 20 s timeout while still queued behind another. A meeting
    // names nine people at most in practice, so this is one wave, sometimes two.
    const results: PromiseSettledResult<{ ok: boolean; error?: string }>[] = [];
    for (let i = 0; i < planned.length; i += SEND_CONCURRENCY) {
      const wave = planned.slice(i, i + SEND_CONCURRENCY).map((p) =>
        sendEmail({
          to: redirectTo || p.email,
          subject: redirectTo ? `[→ ${p.email}] ${p.subject}` : p.subject,
          html: p.html,
        }),
      );
      results.push(...(await Promise.allSettled(wave)));
    }
    let emailed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.ok) emailed++;
      else {
        const reason = r.status === "fulfilled" ? r.value.error : String(r.reason);
        console.error(JSON.stringify({ event: "ministry_event_notice_failed", member: planned[i].memberId, reason }));
      }
    });
    console.log(JSON.stringify({ event: "ministry_event_notices", planned: planned.length, emailed }));
  } catch (err) {
    console.error(JSON.stringify({ event: "ministry_event_notices_failed" }), err);
  }
}
