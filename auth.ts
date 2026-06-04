import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { serverClient, writeClient } from "./sanity/lib/serverClient";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

type SanityMember = {
  _id: string;
  member_name: string;
  alias?: string | null;
  role: OWTRole | null;
  passwordHash: string | null;
};

async function getMemberByEmail(email: string): Promise<SanityMember | null> {
  return serverClient.fetch(
    `*[_type == "teamMembers" && lower(email) == lower($email)][0] {
      _id, member_name, alias, role, passwordHash
    }`,
    { email }
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email y contraseña",
      credentials: {
        email:    { label: "Email",      type: "email"    },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const member = await getMemberByEmail(credentials.email);
        if (!member?.passwordHash) return null;

        const valid = await bcrypt.compare(credentials.password, member.passwordHash);
        if (!valid) return null;

        return {
          id:       member._id,
          name:     member.member_name,
          email:    credentials.email,
          role:     member.role ?? "member",
          sanityId: member._id,
          alias:    member.alias ?? null,
        };
      },
    }),
  ],

  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 }, // 7-day sessions
  secret: process.env.NEXTAUTH_SECRET,

  pages: {
    signIn: "/auth/signin",
  },

  events: {
    async signIn({ user, account }) {
      try {
        if (!user.email) return;
        const member = await serverClient.fetch<SanityMember | null>(
          `*[_type == "teamMembers" && lower(email) == lower($email)][0] {
            _id, member_name, role, passwordHash
          }`,
          { email: user.email }
        );
        if (!member?._id) return;

        await writeClient.create({
          _type: "loginEvent",
          member: { _type: "reference", _ref: member._id },
          email: user.email,
          provider: account?.provider ?? "credentials",
          timestamp: new Date().toISOString(),
        });

        // Sync Google photo URL on every Google sign-in (simple string — no download needed)
        if (account?.provider === "google" && user.image) {
          try {
            const hostname = new URL(user.image).hostname;
            if (hostname !== "lh3.googleusercontent.com") {
              throw new Error(`Unexpected image host: ${hostname}`);
            }
            await writeClient.patch(member._id).set({ googlePhotoUrl: user.image }).commit();
          } catch (err) {
            console.error("[auth] Failed to sync Google photo URL:", err);
          }
        }
      } catch (err) {
        console.error("[auth] Failed to log sign-in event:", err);
      }
    },
  },

  callbacks: {
    async jwt({ token, user, trigger, session: updatePayload }) {
      // Handle session.update() calls for impersonation
      if (trigger === "update" && updatePayload) {
        if (updatePayload.impersonating) {
          // SECURITY: impersonation is super-admin-only. Enforce it here, server-side,
          // so a crafted session.update({ impersonating }) from a lesser role cannot
          // escalate privileges. When already impersonating, the *real* identity (and
          // therefore the role that matters) lives in __realAdmin.
          const realRole = token.__realAdmin?.role ?? token.role;
          if (realRole !== "super-admin") return token;

          const target = await serverClient.fetch<{ _id: string; member_name: string; alias?: string | null; role: OWTRole | null } | null>(
            `*[_type == "teamMembers" && _id == $id][0] { _id, member_name, alias, role }`,
            { id: updatePayload.impersonating }
          );
          if (target) {
            // Snapshot the original admin identity once; don't clobber it when
            // switching impersonation targets, or "stop" would restore the wrong user.
            if (!token.__realAdmin) {
              token.__realAdmin = {
                role:     token.role ?? "member",
                sanityId: token.sanityId ?? "",
                name:     token.name,
                alias:    token.alias ?? null,
              };
            }
            token.role           = target.role ?? "member";
            token.sanityId       = target._id;
            token.name           = target.member_name;
            token.alias          = target.alias ?? null;
            token.isImpersonating = true;
            token.realAdminName  = token.__realAdmin.name ?? undefined;
          }
        } else if (updatePayload.stopImpersonating && token.__realAdmin) {
          token.role           = token.__realAdmin.role;
          token.sanityId       = token.__realAdmin.sanityId;
          token.name           = token.__realAdmin.name;
          token.alias          = token.__realAdmin.alias;
          token.isImpersonating = false;
          token.realAdminName  = undefined;
          token.__realAdmin    = undefined;
        }
        return token;
      }

      // On first sign-in, user object is populated
      if (user) {
        // Credentials provider already attaches role + sanityId + alias
        if ("sanityId" in user && user.sanityId) {
          token.role     = (user as any).role;
          token.sanityId = user.sanityId;
          token.alias    = (user as any).alias ?? null;
          return token;
        }
        // SSO providers: look up member by email
        if (token.email) {
          const member = await getMemberByEmail(token.email);
          if (member) {
            token.role     = member.role ?? "member";
            token.sanityId = member._id;
            token.alias    = member.alias ?? null;
          }
          // If member not found, sanityId stays undefined → middleware redirects
        }
      }

      // Backfill alias for sessions that predate this field (runs once, then cached in JWT)
      if (token.alias === undefined && token.sanityId) {
        try {
          const m = await serverClient.fetch<{ alias?: string | null } | null>(
            `*[_type == "teamMembers" && _id == $id][0] { alias }`,
            { id: token.sanityId }
          );
          token.alias = m?.alias ?? null;
        } catch { /* non-fatal */ }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id              = token.sub ?? "";
        session.user.role            = token.role ?? "member";
        session.user.sanityId        = token.sanityId ?? "";
        session.user.alias           = token.alias ?? null;
        session.user.isImpersonating = token.isImpersonating ?? false;
        session.user.realAdminName   = token.realAdminName;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
