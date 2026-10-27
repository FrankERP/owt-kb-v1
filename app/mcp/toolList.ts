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
import { registerProposalCard } from "./apps/proposalCard";
import { toolListDigest } from "./toolListVersion";

/**
 * Every tool and the card resource, in `tools/list` order. Also run once by `toolListDigest`;
 * `version` is the deployment's commit, which only `ping`'s answer carries.
 */
export function registerAllTools(server: McpServer, deps: { version: string }): void {
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
  // The four writes (P3), after the reads. Each calls its admin counterpart's
  // own `*Commit` module (ADR-0043) and declares itself destructive (I14).
  registerUnpublishService(server);
  registerPublishService(server);
  registerSwapAssignment(server);
  registerEditSetlist(server);
  registerSolveMonth(server);
  registerApplySchedule(server);
  registerProposalEditor(server);
  // Admin parity phase 1 (ADR-0066): the saved-month editor (its save and its copy write through
  // /admin's own writers) and create_service (through the roles POST's).
  registerServiceEditor(server);
  registerCreateService(server);
  // Admin parity phase 2: deleting saved services, through /admin's own DELETE writer.
  registerServiceDeletes(server);
  // Admin parity phase 3: a service's messages (thread, pastor message, team message).
  registerServiceMessages(server);
  // The card (MCP Apps), at a URI that carries its build's digest. Fixed per deployment, like the tools.
  registerProposalCard(server);
}

/**
 * The digest of the tool list this deployment serves (ADR-0069). Every model-visible tool asks for
 * it back as `toolsVersion`, so a client still holding an older copy of the list is told to refresh.
 */
export const TOOL_LIST_VERSION = toolListDigest((server) => registerAllTools(server, { version: "" }));
