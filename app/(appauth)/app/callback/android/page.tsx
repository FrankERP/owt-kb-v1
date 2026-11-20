// /app/callback/android — the verified redirect of the backstage-android client (ADR-0091).
// A static folder, not `[platform]`, so the matcher's PUBLIC_ROUTES lists the real page.
// `force-dynamic` so the `no-store` header in next.config.mjs is what is served.

import CallbackPage from "../CallbackPage";

export const dynamic = "force-dynamic";

export default CallbackPage;
