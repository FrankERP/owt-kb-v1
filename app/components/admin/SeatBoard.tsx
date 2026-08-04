"use client";

// The service team editor: seats left, the WHOLE eligible roster right. Each
// pane scrolls independently, side by side, in a bounded-height dialog; the
// footer sits outside both as a sibling, never a descendant, so it stays
// visible and clickable no matter how many seats or roster rows exist.
//
// It replaces a sheet that stacked FIVE scroll regions vertically in one
// narrow column — the modal body, the form, and three ~144px member pickers —
// showing 4 of 16 voices three times over. That nesting was the defect. Two
// panes that sit side by side and each scroll on their own is not that
// defect, as long as neither scroller is nested inside the other and the
// roster is never reduced to a small keyhole. Nothing here ranks or blocks on
// its own — the seat vocabulary comes from `seatModel` and the ordering,
// availability, existing assignment and load all come from `rankCandidates`,
// so both are table-tested without a DOM.

import { useMemo, useState } from "react";

import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  normalizeSeatName,
  type SeatDef,
} from "./seatModel";
import {
  displayName,
  rankCandidates,
  type AssignedSeat,
  type RankedCandidate,
  type RankMember,
} from "./candidateRanking";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { ParticipationRail } from "./ParticipationRail";
import { unresolvedRuleNames } from "./ruleEnforcement";
import type { SolverConfig } from "./plannerModel";
import {
  CARD_STYLE,
  SERVICE_BADGE,
  SERVICE_LABEL,
  type ServiceRole,
  type ServiceType,
} from "./serviceCardModel";

/**
 * A role in the recent-load window. `_id` is optional and used for ONE thing:
 * recognising the saved copy of the service this board is editing, so the
 * participation rail can drop it and count the live seats instead. Optional
 * because `rankCandidates` neither needs nor reads it, and every caller that
 * passes real `ServiceRole` documents already carries it.
 */
export type WindowRole = ParticipantRole & { _id?: string };

