import "server-only";

// The reminders of a Jóvenes meeting, two weeks and one week ahead (ADR-0089, addendum of
// 2026-11-17). Frank: «mandar correos de recordatorio 2 semanas antes y una semana antes de cada
// reunión de jóvenes para que vayan llenando las cosas que tienen asignadas».
//
// The daily Vercel cron — `/api/cron/service-reminders`, 01:00 UTC = 19:00 CDMX — is the only
// caller. Each day it reads the meetings dated EXACTLY 14 and 7 days ahead and writes to:
//   · whoever answers for a part that still lacks something (`partGaps`, the same rule the cards
//     use for «pendiente»): one email per person per meeting, naming only what is missing;
//   · whoever coordinates a Saturday meeting (the `encargado` seat) when Oración or a dinámica
//     still has nobody — the encargado is who assigns those, through the program.
// A part that is filled, a free program line and the `apoyo` seat owe nothing and hear nothing.
//
// THE AUDIENCE only narrows, as in `ministryEventNotify.ts`: the meetings are the ones EVERY
// member of Jóvenes reads (`readAnnouncedMeetings`: published and for the whole ministry — the
// same meetings «Te toca» announces), the people are member ids those meetings name, and each
// passes `assignedAddress` read NOW (active member of Jóvenes, an email, the allowlist,
// «Asignaciones» on). Never a group, never the ministry, never a typed name.
//
// Why the daily cron and an exact day, with no «already sent» marker: ADR-0080's reasons, said
// again in the addendum. A day the cron misses is a reminder nobody gets.
//
// `readAnnouncedMeetings` is this module's alone: `ministryEventCoverage.test.ts` fails on any
// other importer, because that read takes no reader and a page calling it would serve meetings
// to someone who is not in Jóvenes.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { appBaseUrl, getAllowlist } from "./assignmentEmail";
import { SEND_CONCURRENCY, SEND_TIMEOUT_MS, sendEmail } from "./email";
import { partGaps, type PartGap } from "./jovenesPartView";
import { buildPartReminderEmail, meetingPath } from "./ministryEventEmail";
import { NOTICE_PEOPLE_QUERY, assignedAddress, nameOf, type PersonRow, type PlannedEmail } from "./ministryEventNotify";
import { readAnnouncedMeetings, type MinistryEventView } from "./ministryEventReads";
import { MEETING_PARTS, PLATICA_SEAT, hasFixedProgram, type PartId } from "./ministryParts";

export const TIMEZONE = "America/Mexico_City";

/** How many days ahead a meeting is reminded about: two weeks and one week. */
export const REMINDER_DAYS = [14, 7] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

/** The seat that coordinates a meeting and assigns Oración and the dinámicas (W3a). */
const COORDINATOR_SEAT = "encargado";

/**
 * No wave of sends may END past this many milliseconds of the route (what the route spent before
 * this step, plus the step's own time, plus one send timeout): the liveness alarm runs next and
 * its email to a person may need a send timeout of its own inside the route's 60 s. What the
 * deadline leaves unsent is logged, never retried. The two Sanity reads have no timeout of their
 * own, like the leads' step's (ADR-0080).
 */
export const REMINDER_STEP_DEADLINE_MS = 35_000;

/** Adds whole days to a `YYYY-MM-DD` calendar date (UTC arithmetic: no DST drift). */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The meeting dates today's run covers (a CDMX calendar day in, exact days out), or none. */
export function reminderDates(todayCdmx: string): Array<{ date: string; days: ReminderDays }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayCdmx)) return [];
  return REMINDER_DAYS.map((days) => ({ date: addDays(todayCdmx, days), days }));
}

/** One person's reminder about one meeting: what of theirs lacks something, and what lacks a person. */
export type MeetingReminder = {
  memberId: string;
  /** Their parts that still lack something. `partners`: the other members on it; `partnerNames`: typed names. */
  fill: Array<{ part: PartId; gaps: PartGap[]; partners: string[]; partnerNames: string[] }>;
  /** The parts with nobody, for who coordinates the meeting. */
  assign: PartId[];
};

type Meeting = Pick<MinistryEventView, "audience" | "published" | "kind" | "seats" | "program">;

/**
 * Who a meeting reminds, and of what — pure. Nobody when the meeting is not announced (the read
 * never returns such a meeting; said again here because this is the audience). In the order the
 * meeting runs its parts.
 */
export function meetingReminders(e: Meeting): MeetingReminder[] {
  if (!e.published || e.audience?.kind !== "ministry") return [];
  const out = new Map<string, MeetingReminder>();
  const of = (memberId: string): MeetingReminder => {
    const known = out.get(memberId);
    if (known) return known;
    const fresh: MeetingReminder = { memberId, fill: [], assign: [] };
    out.set(memberId, fresh);
    return fresh;
  };
  const unassigned: PartId[] = [];

  for (const spec of MEETING_PARTS) {
    // The writer stores at most one line per part; the first is the one every reader takes.
    const line = e.program.find((l) => l.part === spec.id) ?? null;
    const seats = spec.id === "platica" ? e.seats.filter((s) => s.role === PLATICA_SEAT) : [];
    const members = [
      ...new Set(
        (spec.id === "platica" ? seats.map((s) => s.memberId) : [line?.memberId ?? null, line?.second?.memberId ?? null]).filter(
          (m): m is string => !!m,
        ),
      ),
    ];
    // A guest typed by name shares too, but has no account: named beside the others, never written to.
    const typed = seats.filter((s) => !s.memberId && s.name).map((s) => s.name as string);
    if (members.length === 0) {
      // Plática's people are seats, which the encargado does not write: not theirs to assign.
      if (spec.id !== "platica" && hasFixedProgram(e)) unassigned.push(spec.id);
      continue;
    }
    const gaps = partGaps({ id: spec.id, note: line?.note ?? null, music: spec.music ? (line?.music ?? null) : null });
    if (gaps.length === 0) continue;
    for (const memberId of members) {
      of(memberId).fill.push({ part: spec.id, gaps, partners: members.filter((m) => m !== memberId), partnerNames: typed });
    }
  }

  if (unassigned.length > 0) {
    for (const seat of e.seats) {
      if (seat.role === COORDINATOR_SEAT && seat.memberId) of(seat.memberId).assign = [...unassigned];
    }
  }
  return [...out.values()];
}

