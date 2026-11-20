// Native-app sign-in — the CSRF rule of the code-minting POST (spec §3.2).
// Pure. `Sec-Fetch-Site` first: present → it must be `same-origin`. Absent →
// `Origin` must be present and EXACTLY the canonical origin; a missing `Origin`
// or the literal `null` is refused. Every browser the apps sign in through
// (Chrome 137+, Safari on iOS 17.4+) sends `Sec-Fetch-Site`.

export function sameOriginPost(headers: Pick<Headers, "get">, origin: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const requestOrigin = headers.get("origin");
  return requestOrigin !== null && requestOrigin !== "null" && requestOrigin === origin;
}
