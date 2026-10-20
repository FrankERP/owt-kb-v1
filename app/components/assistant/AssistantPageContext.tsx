"use client";

// Tells the assistant bubble what this page shows beyond its path (ADR-0060): a song page names
// its song, the admin panel its tab. Renders nothing. A Server Component renders it as JSX with
// plain props — never calls anything from this module (ADR-0028).

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { AdminChatPageRef } from "@/app/utils/adminChat";
import { setPageOverride } from "./assistantPage";

export default function AssistantPageContext({ label, refs = [] }: { label: string; refs?: AdminChatPageRef[] }) {
  const pathname = usePathname() ?? "/";
  // Keyed on the content, not the array's identity: a parent re-render must not re-register.
  const refsKey = JSON.stringify(refs);
  useEffect(() => {
    return setPageOverride({ path: pathname, label, refs: JSON.parse(refsKey) as AdminChatPageRef[] });
  }, [pathname, label, refsKey]);
  return null;
}
