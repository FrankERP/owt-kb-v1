// The connector's tool list: what `/api/mcp` registers on every per-request server, and the digest of
// that list (ADR-0069). Its own module because a Next route file may export only route fields, and
// the route tests need the digest to call a tool as a current client would.

import type { McpServer } from "@modelcontextprotocol/server";
import { registerGetMemberAvailability } from "./tools/getMemberAvailability";
import { registerGetParticipation } from "./tools/getParticipation";
import { registerGetFairnessLedger } from "./tools/getFairnessLedger";
import { registerGetSolverRules } from "./tools/getSolverRules";
import { registerGetIntegrityQueue } from "./tools/getIntegrityQueue";
import { registerGetService } from "./tools/getService";
import { registerGetSong } from "./tools/getSong";
import { registerListProposals } from "./tools/listProposals";
import { registerListServices } from "./tools/listServices";
import { registerPing } from "./tools/ping";
import { registerSearchSongs } from "./tools/searchSongs";
import { registerUnpublishService } from "./tools/unpublishService";
import { registerPublishService } from "./tools/publishService";
import { registerSwapAssignment } from "./tools/swapAssignment";
import { registerEditSetlist } from "./tools/editSetlist";
import { registerSolveMonth } from "./tools/solveMonth";
import { registerApplySchedule } from "./tools/applySchedule";
import { registerProposalEditor } from "./tools/proposalEditor";
import { registerServiceEditor } from "./tools/serviceEditor";
import { registerCreateService } from "./tools/createService";
import { registerServiceDeletes } from "./tools/serviceDeletes";
import { registerServiceMessages } from "./tools/serviceMessages";
import { registerKids } from "./tools/kids";
import { registerSetlistProposalReview } from "./tools/setlistProposalReview";
import { registerSongEdits } from "./tools/songEdits";
import { registerMemberTools } from "./tools/members";
import { registerProposalCard } from "./apps/proposalCard";
import { toolListDigest } from "./toolListVersion";

/**
 * Which tool list a connection is served (ADR-0083). The tier comes from the member's LIVE access
 * (`mcpTierOf`), the client from the grant (`effectiveGrantClient`):
 *
 *   full       — a super-admin on a claude.ai grant: every tool and the card resources
 *   fullNoApps — a super-admin on any other agent: every tool EXCEPT the app-only card tools, and
 *                no card resources (their safety rests on the host hiding them from the model)
 *   read       — a worship admin, on any agent: `READ_TIER_TOOLS` only
 */
export type ToolListScope = "full" | "fullNoApps" | "read";

/**
 * The tools a worship admin's connection reaches — an ALLOWLIST, in `tools/list` order. A tool
 * added to the connector lands in the full lists only, unless someone adds it here on purpose;
 * `toolList.test.ts` pins this list to what `registerReadTools` registers and to `readOnlyHint`.
 */
export const READ_TIER_TOOLS = [
  "ping",
  "get_service",
  "list_services",
  "search_songs",
  "get_song",
  "get_member_availability",
  "get_participation",
  "list_proposals",
  "get_fairness_ledger",
  "get_solver_rules",
  "get_integrity_queue",
] as const;

/** The read tools, in order: the whole "read" list, and the head of the full lists. */
function registerReadTools(server: McpServer, deps: { version: string }): void {
  registerPing(server, { version: deps.version });
  registerGetService(server);
  registerListServices(server);
  registerSearchSongs(server);
  registerGetSong(server);
  registerGetMemberAvailability(server);
  registerGetParticipation(server);
  registerListProposals(server);
  registerGetFairnessLedger(server);
  registerGetSolverRules(server);
  registerGetIntegrityQueue(server);
}

/**
 * The tools (and, on a claude.ai grant, the card resources) of `scope`, in `tools/list` order. Also
 * run once per scope by `toolListDigest`; `version` is the deployment's commit, which only `ping`'s
 * answer carries. `scope` defaults to "full", which is exactly the list before ADR-0083.
 */
export function registerAllTools(server: McpServer, deps: { version: string; scope?: ToolListScope }): void {
  const scope = deps.scope ?? "full";
  registerReadTools(server, deps);
  if (scope === "read") return;
  const appsHost = scope === "full";
  // The four writes (P3), after the reads. Each calls its admin counterpart's
  // own `*Commit` module (ADR-0043) and declares itself destructive (I14).
  registerUnpublishService(server);
  registerPublishService(server);
  registerSwapAssignment(server);
  registerEditSetlist(server);
  registerSolveMonth(server);
  registerApplySchedule(server);
  registerProposalEditor(server, { appsHost });
  // Admin parity phase 1 (ADR-0066): the saved-month editor (its save and its copy write through
  // /admin's own writers) and create_service (through the roles POST's).
  registerServiceEditor(server, { appsHost });
  registerCreateService(server);
  // Admin parity phase 2: deleting saved services, through /admin's own DELETE writer.
  registerServiceDeletes(server, { appsHost });
  // Admin parity phase 3: a service's messages (thread, pastor message, team message).
  registerServiceMessages(server);
  // Admin parity phase 3 (S4): Oasis Kids (month, proposal, Sundays, pairs, absences).
  registerKids(server);
  // Admin parity phase 3 (S1): deciding setlist proposals, through /admin's own writer.
  registerSetlistProposalReview(server);
  // Admin parity phase 3 (S3): creating and editing songs, through /admin's own writer.
  registerSongEdits(server);
  // Admin parity phase 4 (slice M): people, through /admin's own writer (`memberCommit.ts`).
  registerMemberTools(server);
  // The card (MCP Apps), at a URI that carries its build's digest. Fixed per deployment, like the
  // tools. Only for a claude.ai grant: the card calls the app-only tools.
  if (appsHost) registerProposalCard(server);
}

/** The scopes, for building one handler and one digest per scope. */
export const TOOL_LIST_SCOPES: readonly ToolListScope[] = ["full", "fullNoApps", "read"];

/**
 * The digest of each tool list this deployment serves (ADR-0069, one per scope since ADR-0083).
 * Every model-visible tool asks for it back as `toolsVersion`, so a client still holding an older
 * copy of ITS list is told to refresh. `full` is exactly the digest before ADR-0083.
 */
export const TOOL_LIST_VERSIONS: Readonly<Record<ToolListScope, string>> = {
  full: toolListDigest((server) => registerAllTools(server, { version: "", scope: "full" })),
  fullNoApps: toolListDigest((server) => registerAllTools(server, { version: "", scope: "fullNoApps" })),
  read: toolListDigest((server) => registerAllTools(server, { version: "", scope: "read" })),
};

/** The claude.ai super-admin list's digest — the one every existing caller and test means. */
export const TOOL_LIST_VERSION = TOOL_LIST_VERSIONS.full;
