import "next-auth";
import "next-auth/jwt";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: OWTRole;
      sanityId: string;
      isImpersonating?: boolean;
      realAdminName?: string;
    };
  }
  interface User {
    role?: OWTRole;
    sanityId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: OWTRole;
    sanityId?: string;
    isImpersonating?: boolean;
    realAdminName?: string;
    __realAdmin?: {
      role: OWTRole;
      sanityId: string;
      name: string | null | undefined;
    };
  }
}
