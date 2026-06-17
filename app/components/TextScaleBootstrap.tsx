"use client";

import { useEffect } from "react";
import { applyScale, getStoredMode } from "@/app/utils/textZoom";

/**
 * Applies the stored text-scale on app load (default "auto" → follows the device
 * setting on native). Renders nothing. Runs once on mount.
 */
export default function TextScaleBootstrap() {
  useEffect(() => {
    applyScale(getStoredMode());
  }, []);
  return null;
}
