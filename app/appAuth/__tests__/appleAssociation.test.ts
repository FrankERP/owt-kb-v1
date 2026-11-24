// The Apple app-site association (ADR-0091): names exactly our app, opens exactly the
// sign-in callback, and is served as plain JSON with no cookie, no redirect and no I/O.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/api/app/association/apple/route";
import { appleAppSiteAssociation, IOS_APP_ID, IOS_CALLBACK_PATH } from "@/app/appAuth/appleAssociation";
import { verifiedCallbackFor } from "@/app/appAuth/clients";

describe("apple-app-site-association", () => {
  it("names one app, under webcredentials and applinks, and opens only the iOS callback", () => {
    expect(IOS_APP_ID).toBe("2NM4872N5S.com.owtBackstage.app");
    expect(appleAppSiteAssociation()).toEqual({
      applinks: {
        details: [{ appIDs: [IOS_APP_ID], components: [{ "/": IOS_CALLBACK_PATH, comment: expect.any(String) }] }],
      },
      webcredentials: { apps: [IOS_APP_ID] },
    });
  });

  it("the path it opens is the iOS client's verified callback", () => {
    const origin = "https://owt-backstage.vercel.app";
    expect(`${origin}${IOS_CALLBACK_PATH}`).toBe(verifiedCallbackFor("backstage-ios", origin));
  });

  it("is served as JSON with no cookie", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual(appleAppSiteAssociation());
  });

  it("the iOS project signs with the same team and bundle id", () => {
    const spec = readFileSync(join(process.cwd(), "native/ios/project.yml"), "utf8");
    expect(spec).toMatch(/DEVELOPMENT_TEAM: "2NM4872N5S"/);
    expect(spec).toMatch(/PRODUCT_BUNDLE_IDENTIFIER: com\.owtBackstage\.app\n/);
  });

  it("the route does no I/O: it imports nothing but the association", () => {
    const src = readFileSync(join(process.cwd(), "app/api/app/association/apple/route.ts"), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/app/appAuth/appleAssociation"]);
  });
});
