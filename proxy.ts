import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const { pathname } = req.nextUrl;

    // Signed in via SSO but email not found in Sanity teamMembers
    if (token && !token.sanityId) {
      return NextResponse.redirect(new URL("/auth/not-a-member", req.url));
    }

    // Sanity Studio requires admin role or higher — members cannot access it
    if (pathname.startsWith("/studio")) {
      const role = token?.role as string | undefined;
      if (role !== "super-admin" && role !== "admin") {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  // Protect everything except: auth pages, NextAuth API, and static assets.
  // Studio is now included — it requires login + admin role (checked above).
  //
  // NOTE: Next.js requires this matcher to be a statically-analyzable string
  // literal (an imported constant is ignored at build time), so it is inlined
  // here. It MUST stay byte-for-byte equal to MIDDLEWARE_MATCHER in
  // app/utils/routeMatcher.ts, which carries the tested exclusion logic and a
  // sync guard (routeMatcher.test.ts). Each excluded prefix is anchored with
  // `(?:/|$)` so `/author` is not mistaken for a public `/auth` route.
  matcher: [
    "/((?!auth(?:/|$)|api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|LogoOasis\\.png$).*)",
  ],
};
