// What the four write doors of the app's «Mensajes del servicio» (A-W2 spec D3.1) share after
// authorization: the JSON read (malformed → 400 `invalid_request` with issues `["json"]`, the A-W1
// door's answer) and the author's name for the leads' email.

import { jsonNoStore } from "@/app/appAuth/responses";
import { serviceError } from "@/app/utils/serviceMutation";
import { loadActorName } from "@/app/mcp/reads/serviceConversation";

/** The request's JSON, or the 400 to send. */
export async function readJsonBody(request: Request): Promise<{ raw: unknown } | { response: Response }> {
  try {
    return { raw: await request.json() };
  } catch {
    const res = serviceError("invalid_request", { details: { issues: ["json"] } });
    return {
      response: jsonNoStore({ error: res.body.error, conflict: res.body.conflict, details: { issues: ["json"] } }, res.status),
    };
  }
}

/**
 * The name the leads' email shows («… te escribió»): ONE live read of `alias || member_name`
 * through the MCP tools' `loadActorName` (the same writers), `""` on any failure — the mail then
 * reads «Un admin» (`serviceThreadNotify.ts`), never someone else's name. The stored message names
 * its author by reference, so this is cosmetic.
 */
export async function actorNameOf(memberId: string): Promise<string> {
  try {
    return await loadActorName(memberId);
  } catch {
    return "";
  }
}