/** Every member id a set of reminders names: who is written to and who their email mentions. */
function idsOf(reminders: readonly MeetingReminder[]): string[] {
  return [...new Set(reminders.flatMap((r) => [r.memberId, ...r.fill.flatMap((f) => f.partners)]))];
}

/**
 * Pure half: the emails the day's meetings become, given the people read (the answer of
 * `NOTICE_PEOPLE_QUERY` for the ids the reminders name).
 */
export function planReminderEmails(
  meetings: ReadonlyArray<{ meeting: MinistryEventView; days: ReminderDays }>,
  people: readonly PersonRow[],
  env: { baseUrl: string; allow: string[] },
): PlannedEmail[] {
  const byId = new Map(people.filter((p) => p && typeof p._id === "string").map((p) => [p._id, p]));
  const settingsLink = `${env.baseUrl}/me/ajustes`;
  const out: PlannedEmail[] = [];
  for (const { meeting, days } of meetings) {
    const link = `${env.baseUrl}${meetingPath(meeting._id)}`;
    for (const r of meetingReminders(meeting)) {
      const person = byId.get(r.memberId);
      const email = assignedAddress(person, "jovenes", env.allow);
      if (!person || !email) continue;
      const { subject, html } = buildPartReminderEmail({
        name: nameOf(person) ?? "",
        meeting: {
          id: meeting._id,
          date: meeting.date,
          time: meeting.time,
          arrival: meeting.arrival,
          place: meeting.place,
          title: meeting.title,
          kind: meeting.kind,
        },
        days,
        fill: r.fill.map((f) => ({
          part: f.part,
          gaps: f.gaps,
          partnerNames: [...f.partners.map((id) => nameOf(byId.get(id))).filter((n): n is string => n !== null), ...f.partnerNames],
        })),
        assign: r.assign,
        link,
        settingsLink,
      });
      out.push({ memberId: r.memberId, email, subject, html });
    }
  }
  return out;
}

export interface MeetingReminderReport {
  ran: boolean;
  meetings?: number;
  planned?: number;
  emailed?: number;
  failed?: number;
  /** Planned but never started: the step ran out of the route's time. */
  skipped?: number;
  elapsedMs?: number;
  error?: string;
}

/**
 * The route's one call, every day. Never throws: the daily cron's sweep and alarms must run
 * whatever happens here. `spentMs`: what the route already spent before this step, so the last
 * wave it starts ends by `REMINDER_STEP_DEADLINE_MS` of the route.
 */
export async function sendMinistryEventReminders(now: Date = new Date(), opts: { spentMs?: number } = {}): Promise<MeetingReminderReport> {
  const started = Date.now();
  const spent = Math.max(0, opts.spentMs ?? 0);
  try {
    const dates = reminderDates(now.toLocaleDateString("sv", { timeZone: TIMEZONE }));
    const daysOf = new Map(dates.map((d) => [d.date, d.days]));
    const rows = await readAnnouncedMeetings("jovenes", dates.map((d) => d.date));
    const meetings = rows.flatMap((meeting) => {
      const days = daysOf.get(meeting.date);
      return days ? [{ meeting, days }] : [];
    });
    const ids = idsOf(meetings.flatMap((m) => meetingReminders(m.meeting)));
    const people = ids.length ? await operationalClient.fetch<PersonRow[] | null>(NOTICE_PEOPLE_QUERY, { ids }) : [];
    const planned = planReminderEmails(meetings, people ?? [], { baseUrl: appBaseUrl(), allow: getAllowlist() });
    // Preview mail goes to one address (docs/SECRETS.md), like every other app email.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    // In waves as wide as the transport's pool, so no send starts its timeout queued behind
    // another; and no wave starts once one more timeout would outlast the route.
    const results: PromiseSettledResult<{ ok: boolean; error?: string }>[] = [];
    for (let i = 0; i < planned.length; i += SEND_CONCURRENCY) {
      if (spent + (Date.now() - started) + SEND_TIMEOUT_MS > REMINDER_STEP_DEADLINE_MS) break;
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
        console.error(JSON.stringify({ event: "ministry_reminder_send_failed", member: planned[i].memberId, reason }));
      }
    });
    const skipped = planned.length - results.length;
    if (skipped > 0) console.error(JSON.stringify({ event: "ministry_reminder_skipped", skipped }));
    const report: MeetingReminderReport = {
      ran: true,
      meetings: meetings.length,
      planned: planned.length,
      emailed,
      failed: results.length - emailed,
      skipped,
      elapsedMs: Date.now() - started,
    };
    console.log(JSON.stringify({ event: "ministry_reminder_run", dates: dates.map((d) => d.date), ...report }));
    return report;
  } catch (err) {
    console.error(JSON.stringify({ event: "ministry_reminder_failed" }), err);
    return { ran: true, error: "ministry_reminder_failed", elapsedMs: Date.now() - started };
  }
}
