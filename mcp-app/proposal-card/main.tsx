// The proposal card's entry (S1): connects to the host (claude.ai or the Claude app) through
// MCP Apps, turns each `solve_month` result into a `CardView`, and follows the host's theme,
// fonts and safe area. Bundled by `mcp-app/build.mjs` into one inline HTML document, because
// the host's CSP allows no other origin.

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";
import { cardViewOf, type CardView } from "./model";
import { ProposalCard } from "./ProposalCard";
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

  return <ProposalCard view={view} canExpand={canExpand} onExpand={onExpand} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CardApp />
  </StrictMode>,
);
