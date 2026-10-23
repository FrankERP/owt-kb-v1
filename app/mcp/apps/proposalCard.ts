// The proposal card (MCP Apps, S1 of docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md):
// a read-only view of what `solve_month` answered, drawn by the host (claude.ai, the Claude app)
// in a sandboxed iframe next to the chat. `solve_month` names this resource in its `_meta`, and
// the host reads it with `resources/read` through the same authenticated `/api/mcp` — so the
// document is behind the bearer check like every tool.
//
// The card is built from `mcp-app/proposal-card/` by `node mcp-app/build.mjs` into one inline
// HTML document. It carries NO data: everything it shows is the tool result the host hands it,
// and it sends nothing back (plan E1). A host without MCP Apps ignores both keys and keeps
// showing the text answer.

import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { PROPOSAL_CARD_HTML } from "@/mcp-app/generated/proposalCardHtml";

/**
 * The card's first URI, still served so a client whose tool list predates the versioned one keeps
 * drawing a card until it refreshes (ADR-0069).
 */
export const LEGACY_PROPOSAL_CARD_URI = "ui://owt/proposal-editor";

/**
 * The URI carries a digest of the document. The Claude app keeps a card's HTML by its URI: on
 * 2026-10-23 Frank's card still sent the «Guardar» message of a build two releases old after
 * the server had the new one. A new build is a new URI, so the host has to read it; and since
 * the tools name the URI in their `_meta`, it also changes the tool list's version, so a stale
 * client hears it should refresh.
 */
export const PROPOSAL_CARD_URI = `${LEGACY_PROPOSAL_CARD_URI}/${createHash("sha256").update(PROPOSAL_CARD_HTML).digest("hex").slice(0, 8)}`;
/** The MCP Apps profile; a host renders only a resource of this type as an app. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * The tool `_meta` that links a tool to the card: the current key (`ui.resourceUri`) and the
 * legacy flat one, which older hosts still read — the same pair `registerAppTool` writes.
 */
export const PROPOSAL_CARD_TOOL_META = {
  ui: { resourceUri: PROPOSAL_CARD_URI },
  "ui/resourceUri": PROPOSAL_CARD_URI,
} as const;

export function registerProposalCard(server: McpServer): void {
  registerCardAt(server, "proposal_card", PROPOSAL_CARD_URI);
  registerCardAt(server, "proposal_card_legacy", LEGACY_PROPOSAL_CARD_URI);
}

function registerCardAt(server: McpServer, name: string, at: string): void {
  server.registerResource(
    name,
    at,
    {
      title: "Propuesta del mes",
      description: "Tarjeta de solo lectura con la propuesta que devolvió solve_month.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: MCP_APP_MIME_TYPE,
          text: PROPOSAL_CARD_HTML,
          // Inline only: no network origin is declared, so the host's CSP admits none.
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );
}
