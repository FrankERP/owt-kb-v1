"use client";

// A service card's team: Voces, Banda and Cabina as folding sections of faces
// (photo, or two-letter initials), two to a row. It replaced three blocks that
// were always open — names in columns, then «BATERÍA | Raúl» chips — which made
// the hero card on a phone a long scroll of labels (Frank, 2026-10-21).
//
// A CLOSED section is not empty: it lists its names (up to two lines), so who
// plays bass is answered without a tap, and opening it adds faces and seats.
// Which ones start open is `defaultOpenSections` (this service's seat, else the
// member's Tipo, and always a section with a ⚠ double booking); a tap overrides
// that for the life of the card. The header carries the ⚠ too, so a conflict
// shows even when someone closes the section.
//
// Voces is three groups — Lead, BGV, Coro — each on its own softly shaded
// panel under its own label (Frank, 2026-10-21: «separar los grupos de forma
// visual antes de leer»). Shading, not a hue per role: every hue on the card
// already means something (green «tú», amber ⚠, cyan «se puede tocar», the day's
// rail), and a fourth meaning would make them all harder to read. Inside a
// group the seat is the label, so a face carries only its name.
//
// The section header is a raw <button>, not the house Button: it is a disclosure
// row (the row is the affordance), the exemption `DayCardDisclosure` carries.

import Image from "next/image";
import Link from "next/link";
import { Fragment, useId, useState } from "react";
import Collapse from "./ui/Collapse";
import { WarningIcon } from "./ui/icons";
import { findDuplicates } from "@/app/utils/agenda";
import {
  avatarSrc,
  defaultOpenSections,
  initialsOf,
  personKey,
  teamSections,
  type TeamInput,
  type TeamPerson,
  type TeamSection,
  type TeamSectionId,
} from "@/app/utils/teamSections";

export default function TeamSections({
  team,
  myName,
  photos,
  viewerTypes,
  openAll = false,
  openAllFrom,
  sheet = false,
}: {
  team: TeamInput;
  /** `myNameFromSession`'s lowercased display name; "" seats nobody. */
  myName: string;
  /** Display-name key → photo URL. Absent on a surface whose query carries no
   *  photos: everyone shows initials there, and nobody is offered «+ foto» —
   *  without the map, a missing photo and an unknown one look the same. */
  photos?: Record<string, string>;
  /** The viewer's Tipo, for the default when they hold no seat here. */
  viewerTypes?: string[] | null;
  /** Every section starts open — an admin's view (see `DayCard`). A tap still closes one. */
  openAll?: boolean;
  /**
   * From this breakpoint the team is laid out OPEN, with no disclosures — the
   * home run sheet's rail from `lg` (Frank, 2026-10-22: «el equipo expandido»
   * beside the setlist), while a phone keeps the folding sections. Two
   * renderings, one shown per width by CSS (`lg:hidden` / `hidden lg:block`):
   * the open one cannot be a JS media query, because a server render does not
   * know the width, and a desktop that hydrates folded and then tweens three
   * sections open is a layout shift on every visit — `Collapse` animates on a
   * tap only (`docs/MOTION.md`). The same `lg:` Tailwind screen as the rail's
   * grid, so the two cannot drift apart.
   */
  openAllFrom?: "lg";
  /**
   * The hero's run sheet (ADR-0071): section labels in the page's own type —
   * «Voces · 8» at 17 px sentence case, a Voces group as «Lead · 2» in muted
   * body — instead of the card's tracked small caps. The faces are the same.
   */
  sheet?: boolean;
}) {
  const sections = teamSections(team);
  // Overrides, not the open set itself: the default depends on `myName`, which a
  // client-only session fills in AFTER first paint — a set frozen in a useState
  // initializer would keep the member's own section shut once it arrived.
  const [overrides, setOverrides] = useState<Partial<Record<TeamSectionId, boolean>>>({});
  const defaults = openAll ? new Set(sections.map((s) => s.id)) : defaultOpenSections(sections, myName, viewerTypes);
  if (!sections.length) return null;

  const folding = (
    <div className={`divide-y divide-ink/[0.06]${openAllFrom ? " lg:hidden" : ""}`}>
      {sections.map((s) => (
        <Section
          key={s.id}
          section={s}
          open={overrides[s.id] ?? defaults.has(s.id)}
          onToggle={(next) => setOverrides((o) => ({ ...o, [s.id]: next }))}
          myName={myName}
          photos={photos}
          sheet={sheet}
        />
      ))}
    </div>
  );
  if (!openAllFrom) return folding;
  return (
    <>
      {folding}
      <div className="hidden divide-y divide-ink/[0.06] lg:block" data-team-open="">
        {sections.map((s) => (
          <OpenSection key={s.id} section={s} myName={myName} photos={photos} sheet={sheet} />
        ))}
      </div>
    </>
  );
}

