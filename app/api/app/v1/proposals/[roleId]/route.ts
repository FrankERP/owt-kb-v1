// GET /api/app/v1/proposals/[roleId] — the native app's setlist-proposal editor read (ADR-0091 W1,
// spec D3): the service the caller leads, its ONE shared proposal with the `observed` the app sends
// back on save, «Tonos anteriores» for its songs, and the service conversation. 404 unless the role
// exists, is published and lists the caller in `Lead[]` (the web editor's rule, the same helper).

import { requireAppSession } from "@/app/appAuth/requireAppSession";
import { appUnavailableResponse, jsonNoStore } from "@/app/appAuth/responses";
import { readProposalEditor, type ProposalEditorRead } from "@/app/utils/proposalEditorRead";
import { previousKeysFor } from "@/app/utils/songPreviousKeys";
import { buildAppProposalEditor, proposalSongIds } from "@/app/utils/appProposalEditor";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ roleId: string }> }): Promise<Response> {
  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
  if (!auth.ok) return auth.response;

  const { roleId } = await params;
  // Checked before any read: a malformed id is no service.
  if (!isCanonicalDocumentId(roleId)) return jsonNoStore({ error: "not_found" }, 404);

  const me = auth.session.sanityId;
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  let read: ProposalEditorRead | null;
  let previousKeys: Map<string, string[]>;
  try {
    read = await readProposalEditor(roleId, me);
    if (!read) return jsonNoStore({ error: "not_found" }, 404);
    previousKeys = await previousKeysFor(proposalSongIds(read), today);
  } catch {
    return appUnavailableResponse();
  }
  return jsonNoStore(buildAppProposalEditor(read, me, previousKeys));
}
