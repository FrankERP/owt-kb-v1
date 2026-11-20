// Native-app sign-in — the minimal HTML answer a route handler of the sign-in
// flow shows the PERSON (a refusal, a stale GET). No script, no external asset;
// both strings are fixed copy from the callers, still escaped.

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function appAuthHtmlPage(
  title: string,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>Backstage</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;` +
    `justify-content:center;color-scheme:light dark;font-family:system-ui,sans-serif;text-align:center;` +
    `padding:24px}h1{font-size:20px;text-transform:uppercase;letter-spacing:.05em}p{opacity:.8;font-size:16px}</style>` +
    `</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      ...extraHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
