"use client";

// The private lead ↔ admin conversation on a proposal (Child A §7), shared by
// both surfaces: the lead's editor and the admin Control Room card.
//
// Rendering is deliberately UNCONDITIONAL. The blocks this replaces were gated
// (`{proposal.lead_notes && …}`, `{status === "changes_requested" && …}`), and
// inheriting those conditions would hide the thread on a `pending` proposal —
// which is exactly where the conversation happens.
//
// NO UNREAD INDICATOR, deliberately. Real read marks were chosen over a derived
// "newer than your last visit" signal, which lies in the case that matters —
// someone who opened the page without reading. Before adding one, read
// **ADR-0024**: the two obvious homes for that state (`setlistProposal.readBy[]`
// and a map on `teamMembers`) both turn a page view into a write on a protected,
// revision-asserted document, which 409s every open lead editor and trips the
// admin's fail-closed review lock.

import { useState } from "react";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { orderedMessages, isThreadOpen } from "@/app/utils/proposalThread";
import { PROPOSAL_NOTES_MAX } from "@/app/utils/proposalNotesLimit";
import { useTransientValue } from "@/app/utils/useTransientValue";
import Button from "@/app/components/ui/Button";

export interface ThreadMessage {
  _key?: string;
  author?: string | null;
  author_name?: string | null;
  author_role?: string;
  kind?: string;
  body?: string;
  at?: string;
  /** Set when its author edited it (service-thread messages only, ADR-0065). */
  edited_at?: string | null;
}

interface Props {
  messages: ThreadMessage[] | null | undefined;
  /** The viewer's Sanity id, for right-aligning their own bubbles. */
  viewerId?: string | null;
  /** Which side of the conversation the viewer is on — drives the heading only. */
  viewerRole: "lead" | "admin";
  serviceDate: string;
  /**
   * Resolves when the post has committed. Must reject on failure. ABSENT means
   * the viewer can read but not post here — the lead's view of what admins wrote
   * before the proposal existed (ADR-0065), where `readOnlyHint` says where to
   * answer instead.
   */
  onPost?: (body: string) => Promise<void>;
  /**
   * Which messages the viewer may edit or delete — the admin's service dialog
   * only (ADR-0065, amended 2026-10-24): an admin's OWN service-thread messages.
   * The server checks authorship again; this only decides what to offer.
   */
  canModify?: (m: ThreadMessage) => boolean;
  /** Resolves when the edit committed; must reject on failure (the editor stays open). */
  onEdit?: (key: string, body: string) => Promise<void>;
  /** Resolves when the delete committed; must reject on failure. */
  onDelete?: (key: string) => Promise<void>;
  /** Overrides the heading — e.g. a service thread that talks to several leads. */
  title?: string;
  /** Shown instead of the composer when `onPost` is absent. */
  readOnlyHint?: string;
}

const SERVICE_TIME_ZONE = "America/Mexico_City";

/**
 * A message's timestamp, as a calendar-day label plus the time.
 *
 * `at` is a full ISO datetime, so it is converted to a LOCAL CALENDAR DAY first
 * and the day difference is taken between those strings — never elapsed hours,
 * which drift across a DST boundary, and never a bare `new Date(iso)` for the
 * day itself. CLAUDE.md's timezone invariant.
 */