/** A section with no disclosure: its label line, then its faces — the run sheet's rail from `lg`. */
function OpenSection({ section, myName, photos, sheet = false }: { section: TeamSection; myName: string; photos?: Record<string, string>; sheet?: boolean }) {
  const dups = findDuplicates(section.people.map((p) => p.name));
  const people = section.people.filter((p) => p.name);
  return (
    <div className={sheet ? "py-4" : "py-3"}>
      <p className={sheet ? `mb-3 ${SHEET_LABEL}` : "mb-2 font-label text-xs uppercase tracking-widest text-mono-400"}>
        <SectionLabel section={section} count={people.length} dups={dups} />
      </p>
      <SectionBody section={section} people={people} myName={myName} photos={photos} dups={dups} sheet={sheet} />
    </div>
  );
}

/** The sheet's section label (ADR-0071): the page's 17 px semibold, no small caps. */
const SHEET_LABEL = "font-body text-[17px] font-semibold text-ink";

/** «Voces · 8», plus the ⚠ count when someone is seated twice in the section. */
function SectionLabel({ section, count, dups }: { section: TeamSection; count: number; dups: Set<string> }) {
  return (
    <>
      {section.label} <span className="font-normal text-ink-dim">· {count}</span>
      {dups.size > 0 && (
        <span className="text-warning-strong"> · <WarningIcon size={11} className="inline-block align-[-1px]" /> {dups.size === 1 ? "repetido" : `${dups.size} repetidos`}</span>
      )}
    </>
  );
}

/** The faces: Voces as its three seat panels, any other section as one row of faces. */
function SectionBody({ section, people, myName, photos, dups, sheet = false }: {
  section: TeamSection;
  people: TeamPerson[];
  myName: string;
  photos?: Record<string, string>;
  dups: Set<string>;
  sheet?: boolean;
}) {
  return section.id === "voces" ? (
    <div className="space-y-2">
      {roleGroups(people).map((g) => (
        <div key={g.role} className="rounded-xl bg-ink/[0.04] px-3 pb-3 pt-2">
          <p className={sheet ? "mb-2 font-body text-sm text-ink-muted" : "mb-2 font-label text-[10px] uppercase tracking-widest text-ink-dim"}>
            {g.role} · {g.people.length}
          </p>
          <Faces people={g.people} myName={myName} photos={photos} dups={dups} grouped />
        </div>
      ))}
    </div>
  ) : (
    <Faces people={people} myName={myName} photos={photos} dups={dups} />
  );
}

function Section({ section, open, onToggle, myName, photos, sheet = false }: {
  section: TeamSection;
  open: boolean;
  onToggle: (open: boolean) => void;
  myName: string;
  photos?: Record<string, string>;
  sheet?: boolean;
}) {
  const id = useId();
  // The same person seated twice in ONE section is the card's conflict mark (⚠);
  // once in Voces and once in Banda is fine — the rule `serviceConflicts` counts.
  const dups = findDuplicates(section.people.map((p) => p.name));
  const people = section.people.filter((p) => p.name);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
        className={`flex w-full items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${sheet ? "py-4" : "py-3"}`}
      >
        <span className="min-w-0 flex-1">
          <span className={sheet ? `block ${SHEET_LABEL}` : "block font-label text-xs uppercase tracking-widest text-mono-400"}>
            <SectionLabel section={section} count={people.length} dups={dups} />
          </span>
          {!open && (
            // Two lines, not `truncate`: one line hid the later names (and a ⚠
            // among them) behind an ellipsis on a phone.
            <span className="mt-0.5 line-clamp-2 font-body text-sm text-ink-muted">
              <NamesLine section={section} people={people} myName={myName} dups={dups} />
            </span>
          )}
        </span>
        {/* `currentColor`: `var()` is not substituted in an SVG presentation attribute. */}
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink-dim">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {/* The padding rides on Collapse's inner div — a padded animated element
          never closes to zero (see Collapse). */}
      <Collapse open={open} id={id} className="pb-4 pt-1">
        <SectionBody section={section} people={people} myName={myName} photos={photos} dups={dups} sheet={sheet} />
      </Collapse>
    </div>
  );
}

/** Voces' people split by seat, in seat order (Lead, BGV, Coro): `teamSections`
 *  already lists them that way, so a group is a run of one role. */
