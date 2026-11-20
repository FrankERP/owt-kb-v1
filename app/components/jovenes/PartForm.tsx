"use client";

// «Mi parte» — what the responsable of ONE fixed part of a Jóvenes meeting fills (Frank,
// 2026-11-17; ADR-0089): a short description, for a dinámica the youths who help, and for Oración
// and Plática whether they want a track or the worship team. It lives on the meeting's own page
// (`/jovenes/reunion/[token]`), where the «Te toca» email lands.
//
// It writes through the part PATCH (W10), which changes that part's line and nothing else and
// decides again, on the stored meeting, whether this person may. The form is one column, its
// controls 16 px or more on a phone (`inputFontSize.test.ts`), because most pastors will open it
// from the email on their phone.
//
// THE REVISION is held with the values they were loaded from, as `ProgramEditor` does: a refresh
// that brings a newer meeting never lets a half-typed description save over it unseen. Untouched,
// the form follows the page; touched, a save that finds the meeting changed answers 409, the page
// refreshes above the form, and the person reads it and saves again.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import { ChevronDownIcon } from "@/app/components/ui/icons";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import { MUSIC_WORDS, PART_ASK, PART_LIMITS, partSpec, type PartId, type PartMusic } from "@/app/utils/ministryParts";
import { partUrl, sendEventWrite } from "./eventWrite";

export type PartFormValues = { note: string; music: PartMusic | null; helpers: string };

/** The words over the description, by part. */
const NOTE_LABEL: Record<PartId, string> = {
  oracion: "Nota (opcional)",
  dinamica1: "Descripción de la dinámica",
  dinamica2: "Descripción de la dinámica",
  platica: "Tema",
};
const NOTE_PLACEHOLDER: Record<PartId, string> = {
  oracion: "Algo que el equipo deba saber",
  dinamica1: "En qué consiste, en pocas palabras",
  dinamica2: "En qué consiste, en pocas palabras",
  platica: "De qué vas a hablar",
};

/** Short enough for two pills side by side on a phone; the full words are the accessible name. */
const MUSIC_SHORT: Record<"oracion" | "platica", Record<PartMusic, string>> = {
  oracion: { track: "Track", alabanza: "Alguien de alabanza" },
  platica: { track: "Track al final", alabanza: "Canción con alabanza" },
};

/** What the body sends for a text field: its trimmed text, or `null` to clear it. */
const textOrNull = (v: string): string | null => (v.trim() ? v.trim() : null);

const same = (a: PartFormValues, b: PartFormValues) => a.note === b.note && a.music === b.music && a.helpers === b.helpers;