function stamp(at: string | undefined, today: string): string {
  if (!at) return "";
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return "";
  const day = instant.toLocaleDateString("sv", { timeZone: SERVICE_TIME_ZONE });
  const time = instant.toLocaleTimeString("es-MX", {
    timeZone: SERVICE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  if (day === today) return `Hoy ${time}`;
  // Both sides are `YYYY-MM-DD`, so this is a calendar-day comparison pinned at
  // local noon, not an elapsed-time one.
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toLocaleDateString("sv")) return `Ayer ${time}`;
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
  return `${label} ${time}`;
}

/**
 * Who to show as the author.
 *
 * Keyed on the ROLE, not on the missing name: two production `admin_notes` have
 * nobody to attribute them to, and falling back to "Admin" whenever a name is
 * absent would render an author-less `lead_note` as "Admin" in a history admins
 * read to decide things.
 */
function authorLabel(m: ThreadMessage): string {
  // What the pastor sent, relayed by an admin (ADR-0065): the pastor is what the
  // leads look for, the admin is who brought it.
  if (m.kind === "pastor_note") {
    return m.author_name ? `Mensaje del pastor · vía ${m.author_name}` : "Mensaje del pastor";
  }
  if (m.author_name) return m.author_name;
  if (m.author_role === "admin") return "Admin";
  if (m.author_role === "lead") return "Líder";
  return "—";
}

export default function ProposalThread({
  messages,
  viewerId,
  viewerRole,
  serviceDate,
  onPost,
  title,
  readOnlyHint,
  canModify,
  onEdit,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  // One message at a time is being edited, or asked «¿Borrar?» about.
  const [editing, setEditing] = useState<{ key: string; body: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [modifying, setModifying] = useState(false);
  const [error, showError] = useTransientValue<string | null>(null, 6000);

  // `serviceTodayIso()`, not a second inline `new Date()`, and the reason is a
  // test that lied. This computed the same string the shared helper does, but
  // through its OWN clock read — so `proposalsPanelThread.test.tsx`, which pins
  // "today" by mocking `serviceReadiness`, never reached the one decision that
  // matters here: whether the thread is open. Those tests passed only while the
  // fixture's service date happened to still be in the future, and went red the
  // day after it. One clock, one place to pin it.
  const today = serviceTodayIso();
  const ordered = orderedMessages(messages ?? []);
  // The same predicate the two routes enforce server-side. A hidden composer is
  // not a guard; this is the courtesy half of it.
  const open = isThreadOpen({ serviceDate, today });

  async function post() {
    const body = draft.trim();
    if (!body || posting || !onPost) return;
    setPosting(true);
    try {
      await onPost(body);
      // Cleared ONLY on success. A failed post that wiped the composer would
      // lose what the person wrote, in a channel whose promise is that nothing
      // is lost.
      setDraft("");
    } catch {
      showError("Error al enviar el mensaje");
    } finally {
      setPosting(false);
    }
  }

  async function saveEdit() {
    if (!editing || !onEdit || modifying) return;
    const body = editing.body.trim();
    if (!body) return;
    setModifying(true);
    try {
      await onEdit(editing.key, body);
      setEditing(null);
    } catch {
      // The editor stays open with the text: nothing typed is lost.
      showError("No se pudo guardar el cambio");
    } finally {
      setModifying(false);
    }
  }

  async function confirmDelete(key: string) {
    if (!onDelete || modifying) return;
    setModifying(true);
    try {
      await onDelete(key);
      setConfirmingDelete(null);
    } catch {
      showError("No se pudo borrar el mensaje");
    } finally {
      setModifying(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-label text-xs uppercase tracking-widest text-mono-500">
        {title ?? (viewerRole === "lead" ? "Conversación con los admins" : "Conversación con el líder")}
      </h3>

      {ordered.length === 0 ? (
        <p className="font-body text-sm text-mono-600">Aún no hay mensajes.</p>
      ) : (
        <ol className="space-y-2">
          {ordered.map((m, i) => {
            const mine = !!viewerId && m.author === viewerId;
            const fromAdmin = m.author_role === "admin";
            const fromPastor = m.kind === "pastor_note";
            const modifiable = !!m._key && !!canModify?.(m) && (!!onEdit || !!onDelete);
            const editingThis = modifiable && editing?.key === m._key ? editing : null;
            const isConfirming = modifiable && confirmingDelete === m._key;
            return (
              <li
                key={m._key ?? `m${i}`}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 ${
                    fromPastor
                      ? "border-accent/40 bg-accent/10 text-ink"
                      : fromAdmin
                        ? "border-negative-strong/30 bg-negative-strong/10 text-negative-muted"
                        : "border-surface-accent-30 bg-accent/5 text-mono-300"
                  }`}
                >
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                    {authorLabel(m)}
                  </p>
                  {editingThis ? (
                    <textarea
                      aria-label="Editar mensaje"
                      className="mt-1 w-full min-w-[16rem] resize-none rounded-lg border border-edge-control bg-transparent px-3 py-2 font-body text-[16px] sm:text-sm text-ink transition-colors focus:border-accent focus:outline-none"
                      rows={3}
                      maxLength={PROPOSAL_NOTES_MAX}
                      value={editingThis.body}
                      onChange={(e) => setEditing({ key: editingThis.key, body: e.target.value })}
                      disabled={modifying}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap font-body text-sm">{m.body}</p>
                  )}
                </div>
                <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                  {stamp(m.at, today)}
                  {m.edited_at ? " · editado" : ""}
                </span>
                {modifiable && (
                  <div className="flex items-center gap-1">
                    {editingThis ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={modifying}>
                          Cancelar
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={saveEdit}
                          disabled={!editingThis.body.trim()}
                          busy={modifying}
                          busyLabel="Guardando…"
                        >
                          Guardar
                        </Button>
                      </>
                    ) : isConfirming ? (
                      <>
                        <span className="font-body text-xs text-mono-400">¿Borrar este mensaje?</span>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(null)} disabled={modifying}>
                          No
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => confirmDelete(m._key!)}
                          busy={modifying}
                          busyLabel="Borrando…"
                        >
                          Sí, borrar
                        </Button>
                      </>
                    ) : (
                      <>
                        {onEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setConfirmingDelete(null);
                              setEditing({ key: m._key!, body: m.body ?? "" });
                            }}
                            disabled={modifying}
                          >
                            Editar
                          </Button>
                        )}
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(null);
                              setConfirmingDelete(m._key!);
                            }}
                            disabled={modifying}
                          >
                            Borrar
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!onPost ? (
        readOnlyHint ? <p className="font-body text-xs text-mono-600">{readOnlyHint}</p> : null
      ) : open ? (
        <div className="space-y-2">
          <textarea
            className="w-full resize-none rounded-lg border border-edge-control bg-transparent px-3 py-2 font-body text-[16px] sm:text-sm transition-colors placeholder:text-placeholder focus:border-accent focus:outline-none"
            rows={2}
            maxLength={PROPOSAL_NOTES_MAX}
            placeholder="Escribe un mensaje…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={posting}
          />
          {/* The one action of the composer is the primary, at the end of the
              line where a form's submit sits (bloque 5); the error reads before it. */}
          <div className="flex items-center justify-end gap-3">
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
            <Button variant="primary" size="sm" onClick={post} disabled={!draft.trim()} busy={posting} busyLabel="Enviando…">
              Enviar
            </Button>
          </div>
        </div>
      ) : (
        <p className="font-body text-xs text-mono-600">
          La conversación se cerró al pasar el servicio.
        </p>
      )}
    </section>
  );
}