function roleGroups(people: TeamPerson[]): Array<{ role: string; people: TeamPerson[] }> {
  const groups: Array<{ role: string; people: TeamPerson[] }> = [];
  for (const p of people) {
    const last = groups[groups.length - 1];
    if (last?.role === p.role) last.people.push(p);
    else groups.push({ role: p.role, people: [p] });
  }
  return groups;
}

function Faces({ people, myName, photos, dups, grouped = false }: { people: TeamPerson[]; myName: string; photos?: Record<string, string>; dups: Set<string>; grouped?: boolean }) {
  return (
    // auto-fit + an em floor, not `grid-cols-2`: the track minimum grows with the
    // TEXT, so at «Máximo» the faces drop to one column instead of two columns
    // whose names overlap. 7.5em keeps two faces a row inside a Voces panel on a
    // 375 px phone (measured: 8.5em left one column there).
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5em),1fr))] gap-x-3 gap-y-3">
      {people.map((p, i) => (
        <Person key={`${p.name}-${p.role}-${i}`} person={p} myName={myName} photos={photos} duplicate={dups.has(personKey(p.name))} grouped={grouped} />
      ))}
    </ul>
  );
}

/** One line of names for a closed section. Voces keeps its Lead · BGV · Coro
 *  grouping with a middle dot between the groups; Banda and Cabina are one list. */
function NamesLine({ section, people, myName, dups }: { section: TeamSection; people: TeamPerson[]; myName: string; dups: Set<string> }) {
  return (
    <>
      {people.map((p, i) => {
        const key = personKey(p.name);
        const dup = dups.has(key);
        const sep = i === 0 ? "" : section.id === "voces" && people[i - 1].role !== p.role ? " · " : ", ";
        return (
          <Fragment key={i}>
            {sep}
            <span className={dup ? "font-semibold text-warning-strong" : key === myName ? "font-semibold text-positive-fg" : undefined}>
              {dup && <WarningIcon size={12} className="mr-1 inline-block align-[-1px]" />}
              {p.name}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

function Person({ person, myName, photos, duplicate, grouped }: { person: TeamPerson; myName: string; photos?: Record<string, string>; duplicate: boolean; grouped: boolean }) {
  const key = personKey(person.name);
  const me = !duplicate && !!myName && key === myName;
  const photo = photos?.[key];
  // «+ foto» only where the surface KNOWS photos (the map is present) — and only
  // on your own face: it links to the upload in Ajustes, which only you can use.
  const askForPhoto = me && !!photos && !photo;
  // In a Voces group the seat is the group's label, so the line under the name
  // is only for «tú» and «+ foto».
  const showSeat = !grouped || me;
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <Avatar name={person.name} photo={photo} me={me} dashed={askForPhoto} />
      <div className="min-w-0">
        {/* `break-words`, not `truncate`: at «Máximo» a long name breaks inside its
            own column instead of being cut, and `min-w-0` lets the grid item
            honour its track. */}
        <p className={`break-words font-body text-sm font-semibold leading-tight ${duplicate ? "text-warning-strong" : "text-ink"}`}>
          {duplicate && <WarningIcon size={12} className="mr-1 inline-block align-[-1px]" />}
          {person.name}
        </p>
        {showSeat && (
          <p className={`break-words font-body text-xs leading-tight ${me ? "text-positive-fg" : "text-ink-dim"}`}>
            {grouped ? "tú" : person.role}
            {me && !grouped && " · tú"}
            {askForPhoto && (
              <>
                {" · "}
                <Link href="/me/ajustes" className="font-semibold text-accent underline-offset-2 hover:underline">
                  {/* A no-break space: «+» alone at a line's end read as a stray mark. */}
                  +{"\u00a0"}foto
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

function Avatar({ name, photo, me, dashed }: { name: string; photo?: string; me: boolean; dashed: boolean }) {
  // A photo that fails to load (a revoked Google URL, a deleted asset) falls back
  // to initials rather than a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const ring = me
    ? dashed ? "border-2 border-dashed border-positive-fg" : "border-2 border-positive-fg"
    : "border border-ink/10";
  return (
    <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised ${ring}`}>
      {photo && !failed ? (
        // unoptimized: the original JPEG/PNG, never Next's WebP — the iOS
        // WKWebView fails to decode it (same reason as `MeHeader`'s avatar).
        <Image src={avatarSrc(photo)} alt="" width={36} height={36} unoptimized loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="font-label text-[11px] text-ink">{initialsOf(name)}</span>
      )}
    </span>
  );
}
