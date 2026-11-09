import { NextResponse, type NextRequest } from "next/server";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { rolloutAllows } from "@/app/utils/rollout";

/**
 * The rollout holds on the server (ADR-0081, plan G6): until `jovenesEvents` reaches this person,
 * the meeting routes answer 404 as if they did not exist, before reading the body. Any ministry
 * but Jóvenes has no meetings yet. The cached snapshot is enough here: a stage moves only with a
 * deploy, and the writer reads the actor's access fresh anyway (W1).
 */
export async function eventRouteGate(sanityId: string, ministry: string): Promise<NextResponse | null> {
  if (ministry !== "jovenes" || !rolloutAllows("jovenesEvents", await getMemberAccess(sanityId))) {
    return NextResponse.json({ error: "Ese evento no existe." }, { status: 404 });
  }
  return null;
}

/** The request's JSON, or `null` when it is not JSON (the writer answers 400 `invalid_body`). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
