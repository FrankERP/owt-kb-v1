"use client";

// Dialog fixture — the CueDialog portal path (Child A2 step 2).
//
// `CueDialog` portals into a node `CueDialogProvider` appends to `document.body`, so it
// renders OUTSIDE the normal tree. A screenshot of a static panel does not cover it,
// which is why it gets its own route: its `z-[90]` backdrop is the intended SUBJECT
// here, not an occluder of something else.
//
// `CueDialogProvider` is mounted DIRECTLY. Verified standalone-safe: it references no
// `useSession`, no `fetch` and nothing from `next-auth`, and it is the innermost
// provider in `app/utils/Provider.tsx`. Importing `Provider` instead would drag in
// `SessionProvider` and `ActivityPing`, which fetches on mount.

import { useRef, useState } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";

function OpenDialog() {
  // Open on first render and stay open — the baseline needs the dialog PRESENT, not a
  // button that would have to be clicked before every capture.
  const [open, setOpen] = useState(true);
  const fallbackRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={fallbackRef} data-gallery-surface="dialog">
      <p className="text-sm opacity-80">
        El diálogo está abierto. Su fondo <code>bg-scrim/[0.68] backdrop-blur-md</code> es el sujeto
        de esta captura.
      </p>
      <CueDialog
        open={open}
        title="Diálogo de ejemplo"
        label="Diálogo de ejemplo para la galería de temas"
        onDismiss={() => setOpen(false)}
        fallbackFocusRef={fallbackRef}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Contenido del diálogo, para revisar superficie, borde y contraste en ambos temas.
          </p>
          <CueDialogStatus tone="info">Un estado dentro del diálogo</CueDialogStatus>
          <button type="button" className="brand-surface-interactive rounded-lg px-3 py-2 text-sm">
            Un botón
          </button>
        </div>
      </CueDialog>
    </div>
  );
}

export function DialogFixture() {
  return (
    <CueDialogProvider>
      <OpenDialog />
    </CueDialogProvider>
  );
}
