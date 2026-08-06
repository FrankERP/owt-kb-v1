"use client";

// app/components/admin/useSolverConfig.ts
//
// The ONE place the shared rule set is fetched and written.
//
// ─── Why it is mounted by `ServicesPanel` and passed down ────────────────────
//
// The rule surfaces hang off that panel: it mounts `MonthGenerator`, which
// carries both the planner grid and the rule builder, in create and stored
// modes alike. Owning the state THERE and threading it down makes "every
// surface reads the same config" structural rather than coincidental — one
// fetch, one object. Two independent hooks, one per mount, would read the same
// document through the same code and still drift: save a rule in one generator,
// close it, open another, and the second would enforce the copy it fetched
// before the edit. The panel is still the right owner even though the number of
// mounts has changed; do not move the hook down into the component.
//
// ─── No `revalidate*`, deliberately ──────────────────────────────────────────
//
// This document backs no ISR surface — it is read solely inside the dynamic,
// session-gated admin tree, through this route's own GET. The refresh is this
// hook re-reading it. See the route header before "restoring" a revalidation
// that was never missing.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SAVE_NETWORK_MESSAGE,
  SOLVER_CONFIG_ENDPOINT,
  READ_FAILED_MESSAGE,
  saveFailure,
  sourceFromGet,
  type SolverConfigController,
  type SolverConfigSaveResult,
  type SolverConfigSource,
} from "./solverConfigSource";
import type { SolverConfig } from "./plannerModel";

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function useSolverConfig(): SolverConfigController {
  const [source, setSource] = useState<SolverConfigSource>({ status: "loading" });

  const load = useCallback(async () => {
    setSource({ status: "loading" });
    try {
      const res = await fetch(SOLVER_CONFIG_ENDPOINT);
      setSource(sourceFromGet(res.ok, await readJson(res)));
    } catch {
      // A thrown fetch is a FAILED READ, never an absent document. The
      // difference is the whole point of `SolverConfigSource`.
      setSource({ status: "error", message: READ_FAILED_MESSAGE });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Explicit save — never per keystroke.
   *
   * A POST per change would thrash the route's `_rev` check and lose edits to
   * its own concurrency guard: every keystroke invalidates the revision the
   * previous one was still writing under.
   *
   * CLAUDE.md's client-mutation invariant: `try`/`catch`, `res.ok` checked, the
   * caller's loading flag reset in its own `finally`, and a failure NEVER
   * reported as success — the panel keeps the admin's edits on screen and says
   * what happened.
   */
  const save = useCallback(
    async (config: SolverConfig, rev: string): Promise<SolverConfigSaveResult> => {
      try {
        const res = await fetch(SOLVER_CONFIG_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rev, config }),
        });
        const body = await readJson(res);
        if (!res.ok) return { ok: false, ...saveFailure(res.status, body) };
        const next = sourceFromGet(true, body);
        // The write landed. If its echo is unusable we re-read rather than
        // parking a state that cannot save again — and never report the save
        // itself as failed, which would invite a retry against a `_rev` that is
        // now genuinely stale.
        if (next.status === "ready") setSource(next);
        else void load();
        return { ok: true };
      } catch {
        return { ok: false, message: SAVE_NETWORK_MESSAGE, stale: false };
      }
    },
    [load],
  );

  const reload = useCallback(() => {
    void load();
  }, [load]);

  // Memoised so the controller is a stable object: it is a prop on
  // `MonthGenerator`, and a fresh one per render would make it useless as an
  // effect dependency for anything added later.
  return useMemo(() => ({ source, reload, save }), [source, reload, save]);
}
