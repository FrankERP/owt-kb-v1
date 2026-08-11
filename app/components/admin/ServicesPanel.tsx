"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import MonthGenerator from "./MonthGenerator";
import { useSolverConfig } from "./useSolverConfig";
import {
  SERVICE_SOURCE_KEYS,
  selectServiceCapabilities,
  serviceTodayIso,
  type ServiceCapabilities,
  type ServiceControl,
  type ServiceSourceKey,
} from "./serviceReadiness";
import {
  SOURCE_ENDPOINTS,
  canFilterMonths,
  captureActiveMode,
  checkActiveMode,
  editModalControl,
  guardControl,
  initialSourceRecords,
  isValidSourcePayload,
  latchInvalidation,
  mutationOutcomeMessage,
  reduceSourceRecords,
  retryTargets,
  rolesView,
  sourceStates,
  unreadyMessage,
  type ActiveMode,
  type ActiveModeInvalidation,
  type ActiveModeSnapshot,
  type ServiceSourceRecords,
} from "./serviceSourceState";
import {
  INTEGRITY_QUEUE_TITLE,
  buildIntegrityQueue,
  integrityQueueSummary,
  integrityQueueTone,
} from "./serviceIntegrityQueue";
import {
  CARD_STYLE,
  SERVICE_LABEL,
  TONE_CLASS,
  buildPublishConfirmation,
  buildServiceCards,
  commandSummaryCounters,
  commandSummarySegments,
  describeAcknowledgedBlockers,
  formatServiceDate,
  integrityTargetForCard,
  monthTargetPreflight,
  primaryActionRoute,
  proposalHandoffInput,
  serviceCardLabel,
  serviceCardRefs,
  type CardSourceSummaries,
  type MemberOption,
  type PublishConfirmationPlan,
  type PublishOverrideLine,
  type ServiceCardModel,
  type ServiceRole,
  type ServiceType,
} from "./serviceCardModel";
import ServiceReadinessCard, {
  type CardGate,
  type CardGates,
} from "./ServiceReadinessCard";
import { overrideAcknowledgement, type PublishWorkflowBlocker } from "./publishSelection";
import { buildProposalHandoff } from "./proposalHandoff";
import { useServiceHandoff } from "./serviceHandoffContext";
import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import { ParticipationSidebar } from "@/app/components/admin/ParticipationSidebar";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The card/member shapes, identity colours and every presentational decision live
// in `serviceCardModel`; this file keeps the modal and mutation flows.

// ─── Setlist types ────────────────────────────────────────────────────────────

import { SetlistEditor } from "./SetlistEditor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Long Spanish date, parsed at local noon (never a bare `new Date(iso)`). */
const formatDate = (iso: string) => formatServiceDate(iso, "es-MX");

// Spanish message for a rejected mutation. A 409 always means "your view is
// stale": the modal/mode stays open and the operator is told to reload.
async function describeMutationError(res: Response, fallback: string): Promise<string> {
  let code: string | undefined;
  let dependencies: { type?: string }[] | undefined;
  try {
    const body = await res.json();
    code = typeof body?.error === "string" ? body.error : undefined;
    dependencies = body?.details?.dependencies;
  } catch {
    code = undefined;
  }
  switch (code) {
    case "idempotency_mismatch":
      return "Este intento ya se envió con otros datos. Cierra y crea el servicio de nuevo.";
    case "idempotency_key_retired":
      return "Este servicio fue eliminado. Cierra y créalo de nuevo.";
    case "bootstrap_completed_reload":
      return "Se repararon datos internos, pero tu cambio no se aplicó. Recarga e intenta de nuevo.";
    case "target_has_orphaned_dependencies":
    case "role_date_has_dependencies":
    case "role_has_dependencies":
      return `Hay ${dependencies?.length ?? 0} registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada.`;
    case "stale_revision":
      return "Alguien más cambió este servicio. Recarga e intenta de nuevo.";
    case "ambiguous_target":
      return "Ya existe un servicio en esa fecha (o hay duplicados). Recarga y revisa.";
    case "integrity_conflict":
      return "Los datos guardados no pasaron una revisión de integridad. No se modificó nada.";
    case "invalid_request":
      return "La solicitud fue rechazada antes de guardar. Revisa los datos.";
    case "not_found":
      return "Este servicio ya no existe. Recarga la lista.";
    default:
      return res.status === 409 ? "Alguien más cambió este servicio. Recarga e intenta de nuevo." : fallback;
  }
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  wide,
  status,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <CueDialog open title={title} label={title} mode="sheet" size={wide ? "lg" : "sm"} onDismiss={onClose}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        {status && (
          <div>
            <CueDialogStatus tone="error">{status}</CueDialogStatus>
          </div>
        )}
        {children}
      </div>
    </CueDialog>
  );
}


// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ServicesPanel() {
  const [roles, setRoles]       = useState<ServiceRole[]>([]);
  const [members, setMembers]   = useState<MemberOption[]>([]);
  // The five read domains are tracked INDEPENDENTLY: a failure in one never
  // clears another's data and never reads as a clean value (Plan B item 5).
  const [sourceRecords, setSourceRecords] = useState<ServiceSourceRecords>(initialSourceRecords);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [showPastMonths, setShowPastMonths] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  // Delete modal. Roster create/edit now lives in the stored month editor.
  type EditModal = { type: "delete"; role: ServiceRole } | null;
  const [editModal, setEditModal] = useState<EditModal>(null);
  /**
   * THE rule set (P6) — one fetch, one object, both surfaces.
   *
   * This panel owns it because both rule surfaces hang off it: it mounts
   * `MonthGenerator` (both the stored month editor and the create planner).
   * Owning it here keeps every roster surface on one controller.
   *
   * `localStorage` is no longer involved. The retired key answered `null` for a
   * value that was absent OR byte-equal to the shipped seed; that heuristic is
   * now a fact the server states. An absent document, a failed read and a read
   * still in flight remain distinct states in the shared controller.
   */
  const rules = useSolverConfig();
  const [editError, setEditError] = useState<string | null>(null);

  // Month generator
  const [showGenerator, setShowGenerator] = useState(false);
  const [monthEditor, setMonthEditor] = useState<{
    month: string;
    focusRoleId?: string;
    openComposerInitially?: boolean;
  } | null>(null);
  // D10: the generator is a full-width panel that replaces this whole view
  // rather than an overlay on top of it, so its own trigger button unmounts
  // while it's open. Escape-to-close lives in `MonthGenerator` itself; focus
  // restoration on close has to live here, since it's this ref — not anything
  // inside `MonthGenerator` — that still exists once the panel is dismissed.
  const generatorTriggerRef = useRef<HTMLButtonElement>(null);
  const monthEditorTriggerRef = useRef<HTMLButtonElement>(null);
  const newServiceTriggerRef = useRef<HTMLButtonElement>(null);
  const monthEditorOpenerRef = useRef<{ kind: "toolbar" | "new" | "card"; roleId?: string }>({ kind: "toolbar" });
  const wasShowingGeneratorRef = useRef(false);
  const wasShowingMonthEditorRef = useRef(false);
  useEffect(() => {
    if (wasShowingGeneratorRef.current && !showGenerator) {
      generatorTriggerRef.current?.focus();
    }
    wasShowingGeneratorRef.current = showGenerator;
  }, [showGenerator]);
  useEffect(() => {
    if (wasShowingMonthEditorRef.current && !monthEditor) {
      const opener = monthEditorOpenerRef.current;
      requestAnimationFrame(() => {
        if (opener.kind === "new") newServiceTriggerRef.current?.focus();
        else if (opener.kind === "card" && opener.roleId) {
          const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(opener.roleId)
            : opener.roleId.replace(/["\\]/g, "\\$&");
          const cardEdit = document.querySelector<HTMLElement>(`[data-card-id="${escaped}"] button[aria-label="Editar equipo"]`);
          (cardEdit ?? monthEditorTriggerRef.current)?.focus();
        } else monthEditorTriggerRef.current?.focus();
      });
    }
    wasShowingMonthEditorRef.current = !!monthEditor;
  }, [monthEditor]);

  // Setlist
  const [setlistRole, setSetlistRole] = useState<ServiceRole | null>(null);

  // Copy-instruments mode: pick a source card, then a target day to repeat its lineup.
  const [copySource, setCopySource] = useState<string | null>(null);
  const copyMode = copySource !== null;

  // The three A1 integrity summaries, kept beside the roles/members arrays. A
  // failed domain is `null` = unproven; it is NEVER an empty inventory.
  const [summaries, setSummaries] = useState<CardSourceSummaries>({
    roles: null, setlists: null, proposals: null,
  });

  // `Publicar listos` confirmation, the individual override, and safe unpublish —
  // three separate flows on purpose (a hide never routes through publish).
  const [publishPlan, setPublishPlan] = useState<PublishConfirmationPlan | null>(null);
  const [overrideCard, setOverrideCard] = useState<ServiceCardModel | null>(null);
  const [unpublishCard, setUnpublishCard] = useState<ServiceCardModel | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  /**
   * A lost/timed-out publish or unpublish response. Repeat submission is disabled
   * until the read-only `recover` mode says what actually committed.
   */
  const [pendingOutcome, setPendingOutcome] = useState<
    { kind: "publish" | "unpublish"; ids: string[]; published: boolean } | null
  >(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // Transient proposal / integrity handoff, owned by `AdminPanel`.
  const { openReviewTarget, openIntegrityIssue } = useServiceHandoff();

  // ── Independent source loading + per-control capability ───────────────────

  const sources = useMemo(() => sourceStates(sourceRecords), [sourceRecords]);
  const capabilities: ServiceCapabilities = useMemo(
    () => selectServiceCapabilities(sources),
    [sources],
  );
  /** Render-time gate for one control, with the Spanish "which source" copy. */
  const gate = useCallback(
    (control: ServiceControl): CardGate => {
      const capability = capabilities[control];
      return { enabled: capability.enabled, reason: unreadyMessage(capability.blockedBy) };
    },
    [capabilities],
  );
  const view = rolesView(sourceRecords);

  // Active delete/copy snapshots, plus the LATCHED reason each became stale.
  // A stale mode is never submitted: it requires an explicit reload.
  const [snapshots, setSnapshots] = useState<Partial<Record<ActiveMode, ActiveModeSnapshot>>>({});
  const [staleModes, setStaleModes] = useState<Partial<Record<ActiveMode, ActiveModeInvalidation>>>({});

  const openSnapshot = (mode: ActiveMode, control: ServiceControl, observed: readonly ServiceRole[]) => {
    setSnapshots(prev => ({
      ...prev,
      [mode]: captureActiveMode({ mode, control, roles: observed, records: sourceRecords }),
    }));
    setStaleModes(prev => {
      if (!prev[mode]) return prev;
      const next = { ...prev };
      delete next[mode];
      return next;
    });
  };

  const clearSnapshot = (...modes: ActiveMode[]) => {
    setSnapshots(prev => {
      const next = { ...prev };
      let changed = false;
      for (const mode of modes) if (next[mode]) { delete next[mode]; changed = true; }
      return changed ? next : prev;
    });
    setStaleModes(prev => {
      const next = { ...prev };
      let changed = false;
      for (const mode of modes) if (next[mode]) { delete next[mode]; changed = true; }
      return changed ? next : prev;
    });
  };

  // A required source failing/reloading, a selected role disappearing, or an
  // observed revision changing invalidates the open mode — and stays latched.
  useEffect(() => {
    setStaleModes(prev => {
      let changed = false;
      const next = { ...prev };
      for (const mode of Object.keys(snapshots) as ActiveMode[]) {
        const snapshot = snapshots[mode];
        if (!snapshot) continue;
        const latched = latchInvalidation(
          prev[mode] ?? null,
          checkActiveMode(snapshot, { records: sourceRecords, roles }),
        );
        if (latched && latched !== prev[mode]) {
          next[mode] = latched;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [snapshots, sourceRecords, roles]);

  const openEditModal = (next: Exclude<EditModal, null>) => {
    const control = editModalControl("delete");
    // Re-checked at handler entry, not only at render.
    const guard = guardControl(sources, control);
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setEditError(null);
    openSnapshot("delete", control, [next.role]);
    setEditModal(next);
  };

  const closeEditModal = () => {
    setEditError(null);
    clearSnapshot("delete");
    setEditModal(null);
  };

  /**
   * Load the given sources independently. Each one reports its own success or
   * failure; a non-OK response or an unusable payload is an error, never an empty
   * array. Returns the sources that did NOT load, so a caller that just mutated
   * can be honest about an incomplete refresh.
   */
  const loadSources = useCallback(
    async (keys: readonly ServiceSourceKey[] = SERVICE_SOURCE_KEYS): Promise<ServiceSourceKey[]> => {
      setSourceRecords(prev => reduceSourceRecords(prev, { type: "load_start", sources: keys }));
      const results = await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch(SOURCE_ENDPOINTS[key]);
            if (!res.ok) return { key, ok: false, body: null as unknown };
            const body = (await res.json()) as unknown;
            return { key, ok: isValidSourcePayload(key, body), body };
          } catch {
            return { key, ok: false, body: null as unknown };
          }
        }),
      );
      for (const result of results) {
        if (result.key === "roles" && result.ok) setRoles(result.body as ServiceRole[]);
        if (result.key === "members" && result.ok) setMembers(result.body as MemberOption[]);
        // A failed integrity domain drops back to `null` (unproven) rather than
        // keeping a stale inventory that would read as proof.
        if (result.key === "roleTargets") {
          setSummaries(prev => ({ ...prev, roles: result.ok ? (result.body as RoleDomainSummary) : null }));
        }
        if (result.key === "setlistTargets") {
          setSummaries(prev => ({ ...prev, setlists: result.ok ? (result.body as SetlistDomainSummary) : null }));
        }
        if (result.key === "proposals") {
          setSummaries(prev => ({ ...prev, proposals: result.ok ? (result.body as ProposalDomainSummary) : null }));
        }
      }
      setSourceRecords(prev =>
        results.reduce(
          (acc, result) =>
            reduceSourceRecords(
              acc,
              result.ok ? { type: "load_ok", source: result.key } : { type: "load_error", source: result.key },
            ),
          prev,
        ),
      );
      return results.filter(r => !r.ok).map(r => r.key);
    },
    [],
  );

  const retryLoad = useCallback(() => {
    void loadSources(retryTargets(sourceRecords));
  }, [loadSources, sourceRecords]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (editModal?.type !== "delete") return;
    const stale = staleModes.delete;
    if (stale) { setEditError(stale.message); return; }
    const guard = guardControl(sources, "deleteService");
    if (!guard.ok) { setEditError(guard.message ?? "Datos incompletos."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/roles/${editModal.role._id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev: editModal.role._rev }),
      });
      if (res.ok) {
        closeEditModal();
        showToast(
          mutationOutcomeMessage("Eliminado.", await loadSources(), "Eliminado, pero no se pudo actualizar"),
        );
      } else {
        setEditError(await describeMutationError(res, "Error al eliminar."));
        if (res.status === 409) void loadSources();
      }
    } catch {
      setEditError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Copy instruments to another day ─────────────────────────────────────────

  function exitCopyMode() { setCopySource(null); clearSnapshot("copy"); }

  function startCopyInstruments(roleId: string) {
    const guard = guardControl(sources, "copyInstruments");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    const source = roles.find(r => r._id === roleId);
    if (!source) { showToast("Este servicio ya no existe. Recarga la lista."); return; }
    openSnapshot("copy", "copyInstruments", [source]);
    setCopySource(roleId);
  }

  async function copyInstrumentsTo(targetId: string) {
    if (!copySource || copySource === targetId) return;
    const stale = staleModes.copy;
    if (stale) { showToast(stale.message); return; }
    const guard = guardControl(sources, "copyInstruments");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    const source = roles.find(r => r._id === copySource);
    const target = roles.find(r => r._id === targetId);
    if (!source || !target) { showToast("Este servicio ya no existe. Recarga la lista."); return; }
    const count = (source.instruments ?? []).filter(s => s.person).length;
    const fmt = (r: ServiceRole) =>
      new Date(r.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
    if (!confirm(`¿Copiar ${count} instrumento(s) de ${fmt(source)} a ${fmt(target)}? Reemplazará los instrumentos del destino.`)) return;
    setSubmitting(true);
    try {
      // Both observed revisions are sent; the server re-reads the source lineup
      // and patches only the target's instruments in one guarded transaction. On
      // failure copy mode stays open and nothing is claimed.
      const res = await fetch("/api/admin/roles/copy-instruments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: { id: source._id, rev: source._rev },
          target: { id: target._id, rev: target._rev },
        }),
      });
      if (res.ok) {
        exitCopyMode();
        showToast(mutationOutcomeMessage("Instrumentos copiados.", await loadSources()));
      } else {
        // Copy mode stays open; a 409 refresh invalidates the stale selection.
        showToast(await describeMutationError(res, "Error al copiar."));
        if (res.status === 409) void loadSources();
      }
    } catch {
      showToast("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Publish (server-authoritative) ────────────────────────────────────────
  //
  // Three distinct flows, never collapsed into one:
  //   `ready`    — `Publicar listos`, and the card's rule-13 `Publicar`.
  //   `override` — an explicit individual acknowledgement of WORKFLOW blockers.
  //   unpublish  — the separate narrow safe-targeting capability (never publish).
  // Every one re-checks its own capability row at submit, keeps its dialog open on
  // failure, and refuses to repeat a submission whose outcome is unknown.

  /** POST a publish/unpublish request; returns the Spanish outcome, if any. */
  async function submitPublication(input: {
    url: string;
    body: unknown;
    /** For the unknown-outcome recovery: what we asked to become true. */
    outcome: { kind: "publish" | "unpublish"; ids: string[]; published: boolean };
    success: string;
    fallback: string;
    onDone: () => void;
  }): Promise<void> {
    if (pendingOutcome) {
      setPublishError("El resultado anterior es desconocido. Verifícalo antes de reintentar.");
      return;
    }
    setSubmitting(true);
    setPublishError(null);
    try {
      const res = await fetch(input.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
      });
      if (res.ok) {
        input.onDone();
        showToast(mutationOutcomeMessage(input.success, await loadSources()));
      } else {
        // Never close as success. A 409 refreshes so the operator can reload.
        setPublishError(await describeMutationError(res, input.fallback));
        if (res.status === 409) void loadSources();
      }
    } catch {
      // Outcome unknown: do NOT infer failure and do NOT replay automatically.
      // Repeat submission is disabled until `recover` says what committed, and the
      // authoritative bundle is refetched so any retry uses a new observation.
      setPendingOutcome(input.outcome);
      setPublishError(
        "No se pudo confirmar el resultado. Verifica qué quedó guardado antes de reintentar.",
      );
      void loadSources();
    } finally {
      setSubmitting(false);
    }
  }

  /** Read-only outcome verification. An observed commit is recovered success. */
  async function verifyPendingOutcome() {
    const pending = pendingOutcome;
    if (!pending) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        pending.kind === "publish" ? "/api/admin/roles/publish-ready" : "/api/admin/roles/unpublish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "recover",
            roles: pending.ids.map(id => ({ id })),
            ...(pending.kind === "publish" ? { published: pending.published } : {}),
          }),
        },
      );
      if (res.ok) {
        setPendingOutcome(null);
        setPublishError(null);
        setPublishPlan(null);
        setOverrideCard(null);
        setUnpublishCard(null);
        showToast(mutationOutcomeMessage("Cambio confirmado.", await loadSources()));
      } else {
        // Not in the requested state, or the refetch itself failed: stay unknown
        // and require an explicit retry over a wholly new observed bundle.
        setPublishError(
          await describeMutationError(
            res,
            "El resultado sigue sin confirmarse. Recarga y vuelve a intentar.",
          ),
        );
        if (res.status === 409) {
          setPendingOutcome(null);
          void loadSources();
        }
      }
    } catch {
      setPublishError("No se pudo verificar el resultado. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  /** `Publicar listos` (a batch) or a single rule-13 `Publicar` — always `ready`. */
  async function publishReady(entries: { id: string; rev: string }[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    if (entries.length === 0) return;
    await submitPublication({
      url: "/api/admin/roles/publish-ready",
      body: { mode: "ready", roles: entries },
      outcome: { kind: "publish", ids: entries.map(e => e.id), published: true },
      success: entries.length === 1 ? "Servicio publicado." : `${entries.length} servicios publicados.`,
      fallback: "Error al publicar.",
      onDone: () => { setPublishPlan(null); setOverrideCard(null); },
    });
  }

  /**
   * `Publicar todos` — ONE override batch carrying the ready drafts (acknowledging
   * nothing) and the bulk-acknowledgeable ones together. The server recomputes
   * every entry's own workflow set, so a service whose blockers moved since the
   * modal opened rejects the whole request rather than publishing silently.
   */
  async function publishOverrideAll(entries: PublishOverrideLine[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    if (entries.length === 0) return;
    await submitPublication({
      url: "/api/admin/roles/publish-ready",
      body: {
        mode: "override",
        roles: entries.map(({ id, rev, acknowledgedBlockers }) => ({
          id,
          rev,
          acknowledgedBlockers: [...acknowledgedBlockers],
        })),
      },
      outcome: { kind: "publish", ids: entries.map(e => e.id), published: true },
      success: entries.length === 1 ? "Servicio publicado." : `${entries.length} servicios publicados.`,
      fallback: "Error al publicar.",
      onDone: () => { setPublishPlan(null); setOverrideCard(null); },
    });
  }

  /** The explicit individual override: only WORKFLOW blockers, one service. */
  async function publishOverride(card: ServiceCardModel, blockers: readonly PublishWorkflowBlocker[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    await submitPublication({
      url: "/api/admin/roles/publish-ready",
      body: {
        mode: "override",
        roles: [{ id: card.role._id, rev: card.role._rev, acknowledgedBlockers: [...blockers] }],
      },
      outcome: { kind: "publish", ids: [card.role._id], published: true },
      success: "Servicio publicado.",
      fallback: "Error al publicar.",
      onDone: () => { setOverrideCard(null); setPublishPlan(null); },
    });
  }

  /**
   * Hide a published service. Deliberately narrow: it needs only roles +
   * role-target integrity, so an unsafe/incomplete/unavailable member, setlist or
   * proposal source must NOT prevent it, and it never sends acknowledgements.
   */
  async function unpublishService(card: ServiceCardModel) {
    const guard = guardControl(sources, "unpublish");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    await submitPublication({
      url: "/api/admin/roles/unpublish",
      body: { roles: [{ id: card.role._id, rev: card.role._rev }] },
      outcome: { kind: "unpublish", ids: [card.role._id], published: false },
      success: "Servicio oculto.",
      fallback: "Error al ocultar.",
      onDone: () => setUnpublishCard(null),
    });
  }

  function openPublishPlan(cards: readonly ServiceCardModel[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setPublishPlan(buildPublishConfirmation(cards));
  }

  function openOverride(card: ServiceCardModel) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setOverrideCard(card);
  }

  function openUnpublish(card: ServiceCardModel) {
    // Re-checked here AND at confirmation.
    const guard = guardControl(sources, "unpublish");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setUnpublishCard(card);
  }

  // ── Setlist editor ────────────────────────────────────────────────────────

  function openSetlist(role: ServiceRole) {
    const guard = guardControl(sources, "editSetlist");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setSetlistRole(role);
  }

  function openGenerator() {
    const guard = guardControl(sources, "generateMonth");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setMonthEditor(null);
    setShowGenerator(true);
  }

  function openMonthEditor(
    month: string,
    focusRoleId?: string,
    openComposerInitially = false,
    opener: { kind: "toolbar" | "new" | "card"; roleId?: string } = { kind: "toolbar" },
  ) {
    if (openComposerInitially) {
      const guard = guardControl(sources, "createService");
      if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    }
    monthEditorOpenerRef.current = opener;
    setShowGenerator(false);
    setMonthEditor({ month, focusRoleId, openComposerInitially });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const today = serviceTodayIso();

  // Split months into current/future and past
  const currentYM   = today.slice(0, 7);
  const allMonths   = Array.from(new Set(roles.map(r => r.date.slice(0, 7)))).sort();
  const futureMonths = allMonths.filter(ym => ym >= currentYM);
  const pastMonths   = allMonths.filter(ym => ym < currentYM).reverse(); // most-recent first

  const toggleMonth = (ym: string) =>
    setSelectedMonths(prev => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym); else next.add(ym);
      return next;
    });

  // ── Readiness models (one per card) ────────────────────────────────────────
  //
  // The global integrity queue is built from the SAME three summaries, over every
  // loaded card (not just the visible ones), so a month filter can never push an
  // owned issue into the global `Integridad de datos` list. Its `cardIssues`
  // (lock/legacy only) are what `deriveServiceReadiness` consumes.
  const queue = useMemo(
    () =>
      buildIntegrityQueue({
        sources,
        cards: serviceCardRefs(roles, summaries),
        roles: summaries.roles,
        setlists: summaries.setlists,
        proposals: summaries.proposals,
      }),
    [sources, roles, summaries],
  );

  const cards = useMemo(
    () => buildServiceCards({ roles, members, sources, summaries, todayIso: today, queue }),
    [roles, members, sources, summaries, today, queue],
  );

  // No filter selected → show upcoming only (default). Months selected → exactly those.
  const visibleCards = selectedMonths.size === 0
    ? cards.filter(c => !c.isPast)
    : cards.filter(c => selectedMonths.has(c.role.date.slice(0, 7)));

  const monthLabel =
    selectedMonths.size === 0 ? "Próximos"
    : selectedMonths.size === 1 ? fmtYM([...selectedMonths][0])
    : `${selectedMonths.size} meses`;

  const counters = commandSummaryCounters({ all: cards, visible: visibleCards });
  const summaryLine = commandSummarySegments(counters).join(" · ");
  const queueTone = integrityQueueTone(queue);

  // Availability conflicts across the visible, still-upcoming cards.
  const conflictNotices = visibleCards
    .filter(card => !card.isPast && card.readiness.availabilityStatus === "conflict")
    .flatMap(card =>
      card.readiness.conflicts.map(conflict => ({
        name: conflict.memberName,
        label: SERVICE_LABEL[card.role._type],
        date: card.day ?? card.role.date.slice(0, 10),
        note: conflict.note,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  /** Per-target month/create preflight over the currently observed bundle. */
  const preflightTarget = useCallback(
    (type: ServiceType, date: string) =>
      monthTargetPreflight({ sources, summaries, queue, type, date }),
    [sources, summaries, queue],
  );

  /**
   * Run ONE card's primary action. The action itself is the shipped ladder's
   * result; this only opens the existing flow its route names, and re-checks that
   * flow's capability row at handler entry.
   */
  function runPrimaryAction(card: ServiceCardModel) {
    switch (primaryActionRoute(card.readiness)) {
      case "service_modal":
        openMonthEditor(card.role.date.slice(0, 7), card.role._id, false, { kind: "card", roleId: card.role._id });
        return;
      case "setlist_editor":
        // Unreachable for a non-editable target (the route falls back), but the
        // guard stays so a malformed setlist can never open the editor.
        if (!card.readiness.setlistEditable) { openIntegrityDetails(card); return; }
        openSetlist(card.role);
        return;
      case "publish":
        openPublishPlan([card]);
        return;
      case "proposal_handoff": {
        const guard = guardControl(sources, "proposalHandoff");
        if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
        const target = buildProposalHandoff(proposalHandoffInput(card));
        if (!target) { showToast("No hay una propuesta que abrir para este servicio."); return; }
        openReviewTarget(target);
        return;
      }
      case "integrity_details":
        openIntegrityDetails(card);
        return;
      case "retry_sources":
        retryLoad();
        return;
      default:
        return;
    }
  }

  /** Read-only integrity details, by explicit id — never an editable setlist. */
  function openIntegrityDetails(card: ServiceCardModel) {
    const target = integrityTargetForCard(card);
    if (!target) {
      showToast("No se pudo verificar este servicio. Reintenta la carga.");
      retryLoad();
      return;
    }
    openIntegrityIssue(target);
  }

  // ── Per-control gates (one snapshot, five individual source states) ─────────
  const publishGate       = gate("publishReady");
  const generateGate      = gate("generateMonth");
  const createGate        = gate("createService");
  const editTeamGate      = gate("editTeam");
  const swapGate          = gate("swap");
  const changeDateGate    = gate("changeServiceDate");
  const participationGate = gate("participationSidebar");
  const cardGates: CardGates = {
    editTeam: gate("editTeam"),
    editSetlist: gate("editSetlist"),
    copyInstruments: gate("copyInstruments"),
    deleteService: gate("deleteService"),
    publish: publishGate,
    unpublish: gate("unpublish"),
    swap: gate("swap"),
    proposalHandoff: gate("proposalHandoff"),
  };

  // Honest banner: which sources are missing, and its retry. Availability/team
  // are explicitly "unverified" while members is unavailable — never "clear".
  const unreadySummary = unreadyMessage(
    SERVICE_SOURCE_KEYS.filter(key => sources[key] !== "ready").map(key => ({
      source: key,
      state: sources[key] as "loading" | "error",
    })),
  );
  const availabilityUnverified = sources.members !== "ready";

  // ── Month editor / generator — full-width panels, not dialogs (D10) ──────
  //
  // While open, it REPLACES the whole two-column layout below (sidebar
  // included), not just the card list: `lg:grid-cols-[320px_1fr]` leaves only
  // ~1048px of a 1440px viewport for the list, barely better than the old
  // `CueDialog`'s `max-w-4xl` (~75px columns on a 10-column month) and still
  // short of the width the grid needs. `CueDialog` has no size above `lg` and
  // widening that shared token risks every other dialog in the app, so the
  // generator leaves `Modal`/`CueDialog` entirely instead.
  if (monthEditor) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl uppercase tracking-wide">Editar mes</h1>
        </div>
        <MonthGenerator
          key={`stored:${monthEditor.month}:${monthEditor.focusRoleId ?? "month"}`}
          mode="stored"
          initialMonth={monthEditor.month}
          focusRoleId={monthEditor.focusRoleId}
          openComposerInitially={monthEditor.openComposerInitially}
          members={members}
          existingRoles={roles}
          allRoles={roles}
          rules={rules}
          capability={monthEditor.openComposerInitially
            ? { enabled: createGate.enabled, reason: createGate.reason }
            : { enabled: editTeamGate.enabled, reason: editTeamGate.reason }}
          storedCapabilities={{
            edit: { enabled: editTeamGate.enabled, reason: editTeamGate.reason },
            create: { enabled: createGate.enabled, reason: createGate.reason },
            swap: { enabled: swapGate.enabled, reason: swapGate.reason },
            changeDate: { enabled: changeDateGate.enabled, reason: changeDateGate.reason },
          }}
          storedSource={{
            roles,
            integrity: summaries.roles,
            rolesStatus: sourceRecords.roles.status,
            integrityStatus: sourceRecords.roleTargets.status,
            rolesGeneration: sourceRecords.roles.generation,
            integrityGeneration: sourceRecords.roleTargets.generation,
            reload: async () =>
              (await loadSources(["roles", "roleTargets"])).length === 0,
          }}
          onClose={() => setMonthEditor(null)}
          onCreated={() => showToast("Servicio creado y verificado.")}
        />
      </div>
    );
  }

  if (showGenerator) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl uppercase tracking-wide">Generar mes</h1>
        </div>
        <MonthGenerator
          members={members}
          existingRoles={roles}
          // `ServiceRole` is a structural superset of `ParticipantRole` (richer
          // `leads`/`bgvs`/`chorus`/`instruments`/`foh` member shape, same
          // `_type`/`date`), so no cast is needed — and none should be added
          // back: if `ServiceRole` ever drifts out of that superset relationship,
          // this is meant to be a `tsc` error, not a silent narrowing that lets
          // `savedWindow` (D12, inside `MonthGenerator`) degrade to a blank
          // "sin historial reciente" strip.
          allRoles={roles}
          // The same controller used by the stored month editor. One object, so
          // neither planner surface can drift onto its own rules copy.
          rules={rules}
          // Re-checked at preview and at confirmation, not just at open.
          capability={{ enabled: generateGate.enabled, reason: generateGate.reason }}
          // Per-target A1/A2 preflight: only proven-`creatable` targets are posted.
          preflight={preflightTarget}
          onClose={() => setShowGenerator(false)}
          onCreated={async () => {
            showToast(mutationOutcomeMessage("Servicios generados.", await loadSources()));
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Command summary — replaces the plain count header */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl uppercase tracking-wide">Servicios</h1>
          {view !== "loading" && (
            <>
              <p className={`mt-0.5 font-label text-xs uppercase tracking-widest text-mono-500 ${CARD_STYLE.longText}`}>
                {summaryLine}
              </p>
              {/* The global integrity entry: never a clean zero when an inventory failed. */}
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                  {INTEGRITY_QUEUE_TITLE}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${
                    TONE_CLASS[
                      queueTone === "clean" ? "approved" : queueTone === "unknown" ? "unknown" : "error"
                    ]
                  }`}
                >
                  {integrityQueueSummary(queue)}
                </span>
              </p>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {visibleCards.some(c => c.readiness.publishState === "draft") && (
            <button type="button"
              disabled={!publishGate.enabled}
              title={publishGate.reason ?? undefined}
              onClick={() => openPublishPlan(visibleCards)}
              className="min-h-[44px] rounded-lg bg-surface-accent-solid px-3 font-label text-xs uppercase tracking-widest transition-colors hover:bg-accent-deep/80 dark:hover:bg-surface-accent-solid disabled:opacity-40">
              Publicar listos ({counters.readyToPublish})
            </button>
          )}
          <button ref={generatorTriggerRef} onClick={openGenerator}
            disabled={!generateGate.enabled}
            title={generateGate.reason ?? undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-accent-20 font-label text-xs uppercase tracking-widest text-mono-500 hover:text-accent hover:border-accent/30 dark:hover:border-surface-accent-20 transition-colors disabled:opacity-40">
            📅 Generar mes
          </button>
          <button
            ref={monthEditorTriggerRef}
            type="button"
            onClick={() => openMonthEditor(selectedMonths.size === 1 ? [...selectedMonths][0] : currentYM, undefined, false, { kind: "toolbar" })}
            disabled={!editTeamGate.enabled}
            title={editTeamGate.reason ?? undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-accent-20 font-label text-xs uppercase tracking-widest text-mono-500 hover:text-accent hover:border-accent/30 dark:hover:border-surface-accent-20 transition-colors disabled:opacity-40"
          >
            Editar mes
          </button>
          {!copyMode && (
            <button ref={newServiceTriggerRef} onClick={() => openMonthEditor(selectedMonths.size === 1 ? [...selectedMonths][0] : currentYM, undefined, true, { kind: "new" })}
              disabled={!createGate.enabled}
              title={createGate.reason ?? undefined}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-accent-solid hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-40">
              <span className="text-base leading-none">+</span> Nuevo
            </button>
          )}
        </div>
      </div>

      {/* Source state — names the missing source and offers its retry */}
      {view !== "loading" && unreadySummary && (
        <div className="rounded-lg border border-warning-fg/40 bg-warning-fg/10 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-label text-xs uppercase tracking-widest text-warning-strong">Datos incompletos</p>
            <p className="font-body text-xs text-mono-300 mt-0.5">{unreadySummary}</p>
            {availabilityUnverified && (
              <p className="font-body text-xs text-mono-400 mt-0.5">
                El equipo y la disponibilidad no se pudieron verificar.
              </p>
            )}
          </div>
          <button type="button" onClick={retryLoad}
            className="px-3 py-1.5 rounded-lg border border-warning-fg/40 font-label text-[11px] uppercase tracking-widest text-warning-soft hover:bg-warning-fg/15 transition-colors shrink-0">
            Reintentar carga
          </button>
        </div>
      )}

      {/* Month filter */}
      {canFilterMonths(sourceRecords) && allMonths.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-label text-[11px] uppercase tracking-widest text-mono-600 shrink-0">Mes:</span>
            <MonthPill label="Próximos" selected={selectedMonths.size === 0} onClick={() => setSelectedMonths(new Set())} />
            {futureMonths.map(ym => (
              <MonthPill key={ym} label={fmtYM(ym)} selected={selectedMonths.has(ym)} onClick={() => toggleMonth(ym)} />
            ))}
            {pastMonths.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPastMonths(v => !v)}
                className="font-label text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-accent/10 text-mono-600 hover:border-accent/25 hover:text-mono-400 transition-colors flex items-center gap-1"
              >
                Roles previos
                <span className={`transition-transform ${showPastMonths ? "rotate-180" : ""}`}>▾</span>
              </button>
            )}
          </div>
          {showPastMonths && pastMonths.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pl-12">
              {pastMonths.map(ym => (
                <MonthPill key={ym} label={fmtYM(ym)} selected={selectedMonths.has(ym)} onClick={() => toggleMonth(ym)} past />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Availability conflict summary */}
      {view !== "loading" && conflictNotices.length > 0 && (
        <div className="rounded-lg border border-negative-strong/50 bg-negative-strong/10 px-4 py-3">
          <p className="font-label text-xs uppercase tracking-widest text-negative-fg flex items-center gap-1.5">
            ⚠ {conflictNotices.length} conflicto{conflictNotices.length !== 1 ? "s" : ""} de disponibilidad
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {conflictNotices.map((c, i) => (
              <li key={i} className="font-body text-xs text-mono-300">
                <span className="text-negative-muted font-semibold">{c.name}</span>
                {" · "}{c.label}{" "}
                {new Date(c.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}
                {c.note && (
                  <span className="text-mono-500 italic"> — &quot;{c.note}&quot;</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Copy-instruments mode banner */}
      {copyMode && (() => {
        const src = roles.find(r => r._id === copySource);
        const srcLabel = src
          ? new Date(src.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })
          : "";
        return (
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="font-label text-xs uppercase tracking-widest text-accent">Copiar instrumentos</p>
              <p className="font-body text-xs text-mono-500 mt-0.5">
                Copiando los instrumentos de <span className="text-mono-300 capitalize">{srcLabel}</span>. Haz clic en «Pegar aquí» en el día destino (reemplaza sus instrumentos).
              </p>
            </div>
            <button onClick={exitCopyMode} className="font-label text-[11px] uppercase tracking-widest text-mono-500 hover:text-negative-fg transition-colors ml-4 shrink-0">
              Cancelar
            </button>
          </div>
        );
      })()}

      {/* An invalidated copy selection is never pasted: reload first. */}
      {copyMode && staleModes.copy && (
        <div className="rounded-lg border border-negative-strong/40 bg-negative-strong/10 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <p className="font-body text-xs text-negative-muted">{staleModes.copy.message}</p>
          <button type="button" onClick={() => { exitCopyMode(); retryLoad(); }}
            className="px-3 py-1.5 rounded-lg border border-negative-fg/40 font-label text-[11px] uppercase tracking-widest text-negative-soft hover:bg-negative-strong/15 transition-colors shrink-0">
            Recargar
          </button>
        </div>
      )}

      {/* Loading */}
      {view === "loading" && <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-surface-accent-wash animate-pulse" />)}</div>}

      {/* A roles failure prevents card rendering and shows retry instead */}
      {view === "error" && (
        <div className="rounded-lg border border-negative-strong/50 bg-negative-strong/10 px-4 py-6 text-center space-y-3">
          <p className="font-label text-xs uppercase tracking-widest text-negative-fg">No se pudieron cargar los servicios</p>
          <p className="font-body text-sm text-mono-300">
            No se pueden mostrar los servicios sin esa fuente. Reintenta la carga.
          </p>
          <button type="button" onClick={retryLoad}
            className="px-4 py-2 rounded-lg border border-negative-fg/40 font-label text-xs uppercase tracking-widest text-negative-soft hover:bg-negative-strong/15 transition-colors">
            Reintentar carga
          </button>
        </div>
      )}

      {/* Grid */}
      {view === "cards" && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
          {participationGate.enabled ? (
            <ParticipationSidebar
              roles={visibleCards.map(c => c.role) as ParticipantRole[]}
              monthLabel={monthLabel}
            />
          ) : (
            // Never compute participation from partial membership.
            <aside className="rounded-xl border border-accent/20 bg-surface-ink-l40-d100-base p-3 space-y-2">
              <p className="font-label text-xs uppercase tracking-widest text-accent">Participaciones</p>
              <p className="font-body text-xs text-mono-400">{participationGate.reason}</p>
              <button type="button" onClick={retryLoad}
                className="px-3 py-1.5 rounded-lg border border-accent/30 font-label text-[11px] uppercase tracking-widest text-accent hover:bg-accent/10 transition-colors">
                Reintentar carga
              </button>
            </aside>
          )}
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {counters.upcoming === 0 && selectedMonths.size === 0 && (
            <p className="font-body text-sm text-mono-500 text-center py-12">No hay servicios próximos.</p>
          )}
          {visibleCards.map(card => (
            <ServiceReadinessCard
              key={card.cardId}
              card={card}
              sources={sources}
              todayIso={today}
              gates={cardGates}
              onPrimaryAction={() => runPrimaryAction(card)}
              onEdit={() => openMonthEditor(card.role.date.slice(0, 7), card.role._id, false, { kind: "card", roleId: card.role._id })}
              onDelete={() => openEditModal({ type: "delete", role: card.role })}
              onSetlist={() => openSetlist(card.role)}
              // The menu's `Publicar` is the explicit override path when workflow
              // blockers remain; a clean draft goes through the ready confirmation.
              onPublish={() =>
                card.readiness.isReadyToPublish ? openPublishPlan([card]) : openOverride(card)
              }
              onUnpublish={() => openUnpublish(card)}
              swapMode={false}
              swapSource={null}
              onCardSwapSelect={() => {}}
              onMemberChipClick={() => {}}
              copyMode={copyMode}
              isCopySource={copySource === card.role._id}
              onCopyStart={() => startCopyInstruments(card.role._id)}
              onCopyPick={() => copyInstrumentsTo(card.role._id)}
            />
          ))}
          </div>
        </div>
      )}


      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-surface-raised-alt border border-accent/30 font-label text-xs uppercase tracking-widest shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {editModal?.type === "delete" && (() => {
        // Dependency inventory must be complete (all five) and the observed
        // record still current, or this destructive confirmation is disabled.
        const blocked = staleModes.delete?.message ?? cardGates.deleteService.reason;
        return (
          <Modal title="Eliminar servicio" onClose={closeEditModal} status={editError ?? blocked}>
            <p className="font-body text-sm text-mono-400">¿Eliminar el servicio del <span className="text-negative-fg font-semibold">{formatDate(editModal.role.date)}</span>? Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={closeEditModal} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">Cancelar</button>
              {staleModes.delete ? (
                <button onClick={() => { closeEditModal(); retryLoad(); }} className="flex-1 py-2 rounded-lg border border-accent/30 font-label text-xs uppercase tracking-widest text-accent hover:bg-accent/10 transition-colors">Recargar</button>
              ) : (
                <button onClick={handleDelete} disabled={submitting || !!blocked} title={blocked ?? undefined} className="flex-1 py-2 rounded-lg bg-negative-surface/60 hover:bg-negative-border/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{submitting ? "Eliminando..." : "Eliminar"}</button>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* `Publicar listos` — the readiness-aware bulk confirmation */}
      {publishPlan && (
        <Modal
          title="Publicar listos"
          onClose={() => { setPublishPlan(null); setPublishError(null); setPendingOutcome(null); }}
          status={publishError}
        >
          <div className={CARD_STYLE.dialog}>
            <p className="font-body text-sm text-mono-400">
              «Publicar {publishPlan.selected.length}» envía solo los servicios que pasaron toda
              la verificación. Los demás se muestran abajo con su motivo.
            </p>
            <section>
              <p className="font-label text-[11px] uppercase tracking-widest text-accent">
                Se publicarán ({publishPlan.selected.length})
              </p>
              {publishPlan.selected.length === 0 ? (
                <p className="font-body text-xs italic text-mono-500">
                  Ningún borrador visible está listo para publicar.
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {publishPlan.selected.map(entry => (
                    <li key={entry.id} className={`font-body text-xs text-mono-300 ${CARD_STYLE.longText}`}>
                      {entry.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {publishPlan.overrideAdds.length > 0 && (
              <section>
                <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
                  Solo con «Publicar todos» ({publishPlan.overrideAdds.length})
                </p>
                <p className="mt-0.5 font-body text-xs text-mono-500">
                  Se publican los roles para que cada quien vea el día que le toca. El setlist
                  se puede completar después.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {publishPlan.overrideAdds.map(entry => (
                    <li key={entry.id} className={`font-body text-xs text-mono-400 ${CARD_STYLE.longText}`}>
                      <span className="text-mono-300">{entry.label}</span> — {entry.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {publishPlan.overrideBlocked.length > 0 && (
              <section>
                <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
                  Se omiten ({publishPlan.overrideBlocked.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {publishPlan.overrideBlocked.map(entry => (
                    <li key={entry.id} className={`font-body text-xs text-mono-400 ${CARD_STYLE.longText}`}>
                      <span className="text-mono-300">{entry.label}</span> — {entry.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <PublicationFooter
              onClose={() => { setPublishPlan(null); setPublishError(null); setPendingOutcome(null); }}
              onConfirm={() => publishReady(publishPlan.selected.map(({ id, rev }) => ({ id, rev })))}
              onVerify={verifyPendingOutcome}
              confirmLabel={`Publicar ${publishPlan.selected.length}`}
              loading={submitting}
              disabled={publishPlan.selected.length === 0 || !publishGate.enabled}
              unknownOutcome={!!pendingOutcome}
              secondary={
                publishPlan.overrideAll.length > 0
                  ? {
                      label: `Publicar todos (${publishPlan.overrideAll.length})`,
                      onClick: () => publishOverrideAll(publishPlan.overrideAll),
                      disabled: !publishGate.enabled,
                    }
                  : undefined
              }
            />
          </div>
        </Modal>
      )}

      {/* Individual override: WORKFLOW blockers only, acknowledged explicitly */}
      {overrideCard && (() => {
        const acknowledgement = overrideAcknowledgement({
          id: overrideCard.role._id,
          rev: overrideCard.role._rev,
          readiness: overrideCard.readiness,
        });
        return (
          <Modal
            title="Publicar de todos modos"
            onClose={() => { setOverrideCard(null); setPublishError(null); setPendingOutcome(null); }}
            status={publishError}
          >
            <div className={CARD_STYLE.dialog}>
              <p className={`font-body text-sm text-mono-400 ${CARD_STYLE.longText}`}>
                {serviceCardLabel(overrideCard.role)}
              </p>
              {acknowledgement ? (
                <>
                  <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
                    Vas a publicar aunque:
                  </p>
                  <ul className="space-y-0.5">
                    {describeAcknowledgedBlockers(acknowledgement.acknowledgedBlockers).map(text => (
                      <li key={text} className="font-body text-xs text-warning-faint/90">• {text}</li>
                    ))}
                  </ul>
                  <p className="font-body text-xs text-mono-500">
                    El servidor vuelve a calcular estos puntos y rechaza la publicación si
                    cambiaron.
                  </p>
                </>
              ) : (
                <p className="font-body text-xs text-negative-muted">
                  Este servicio tiene problemas de integridad: no se puede publicar con una
                  confirmación. Usa «Revisar datos».
                </p>
              )}
              <PublicationFooter
                onClose={() => { setOverrideCard(null); setPublishError(null); setPendingOutcome(null); }}
                onConfirm={() =>
                  acknowledgement && publishOverride(overrideCard, acknowledgement.acknowledgedBlockers)
                }
                onVerify={verifyPendingOutcome}
                confirmLabel="Publicar de todos modos"
                loading={submitting}
                disabled={!acknowledgement || !publishGate.enabled}
                unknownOutcome={!!pendingOutcome}
                danger
              />
            </div>
          </Modal>
        );
      })()}

      {/* Safe unpublish — never routed through publish readiness or override */}
      {unpublishCard && (
        <Modal
          title="Ocultar servicio"
          onClose={() => { setUnpublishCard(null); setPublishError(null); setPendingOutcome(null); }}
          status={publishError ?? cardGates.unpublish.reason}
        >
          <div className={CARD_STYLE.dialog}>
            <p className={`font-body text-sm text-mono-400 ${CARD_STYLE.longText}`}>
              ¿Ocultar <span className="font-semibold text-mono-200">{serviceCardLabel(unpublishCard.role)}</span> del
              equipo? Deja de ser visible para los miembros; no se borra nada.
            </p>
            <p className="font-body text-xs text-mono-500">
              Ocultar no depende de la verificación de publicación: se puede ocultar un servicio
              con datos incompletos o en conflicto.
            </p>
            <PublicationFooter
              onClose={() => { setUnpublishCard(null); setPublishError(null); setPendingOutcome(null); }}
              onConfirm={() => unpublishService(unpublishCard)}
              onVerify={verifyPendingOutcome}
              confirmLabel="Ocultar"
              loading={submitting}
              disabled={!cardGates.unpublish.enabled}
              unknownOutcome={!!pendingOutcome}
              danger
            />
          </div>
        </Modal>
      )}

      {/* `showGenerator` is handled by an early return above (D10: full-width
          panel, not a dialog) — this tab body never renders alongside it. */}
      {setlistRole && (() => {
        const r = setlistRole;
        const type = r._type === "sunday_role" ? "sunday" : r._type === "saturday_role" ? "saturday" : "special";
        const week = r.date.slice(0, 10);
        const title = `Setlist — ${SERVICE_LABEL[r._type]} ${new Date(week + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`;
        return (
          <Modal title={title} onClose={() => setSetlistRole(null)} wide>
            <SetlistEditor
              week={week}
              type={type}
              roleId={type === "special" ? r._id : undefined}
              onClose={() => setSetlistRole(null)}
              onSaved={async () => {
                setSetlistRole(null);
                showToast(mutationOutcomeMessage("Setlist guardado.", await loadSources()));
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}

/**
 * Footer of a publish / override / unpublish confirmation. When the outcome of a
 * submission is UNKNOWN (a lost or timed-out response) the confirm button is
 * replaced by a read-only verification: the panel never replays a mutation
 * automatically, and never closes as success.
 */
function PublicationFooter({
  onClose,
  onConfirm,
  onVerify,
  confirmLabel,
  loading,
  disabled,
  unknownOutcome,
  danger,
  secondary,
}: {
  onClose: () => void;
  onConfirm: () => void;
  onVerify: () => void;
  confirmLabel: string;
  loading: boolean;
  disabled?: boolean;
  unknownOutcome?: boolean;
  danger?: boolean;
  /**
   * An additional, wider-reaching commit beside the primary one (today: publishing
   * the acknowledged drafts too). Hidden while an outcome is unknown, so the only
   * offer after a lost response is still `Verificar resultado` — never a second
   * way to re-submit a batch that may already have landed.
   */
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onClose}
        className="min-h-[44px] flex-1 rounded-lg border border-surface-accent-30 px-3 font-label text-xs uppercase tracking-widest transition-colors hover:border-accent dark:hover:border-surface-accent-30"
      >
        Cancelar
      </button>
      {unknownOutcome ? (
        <button
          type="button"
          onClick={onVerify}
          disabled={loading}
          className="min-h-[44px] flex-1 rounded-lg border border-warning-fg/50 bg-warning-fg/10 px-3 font-label text-xs uppercase tracking-widest text-warning-faint transition-colors hover:bg-warning-fg/20 disabled:opacity-50"
        >
          {loading ? "Verificando..." : "Verificar resultado"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading || disabled}
          className={`min-h-[44px] flex-1 rounded-lg px-3 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${
            danger
              ? "bg-orange-600/70 hover:bg-orange-600"
              : "bg-surface-accent-solid hover:bg-accent-deep/80 dark:hover:bg-accent/30"
          }`}
        >
          {loading ? "Guardando..." : confirmLabel}
        </button>
      )}
      {secondary && !unknownOutcome && (
        <button
          type="button"
          onClick={secondary.onClick}
          disabled={loading || secondary.disabled}
          className="min-h-[44px] flex-1 rounded-lg border border-warning-fg/50 bg-warning-fg/10 px-3 font-label text-xs uppercase tracking-widest text-warning-faint transition-colors hover:bg-warning-fg/20 disabled:opacity-50"
        >
          {loading ? "Guardando..." : secondary.label}
        </button>
      )}
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function fmtYM(ym: string) {
  return new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

function MonthPill({ label, selected, onClick, past }: { label: string; selected: boolean; onClick: () => void; past?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-label text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
        selected
          ? "border-accent/60 bg-accent/15 text-accent"
          : past
          ? "border-accent/10 text-mono-600 hover:border-accent/30 hover:text-mono-400"
          : "border-accent/20 text-mono-400 hover:border-accent/40 hover:text-mono-200"
      }`}
    >
      {label}
    </button>
  );
}
