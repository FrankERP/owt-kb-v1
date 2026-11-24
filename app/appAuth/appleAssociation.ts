// Native-app sign-in — the Apple app-site association (ADR-0091, docs/MOBILE.md).
//
// iOS hands the verified `https` callback `<origin>/app/callback/ios` to an app
// only when this file, served by our own origin, names that app. Listing it
// under `webcredentials` is what lets `ASWebAuthenticationSession` complete an
// https callback for our domain (iOS 17.4); `applinks` limited to the callback
// path makes a tapped callback link open the app instead of the inert page.
// Nothing else of the site opens in the app.
//
// The Team ID and bundle id are public identifiers (they appear in every signed
// build), not secrets: code, not configuration.

export const APPLE_TEAM_ID = "2NM4872N5S";
export const IOS_BUNDLE_ID = "com.owtBackstage.app";
export const IOS_APP_ID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;

/** The one path an associated app may open: the iOS sign-in callback. */
export const IOS_CALLBACK_PATH = "/app/callback/ios";

export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [{ "/": IOS_CALLBACK_PATH, comment: "Native app sign-in callback only (ADR-0091)" }],
        },
      ],
    },
    webcredentials: { apps: [IOS_APP_ID] },
  };
}
