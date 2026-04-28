import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { serverClient, writeClient } from "./sanity/lib/serverClient";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

type SanityMember = {
  _id: string;
  member_name: string;
  role: OWTRole | null;
  passwordHash: string | null;
};

async function getMemberByEmail(email: string): Promise<SanityMember | null> {
  return serverClient.fetch(
    `*[_type == "teamMembers" && lower(email) == lower($email)][0] {
      _id, member_name, role, passwordHash
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
          const target = await serverClient.fetch<{ _id: string; member_name: string; role: OWTRole | null } | null>(
            `*[_type == "teamMembers" && _id == $id][0] { _id, member_name, role }`,
            { id: updatePayload.impersonating }
          );
          if (target) {
            token.__realAdmin = {
              role:     token.role ?? "member",
              sanityId: token.sanityId ?? "",
              name:     token.name,
            };
            token.role           = target.role ?? "member";
            token.sanityId       = target._id;
            token.name           = target.member_name;
            token.isImpersonating = true;
            token.realAdminName  = token.__realAdmin.name ?? undefined;
          }
        } else if (updatePayload.stopImpersonating && token.__realAdmin) {
          token.role           = token.__realAdmin.role;
          token.sanityId       = token.__realAdmin.sanityId;
          token.name           = token.__realAdmin.name;
          token.isImpersonating = false;
          token.realAdminName  = undefined;
          token.__realAdmin    = undefined;
        }
        return token;
      }

      // On first sign-in, user object is populated
      if (user) {
        // Credentials provider already attaches role + sanityId
        if ("sanityId" in user && user.sanityId) {
          token.role     = (user as any).role;
          token.sanityId = user.sanityId;
          return token;
        }
        // SSO providers: look up member by email
        if (token.email) {
          const member = await getMemberByEmail(token.email);
          if (member) {
            token.role     = member.role ?? "member";
            token.sanityId = member._id;
          }
          // If member not found, sanityId stays undefined → middleware redirects
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id              = token.sub ?? "";
        session.user.role            = token.role ?? "member";
        session.user.sanityId        = token.sanityId ?? "";
        session.user.isImpersonating = token.isImpersonating ?? false;
        session.user.realAdminName   = token.realAdminName;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
