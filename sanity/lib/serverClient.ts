import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "../env";

// Private server-side Sanity client — bypasses CDN, uses a read token.
// ONLY use in Server Components, Route Handlers, or NextAuth callbacks.
// NEVER import this in "use client" files.
export const serverClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  token: process.env.SANITY_API_READ_TOKEN,
});
