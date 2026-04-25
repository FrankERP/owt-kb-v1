import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;

    // Signed in via SSO but email not found in Sanity teamMembers
    if (token && !token.sanityId) {
      return NextResponse.redirect(new URL("/auth/not-a-member", req.url));
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
  // Protect everything except: auth pages, NextAuth API, Sanity Studio, and static assets
  matcher: [
    "/((?!auth|api/auth|studio|_next/static|_next/image|favicon\\.ico|LogoOasis\\.png).*)",
  ],
};
