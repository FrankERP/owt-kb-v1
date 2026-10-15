import "server-only";

import { serverClient } from "@/sanity/lib/serverClient";
import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import { getMemberAccess } from "./memberAccess";
import type { CalendarFeedState } from "./calendarFeed";
import {
  calendarFeedDocId,
  feedSecret,
  feedUrls,
  hasReadToken,
  parseStoredGeneration,
} from "./calendarFeedToken";

/**
 * The «Calendario» block's state for the signed-in member (spec D7): the URLs signed with their
 * current generation, or why there are none. Called by the `/me/ajustes` Server Component only —
 * the secret never leaves the server; the panel receives strings.
 */
export async function loadCalendarFeedState(user: {
  sanityId: string;
  isImpersonating?: boolean;
}): Promise<CalendarFeedState> {
  if (user.isImpersonating) {
    return { kind: "unavailable", message: "El enlace de calendario es personal: no se muestra mientras suplantas a alguien." };
  }
  const { ministries } = await getMemberAccess(user.sanityId);
  if (!ministries.includes("worship")) {
    return { kind: "unavailable", message: "El calendario por ahora es solo para el equipo de alabanza." };
  }
  const secret = feedSecret();
  const origin = canonicalOrigin();
  const unavailable: CalendarFeedState = { kind: "unavailable", message: "El calendario no está disponible en este momento." };
  if (!secret || !origin || !hasReadToken()) return unavailable;

  let raw: unknown;
  try {
    raw = await serverClient.fetch<unknown>(`*[_id == $id][0].generation`, { id: calendarFeedDocId(user.sanityId) });
  } catch {
    return unavailable;
  }
  const generation = parseStoredGeneration(raw);
  if (generation === null) return unavailable;
  return {
    kind: "ready",
    urls: feedUrls(origin, user.sanityId, generation, secret),
    preview: process.env.VERCEL_ENV === "preview",
  };
}
