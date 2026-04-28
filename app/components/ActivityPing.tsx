"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

// Fire at most once per 30 minutes per browser session
const PING_KEY = "owt_last_ping";
const PING_TTL = 30 * 60 * 1000;

export default function ActivityPing() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.sanityId) return;

    try {
      const last = sessionStorage.getItem(PING_KEY);
      if (last && Date.now() - Number(last) < PING_TTL) return;
    } catch {
      // sessionStorage unavailable — fall through and ping anyway
    }

    fetch("/api/activity/ping", { method: "POST" }).then(() => {
      try { sessionStorage.setItem(PING_KEY, String(Date.now())); } catch {}
    });
  }, [status, session?.user?.sanityId]);

  return null;
}
