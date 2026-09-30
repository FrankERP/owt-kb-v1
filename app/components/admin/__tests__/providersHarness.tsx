// app/components/admin/__tests__/providersHarness.tsx
//
// Test-only providers for suites that render `MonthGenerator` — NOT a test file.
// Production mounts these app-wide (`app/utils/Provider.tsx`); `useToast` and
// `CueDialog` throw without theirs. Same nesting as production: dialogs, then
// motion (the toast's exit is an `m.*` animation — `Toast.test.tsx` wraps it
// the same way), then toasts.
import type { ReactNode } from "react";

import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { MotionProvider } from "../../ui/MotionProvider";
import { ToastProvider } from "../../ui/Toast";

export function AdminProviders({ children }: { children: ReactNode }) {
  return (
    <CueDialogProvider>
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
    </CueDialogProvider>
  );
}
