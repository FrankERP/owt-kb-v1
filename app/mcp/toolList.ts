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
import { confirmingServer } from "./writes/confirmRule";

/**
 * Which tool list a connection is served (ADR-0083 and its addendum). The tier comes from the
 * member's LIVE access (`mcpTierOf`); the client and the consent from the grant
 * (`effectiveGrantClient`, `adminScopeOf`):
 *
 *   full        — a super-admin on a claude.ai grant: every tool and the card resources
 *   fullNoApps  — a super-admin on any other agent: every tool EXCEPT the app-only card tools, and
 *                 no card resources (their safety rests on the host hiding them from the model)
 *   admin       — a worship admin on a claude.ai grant approved under the admin consent:
 *                 `ADMIN_TIER_TOOLS` and the card resources
 *   adminNoApps — the same on any other agent: `ADMIN_TIER_TOOLS` minus the app-only tools
 *   adminRead   — a worship admin on a grant approved under the read-only consent (before
 *                 `ADMIN_WRITES_CUTOFF`): `READ_TIER_TOOLS` only, exactly slice A's list
 */
export type ToolListScope = "full" | "fullNoApps" | "admin" | "adminNoApps" | "adminRead";

/**
 * The read tools, in `tools/list` order: the whole `adminRead` list, and the head of every other.
 * `mcpRoute.test.ts` pins this list to what `registerReadTools` registers and to `readOnlyHint`.
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

/**
 * Tools only a super-admin reaches (ADR-0083 addendum): people (ADR-0082; «Personas sigue siendo solo
 * tuyo») and Oasis Kids (another ministry, gated in the app by `requireMinistryManager("kids")`, not
 * by the worship role — ADR-0075). Every tool of the full list is in exactly one of this list and
 * `ADMIN_TIER_TOOLS`; `mcpRoute.test.ts` fails on a tool that is in neither.
 */
export const SUPER_ADMIN_ONLY_TOOLS = [
  "get_kids_month",
  "generate_kids_month",
  "save_kids_sundays",
  "save_kids_pair",
  "set_kids_absences",
  "list_members",
  "get_member",
  "check_member_changes",
  "save_member_changes",
  "check_new_members",
  "create_members",
  "set_member_access",
] as const;

/**
 * The tools a worship admin's connection reaches after `ADMIN_WRITES_CUTOFF` — an ALLOWLIST, written
 * out by name in `tools/list` order, never computed: a tool added to the connector reaches no admin
 * until its name is added here on purpose (and the classification test makes that choice
 * unavoidable). Everything an admin does in `/admin`, through the same writers, except
 * `SUPER_ADMIN_ONLY_TOOLS`. The app-only twins in it are served only on a claude.ai grant.
 */
export const ADMIN_TIER_TOOLS = [
  ...READ_TIER_TOOLS,
  "unpublish_service",
  "publish_service",
  "swap_assignment",
  "edit_setlist",
  "solve_month",
  "apply_schedule",
  "check_proposal_edits",
  "save_proposal_edits",
  "revise_proposal",
  "check_service_edits",
  "check_service_edits_app",
  "save_service_edits",
  "save_service_edits_app",
  "copy_instruments",
  "create_service",
  "check_service_deletes",
  "delete_services",
  "delete_services_app",
  "get_service_messages",
  "send_service_message",
  "edit_service_message",
  "set_pastor_message",
  "set_team_message",
  "check_setlist_proposal_review",
  "review_setlist_proposal",
  "check_song_edits",
  "save_song_edits",
  "check_new_song",
  "create_song",
] as const;

/**
 * `server`, seen through an allowlist: `registerTool(name, …)` registers only names in `names` and
 * silently skips any other; every other member is the server's own (functions bound to it). So the
 * admin scopes' runtime list is an allowlist, as ADR-0083 promised, not «everything but two bundles».
 */
export function allowlistedServer(server: McpServer, names: readonly string[]): McpServer {
  const allowed = new Set(names);
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "registerTool") {
        const register = (target.registerTool as (...args: unknown[]) => unknown).bind(target);
        return (name: string, ...rest: unknown[]) => (allowed.has(name) ? register(name, ...rest) : undefined);
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The read tools, in order: the whole `adminRead` list, and the head of every other. */
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
 * answer carries. `scope` is required, so no caller gets the most privileged list by forgetting it;
 * "full" is exactly the list before ADR-0083.
 */
export function registerAllTools(target: McpServer, deps: { version: string; scope: ToolListScope }): void {
  const scope = deps.scope;
  const adminScope = scope === "admin" || scope === "adminNoApps";
  // The admin lists register through the allowlist; the super-admin lists register everything.
  // Every list appends `PERSON_CONFIRMS_RULE` to each model-visible destructive write (§3.7).
  const server = confirmingServer(adminScope ? allowlistedServer(target, ADMIN_TIER_TOOLS) : target);
  registerReadTools(server, deps);
  if (scope === "adminRead") return;
  const appsHost = scope === "full" || scope === "admin";
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
  // Admin parity phase 3 (S4): Oasis Kids (month, proposal, Sundays, pairs, absences). Super-admin
  // only (ADR-0083 addendum): another ministry.
  if (!adminScope) registerKids(server);
  // Admin parity phase 3 (S1): deciding setlist proposals, through /admin's own writer.
  registerSetlistProposalReview(server);
  // Admin parity phase 3 (S3): creating and editing songs, through /admin's own writer.
  registerSongEdits(server);
  // Admin parity phase 4 (slice M): people, through /admin's own writer (`memberCommit.ts`).
  // Super-admin only (ADR-0082, ADR-0083 addendum).
  if (!adminScope) registerMemberTools(server);
  // The card (MCP Apps), at a URI that carries its build's digest. Fixed per deployment, like the
  // tools. Only for a claude.ai grant: the card calls the app-only tools.
  if (appsHost) registerProposalCard(server);
}

/** The scopes, for building one handler and one digest per scope. */
export const TOOL_LIST_SCOPES: readonly ToolListScope[] = ["full", "fullNoApps", "admin", "adminNoApps", "adminRead"];

/**
 * The digest of each tool list this deployment serves (ADR-0069, one per scope since ADR-0083).
 * Every model-visible tool asks for it back as `toolsVersion`, so a client still holding an older
 * copy of ITS list is told to refresh. `full` is exactly the digest before ADR-0083.
 */
export const TOOL_LIST_VERSIONS: Readonly<Record<ToolListScope, string>> = {
  full: toolListDigest((server) => registerAllTools(server, { version: "", scope: "full" })),
  fullNoApps: toolListDigest((server) => registerAllTools(server, { version: "", scope: "fullNoApps" })),
  admin: toolListDigest((server) => registerAllTools(server, { version: "", scope: "admin" })),
  adminNoApps: toolListDigest((server) => registerAllTools(server, { version: "", scope: "adminNoApps" })),
  adminRead: toolListDigest((server) => registerAllTools(server, { version: "", scope: "adminRead" })),
};

/** The claude.ai super-admin list's digest — the one every existing caller and test means. */
export const TOOL_LIST_VERSION = TOOL_LIST_VERSIONS.full;