export default function PartForm({
  ministry,
  eventId,
  rev,
  part,
  initial,
  mine,
  who = null,
  defaultOpen = false,
}: {
  ministry: string;
  /** The meeting's document id (`ministryEvent.<uuid>`). */
  eventId: string;
  /** The revision `initial` was read at. */
  rev: string | null;
  part: PartId;
  initial: PartFormValues;
  /** The reader is this part's responsable: the form speaks to them («Tu parte»). */
  mine: boolean;
  /** Who answers for the part, for an editor filling somebody else's («Pau y Mkz»). */
  who?: string | null;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const bodyId = useId();
  const noteId = useId();
  const musicId = useId();
  const spec = partSpec(part);
  const [open, setOpen] = useState(defaultOpen);
  const [values, setValues] = useState<PartFormValues>(initial);
  // What the values were loaded from, the revision that came with it, and `from`: the revision the
  // PAGE held when this base was set. After a save the base is the answered revision while the
  // page still holds the one before, so «the page changed» is `rev !== base.from`, never
  // `rev !== base.rev` (that comparison threw a just-saved text back to the old one).
  const [base, setBase] = useState<{ rev: string | null; values: PartFormValues; from: string | null }>({
    rev,
    values: initial,
    from: rev,
  });
  // A save found the meeting changed: take the next revision the page brings, keep the text.
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !same(values, base.values);
  // Derived during render (no effect): the page refreshed and handed another revision.
  if (rev !== base.from) {
    if (!dirty) {
      // Untouched: follow the page.
      setBase({ rev, values: initial, from: rev });
      setValues(initial);
      if (stale) setStale(false);
    } else if (rev === base.rev) {
      // The refresh after my own save, with more typed since: same revision, nothing to take.
      setBase({ ...base, from: rev });
    } else if (stale) {
      // After a refused save the newer revision becomes the base; the typed text stays, so it is
      // still «dirty» against what is stored and the person saves again, having seen the page.
      setBase({ rev, values: initial, from: rev });
      setStale(false);
    }
    // Touched and not refused: keep the old base, so the save answers 409 and the person looks.
  }

  if (!spec) return null;
  const musicWords = part === "oracion" || part === "platica" ? MUSIC_WORDS[part] : null;
  const musicShort = part === "oracion" || part === "platica" ? MUSIC_SHORT[part] : null;
  const left = PART_LIMITS.note - values.note.length;

  function patch(p: Partial<PartFormValues>) {
    setValues((v) => ({ ...v, ...p }));
    setError(null);
  }

  async function save() {
    if (saving) return;
    if (!base.rev) {
      setError("Recarga la página para llenar esta parte.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { _rev: base.rev, note: textOrNull(values.note) };
      if (spec?.music) body.music = values.music;
      if (spec?.helpers) body.helpers = textOrNull(values.helpers);
      const r = await sendEventWrite("PATCH", partUrl(ministry, eventId, part), body);
      if (!r.ok) {
        if (r.stale) {
          // Someone saved this meeting first. The text stays; the page above shows what changed.
          setStale(true);
          setError("La reunión cambió mientras escribías. Revisa lo que dice arriba y guarda de nuevo.");
          router.refresh();
          return;
        }
        setError(r.message);
        return;
      }
      // What is stored now is what the form holds: the next save starts from the new revision.
      setBase({ rev: r.rev, values, from: rev });
      toast({ message: mine ? "Tu parte quedó guardada" : `${spec?.label ?? "Parte"} guardada`, tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label={mine ? `Tu parte: ${spec.label}` : spec.label}
      className={`brand-surface overflow-hidden rounded-[var(--brand-radius-panel)] ${mine ? "border-positive-fg/40" : ""}`}
    >
      <div className="relative flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className={`font-label text-[10px] uppercase tracking-[0.16em] ${mine ? "text-positive-fg" : "text-ink-dim"}`}>
            {mine ? "Tu parte" : who ? `Parte de ${who}` : "Sin asignar"}
          </p>
          <h3 className="break-words pt-1 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.02em] text-ink">
            {spec.label}
          </h3>
        </div>
        {/* The whole head is the hit area, as on a meeting's card (see `MeetingCard` for why the
            button gives up the house press). */}
        <Button
          variant="round"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Ocultar ${spec.label}` : `Llenar ${spec.label}`}
          onClick={() => setOpen((o) => !o)}
          className="!h-9 !w-9 after:absolute after:inset-0 after:content-[''] active:!transform-none"
        >
          <ChevronDownIcon size={16} className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`} />
        </Button>
      </div>
      <Collapse open={open} id={bodyId}>
        <div className="space-y-5 border-t border-ink/[0.08] px-5 pb-5 pt-4">
          <p className="font-body text-[15px] leading-snug text-ink-muted">{PART_ASK[part]}</p>

          {musicWords && musicShort && (
            <div>
              <span id={musicId} className={`${HAIRLINE_LABEL_CLASS} mb-2 block`}>
                Música
              </span>
              <SegmentedControl<PartMusic>
                labelledBy={musicId}
                value={values.music}
                onChange={(music) => patch({ music })}
                size="md"
                options={[
                  { value: "track", label: musicShort.track, ariaLabel: musicWords.track.option },
                  { value: "alabanza", label: musicShort.alabanza, ariaLabel: musicWords.alabanza.option },
                ]}
              />
              {values.music === "alabanza" && (
                <p className="pt-2.5 font-body text-[14px] leading-snug text-ink-muted">
                  Al guardar se le avisa a quien organiza al equipo de alabanza. Tú no eliges quién toca.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={noteId} className={HAIRLINE_LABEL_CLASS}>
                {NOTE_LABEL[part]}
              </label>
              <span
                aria-hidden="true"
                className={`font-label text-[11px] tabular-nums ${left <= 20 ? "text-warning-fg" : "text-ink-dim"}`}
              >
                {values.note.length}/{PART_LIMITS.note}
              </span>
            </div>
            <textarea
              id={noteId}
              className={`${HAIRLINE_INPUT_CLASS} min-h-[6.5rem] resize-y`}
              maxLength={PART_LIMITS.note}
              value={values.note}
              placeholder={NOTE_PLACEHOLDER[part]}
              aria-describedby={`${noteId}-limit`}
              onChange={(e) => patch({ note: e.target.value })}
            />
            <p id={`${noteId}-limit`} className="sr-only">
              Máximo {PART_LIMITS.note} caracteres; llevas {values.note.length}.
            </p>
          </div>

          {spec.helpers && (
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Jóvenes que apoyan (opcional)</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                value={values.helpers}
                maxLength={PART_LIMITS.helpers}
                placeholder="Sus nombres, si alguien del grupo te ayudará"
                onChange={(e) => patch({ helpers: e.target.value })}
              />
            </label>
          )}

          {error && (
            <p role="alert" className="border-l-2 border-negative-strong/60 py-0.5 pl-3 font-body text-[15px] leading-snug text-negative-fg">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {!dirty && !error && base.values.note && <span className="font-body text-[14px] text-ink-dim">Guardado</span>}
            <Button variant="primary" size="lg" onClick={save} busy={saving} busyLabel="Guardando…" disabled={!dirty}>
              {mine ? "Guardar mi parte" : "Guardar"}
            </Button>
          </div>
        </div>
      </Collapse>
    </section>
  );
}
