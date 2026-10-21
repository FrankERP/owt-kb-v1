"use client";

// «Mensajes del servicio» — the admin's conversation with one service's leads,
// opened from the service card (Servicios in /admin, or a DayCard) (ADR-0064).
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
  const [data, setData] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !roleId) return;
    let live = true;
    setLoading(true);
    setError(false);
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/service-threads/${encodeURIComponent(roleId)}/messages`);
        if (!res.ok) throw new Error("load failed");
        const body: Conversation = await res.json();
        if (live) setData(body);
      } catch {
        if (live) setError(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, roleId, attempt]);

  /**
   * Post, then replace ONLY the service thread from the response — the proposal's
   * messages stay as loaded. `messages: null` means the post landed but the
   * read-back did not: keep what is on screen. Rethrows so the composer keeps
   * its text.
   */
  async function post(body: string, opts: { pastor: boolean }) {
    if (!roleId) throw new Error("no service");
    const res = await fetch(`/api/admin/service-threads/${encodeURIComponent(roleId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, pastor: opts.pastor }),
    });
    if (!res.ok) throw new Error("post failed");
    const out: { messages?: ThreadMessage[] | null } = await res.json();
    setData((current) => (current ? { ...current, messages: out.messages ?? current.messages } : current));
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
