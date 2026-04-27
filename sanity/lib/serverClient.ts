import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "../env";

// Read-only client — used in NextAuth callbacks and Server Components.
export const serverClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  token: process.env.SANITY_API_READ_TOKEN,
});

// Write-capable client — used in admin API routes that mutate data.
export const writeClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});
