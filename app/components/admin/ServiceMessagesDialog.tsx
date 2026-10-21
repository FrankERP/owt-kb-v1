"use client";

// «Mensajes del servicio» — the admin's conversation with one service's leads,
// opened from the service card (Servicios in /admin, or a DayCard) (ADR-0065).
//
// It shows the WHOLE conversation: what admins wrote on the service itself
// (`serviceThread.<roleId>`) and, once the leads have created one, the shared
// proposal's own thread — ordered together by `at` in `ProposalThread`. A post
// here always goes to the service thread, with or without a proposal, so the
// admin needs no proposal to exist and the leads read it in their editor either
// way. «Es el mensaje del pastor» marks the post as the pastor's (`pastor_note`).
//
// Fetched when it opens, never before: a card on the board costs no read.

import { useEffect, useState } from "react";
import CueDialog from "@/app/components/ui/CueDialog";
import Button from "@/app/components/ui/Button";
import Skeleton from "@/app/components/ui/Skeleton";
import ProposalThread, { type ThreadMessage } from "@/app/components/ProposalThread";

interface Conversation {
  service: {
    _id: string;
    service_date: string;
    published?: boolean | null;
    leads?: Array<{ id?: string | null; name?: string | null }> | null;
  };
  messages?: ThreadMessage[] | null;
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

  /**
   * Post, then replace ONLY the service thread from the response — the proposal's
   * messages stay as loaded. `messages: null` means the post landed but the
   * read-back did not: append the message the route returns, so the admin sees
   * it sent (a silent clear would invite a retype, and a second email to the
   * leads). The update applies only to the service it was posted for: the
   * dialog may have been reopened on another one meanwhile. Rethrows so the
   * composer keeps its text.
   */
  async function post(body: string, opts: { pastor: boolean }) {
    if (!roleId) throw new Error("no service");
    const postedFor = roleId;
    const res = await fetch(`/api/admin/service-threads/${encodeURIComponent(postedFor)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, pastor: opts.pastor }),
    });
    if (!res.ok) throw new Error("post failed");
    const out: { message?: StoredMessage | null; messages?: ThreadMessage[] | null } = await res.json();
    setResult((prev) => {
      if (!prev?.data || prev.data.service._id !== postedFor) return prev;
      const sent = out.message ? asThreadMessage(out.message, viewerId) : null;
      const messages = out.messages ?? (sent ? [...(prev.data.messages ?? []), sent] : prev.data.messages);
      return { ...prev, data: { ...prev.data, messages } };
    });
  }

  const leadNames = (data?.service.leads ?? []).map((l) => l?.name).filter((n): n is string => !!n);
  const all = [...(data?.messages ?? []), ...(data?.proposal?.messages ?? [])];

  return (
    <CueDialog open={open} title={title} label={title} mode="sheet" size="md" onDismiss={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        {loading && <Skeleton className="h-32 w-full" rounded="lg" />}

        {error && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-body text-sm text-negative-fg">No se pudo cargar la conversación.</p>
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Reintentar
            </Button>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="space-y-1">
              <p className="font-body text-sm text-mono-400">
                {leadNames.length > 0 ? `Líderes: ${leadNames.join(", ")}` : "Este servicio aún no tiene líder."}
              </p>
              <p className="font-body text-xs text-mono-500">
                {data.service.published === false
                  ? "Aún no está publicado: no se avisa a nadie; los líderes lo verán en su propuesta cuando se publique."
                  : data.proposal
                    ? "Los líderes lo ven en su propuesta y les llega por correo."
                    : "Aún no hay propuesta: los líderes lo ven al abrirla y les llega por correo."}
              </p>
            </div>
            <ProposalThread
              messages={all}
              viewerId={viewerId}
              viewerRole="admin"
              title="Conversación con los líderes"
              serviceDate={data.service.service_date}
              onPost={post}
              pastorOption
            />
          </>
        )}
      </div>
    </CueDialog>
  );
}
