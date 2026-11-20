"use client";

import { useState } from "react";
import Button from "./ui/Button";
import { useToast } from "./ui/Toast";
import { SHEET_TITLE } from "@/app/utils/homeHero";

/**
 * «Apps conectadas» in `/me/ajustes` (ADR-0091, spec D9): the person's live native-app sessions on
 * this deployment, each with «Cerrar sesión en ese dispositivo». The list comes from the Server
 * Component; a revoke POSTs `/api/me/app-sessions/[grantId]/revoke` and, only on success, drops the
 * row. Rendered only when there is at least one session — or, while a super-admin impersonates, as
 * one line saying why the list is hidden (it would be the target's sessions).
 */

export interface ConnectedAppRow {
  id: string;
  platform: "ios" | "android" | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const PLATFORM_LABEL: Record<"ios" | "android", string> = {
  ios: "iPhone, iPad o Mac",
  android: "Android",
};

function day(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
}

export default function ConnectedAppsPanel({
  initial,
  impersonating = false,
}: {
  initial: ConnectedAppRow[];
  impersonating?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  if (impersonating) {
    return (
      <section className="mt-11" aria-labelledby="apps-conectadas">
        <h2 id="apps-conectadas" className={`${SHEET_TITLE} mb-4`}>
          Apps conectadas
        </h2>
        <p className="font-body text-sm text-ink-dim">Termina la suplantación para ver las apps conectadas.</p>
      </section>
    );
  }
  if (rows.length === 0) return null;

  async function revoke(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/me/app-sessions/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setRows((current) => current.filter((r) => r.id !== id));
      toast({ message: "Sesión cerrada en ese dispositivo.", tone: "ok", duration: 3000 });
    } catch {
      toast({ message: "No se pudo cerrar la sesión. Intenta de nuevo.", tone: "error", duration: 3500 });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-11" aria-labelledby="apps-conectadas">
      <h2 id="apps-conectadas" className={`${SHEET_TITLE} mb-4`}>
        Apps conectadas
      </h2>
      <ul className="space-y-3">
        {rows.map((row) => {
          const since = day(row.createdAt);
          const used = day(row.lastUsedAt);
          return (
            <li key={row.id} className="rounded-xl border border-ink-dim/20 px-4 py-3">
              <p className="font-body text-[17px] text-ink">
                App Backstage — {row.platform ? PLATFORM_LABEL[row.platform] : "dispositivo"}
              </p>
              <p className="font-body text-sm text-ink-dim">
                {since ? `Desde el ${since}` : "Fecha desconocida"}
                {used ? ` · último uso el ${used}` : ""}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={busy !== null}
                onClick={() => void revoke(row.id)}
              >
                {busy === row.id ? "Cerrando…" : "Cerrar sesión en ese dispositivo"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
