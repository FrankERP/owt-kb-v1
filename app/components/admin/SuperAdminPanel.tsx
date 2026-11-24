"use client";

import dynamic from "next/dynamic";
import PanelBoundary from "./PanelBoundary";
import PanelSkeleton from "./PanelSkeleton";

// Same mount as the panels of /admin: client-only behind `next/dynamic`, inside
// the error boundary, so a failure in the roster never blanks the page.
const MembersPanel = dynamic(() => import("./MembersPanel"), { ssr: false, loading: PanelSkeleton });

/** The super-admin page's body: «Personas», every member of every ministry. */
export default function SuperAdminPanel() {
  return (
    <PanelBoundary>
      <MembersPanel role="super-admin" />
    </PanelBoundary>
  );
}
