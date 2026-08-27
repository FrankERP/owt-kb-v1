"use client";

// The private lead ↔ admin conversation on a proposal (Child A §7), shared by
// both surfaces: the lead's editor and the admin Control Room card.
//
// Rendering is deliberately UNCONDITIONAL. The blocks this replaces were gated
// (`{proposal.lead_notes && …}`, `{status === "changes_requested" && …}`), and
// inheriting those conditions would hide the thread on a `pending` proposal —
// which is exactly where the conversation happens.

import { useState } from "react";
import { orderedMessages, isThreadOpen } from "@/app/utils/proposalThread";
import { PROPOSAL_NOTES_MAX } from "@/app/utils/proposalNotesLimit";
import { useTransientValue } from "@/app/utils/useTransientValue";

export interface ThreadMessage {
  _key?: string;
  author?: string | null;
  author_name?: string | null;
  author_role?: string;
  kind?: string;
  body?: string;
  at?: string;
}

interface Props {
  messages: ThreadMessage[] | null | undefined;
  /** The viewer's Sanity id, for right-aligning their own bubbles. */
  viewerId?: string | null;
  /** Which side of the conversation the viewer is on — drives the heading only. */
  viewerRole: "lead" | "admin";
  serviceDate: string;
  /** Resolves when the post has committed. Must reject on failure. */
  onPost: (body: string) => Promise<void>;
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
}: Props) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, showError] = useTransientValue<string | null>(null, 6000);

  const today = new Date().toLocaleDateString("sv", { timeZone: SERVICE_TIME_ZONE });
  const ordered = orderedMessages(messages ?? []);
  // The same predicate the two routes enforce server-side. A hidden composer is
  // not a guard; this is the courtesy half of it.
  const open = isThreadOpen({ serviceDate, today });

  async function post() {
    const body = draft.trim();
    if (!body || posting) return;
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

  return (
    <section className="space-y-3">
      <h3 className="font-label text-xs uppercase tracking-widest text-mono-500">
        {viewerRole === "lead" ? "Conversación con los admins" : "Conversación con el líder"}
      </h3>

      {ordered.length === 0 ? (
        <p className="font-body text-sm text-mono-600">Aún no hay mensajes.</p>
      ) : (
        <ol className="space-y-2">
          {ordered.map((m, i) => {
            const mine = !!viewerId && m.author === viewerId;
            const fromAdmin = m.author_role === "admin";
            return (
              <li
                key={m._key ?? `m${i}`}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 ${
                    fromAdmin
                      ? "border-negative-strong/30 bg-negative-strong/10 text-negative-muted"
                      : "border-surface-accent-30 bg-accent/5 text-mono-300"
                  }`}
                >
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                    {authorLabel(m)}
                  </p>
                  <p className="whitespace-pre-wrap font-body text-sm">{m.body}</p>
                </div>
                <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                  {stamp(m.at, today)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {open ? (
        <div className="space-y-2">
          <textarea
            className="w-full resize-none rounded-lg border border-edge-control bg-transparent px-3 py-2 font-body text-sm transition-colors placeholder:text-placeholder focus:border-accent focus:outline-none"
            rows={2}
            maxLength={PROPOSAL_NOTES_MAX}
            placeholder="Escribe un mensaje…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={posting}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={post}
              disabled={posting || !draft.trim()}
              className="rounded-lg border border-edge-control px-3 py-1.5 font-label text-xs uppercase tracking-widest text-mono-300 transition-colors hover:border-accent disabled:opacity-50"
            >
              {posting ? "Enviando…" : "Enviar"}
            </button>
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
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