export interface SeatBoardProps {
  initial?: ServiceRole;
  members: RankMember[];
  windowRoles: WindowRole[];
  onSubmit: (data: unknown) => void;
  onClose: () => void;
  loading: boolean;
  dateLockedReason?: string | null;
  submitBlockedReason?: string | null;
  /**
   * The shared rule set (P6). **Optional, and absent means "no rules here"** —
   * never "use the defaults". A browser holding no rules must keep this board's
   * original behaviour exactly (`rankCandidates` answers `ruleBlockedReason:
   * null` with no config), rather than start hard-blocking picks against a rule
   * set nobody on this team wrote.
   *
   * **Standing asymmetry, by construction:** this board edits ONE service and
   * has no Sunday spine, so `evaluate` gets no `sundayDates` and WEEK exclusions
   * (E7) are unevaluable here. Person exclusions and pairwise conflicts do
   * apply. That is a property of the surface, not a gap to fill later — the
   * board genuinely does not know which week of the month a date falls in
   * (`weekForColumn` needs the month's full spine, and `Math.ceil(day / 7)` is
   * E21's wrong answer).
   */
  config?: SolverConfig;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";
const selectCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

/**
 * BOTH refusal channels, as ONE expression read by `occupancyAfterPick` and by
 * `RosterRow`.
 *
 * `blockedReason` (a same-category double booking) and `ruleBlockedReason` (a
 * hard rule) are separate fields on purpose — Task 3 keeps the rule verdict out
 * of the double-booking channel so each can be worded and sorted on its own —
 * and reading only the first silently let every rule through while the roster
 * row drew it as blocked. The double wins the WORDING when both apply, so the
 * row the admin cannot click always names the reason the pick will refuse on.
 */
function refusalFor(candidate: RankedCandidate | undefined): string | null {
  return candidate?.blockedReason ?? candidate?.ruleBlockedReason ?? null;
}

/**
 * The target seat's occupants after a manual pick — or `null` when the pick is
 * REFUSED and the seat must not change.
 *
 * Exported, and pure, because `toggle`'s own refusal is otherwise unpinnable:
 * `RosterRow` blocks its own `onClick`/`onKeyDown`, so no DOM path can reach
 * this with a blocked candidate, and dropping the `ruleBlockedReason` term
 * inside `toggle` used to pass every test with only the render side pinned.
 *
 * REMOVING is never refused: a rule refuses adding, never un-seating, or a pair
 * a rule now forbids could not be taken apart.
 */
export function occupancyAfterPick(
  current: string[],
  seat: Pick<SeatDef, "max">,
  candidate: RankedCandidate | undefined,
  memberId: string,
): string[] | null {
  if (current.includes(memberId)) return current.filter((x) => x !== memberId);
  if (refusalFor(candidate)) return null;
  return seat.max !== null && current.length >= seat.max
    ? [...current.slice(1), memberId] // single-occupant seats replace
    : [...current, memberId];
}

/**
 * P10 — one seat's override record, rewritten against who is now seated there.
 *
 * Mirrors `PlannerGrid`'s `withUpdatedCell`: an id no longer seated cannot stay
 * overridden, so any edit that drops a member drops their entry too. The
 * alternative is a stale exception that would silently sanction the same person
 * if they were ever seated here again.
 *
 * `add` is the ONLY way an entry is created, and it is reachable from exactly
 * one place: the roster row's secondary "Asignar de todos modos" action.
 */
export function withSeatOverrides(
  prev: Record<string, Record<string, string>>,
  seatId: string,
  seated: string[],
  add?: { memberId: string; reason: string },
): Record<string, Record<string, string>> {
  const stillSeated = new Set(seated);
  const kept: Record<string, string> = {};
  for (const [id, reason] of Object.entries(prev[seatId] ?? {})) {
    if (stillSeated.has(id)) kept[id] = reason;
  }
  if (add && stillSeated.has(add.memberId) && kept[add.memberId] === undefined) {
    kept[add.memberId] = add.reason;
  }
  return { ...prev, [seatId]: kept };
}

/**
 * What the participation rail beside this board counts: the recent-load window
 * with this service's SAVED copy removed, plus this service as it stands in the
 * editor right now.
 *
 * **The swap is the point.** `windowRoles` is anchored on the service being
 * edited (`recentRolesWindow`, `ServicesPanel.tsx`), so the stored version of it
 * is already in that list. Appending the live seats without dropping it would
 * count everyone on this service twice and report a fairness picture that is
 * wrong in exactly the direction the admin is about to change. Dropping it
 * without appending would show the numbers as they were before the dialog
 * opened, which is the read the rail exists to replace.
 *
 * Matched on `_id`, not on date + type: the board can move the date, and two
 * specials can share one. A caller that passes no `_id` (the tests' bare
 * `ParticipantRole` fixtures) simply drops nothing — the live role is still
 * appended, so the rail is never silently empty.
 *
 * `assigned` is `SeatBoard`'s own memo, reused rather than re-derived from
 * `occupancy`: it already carries the seat id (`lead`/`bgv`/`coro`) and the
 * category (`voz`/`instrumento`/`foh`) this needs, and it is already built from
 * `seats`, which excludes Coro on a Saturday. A second walk over `occupancy`
 * here would be a second place for that exclusion to drift.
 *
 * Pure and exported so the arithmetic is testable without a DOM.
 */
export function boardParticipationRoles({
  saved,
  savedId,
  type,
  date,
  assigned,
  members,
}: {
  saved: WindowRole[];
  savedId?: string;
  type: ServiceType;
  date: string;
  assigned: AssignedSeat[];
  members: RankMember[];
}): ParticipantRole[] {
  const byId = new Map(members.map((m) => [m._id, m]));
  // An id with no member record round-trips as a bare `_id` rather than being
  // dropped — the same contract `cellsToParticipantRoles` keeps, and for the
  // same reason: `computeParticipation` keys strictly by `_id`, so dropping one
  // under-counts that person with no signal at all.
  const person = (id: string) => {
    const m = byId.get(id);
    return m ? { _id: m._id, member_name: m.member_name, alias: m.alias } : { _id: id };
  };
  const inSeat = (seatId: string) =>
    assigned.filter((a) => a.seatId === seatId).map((a) => person(a.memberId));
  const inCategory = (category: AssignedSeat["category"]) =>
    assigned.filter((a) => a.category === category).map((a) => ({ person: person(a.memberId) }));

  const live: ParticipantRole = {
    _type: type,
    date,
    leads: inSeat("lead"),
    bgvs: inSeat("bgv"),
    chorus: inSeat("coro"),
    instruments: inCategory("instrumento"),
    foh: inCategory("foh"),
  };
  const kept = savedId === undefined ? saved : saved.filter((r) => r._id !== savedId);
  return [...kept, live];
}

export default function SeatBoard(props: SeatBoardProps) {
  const { initial, members, windowRoles, loading, config } = props;

  const [type, setType] = useState(initial?._type ?? "sunday_role");
  const [date, setDate] = useState(initial?.date?.slice(0, 10) ?? "");
  const [serviceName, setServiceName] = useState(initial?.service_name ?? "");

  // occupancy: seatId -> memberId[]
  const [occupancy, setOccupancy] = useState<Record<string, string[]>>(() =>
    seedOccupancy(initial),
  );
  // P10 — seatId → memberId → the RULE that was waived to seat them there.
  //
  // The nearest thing this board has to `GridCell.overrides`/`overrideReasons`
  // (`PlannerGrid`), and written and pruned by the same rules: an id no longer
  // seated cannot stay overridden, and the entry carries the rule it waived
  // rather than only the person, so it can never read as sanctioning a rule
  // written afterwards.
  //
  // **Where it necessarily diverges from the planner grid: lifetime.** A
  // `GridCell` is draft state the planner keeps, so an override there survives
  // as long as the draft does. This board's output is a service document, and
  // `special_role`/`sunday_role`/`saturday_role` have no field for an override —
  // so this record lives exactly as long as the dialog is open, and reopening a
  // saved service shows no marker. That is a display loss and nothing more:
  // nothing on this surface re-checks who is ALREADY seated (there is no E13
  // here — `evaluate` self-exempts occupants), so a forgotten override cannot
  // turn into a false accusation later. Giving it a longer life means a schema
  // field and a migration, which is a decision for the Sanity cutover, not
  // something to invent here.
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const [instrumentSeats, setInstrumentSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.instruments?.map((s) => s.instrument), DEFAULT_INSTRUMENT_SEATS),
  );
  const [fohSeats, setFohSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.foh?.map((s) => s.role), DEFAULT_FOH_SEATS),
  );

  // A Saturday service has no Coro. Confirmed by the team, and matched by the
  // data: 0 of 8 stored saturday_role documents carry a Chorus, against 19 of 19
  // Sundays. The old form offered one Coro picker for every service type, which
  // is where the stray capability came from.
  const voiceSeats: SeatDef[] = useMemo(
    () => VOICE_SEATS.filter((s) => !(s.id === "coro" && type === "saturday_role")),
    [type],
  );

  const seats: SeatDef[] = useMemo(
    () => [
      ...voiceSeats,
      ...instrumentSeats.map(instrumentSeatDef),
      ...fohSeats.map(fohSeatDef),
    ],
    [voiceSeats, instrumentSeats, fohSeats],
  );

  const [targetId, setTargetId] = useState(VOICE_SEATS[0].id);
  const target = seats.find((s) => s.id === targetId) ?? seats[0];

  const assigned: AssignedSeat[] = useMemo(
    () =>
      seats.flatMap((seat) =>
        (occupancy[seat.id] ?? []).map((memberId) => ({
          seatId: seat.id,
          category: seat.category,
          memberId,
        })),
      ),
    [seats, occupancy],
  );

  // `column` scopes any rule's service half — without it every pattern's service
  // half is unmatchable and `Sat.*` would apply to a special. `config` is what
  // turns the rules on here at all (P6): with none, `ruleBlockedReason` is always
  // `null` and this board behaves exactly as it did for its first two releases.
  // No `sundayDates`: see the `config` prop's doc — week exclusions are
  // unevaluable on a surface that edits one service and has no month spine.
  const candidates = useMemo(
    () =>
      rankCandidates({
        seat: target,
        date,
        members,
        windowRoles,
        assigned,
        column: { date, type },
        config,
      }),
    [target, date, type, members, windowRoles, assigned, config],
  );

  /**
   * Rules that resolve to NOBODY (E11/fact 12). Reported HERE and not only in
   * the generator because this is now a surface where a rule HARD-BLOCKS: an
   * unmatched conflict name means the pair the admin named is seated together
   * while the board reports a perfectly normal, successful assignment. On a
   * special no solve runs at all, so there is no second detector — this warning
   * is the only safeguard.
   */
  const unresolved = useMemo(() => unresolvedRuleNames(config, members), [config, members]);

  const participationRoles = useMemo(
    () =>
      boardParticipationRoles({
        saved: windowRoles,
        savedId: initial?._id,
        type,
        date,
        assigned,
        members,
      }),
    [windowRoles, initial?._id, type, date, assigned, members],
  );

  function toggle(memberId: string) {
    const seatId = target.id;
    const current = occupancy[seatId] ?? [];
    const next = occupancyAfterPick(current, target, candidates.find((c) => c.id === memberId), memberId);
    if (!next) return; // refused — see `occupancyAfterPick`
    setOccupancy({ ...occupancy, [seatId]: next });
    setOverrides(withSeatOverrides(overrides, seatId, next));
  }

  /**
   * P10 — seat a RULE-blocked member anyway, deliberately, and record it.
   *
   * A SECOND, separate interaction, exactly as in `PlannerGrid`: the roster row
   * itself stays inert while blocked (`RosterRow` guards `onClick` and
   * `onKeyDown` on `!blocked`), so this cannot be reached by the mis-click that
   * would otherwise seat exactly the pair the admin wrote a rule to keep apart.
   *
   * Only ever a RULE block. D6's same-category double is not overridable — that
   * refusal is a shipped invariant on both surfaces, and a person in two voice
   * seats of one service is a data error, not a judgement call.
   *
   * The waived rule is recorded WITH the seating, from the same
   * `ruleBlockedReason` the admin just read on the row: an override sanctions
   * that rule and no other.
   *
   * **Nothing automatic reaches this.** This board has no filler at all, and
   * `localFill.ts`'s `fillColumn` — the only automation that seats anyone
   * locally — neither calls anything here nor reads an override. A person may
   * make a deliberate exception; the automation may not. That asymmetry is the
   * requirement (ADR-0010), not an implementation detail.
   */
  function overrideMember(memberId: string) {
    const candidate = candidates.find((c) => c.id === memberId);
    if (!candidate?.ruleBlockedReason) return;
    // A BACKSTOP, and — as in `PlannerGrid` — one no test can kill on its own:
    // `RosterRow` offers the button only when the same two conditions hold, so a
    // double-blocked candidate has no button to click. Kept because this
    // function is a write path into the occupancy and the cost is one line.
    if (candidate.blockedReason) return;
    const seatId = target.id;
    const current = occupancy[seatId] ?? [];
    if (current.includes(memberId)) return; // an override ADDS a seat
    const next =
      target.max !== null && current.length >= target.max
        ? [...current.slice(1), memberId] // single-occupant seats replace
        : [...current, memberId];
    setOccupancy({ ...occupancy, [seatId]: next });
    setOverrides(
      withSeatOverrides(overrides, seatId, next, { memberId, reason: candidate.ruleBlockedReason }),
    );
  }

  function removeFromSeat(seatId: string, memberId: string) {
    const next = (occupancy[seatId] ?? []).filter((id) => id !== memberId);
    setOccupancy({ ...occupancy, [seatId]: next });
    setOverrides(withSeatOverrides(overrides, seatId, next));
  }

  // A brand-new seat name keeps the admin's casing (normalizeSeatName's contract —
  // see seatModel.ts), so without this check "Trombone" then "trombone" would
  // create two seats. Reject the case-insensitive repeat here, at the add site,
  // rather than in normalizeSeatName, and tell the admin instead of no-op'ing.
  function addInstrumentSeat(raw: string): string | null {
    const name = normalizeSeatName(raw);
    if (!name) return null;
    let error: string | null = null;
    setInstrumentSeats((prev) => {
      if (prev.some((s) => s.toLowerCase() === name.toLowerCase())) {
        error = "Ya existe un puesto de instrumento con ese nombre.";
        return prev;
      }
      return [...prev, name];
    });
    return error;
  }

  function addFohSeat(raw: string): string | null {
    const name = normalizeSeatName(raw);
    if (!name) return null;
    let error: string | null = null;
    setFohSeats((prev) => {
      if (prev.some((s) => s.toLowerCase() === name.toLowerCase())) {
        error = "Ya existe un rol de FOH con ese nombre.";
        return prev;
      }
      return [...prev, name];
    });
    return error;
  }

  function buildData(published?: boolean) {
    const base = {
      _type: type,
      date,
      service_name: serviceName,
      leads: occupancy["lead"] ?? [],
      bgvs: occupancy["bgv"] ?? [],
      // Belt and braces: hiding the seat stops new picks, but occupancy can
      // survive a type switch from Sunday, so the write is forced empty too.
      chorus: type === "saturday_role" ? [] : (occupancy["coro"] ?? []),
      instruments: instrumentSeats.flatMap((label) => {
        const def = instrumentSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ instrument: def.label, personId }));
      }),
      foh: fohSeats.flatMap((label) => {
        const def = fohSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ role: def.label, personId }));
      }),
    };
    return !initial && published !== undefined ? { ...base, published } : base;
  }

  const membersById = useMemo(() => new Map(members.map((m) => [m._id, m])), [members]);
  function memberName(id: string): string {
    const m = membersById.get(id);
    return m ? displayName(m) : id;
  }

  const isEdit = !!initial;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Header: tipo / fecha / nombre — same fields ServiceForm exposed. */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tipo</label>
            {initial ? (
              <span
                className={`inline-flex rounded-full px-2 py-1 font-label text-xs uppercase tracking-widest ${SERVICE_BADGE[type]}`}
              >
                {SERVICE_LABEL[type]}
              </span>
            ) : (
              <select
                className={selectCls}
                value={type}
                onChange={(e) => setType(e.target.value as ServiceType)}
              >
                <option value="sunday_role">Domingo</option>
                <option value="saturday_role">Sábado</option>
                <option value="special_role">Especial</option>
              </select>
            )}
          </div>
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">Fecha</label>
            <input
              type="date"
              className={`${inputCls} disabled:opacity-50`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!!props.dateLockedReason}
              title={props.dateLockedReason ?? undefined}
              required
            />
            {props.dateLockedReason && (
              <p className="font-body text-[11px] text-amber-400">
                No se puede mover la fecha: {props.dateLockedReason}
              </p>
            )}
          </div>
        </div>
        {type === "special_role" && (
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">
              Nombre del servicio
            </label>
            <input
              className={inputCls}
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="ej. Viernes Santo, Navidad..."
            />
          </div>
        )}
      </div>

      {/* Two panes, side by side, each with its own scroll region — neither
          nested inside the other. Both `min-h-0` so the single grid row
          (stretched to the full height of this flex-1 container) actually
          bounds each pane's height instead of growing to fit content; without
          it, adding enough instrument/FOH seats on the left would grow this
          row past the dialog's height and push the footer below out of view
          (the footer is a sibling of this grid, not a descendant, so a grid
          that overflows its bounds is the only way that could happen). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${CARD_STYLE.dialog} min-h-0 min-w-0 overflow-y-auto pr-1`}>
          <SeatGroup
            title="Voces"
            seats={voiceSeats}
            occupancy={occupancy}
            overrides={overrides}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <SeatGroup
            title="Instrumentos"
            seats={instrumentSeats.map(instrumentSeatDef)}
            occupancy={occupancy}
            overrides={overrides}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <AddSeatForm placeholder="Nuevo instrumento" onAdd={addInstrumentSeat} />
          <SeatGroup
            title="FOH / Técnicos"
            seats={fohSeats.map(fohSeatDef)}
            occupancy={occupancy}
            overrides={overrides}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <AddSeatForm placeholder="Nuevo rol" onAdd={addFohSeat} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">
              Candidatos para {target.label}
            </span>
            <span className="font-label text-[11px] text-gray-500">{candidates.length}</span>
          </div>
          {unresolved.length > 0 && (
            <p
              role="status"
              className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-body text-[11px] text-amber-400"
            >
              Estas reglas nombran a alguien que no existe en el equipo y por lo tanto no bloquean
              nada: <span className="font-semibold">{unresolved.join(", ")}</span>. Corrige el
              nombre en las reglas del generador.
            </p>
          )}
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {candidates.map((candidate) => (
              <RosterRow
                key={candidate.id}
                candidate={candidate}
                selected={(occupancy[target.id] ?? []).includes(candidate.id)}
                onToggle={toggle}
                onOverride={overrideMember}
              />
            ))}
            {candidates.length === 0 && (
              <li className="font-body text-xs italic text-gray-600">
                Nadie elegible para este puesto.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/*
        The participation rail — the same chart the Servicios panel shows,
        counting the seats being edited RIGHT NOW rather than only what is
        stored (see `boardParticipationRoles`).

        A sibling of the two-pane grid, and `position: fixed` in the page gutter
        beside the dialog (`ParticipationRail`), so it takes no width from either
        pane and adds no scroll region inside a dialog built to have exactly two.
        Below 1380px there is no gutter to sit in and it renders nothing at all —
        stacking it into this bounded column is the defect `SeatBoard` exists to
        undo.

        MOUNTED here, RENDERED on `document.body`: above the threshold
        `ParticipationRail` portals its output out of this dialog. It stays
        mounted here for STATE (it counts the seats being edited right now) and
        is portalled out for PAINT — `CueDialog`'s shell carries
        `brand-facet-panel` (`relative` + `isolation: isolate` +
        `overflow: hidden`), the same trio as `.brand-admin-shell`, and in
        Safari a `position: fixed` descendant of it lays out and hit-tests
        correctly and then paints nothing. See `ParticipationRail.tsx`'s header.

        KNOWN COST, accepted deliberately: this comment used to say the rail
        stayed inside the dialog's DOM "so the focus trap still owns its
        Voces/Instrumentos control", and that is exactly what the portal gives
        up. `CueDialog` builds its Tab ring from `shellRef` — which IS the
        `brand-facet-panel` element — so anything that escapes the panel escapes
        the ring, and there is no portal target that satisfies both. While this
        dialog is open the rail's select is mouse-only. A visible chart with a
        mouse-only view toggle beats an invisible chart whose toggle cannot be
        reached at all; making `CueDialog` trap portalled satellites is the
        proper fix and is deliberately not attempted here.
      */}
      <ParticipationRail
        placement="dialog"
        roles={participationRoles}
        monthLabel="Carga reciente · incluye este servicio"
      />

      {/* Footer: a sibling of the two-pane grid above, not a descendant of
          either scroll region, so it never scrolls out of reach regardless of
          how many seats or roster rows exist. Create mode keeps two explicit,
          always-visible actions (Crear / Crear y publicar) rather than one
          button plus an easy-to-miss checkbox — matching ServiceForm's
          existing render contract at ServicesPanel.tsx. */}
      <div className="flex items-center gap-3 border-t border-[#00bfff]/10 pt-3">
        <div className="ml-auto flex gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="min-h-[44px] rounded-lg border border-[#003572]/30 px-4 font-label text-xs uppercase tracking-widest transition-colors hover:border-[#00bfff] dark:border-[#00bfff]/20"
          >
            Cancelar
          </button>
          {isEdit ? (
            <button
              type="button"
              onClick={() => props.onSubmit(buildData())}
              disabled={loading || !!props.submitBlockedReason}
              title={props.submitBlockedReason ?? undefined}
              className="min-h-[44px] rounded-lg bg-[#003572] px-4 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-50 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
            >
              {loading ? "Guardando..." : "Guardar"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => props.onSubmit(buildData(false))}
                disabled={loading || !!props.submitBlockedReason}
                title={props.submitBlockedReason ?? undefined}
                className="min-h-[44px] rounded-lg border border-[#003572]/30 px-4 font-label text-xs uppercase tracking-widest transition-colors hover:border-[#00bfff] disabled:opacity-50 dark:border-[#00bfff]/20"
              >
                {loading ? "Guardando..." : "Crear"}
              </button>
              <button
                type="button"
                onClick={() => props.onSubmit(buildData(true))}
                disabled={loading || !!props.submitBlockedReason}
                title={props.submitBlockedReason ?? undefined}
                className="min-h-[44px] rounded-lg bg-[#003572] px-4 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-50 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
              >
                {loading ? "Guardando..." : "Crear y publicar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Existing assignments -> seatId -> memberId[]. */
function seedOccupancy(initial?: ServiceRole): Record<string, string[]> {
  if (!initial) return {};
  const out: Record<string, string[]> = {
    lead: (initial.leads ?? []).map((m) => m._id),
    bgv: (initial.bgvs ?? []).map((m) => m._id),
    coro: (initial.chorus ?? []).map((m) => m._id),
  };
  for (const slot of initial.instruments ?? []) {
    if (!slot.person) continue;
    const def = instrumentSeatDef(slot.instrument);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  for (const slot of initial.foh ?? []) {
    if (!slot.person) continue;
    const def = fohSeatDef(slot.role);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  return out;
}

/** The service's own seat names, normalised, unioned with the defaults. */
function seedSeatNames(existing: (string | undefined)[] | undefined, defaults: string[]): string[] {
  const names = (existing ?? []).map((n) => instrumentSeatDef(n ?? "").label).filter(Boolean);
  return [...new Set([...defaults, ...names])];
}

// ── Seat pane ────────────────────────────────────────────────────────────────

function SeatGroup({
  title,
  seats,
  occupancy,
  overrides,
  targetId,
  onSelectTarget,
  onRemove,
  memberName,
}: {
  title: string;
  seats: SeatDef[];
  occupancy: Record<string, string[]>;
  /** P10 — seatId → memberId → the waived rule, for the persistent marker. */
  overrides: Record<string, Record<string, string>>;
  targetId: string;
  onSelectTarget: (id: string) => void;
  onRemove: (seatId: string, memberId: string) => void;
  memberName: (id: string) => string;
}) {
  if (seats.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <p className="font-label text-[11px] uppercase tracking-widest text-[#C8D8EB]/50">{title}</p>
      <div className="space-y-1.5">
        {seats.map((seat) => (
          <SeatRow
            key={seat.id}
            seat={seat}
            occupantIds={occupancy[seat.id] ?? []}
            overrides={overrides[seat.id]}
            isTarget={seat.id === targetId}
            onSelectTarget={onSelectTarget}
            onRemove={onRemove}
            memberName={memberName}
          />
        ))}
      </div>
    </section>
  );
}

function SeatRow({
  seat,
  occupantIds,
  overrides,
  isTarget,
  onSelectTarget,
  onRemove,
  memberName,
}: {
  seat: SeatDef;
  occupantIds: string[];
  /** P10 — memberId → the rule waived to seat them here, if any. */
  overrides?: Record<string, string>;
  isTarget: boolean;
  onSelectTarget: (id: string) => void;
  onRemove: (seatId: string, memberId: string) => void;
  memberName: (id: string) => string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTarget(seat.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectTarget(seat.id);
        }
      }}
      className={`min-h-[44px] w-full min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${
        isTarget ? "border-[#00bfff] bg-[#00bfff]/10" : "border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">{seat.label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {occupantIds.length === 0 ? (
          <span className="font-body text-xs italic text-gray-600">Sin asignar</span>
        ) : (
          occupantIds.map((id) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1 rounded-full border border-[#00bfff]/25 bg-[#00bfff]/10 px-2 py-0.5 font-label text-[11px] text-[#C8D8EB] ${CARD_STYLE.longText}`}
            >
              <span>{memberName(id)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(seat.id, id);
                }}
                aria-label={`Quitar a ${memberName(id)} de ${seat.label}`}
                className="leading-none text-[#C8D8EB]/60 hover:text-white"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      {/* P10 — the persistent marker, in the same words the planner grid uses.
          An override is a deliberate exception, so the seat must not just go
          green: it names WHO was seated past WHICH rule, and stays there for as
          long as they hold the seat. */}
      {occupantIds
        .filter((id) => overrides?.[id] !== undefined)
        .map((id) => (
          <p key={id} className={`mt-1 font-body text-[11px] text-amber-400 ${CARD_STYLE.longText}`}>
            Regla anulada — {memberName(id)}: {overrides?.[id]}
          </p>
        ))}
    </div>
  );
}

function AddSeatForm({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  /** Returns a Spanish error to show (e.g. a case-insensitive duplicate) or null on success. */
  onAdd: (name: string) => string | null;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const rejected = onAdd(value);
        setError(rejected);
        if (!rejected) setValue("");
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className={`${inputCls} min-h-[44px] flex-1 text-xs`}
        />
        <button
          type="submit"
          className={`${CARD_STYLE.menuTrigger} shrink-0 rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 transition-colors hover:border-[#00bfff]`}
        >
          Añadir
        </button>
      </div>
      {error && <p className="font-body text-[11px] text-red-400">{error}</p>}
    </form>
  );
}

// ── Roster pane ──────────────────────────────────────────────────────────────

function RosterRow({
  candidate,
  selected,
  onToggle,
  onOverride,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  onToggle: (id: string) => void;
  /** P10 — seat this rule-blocked candidate anyway. */
  onOverride: (id: string) => void;
}) {
  // Both refusal channels disable the row and both are shown. `blockedReason`
  // (already assigned in another seat of the same category) wins the wording
  // when they collide, matching the pick's own order so the row the admin
  // cannot click always names the reason `occupancyAfterPick` will refuse on.
  const reason = refusalFor(candidate);
  const blocked = !!reason;
  // Only a RULE block is overridable: a same-category double is a data error,
  // not a judgement call, and it is refused identically on both surfaces.
  //
  // `!selected` is a BACKSTOP, not the enforcement — a seated member is exempted
  // by `evaluate` itself (E6/P9's self-exemption in `ruleEnforcement.ts`), so
  // their `ruleBlockedReason` is already `null` and this expression is already
  // false. What keeps a rule hard is `blocked` below.
  const overridable = !!candidate.ruleBlockedReason && !candidate.blockedReason && !selected;
  return (
    <li
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked ? "true" : undefined}
      title={reason ?? undefined}
      onClick={() => {
        if (!blocked) onToggle(candidate.id);
      }}
      onKeyDown={(e) => {
        if (blocked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(candidate.id);
        }
      }}
      className={`min-h-[44px] min-w-0 rounded-lg border px-3 py-2 transition-colors ${
        blocked
          ? "cursor-not-allowed border-red-500/20 bg-red-500/5 opacity-60"
          : selected
            ? "cursor-pointer border-[#00bfff] bg-[#00bfff]/10"
            : "cursor-pointer border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={`font-body text-sm ${CARD_STYLE.longText}`}>{candidate.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {!candidate.available && <Badge tone="warn">No disp.</Badge>}
          {candidate.alreadyAssigned && <Badge tone="neutral">Ya asignado</Badge>}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex gap-0.5" aria-hidden="true">
          {candidate.recent.map((served, i) => (
            <span key={i} className={`h-1.5 w-3 rounded-sm ${served ? "bg-[#00bfff]/70" : "bg-gray-700"}`} />
          ))}
        </div>
        {/*
          LABELLED for the same reason as `PlannerGrid`'s copy of this row, and
          the drift here is the mirror image: `rankCandidates` is given
          `windowRoles` untouched, so this figure still counts the STORED copy of
          the service being edited, while the rail beside it swaps that copy for
          the live seats (`boardParticipationRoles`). Both are right about their
          own question; an unlabelled 10px number beside a chart of totals is
          what makes them look like one measure that cannot add up.
        */}
        <span
          className="font-label text-[10px] text-gray-500"
          title="Carga que ordena esta lista: solo lo ya guardado en las últimas semanas. No es el total de Participaciones, que ya incluye los puestos que estás editando aquí."
        >
          Carga para ordenar: {candidate.load}
        </span>
      </div>
      {blocked && <p className="mt-1 font-body text-[11px] text-red-400">{reason}</p>}
      {/*
        P10 — the override, as a SEPARATE, secondary action, in the same shape
        and the same words as `PlannerGrid`'s.

        The row above stays inert while blocked, so this button is the only way
        to seat a rule-blocked person: two distinct interactions, and neither one
        is the mis-click that seats exactly the pair a rule exists to keep apart.
        `stopPropagation` is belt-and-braces (the row's own handler already
        returns early while blocked) — it keeps the button working if that guard
        is ever loosened, instead of firing both paths.

        Only a human reaches this. This board runs no filler, and `fillColumn`
        has no path to it at all.
      */}
      {overridable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOverride(candidate.id);
          }}
          className="mt-1.5 min-h-[44px] w-full rounded-lg border border-amber-500/40 px-2 font-label text-[10px] uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10"
        >
          Asignar de todos modos
        </button>
      )}
    </li>
  );
}

function Badge({ tone, children }: { tone: "warn" | "neutral"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-gray-500/40 bg-gray-500/10 text-gray-300";
  return (
    <span className={`rounded-full border px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}
