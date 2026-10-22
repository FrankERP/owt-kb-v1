// The proposal card's entry (S1, S4): connects to the host (claude.ai or the Claude app) through
// MCP Apps, turns each `solve_month`, `revise_proposal` or `check_service_edits` result into a
// `CardView`, opens the editor on it (`useEditor` for a proposal, `useStoredEditor` for a saved
// month; only when the host lets the card call tools), and follows the host's
// theme, fonts and safe area. Bundled by `mcp-app/build.mjs` into one inline HTML document,
// because the host's CSP allows no other origin.

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";
import { cardViewOf, type CardView } from "./model";
import { ProposalCard } from "./ProposalCard";
import { Editor } from "./Editor";
import { useEditor } from "./useEditor";
import { useStoredEditor } from "./useStoredEditor";
import "./styles.css";

function applySafeArea(ctx: McpUiHostContext | undefined) {
  const inset = ctx?.safeAreaInsets;
  if (!inset) return;
  const root = document.documentElement.style;
  root.setProperty("--safe-top", `${inset.top}px`);
  root.setProperty("--safe-right", `${inset.right}px`);
  root.setProperty("--safe-bottom", `${inset.bottom}px`);
  root.setProperty("--safe-left", `${inset.left}px`);
}

function CardApp() {
  const [view, setView] = useState<CardView>({ kind: "waiting" });
  // The host context lives on the App; a change only needs a re-render to be read again.
  const [, setContextVersion] = useState(0);

  const { app } = useApp({
    appInfo: { name: "owt-proposal-card", version: "1.0.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    onAppCreated: (created) => {
      created.ontoolresult = (result) => setView(cardViewOf(result));
      // The route runs every call to completion even when the host gives up (`signal: null`),
      // so a cancel says nothing about whether a proposal was stored: claim nothing.
      created.ontoolcancelled = () =>
        setView({
          kind: "unreadable",
          lines: ["Se interrumpió la respuesta. Pide el mes de nuevo o revisa las propuestas guardadas."],
        });
      created.addEventListener("hostcontextchanged", () => setContextVersion((v) => v + 1));
    },
  });
  const context = app?.getHostContext();
  useHostStyles(app, context);
  useEffect(() => applySafeArea(context), [context]);

  const canExpand = Boolean(context?.availableDisplayModes?.includes("fullscreen")) && context?.displayMode !== "fullscreen";
  const onExpand = useCallback(() => {
    // A host that refuses keeps the card inline; nothing to undo.
    app?.requestDisplayMode({ mode: "fullscreen" }).catch(() => {});
  }, [app]);

  const editor = useEditor(app ?? null);
  const stored = useStoredEditor(app ?? null);
  const canCall = Boolean(app?.getHostCapabilities()?.serverTools);
  const onEdit = useCallback(() => {
    if (view.kind === "proposal" && view.handle) editor.start(view.handle, view.revision);
    if (view.kind === "storedMonth") stored.start(view.month, view.edits);
  }, [editor, stored, view]);

  if (stored.open) {
    if (stored.props) return <Editor {...stored.props} />;
    return (
      <main className="card" aria-busy={stored.opening.notice === null}>
        <p className={stored.opening.notice ? "unfilled" : "muted"} role="status">
          {stored.opening.notice ?? "Abriendo el mes…"}
        </p>
        <div className="actions">
          <button type="button" onClick={stored.opening.onClose}>
            Cerrar
          </button>
        </div>
      </main>
    );
  }

  if (editor.open) {
    if (editor.props) return <Editor {...editor.props} />;
    return (
      <main className="card" aria-busy={editor.opening.notice === null}>
        <p className={editor.opening.notice ? "unfilled" : "muted"} role="status">
          {editor.opening.notice ?? "Abriendo la propuesta…"}
        </p>
        <div className="actions">
          <button type="button" onClick={editor.opening.onClose}>
            Cerrar
          </button>
        </div>
      </main>
    );
  }
  const saved = editor.lastSaved;
  const note =
    saved && view.kind === "proposal" && saved.revision !== view.revision
      ? `Guardaste la versión ${saved.revision}; «Editar» la abre. Abajo sigue la versión ${view.revision}.`
      : undefined;
  return <ProposalCard view={view} canExpand={canExpand} onExpand={onExpand} onEdit={canCall ? onEdit : undefined} note={note} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CardApp />
  </StrictMode>,
);
