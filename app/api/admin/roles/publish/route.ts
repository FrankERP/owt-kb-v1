// app/api/admin/roles/publish/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";

// Notifying the whole team can mean dozens of sequential emails; give the
// after() work room to finish past the response.
export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmailsBatch, assigneesOf, type ServiceType } from "@/app/utils/assignmentEmail";
import { computePublishTransitions } from "@/app/utils/publishTransitions";

export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as { ids: string[]; published: boolean };
  const ids = [...new Set((body.ids ?? []).filter(Boolean))];
  if (!ids.length) return NextResponse.json({ ok: true, published: 0, unpublished: 0 });

  const current = await serverClient.fetch<{ _id: string; published?: boolean }[]>(
    `*[_id in $ids]{ _id, published }`, { ids },
  );
  const { toPatch, toNotify } = computePublishTransitions(current, body.published === true);

  if (toPatch.length) {
    let tx = writeClient.transaction();
    for (const id of toPatch) tx = tx.patch(id, (p) => p.set({ published: body.published === true }));
    await tx.commit();
  }

  // Deferred assignment notification, only for draft -> published transitions.
  // Runs via after() so the (potentially dozens of) team emails reliably
  // complete after the response is sent rather than racing the function exit.
  if (toNotify.length) {
    after(async () => {
      const docs = await serverClient.fetch<{
        _id: string; _type: ServiceType; date: string;
        leads: string[]; bgvs: string[]; chorus: string[];
        instruments: { instrument: string; personId: string }[];
        foh: { role: string; personId: string }[];
      }[]>(
        `*[_id in $ids]{
          _id, _type, "date": coalesce(week, date),
          "leads": Lead[]._ref, "bgvs": BGVs[]._ref, "chorus": Chorus[]._ref,
          "instruments": instruments[]{ instrument, "personId": person._ref },
          "foh": foh_team[]{ role, "personId": person._ref }
        }`, { ids: toNotify },
      );
      for (const d of docs) {
        await sendPush(assigneesOf(d), "assignments", { title: "Nuevo servicio asignado", body: `Te asignaron para el ${d.date}.`, path: "/me" });
      }
      // One consolidated email per member across all newly-published services.
      await sendAssignmentEmailsBatch(docs.map((d) => ({ type: d._type, date: d.date, body: d })));
    });
  }

  // Invalidate member-facing caches so the change is prompt (esp. on unpublish).
  revalidatePath("/"); revalidatePath("/schedule"); revalidatePath("/me");

  const published = body.published === true ? toPatch.length : 0;
  const unpublished = body.published === true ? 0 : toPatch.length;
  return NextResponse.json({ ok: true, published, unpublished });
}
