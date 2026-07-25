import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging as _getMessaging } from "firebase-admin/messaging";

import { requireDeliveryAllowed } from "./deliveryFirewall";

function app() {
  // A3 §3 outbound-delivery firewall, checked BEFORE Firebase is initialized: a
  // blocked run must never construct a credentialed Admin app, not merely avoid
  // sending through one. `getApps()` is consulted after the gate so a warm
  // invocation cannot hand back an app the gate would have refused.
  requireDeliveryAllowed({ channel: "fcm", recipientCount: 0 });
  if (getApps().length) return getApps()[0];
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  return initializeApp({ credential: cert(svc) });
}

/**
 * Throws `DeliveryBlockedError` when the firewall is closed. That is safe for
 * every caller: `push.ts` is the only one, it gates before it gets here, and its
 * existing try/catch swallows anything that does — so a block can never surface as
 * a failed mutation. The throw exists so a FUTURE caller cannot construct Firebase
 * by bypassing `sendPush`.
 */
export function getMessaging() {
  return _getMessaging(app());
}
