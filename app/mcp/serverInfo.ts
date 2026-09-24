// The MCP server's identity: the name and version `initialize` reports as
// `serverInfo` and `ping` repeats in its payload (R22), so Frank can tell from
// the phone which deployment answered. Pure; reads only the env it is handed.

export const MCP_SERVER_NAME = "owt-backstage";

/**
 * The first 7 characters of `VERCEL_GIT_COMMIT_SHA` (set by Vercel on every
 * deployment; the repo is public, so the commit is not sensitive), or
 * `"local"` when it is absent or empty.
 */
export function mcpServerVersion(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === "string" && sha !== "" ? sha.slice(0, 7) : "local";
}
