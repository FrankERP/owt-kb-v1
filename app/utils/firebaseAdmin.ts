import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging as _getMessaging } from "firebase-admin/messaging";

function app() {
  if (getApps().length) return getApps()[0];
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  return initializeApp({ credential: cert(svc) });
}

export function getMessaging() {
  return _getMessaging(app());
}
