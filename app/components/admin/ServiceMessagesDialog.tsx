"use client";

// «Mensajes del servicio» — what admins tell one service, opened from the
// service card (Servicios in /admin, or a DayCard) (ADR-0065, amended 2026-10-24).
// Three parts, each with its own writer:
//
//  1. **Mensaje del pastor** — ONE per service, on `serviceThread.<roleId>`
//     (`PUT …/pastor-message`). Editable and removable at any time; the DayCard
//     shows it to the whole team. Only its first appearance mails the leads.
//  2. **Mensaje para el equipo** — the live setlist's `team_notes`
//     (`PUT …/team-notes`), editable after publishing, and movable into (1) when
//     somebody put the pastor's words in the wrong place. Needs a setlist.
//  3. **Conversación con los líderes** — the service thread plus the shared
//     proposal's own, ordered together by `at` in `ProposalThread`. A post always
//     goes to the service thread; an admin edits or deletes only their OWN
//     service-thread messages (`…/messages/[key]`), never a lead's.
//
// Fetched when it opens, never before: a card on the board costs no read.

import { useEffect, useState } from "react";
import CueDialog from "@/app/components/ui/CueDialog";
import Button from "@/app/components/ui/Button";
import Skeleton from "@/app/components/ui/Skeleton";
import ProposalThread, { type ThreadMessage } from "@/app/components/ProposalThread";
import { PROPOSAL_NOTES_MAX } from "@/app/utils/proposalNotesLimit";
import { useTransientValue } from "@/app/utils/useTransientValue";
import { pastorMessageStamp } from "@/app/utils/serviceMessageEdit";
import type { PastorMessageRow } from "@/app/utils/serviceThread";

interface TeamNotesTarget {
  text: string;
  observed: { id: string; rev: string };
}

interface Conversation {
  service: {
    _id: string;
    _type?: string;
    service_date: string;
    published?: boolean | null;
    leads?: Array<{ id?: string | null; name?: string | null }> | null;
  };
  messages?: ThreadMessage[] | null;
  pastor_message?: PastorMessageRow | null;
  /** Where the «Mensaje para el equipo» lives; null = no (single) setlist yet. */
  teamNotes?: TeamNotesTarget | null;
  proposal?: { _id: string; status?: string; messages?: ThreadMessage[] | null } | null;
}

/** The message as stored — `author` a reference, no resolved name — which the
 *  POST returns beside its read-back. */
type StoredMessage = Omit<ThreadMessage, "author"> & { author?: { _ref?: string } | null };

/** The stored message in the read rows' shape, its author named the way the
 *  read-back would: the admin who just sent it. */
function asThreadMessage(m: StoredMessage, viewerId: string | null): ThreadMessage {
  return { ...m, author: m.author?._ref ?? viewerId, author_name: m.author_name ?? null };
}

const TEXTAREA =
  "w-full resize-y rounded-lg border border-edge-control bg-transparent px-3 py-2 font-body text-[16px] sm:text-sm transition-colors placeholder:text-placeholder focus:border-accent focus:outline-none";

/** A 409 from either field writer: someone else changed it since it loaded. */
class StaleError extends Error {}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new StaleError("stale");
  if (!res.ok) throw new Error("save failed");
  return res.json();
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-label text-xs uppercase tracking-widest text-mono-500">{children}</h3>;
}

