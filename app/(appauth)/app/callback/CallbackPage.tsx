// The inert page a verified app redirect lands on when it is opened somewhere
// other than the app (the app is not installed, or the association files are
// not published yet). It renders NOTHING from the query — the code is never
// echoed, never put in a link — and loads nothing (ADR-0091, spec §3.5).
// Headers (`no-referrer`, `no-store`, `noindex`) are set in `next.config.mjs`.

import AppAuthScreen, { AppAuthMessage } from "../../AppAuthScreen";

export default function CallbackPage() {
  return (
    <AppAuthScreen title="Abre la app">
      <AppAuthMessage>Abre la app Backstage para terminar de entrar.</AppAuthMessage>
    </AppAuthScreen>
  );
}