export default function ServiceMessagesDialog({
  open,
  roleId,
  title,
  viewerId = null,
  onClose,
}: {
  open: boolean;
  /** The service's role document id. */
  roleId: string | null;
  /** «Mensajes · Domingo 26 oct», drawn by the caller, which knows the service. */
  title: string;
  viewerId?: string | null;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  // One read per (service, attempt), and what it answered, tagged with that key.
  // Deriving what to show from the tag — rather than resetting state in the
  // effect — means a dialog reopened on ANOTHER service never paints the previous
  // service's conversation under the new title, not even for one frame.
  const key = open && roleId ? `${roleId}#${attempt}` : null;
  const [result, setResult] = useState<{ key: string; data: Conversation | null; error: boolean } | null>(null);

  useEffect(() => {
    if (!key || !roleId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/service-threads/${encodeURIComponent(roleId)}/messages`);
        if (!res.ok) throw new Error("load failed");
        const body: Conversation = await res.json();
        if (live) setResult({ key, data: body, error: false });
      } catch {
        if (live) setResult({ key, data: null, error: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [key, roleId]);

  const current = result && result.key === key ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? false;
  const loading = !!key && !current;
  const reload = () => setAttempt((n) => n + 1);

  /** Apply `fn` to the loaded conversation, only if it is still `forRole`'s. */
  function update(forRole: string, fn: (d: Conversation) => Conversation) {
    setResult((prev) => {
      if (!prev?.data || prev.data.service._id !== forRole) return prev;
      return { ...prev, data: fn(prev.data) };
    });
  }

  const base = roleId ? `/api/admin/service-threads/${encodeURIComponent(roleId)}` : null;

  /**
   * Post, then replace ONLY the service thread from the response — the proposal's
   * messages stay as loaded. `messages: null` means the post landed but the
   * read-back did not: append the message the route returns, so the admin sees
   * it sent (a silent clear would invite a retype, and a second email to the
   * leads). Rethrows so the composer keeps its text.
   */
  async function post(body: string) {
    if (!roleId || !base) throw new Error("no service");
    const postedFor = roleId;
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error("post failed");
    const out: { message?: StoredMessage | null; messages?: ThreadMessage[] | null } = await res.json();
    update(postedFor, (d) => {
      const sent = out.message ? asThreadMessage(out.message, viewerId) : null;
      return { ...d, messages: out.messages ?? (sent ? [...(d.messages ?? []), sent] : d.messages) };
    });
  }

  /** Edit or delete one of the admin's own messages; `null` read-back = apply locally. */
  async function modify(msgKey: string, body: string | null) {
    if (!roleId || !base) throw new Error("no service");
    const forRole = roleId;
    const res = await fetch(`${base}/messages/${encodeURIComponent(msgKey)}`, {
      method: body === null ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(body === null ? {} : { body: JSON.stringify({ body }) }),
    });
    if (!res.ok) throw new Error("modify failed");
    const out: { messages?: ThreadMessage[] | null } = await res.json();
    update(forRole, (d) => ({
      ...d,
      messages:
        out.messages ??
        (d.messages ?? []).flatMap((m) =>
          m._key !== msgKey ? [m] : body === null ? [] : [{ ...m, body, edited_at: new Date().toISOString() }],
        ),
    }));
  }

  const leadNames = (data?.service.leads ?? []).map((l) => l?.name).filter((n): n is string => !!n);
  // Only the service thread's own messages are the admin's to change; the
  // proposal's belong to its conversation with the leads.
  const serviceKeys = new Set((data?.messages ?? []).map((m) => m._key).filter(Boolean));
  const all = [...(data?.messages ?? []), ...(data?.proposal?.messages ?? [])];
  const published = data?.service.published !== false;

  return (
    <CueDialog open={open} title={title} label={title} mode="sheet" size="md" onDismiss={onClose}>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {loading && <Skeleton className="h-32 w-full" rounded="lg" />}

        {error && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-body text-sm text-negative-fg">No se pudo cargar la conversación.</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          </div>
        )}

        {data && !loading && roleId && base && (
          <>
            <p className="font-body text-sm text-mono-400">
              {leadNames.length > 0 ? `Líderes: ${leadNames.join(", ")}` : "Este servicio aún no tiene líder."}
            </p>

            <PastorMessageSection
              // Remounted per load, so a reload or another service starts clean.
              key={`pastor-${key}`}
              url={`${base}/pastor-message`}
              stored={data.pastor_message ?? null}
              published={published}
              onSaved={(row) => update(roleId, (d) => ({ ...d, pastor_message: row }))}
              onReload={reload}
            />

            <TeamNotesSection
              key={`team-${key}`}
              url={`${base}/team-notes`}
              pastorUrl={`${base}/pastor-message`}
              target={data.teamNotes ?? null}
              hasPastorMessage={!!data.pastor_message?.body}
              onSaved={(target) => update(roleId, (d) => ({ ...d, teamNotes: target }))}
              onPastorSaved={(row) => update(roleId, (d) => ({ ...d, pastor_message: row }))}
              onReload={reload}
            />

            <div className="space-y-2">
              <ProposalThread
                messages={all}
                viewerId={viewerId}
                viewerRole="admin"
                title="Conversación con los líderes"
                serviceDate={data.service.service_date}
                onPost={post}
                canModify={(m) => !!viewerId && m.author === viewerId && serviceKeys.has(m._key)}
                onEdit={(k, body) => modify(k, body)}
                onDelete={(k) => modify(k, null)}
              />
              <p className="font-body text-xs text-mono-500">
                {!published
                  ? "Aún no está publicado: no se avisa a nadie; los líderes lo verán en su propuesta cuando se publique."
                  : data.proposal
                    ? "Los líderes lo ven en su propuesta y les llega por correo."
                    : "Aún no hay propuesta: los líderes lo ven al abrirla y les llega por correo."}
              </p>
            </div>
          </>
        )}
      </div>
    </CueDialog>
  );
}

// ─── 1. Mensaje del pastor ───────────────────────────────────────────────────

function PastorMessageSection({
  url,
  stored,
  published,
  onSaved,
  onReload,
}: {
  url: string;
  stored: PastorMessageRow | null;
  published: boolean;
  onSaved: (row: PastorMessageRow | null) => void;
  onReload: () => void;
}) {
  const current = stored?.body ? stored : null;
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, showError] = useTransientValue<string | null>(null, 6000);

  async function save(body: string) {
    if (saving) return;
    setSaving(true);
    try {
      const out = await putJson<{ pastor_message?: PastorMessageRow | null }>(url, {
        body,
        observed: pastorMessageStamp(current),
      });
      onSaved(out.pastor_message ?? null);
      setDraft(null);
      setConfirmingClear(false);
    } catch (err) {
      if (err instanceof StaleError) setStale(true);
      else showError("No se pudo guardar el mensaje del pastor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2">
      <SectionTitle>Mensaje del pastor</SectionTitle>

      {stale ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-recency-fg/40 bg-recency-fg/10 px-3 py-2">
          <p className="font-body text-sm text-recency-faint/90">
            Otro admin cambió este mensaje mientras lo editabas. Recarga para ver el actual.
          </p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            Recargar
          </Button>
        </div>
      ) : draft !== null ? (
        <div className="space-y-2">
          <textarea
            aria-label="Mensaje del pastor"
            className={TEXTAREA}
            rows={6}
            maxLength={PROPOSAL_NOTES_MAX}
            placeholder="Pega aquí el mensaje del pastor…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <div className="flex items-center justify-end gap-2">
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => save(draft.trim())}
              disabled={!draft.trim()}
              busy={saving}
              busyLabel="Guardando…"
            >
              Guardar
            </Button>
          </div>
        </div>
      ) : current ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-surface-accent-30 bg-accent/5 px-4 py-3">
            <p className="whitespace-pre-wrap font-body text-sm text-ink-muted/90">{current.body}</p>
            <p className="mt-1 font-label text-[11px] uppercase tracking-widest text-mono-500">
              {current.author_name ? `Lo guardó ${current.author_name}` : "Guardado"}
              {current.edited_at ? " · editado" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
            {confirmingClear ? (
              <>
                <span className="font-body text-xs text-mono-400">¿Quitar el mensaje del pastor?</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(false)} disabled={saving}>
                  No
                </Button>
                <Button variant="danger" size="sm" onClick={() => save("")} busy={saving} busyLabel="Quitando…">
                  Sí, quitar
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)}>
                  Quitar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setDraft(current.body ?? "")}>
                  Editar
                </Button>
              </>
            )}
          </div>
          <p className="font-body text-xs text-mono-500">Todo el equipo lo ve en la tarjeta del servicio. Corregirlo no vuelve a avisar.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-sm text-mono-500">
            {published
              ? "Aún no hay. Al guardarlo, les llega a los líderes por correo y todo el equipo lo ve en la tarjeta."
              : "Aún no hay. Todo el equipo lo verá en la tarjeta cuando se publique el servicio."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setDraft("")}>
            Agregar
          </Button>
        </div>
      )}
    </section>
  );
}

// ─── 2. Mensaje para el equipo ───────────────────────────────────────────────

function TeamNotesSection({
  url,
  pastorUrl,
  target,
  hasPastorMessage,
  onSaved,
  onPastorSaved,
  onReload,
}: {
  url: string;
  pastorUrl: string;
  target: TeamNotesTarget | null;
  hasPastorMessage: boolean;
  onSaved: (target: TeamNotesTarget) => void;
  onPastorSaved: (row: PastorMessageRow | null) => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingMove, setConfirmingMove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, showError] = useTransientValue<string | null>(null, 8000);

  if (!target) {
    return (
      <section className="space-y-2">
        <SectionTitle>Mensaje para el equipo</SectionTitle>
        <p className="font-body text-sm text-mono-500">
          Este servicio aún no tiene setlist. El mensaje para el equipo llega con la propuesta de los líderes.
        </p>
      </section>
    );
  }
  const text = target.text;

  /** Saves `teamNotes` against the loaded revision; throws on failure. */
  async function writeNotes(teamNotes: string) {
    if (!target) throw new Error("no setlist");
    const out = await putJson<{ teamNotes?: string | null; observed: { id: string; rev: string } }>(url, {
      teamNotes,
      observed: target.observed,
    });
    onSaved({ text: out.teamNotes ?? "", observed: out.observed });
  }

  async function save() {
    if (draft === null || saving) return;
    setSaving(true);
    try {
      await writeNotes(draft.trim());
      setDraft(null);
    } catch (err) {
      if (err instanceof StaleError) setStale(true);
      else showError("No se pudo guardar el mensaje para el equipo");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Two writes, pastor's message FIRST: if the second fails the text is in both
   * places — nothing is lost — and the admin is told to clear the note by hand.
   * The reverse order could lose the text between the two.
   */
  async function moveToPastor() {
    if (saving) return;
    setSaving(true);
    let pastorSaved = false;
    try {
      const out = await putJson<{ pastor_message?: PastorMessageRow | null }>(pastorUrl, {
        body: text,
        observed: null,
      });
      onPastorSaved(out.pastor_message ?? null);
      pastorSaved = true;
      await writeNotes("");
      setConfirmingMove(false);
    } catch (err) {
      if (pastorSaved) {
        setConfirmingMove(false);
        showError("Ya es el mensaje del pastor, pero no se pudo quitar de aquí. Bórralo con «Editar».");
      } else if (err instanceof StaleError) {
        setStale(true);
      } else {
        showError("No se pudo mover el mensaje");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2">
      <SectionTitle>Mensaje para el equipo</SectionTitle>

      {stale ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-recency-fg/40 bg-recency-fg/10 px-3 py-2">
          <p className="font-body text-sm text-recency-faint/90">
            Alguien cambió el setlist o el mensaje mientras lo editabas. Recarga para ver el actual.
          </p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            Recargar
          </Button>
        </div>
      ) : draft !== null ? (
        <div className="space-y-2">
          <textarea
            aria-label="Mensaje para el equipo"
            className={TEXTAREA}
            rows={4}
            maxLength={PROPOSAL_NOTES_MAX}
            placeholder="Mensaje para todo el equipo…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <div className="flex items-center justify-end gap-2">
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={save} busy={saving} busyLabel="Guardando…">
              Guardar
            </Button>
          </div>
          <p className="font-body text-xs text-mono-500">Déjalo vacío para quitarlo. Guardar no avisa a nadie.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {text ? (
            <div className="rounded-lg border border-ink/[0.08] bg-surface-lift/[0.03] px-4 py-3">
              <p className="whitespace-pre-wrap font-body text-sm text-ink-muted/90">{text}</p>
            </div>
          ) : (
            <p className="font-body text-sm text-mono-500">Este setlist no tiene mensaje para el equipo.</p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error && <span className="font-body text-xs text-negative-muted">{error}</span>}
            {confirmingMove ? (
              <>
                <span className="font-body text-xs text-mono-400">
                  ¿Moverlo al mensaje del pastor? Les llega a los líderes por correo.
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingMove(false)} disabled={saving}>
                  No
                </Button>
                <Button variant="primary" size="sm" onClick={moveToPastor} busy={saving} busyLabel="Moviendo…">
                  Sí, mover
                </Button>
              </>
            ) : (
              <>
                {/* Only into an EMPTY pastor's message: moving onto one would
                    overwrite it. With one already there, edit it directly. */}
                {text && !hasPastorMessage && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingMove(true)}>
                    Mover a mensaje del pastor
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setDraft(text)}>
                  {text ? "Editar" : "Agregar"}
                </Button>
              </>
            )}
          </div>
          <p className="font-body text-xs text-mono-500">
            Si apruebas una nueva propuesta de los líderes, su mensaje reemplaza este.
          </p>
        </div>
      )}
    </section>
  );
}
